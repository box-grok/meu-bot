/**
 * WhatsApp do Hermes (gateway do Hermes Agent na máquina): estado da conexão e pareamento por QR,
 * tudo por SSH, usando o bridge oficial do Hermes em modo `--pair-only --pair-json` (emite JSON por
 * linha: started, qr, connected, disconnected, error). O QR vira imagem aqui no main (pacote qrcode)
 * e vai para a janela como data URL.
 *
 * Pareamento: para o gateway (senão o bridge dele disputa a mesma sessão), opcionalmente move a
 * sessão deslogada para session.loggedout-<ts> (como o próprio Hermes faz), roda o bridge, e no fim
 * (ou se a pessoa cancelar: trap no script remoto) sobe o gateway de novo pelo PM2.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { toDataURL } from "qrcode";
import type { WhatsappEvent, WhatsappStatus } from "../shared/ipc";
import { log } from "./backend";
import { LOCAL_HOST } from "./localBackend";
import { isValidHost } from "./settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

const STATUS_SCRIPT = `
S=$HOME/.hermes/whatsapp
if [ ! -d "$S" ]; then echo present=0; exit 0; fi
echo present=1
echo "health=$(curl -s -m 3 http://127.0.0.1:3000/health 2>/dev/null | tr -d '\\n')"
echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$S/session/creds.json" 2>/dev/null)"
echo "loggedout=$(tail -8 "$S/bridge.log" 2>/dev/null | grep -c 'Logged out')"
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

/** Estado do WhatsApp do Hermes na máquina. `present=false` quando a máquina não tem Hermes com WhatsApp. */
export async function whatsappStatus(host: string): Promise<WhatsappStatus> {
  const none: WhatsappStatus = { present: false, connected: false, state: "ausente", number: null, loggedOut: false, detail: "" };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  const r = await runSsh(host, STATUS_SCRIPT, 40_000);
  if (r.code !== 0) return { ...none, detail: `não consegui consultar: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}` };
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  if (kv.get("present") !== "1") return none;
  let state = "sem bridge";
  try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; if (typeof h.status === "string") state = h.status; } catch { /* bridge fora do ar */ }
  const number = phoneOf(kv.get("me") ?? "");
  const loggedOut = Number(kv.get("loggedout") ?? "0") > 0;
  // O bridge do Hermes reporta "connected"/"disconnected" (não o "open" do Baileys).
  const connected = state === "connected" || state === "open";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : `bridge ${state}`;
  return { present: true, connected, state, number, loggedOut, detail };
}

const PAIR_SCRIPT = `
set -u
export PATH=$HOME/.local/bin:$HOME/bin:$PATH
S=$HOME/.hermes/whatsapp
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
`;

let current: { host: string; child: ChildProcess } | null = null;

export const pairingInProgress = (): string | null => current?.host ?? null;

/** Inicia o pareamento; os eventos vão por `send`. Resolve quando o processo remoto termina. */
export function startPairing(host: string, reset: boolean, send: (ev: WhatsappEvent) => void): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) { send({ kind: "error", text: "esta máquina não tem o WhatsApp do Hermes" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "error", text: `já há um pareamento em andamento em ${current.host}` }); return Promise.resolve(); }
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { stdio: ["pipe", "pipe", "pipe"] });
    current = { host, child };
    let buf = ""; let connected = false; let stderr = "";
    send({ kind: "step", text: `conectando a ${host} por SSH` });
    const handle = async (line: string): Promise<void> => {
      let ev: { event?: string; qr?: string; step?: string; user?: { id?: string }; error?: string; reason?: unknown; session?: string };
      try { ev = JSON.parse(line) as typeof ev; } catch { send({ kind: "log", text: line }); return; }
      switch (ev.event) {
        case "meu-bot":
          if (ev.step === "gateway-stopped") send({ kind: "step", text: "gateway do Hermes pausado durante o pareamento" });
          else if (ev.step === "session-moved") send({ kind: "step", text: "sessão deslogada guardada como session.loggedout-…" });
          else if (ev.step === "gateway-started") send({ kind: "step", text: "gateway do Hermes de volta no ar" });
          break;
        case "started": send({ kind: "step", text: "bridge do Hermes iniciado; gerando o QR…" }); break;
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
