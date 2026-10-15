/**
 * WhatsApp do agente da máquina: estado da conexão e pareamento por QR, tudo por SSH. O app não
 * pressupõe o agente; o script remoto descobre e cada caminho emite os mesmos eventos para a janela.
 *
 * - Hermes (~/.hermes/whatsapp): bridge oficial em modo `--pair-only --pair-json` (JSON por linha:
 *   started, qr, connected, disconnected, error). Para o gateway no PM2 durante o pareamento (senão o
 *   bridge dele disputa a sessão) e o sobe de novo no fim ou no cancelamento (trap).
 * - OpenClaw (CLI `openclaw`): `channels status --json` para o estado e `channels login --channel
 *   whatsapp` para parear. O QR sai como blocos no terminal; qr-blocks.ts o vira imagem. Depois de
 *   vinculado, reinicia o gateway (supervisord se ele o gerencia, senão `openclaw gateway restart`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { toDataURL } from "qrcode";
import { BlockQrCollector, blocksToSvgDataUrl, stripAnsi } from "./qr-blocks";
import type { Gateway, WhatsappEvent, WhatsappStatus } from "../shared/ipc";
import { log } from "./backend";
import { LOCAL_HOST } from "./localBackend";
import { isValidHost } from "./settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

const STATUS_SCRIPT = `
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
S=$HOME/.hermes/whatsapp
if [ -d "$S" ]; then
  echo gateway=hermes; echo present=1
  echo "health=$(curl -s -m 3 http://127.0.0.1:3000/health 2>/dev/null | tr -d '\\n')"
  echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$S/session/creds.json" 2>/dev/null)"
  echo "loggedout=$(tail -8 "$S/bridge.log" 2>/dev/null | grep -c 'Logged out')"
  exit 0
fi
if command -v openclaw >/dev/null 2>&1; then
  echo gateway=openclaw; echo present=1
  echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null)"
  echo "oc=$(timeout 25 openclaw channels status --channel whatsapp --json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin); c=d.get("channels",{}).get("whatsapp") or {}
print(json.dumps({"linked":c.get("linked"),"connected":c.get("connected"),"state":c.get("statusState"),"lifecycle":c.get("lifecycle"),"loggedOut":(c.get("lastDisconnect") or {}).get("loggedOut"),"e164":(c.get("self") or {}).get("e164"),"starting":d.get("status")=="starting"}))' 2>/dev/null)"
  exit 0
fi
echo present=0
`;

function runSsh(host: string, script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: e.message }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
    child.stdin.on("error", () => { /* ssh caiu antes de ler */ });
    child.stdin.end(script);
  });
}

const phoneOf = (jid: string): string | null => { const m = /^(\d{8,15})[:@]/.exec(jid); return m === null ? null : m[1]!; };

/** Estado do WhatsApp do agente da máquina. `present=false` quando não há Hermes nem OpenClaw. */
export async function whatsappStatus(host: string): Promise<WhatsappStatus> {
  const none: WhatsappStatus = { present: false, gateway: null, connected: false, state: "ausente", number: null, loggedOut: false, detail: "" };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  const r = await runSsh(host, STATUS_SCRIPT, 45_000);
  if (r.code !== 0) return { ...none, detail: `não consegui consultar: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}` };
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  if (kv.get("present") !== "1") return none;
  const gateway: Gateway = kv.get("gateway") === "openclaw" ? "openclaw" : "hermes";
  if (gateway === "openclaw") return openclawStatus(kv);
  let state = "sem bridge";
  try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; if (typeof h.status === "string") state = h.status; } catch { /* bridge fora do ar */ }
  const number = phoneOf(kv.get("me") ?? "");
  const loggedOut = Number(kv.get("loggedout") ?? "0") > 0;
  // O bridge do Hermes reporta "connected"/"disconnected" (não o "open" do Baileys).
  const connected = state === "connected" || state === "open";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : `bridge ${state}`;
  return { present: true, gateway, connected, state, number, loggedOut, detail };
}

/** `channels status --json` do OpenClaw; sem gateway no ar, sobra o número do creds.json. */
function openclawStatus(kv: Map<string, string>): WhatsappStatus {
  let oc: { linked?: unknown; connected?: unknown; state?: unknown; lifecycle?: unknown; loggedOut?: unknown; e164?: unknown; starting?: unknown } = {};
  try { oc = JSON.parse(kv.get("oc") || "{}") as typeof oc; } catch { /* gateway fora do ar ou CLI sem --json */ }
  const number = phoneOf(kv.get("me") ?? "") ?? (typeof oc.e164 === "string" ? oc.e164.replace(/\D/g, "") || null : null);
  const connected = oc.connected === true;
  const loggedOut = oc.loggedOut === true;
  const state = typeof oc.state === "string" ? oc.state : oc.starting === true ? "gateway iniciando" : kv.get("oc") ? "sem estado" : "gateway fora do ar";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : oc.linked === true ? `vinculado, ${state}` : state;
  return { present: true, gateway: "openclaw", connected, state, number, loggedOut, detail };
}

const PAIR_SCRIPT = `
set -u
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
S=$HOME/.hermes/whatsapp
if [ -d "$S" ]; then
  B=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent/scripts/whatsapp-bridge
  if [ ! -f "$B/bridge.js" ]; then echo '{"event":"error","error":"bridge do Hermes não encontrado nesta máquina"}'; exit 2; fi
  pm2 stop hermes-gateway >/dev/null 2>&1; echo '{"event":"meu-bot","step":"gateway-stopped"}'
  restart() { pm2 start hermes-gateway >/dev/null 2>&1; echo '{"event":"meu-bot","step":"gateway-started"}'; }
  if [ "$RESET" = "1" ] && [ -d "$S/session" ]; then mv "$S/session" "$S/session.loggedout-$(date +%s)"; echo '{"event":"meu-bot","step":"session-moved"}'; fi
  mkdir -p "$S/session"
  cd "$B" || { restart; exit 2; }
  node bridge.js --pair-only --pair-json --session "$S/session" --mode bot 2>&1 &
  NODE=$!
  trap 'kill $NODE 2>/dev/null; restart; exit 130' HUP TERM INT
  ( sleep 300; kill $NODE 2>/dev/null ) & T=$!
  wait $NODE; rc=$?
  kill $T 2>/dev/null
  trap - HUP TERM INT
  restart
  exit $rc
fi
if command -v openclaw >/dev/null 2>&1; then
  echo '{"event":"meu-bot","step":"openclaw"}'
  if [ "$RESET" = "1" ]; then timeout 60 openclaw channels logout --channel whatsapp >/dev/null 2>&1; echo '{"event":"meu-bot","step":"logged-out"}'; fi
  # Gateway: sob supervisord (computador do Grok Bot) o programa se chama openclaw-gateway; senão o daemon do próprio openclaw.
  GW=$(supervisorctl status 2>/dev/null | awk '/openclaw-gateway/ {print $1; exit}')
  restart() { if [ -n "$GW" ]; then supervisorctl restart "$GW" >/dev/null 2>&1; else openclaw gateway restart >/dev/null 2>&1; fi; echo '{"event":"meu-bot","step":"gateway-started"}'; }
  echo '{"event":"started"}'
  # O CLI pode ficar pendurado depois de vincular (sincronizando); a janela não deve esperar por isso.
  # Um vigia lê a saída: viu "linked/paired/…", dá 4 s para o CLI guardar as credenciais e o encerra.
  LOG=$(mktemp); rm -f "$LOG.linked"
  openclaw channels login --channel whatsapp >"$LOG" 2>&1 &
  P=$!
  tail -n +1 -F --pid=$P "$LOG" 2>/dev/null & TAIL=$!
  ( while kill -0 $P 2>/dev/null; do grep -qiE 'linked|logged in|successfully|paired|authenticated' "$LOG" 2>/dev/null && { touch "$LOG.linked"; sleep 4; kill $P 2>/dev/null; break; }; sleep 1; done ) & W=$!
  trap 'kill $P $W 2>/dev/null; exit 130' HUP TERM INT
  ( sleep 300; kill $P 2>/dev/null ) & T=$!
  wait $P; rc=$?
  kill $T $W 2>/dev/null; wait $TAIL 2>/dev/null
  trap - HUP TERM INT
  LINKED=0; [ -f "$LOG.linked" ] && LINKED=1
  rm -f "$LOG" "$LOG.linked"
  if [ $rc -eq 0 ] || [ $LINKED -eq 1 ]; then restart; exit 0; fi
  exit $rc
fi
echo '{"event":"error","error":"esta máquina não tem Hermes nem OpenClaw com WhatsApp"}'; exit 2
`;

/** `openclaw channels login` vinculou (mesmas pistas do qr-code-openclaw). */
const OC_LINKED_RE = /linked|logged in|successfully|paired|authenticated|syncing|sync complete|bootstrap/i;
const OC_FAIL_RE = /failed|error|timeout/i;

let current: { host: string; child: ChildProcess } | null = null;

export const pairingInProgress = (): string | null => current?.host ?? null;

/** Inicia o pareamento; os eventos vão por `send`. Resolve quando o processo remoto termina. */
export function startPairing(host: string, reset: boolean, send: (ev: WhatsappEvent) => void): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) { send({ kind: "error", text: "este Mac não tem agente com WhatsApp" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "error", text: `já há um pareamento em andamento em ${current.host}` }); return Promise.resolve(); }
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { stdio: ["pipe", "pipe", "pipe"] });
    current = { host, child };
    let buf = ""; let connected = false; let stderr = ""; let openclaw = false;
    const qr = new BlockQrCollector();
    send({ kind: "step", text: `conectando a ${host} por SSH` });
    // Linha de texto do `openclaw channels login`: blocos do QR, pistas de vinculado/falha, ou log.
    const handleText = (raw: string): void => {
      const line = stripAnsi(raw).trimEnd();
      const done = qr.feed(line);
      if (done !== null) send({ kind: "qr", dataUrl: blocksToSvgDataUrl(done) });
      const clean = line.trim();
      if (clean === "") return;
      if (/[█▀▄]/.test(clean)) return;
      send({ kind: "log", text: clean });
      if (!connected && OC_LINKED_RE.test(clean)) { connected = true; send({ kind: "connected", number: null }); }
      else if (!connected && OC_FAIL_RE.test(clean)) send({ kind: "error", text: clean });
    };
    const handle = async (line: string): Promise<void> => {
      let ev: { event?: string; qr?: string; step?: string; user?: { id?: string }; error?: string; reason?: unknown; session?: string };
      try { ev = JSON.parse(line) as typeof ev; } catch { if (openclaw) handleText(line); else send({ kind: "log", text: line }); return; }
      switch (ev.event) {
        case "meu-bot":
          if (ev.step === "openclaw") { openclaw = true; send({ kind: "step", text: "OpenClaw nesta máquina; usando `openclaw channels login`" }); }
          else if (ev.step === "gateway-stopped") send({ kind: "step", text: "gateway do Hermes pausado durante o pareamento" });
          else if (ev.step === "session-moved") send({ kind: "step", text: "sessão deslogada guardada como session.loggedout-…" });
          else if (ev.step === "logged-out") send({ kind: "step", text: "sessão anterior desfeita (channels logout)" });
          else if (ev.step === "gateway-started") send({ kind: "step", text: "gateway de volta no ar" });
          break;
        case "started": send({ kind: "step", text: openclaw ? "gerando o QR…" : "bridge do Hermes iniciado; gerando o QR…" }); break;
        case "qr":
          if (typeof ev.qr === "string" && ev.qr !== "") {
            try { send({ kind: "qr", dataUrl: await toDataURL(ev.qr, { margin: 1, width: 360 }) }); } catch (e) { send({ kind: "error", text: `não consegui desenhar o QR: ${e instanceof Error ? e.message : String(e)}` }); }
          }
          break;
        case "disconnected": send({ kind: "log", text: `desconectado (${String(ev.reason ?? "?")}); tentando de novo…` }); break;
        case "connected": connected = true; send({ kind: "connected", number: phoneOf(ev.user?.id ?? "") }); break;
        case "error": send({ kind: "error", text: ev.error === "logged_out" ? "o WhatsApp recusou a sessão (logged out). Use \"Reparear\" para apagar a sessão e gerar um QR novo." : (ev.error ?? "erro no bridge") }); break;
        default: send({ kind: "log", text: line });
      }
    };
    let chain = Promise.resolve();
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line !== "") chain = chain.then(() => handle(line)); }
    });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.stdin.on("error", () => { /* ssh caiu */ });
    child.stdin.end(`RESET=${reset ? "1" : "0"}\n${PAIR_SCRIPT}`);
    child.on("error", (e) => { send({ kind: "error", text: `não consegui iniciar o ssh: ${e.message}` }); });
    child.on("close", (code) => {
      void chain.then(() => {
        const pending = qr.flush();
        if (pending !== null) send({ kind: "qr", dataUrl: blocksToSvgDataUrl(pending) });
        if (!connected && code !== 0 && code !== null) send({ kind: "error", text: `o pareamento terminou sem conectar (código ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}` });
        send({ kind: "done", ok: connected });
        log(`[whatsapp] pareamento em ${host}: ${connected ? "conectado" : `não conectou (código ${code})`}`);
        current = null;
        resolve();
      });
    });
  });
}

/** Cancela o pareamento em andamento; o script remoto sobe o gateway de novo (trap). */
export function cancelPairing(): void {
  if (current === null) return;
  try { current.child.kill("SIGTERM"); } catch { /* ok */ }
}
