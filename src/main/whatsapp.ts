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
import type { Gateway, VoiceReplyMode, WhatsappChat, WhatsappDmPolicy, WhatsappEvent, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "../shared/ipc";
import { chatsFromSessions, ownSessionKeys, gatewayFailures, peerOfSessionKey, threadFor, threadToMarkdown, whatsappContextNote, type SessionHistory } from "./whatsapp-chats";
import { WA_MARKS_FILE, applyWaMarks, parseWaMarks, waMarkSh, type WaMarkPatch } from "./whatsapp-marks";
import { localWhenText, pauseNoteSh, pauseNoteText, pauseRuleSh, type PauseBy } from "./whatsapp-pause";
import { createFromWhatsapp, type StoredConversation } from "./conversation";
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
  echo "bin=$(command -v hermes 2>/dev/null)"
  echo "ver=$(timeout 10 hermes --version 2>/dev/null | head -1)"
  B=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent/scripts/whatsapp-bridge
  [ -f "$B/bridge.js" ] && echo bridge=1 || echo bridge=0
  echo "health=$(curl -s -m 3 http://127.0.0.1:3000/health 2>/dev/null | tr -d '\\n')"
  echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$S/session/creds.json" 2>/dev/null)"
  echo "loggedout=$(tail -8 "$S/bridge.log" 2>/dev/null | grep -c 'Logged out')"
  exit 0
fi
if command -v openclaw >/dev/null 2>&1; then
  echo gateway=openclaw; echo present=1
  echo "bin=$(command -v openclaw)"
  echo "real=$(readlink -f "$(command -v openclaw)" 2>/dev/null)"
  echo "ver=$(timeout 10 openclaw --version 2>/dev/null | head -1)"
  [ -f "$HOME/.openclaw/openclaw.json" ] && echo cfg=1 || echo cfg=0
  # Plugin do WhatsApp instalado? (não vem de fábrica; é do ClawHub)
  echo "plugin=$(timeout 25 openclaw plugins list 2>/dev/null | grep -ci whatsapp)"
  echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null)"
  # Sem config não há gateway; pular o channels status poupa 25 s.
  [ -f "$HOME/.openclaw/openclaw.json" ] || exit 0
  echo "dmpolicy=$(timeout 15 openclaw config get channels.whatsapp.dmPolicy 2>/dev/null | tr -d '"' | head -1)"
  echo "channel=$(timeout 15 openclaw config get channels.whatsapp --json 2>/dev/null | tr -d '\n' | tr -s ' ')"
  # Áudio: transcritor em tools.media.models e quando a voz responde (tts.auto; sem provedor = sem voz).
  python3 -c 'import json,os
try:
  c=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
except Exception:
  raise SystemExit
m=(c.get("tools") or {}).get("media") or {}
print("audioin=%d" % any("audio" in (x.get("capabilities") or []) for x in (m.get("models") or []) if isinstance(x, dict)))
t=c.get("tts") or {}
print("voz=%s" % (t.get("auto") or "off" if t.get("provider") else ""))' 2>/dev/null
  echo "oc=$(timeout 25 openclaw channels status --channel whatsapp --json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin); c=d.get("channels",{}).get("whatsapp") or {}
print(json.dumps({"linked":c.get("linked"),"connected":c.get("connected"),"state":c.get("statusState"),"lifecycle":c.get("lifecycle"),"loggedOut":(c.get("lastDisconnect") or {}).get("loggedOut"),"e164":(c.get("self") or {}).get("e164"),"starting":d.get("status")=="starting"}))' 2>/dev/null)"
  exit 0
fi
echo present=0
`;

export function runSsh(host: string, script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
  const none: WhatsappStatus = { present: false, gateway: null, agent: "", ready: false, missing: null, connected: false, state: "ausente", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  const r = await runSsh(host, STATUS_SCRIPT, 60_000);
  if (r.code !== 0) return { ...none, detail: `não consegui consultar: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}` };
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  if (kv.get("present") !== "1") return none;
  const gateway: Gateway = kv.get("gateway") === "openclaw" ? "openclaw" : "hermes";
  if (gateway === "openclaw") return openclawStatus(kv);
  const agent = describeInstall("Hermes", kv);
  const ready = kv.get("bridge") === "1";
  if (!ready) return { present: true, gateway, agent, ready, missing: "o bridge do WhatsApp não está nesta instalação do Hermes", connected: false, state: "sem bridge", number: null, loggedOut: false, detail: "Hermes sem o bridge do WhatsApp", dmPolicy: null, channelConfig: null };
  let state = "sem bridge";
  try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; if (typeof h.status === "string") state = h.status; } catch { /* bridge fora do ar */ }
  const number = phoneOf(kv.get("me") ?? "");
  const loggedOut = Number(kv.get("loggedout") ?? "0") > 0;
  // O bridge do Hermes reporta "connected"/"disconnected" (não o "open" do Baileys).
  const connected = state === "connected" || state === "open";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : `bridge ${state}`;
  return { present: true, gateway, agent, ready, missing: null, connected, state, number, loggedOut, detail, dmPolicy: null, channelConfig: null };
}

/** "OpenClaw 2026.9.9 em /usr/local/bin (global, todos os usuários)": versão, caminho e se é do sistema ou só deste usuário. */
function describeInstall(name: string, kv: Map<string, string>): string {
  // "OpenClaw 2026.9.9 (bcfc888)" → "2026.9.9": o hash do commit não ajuda ninguém na tela.
  const ver = (kv.get("ver") ?? "").replace(new RegExp(`^${name}\\s*`, "i"), "").replace(/\s*\([0-9a-f]{6,}\)\s*$/i, "").trim();
  const bin = kv.get("bin") ?? "";
  const real = kv.get("real") ?? "";
  const where = bin === "" ? "" : ` em ${bin.replace(/\/[^/]+$/, "")}`;
  const scope = bin === "" ? "" : bin.startsWith("/home/") || bin.startsWith("/Users/") || bin.startsWith("/root/") ? " (só deste usuário)" : ` (global, todos os usuários${real !== "" && real !== bin ? `; ${real.replace(/\/[^/]+$/, "")}` : ""})`;
  return `${name}${ver === "" ? "" : ` ${ver}`}${where}${scope}`;
}

/** `channels status --json` do OpenClaw; sem gateway no ar, sobra o número do creds.json. */
function openclawStatus(kv: Map<string, string>): WhatsappStatus {
  const agent = describeInstall("OpenClaw", kv);
  const plugin = Number(kv.get("plugin") ?? "0") > 0;
  const cfg = kv.get("cfg") === "1";
  if (!plugin || !cfg) {
    const faltas = [...(!cfg ? ["sem configuração (~/.openclaw/openclaw.json)"] : []), ...(!plugin ? ["sem o plugin do WhatsApp: `openclaw plugins install clawhub:@openclaw/whatsapp`"] : [])];
    return { present: true, gateway: "openclaw", agent, ready: false, missing: faltas.join("\n"), connected: false, state: "sem configurar", number: null, loggedOut: false, detail: `OpenClaw instalado, mas ${!cfg ? "sem configurar" : "sem o plugin do WhatsApp"}`, dmPolicy: null, channelConfig: null };
  }
  let oc: { linked?: unknown; connected?: unknown; state?: unknown; lifecycle?: unknown; loggedOut?: unknown; e164?: unknown; starting?: unknown } = {};
  try { oc = JSON.parse(kv.get("oc") || "{}") as typeof oc; } catch { /* gateway fora do ar ou CLI sem --json */ }
  const number = phoneOf(kv.get("me") ?? "") ?? (typeof oc.e164 === "string" ? oc.e164.replace(/\D/g, "") || null : null);
  const connected = oc.connected === true;
  const loggedOut = oc.loggedOut === true;
  const state = typeof oc.state === "string" ? oc.state : oc.starting === true ? "gateway iniciando" : kv.get("oc") ? "sem estado" : "gateway fora do ar";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : oc.linked === true ? (state === "linked" ? "vinculado, conectando" : `vinculado, ${state}`) : state;
  const dm = kv.get("dmpolicy") ?? "";
  const dmPolicy: WhatsappDmPolicy | null = dm === "pairing" || dm === "allowlist" || dm === "open" || dm === "disabled" ? dm : dm === "" ? "pairing" : null; // sem valor autorado, o OpenClaw usa pairing
  let channelConfig: string | null = null;
  try { const raw = kv.get("channel") ?? ""; if (raw !== "") channelConfig = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* sem bloco ainda */ }
  const voz = kv.get("voz");
  const audioOut: VoiceReplyMode | null = voz === "inbound" || voz === "always" ? voz : voz === undefined || voz === "" ? null : "off";
  return { present: true, gateway: "openclaw", agent, ready: true, missing: null, connected, state, number, loggedOut, detail, dmPolicy, channelConfig, audioIn: kv.get("audioin") === "1", audioOut };
}

/**
 * Quem o agente responde nas DMs do WhatsApp (OpenClaw). "self" = só você: `dmPolicy allowlist` com `allowFrom`
 * vazio e `selfChatMode true` (as mensagens que você manda para o próprio número entram; mais ninguém recebe
 * resposta nem código). "open" = todo mundo: `dmPolicy open` + `allowFrom ["*"]`. Grupos ficam desativados nos
 * dois. O OpenClaw aplica sem reiniciar o gateway.
 */
/** Número pareado lido direto do creds.json (barato); evita o `channels status` caro só para montar o allowFrom. */
async function readSelfNumber(host: string): Promise<string | null> {
  const script = `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null\n`;
  const r = await runSsh(host, script, 15_000);
  return phoneOf(r.stdout.trim());
}

/** " && <trava>" com o número pareado; sem número (ainda não pareou), nada. */
async function ownerLockFor(host: string): Promise<string> {
  const n = await readSelfNumber(host);
  return n === null ? "" : ` && ${ownerLockSh(n)}`;
}

export async function setDmPolicy(host: string, policy: WhatsappReplyChoice): Promise<WhatsappStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const script = policy === "open"
    ? `export PATH=$HOME/.local/bin:$PATH; set -e; openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.dmPolicy open && openclaw config set channels.whatsapp.allowFrom '["*"]' --strict-json && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json${await ownerLockFor(host)}`
    : `export PATH=$HOME/.local/bin:$PATH; set -e; ${selfPolicySh(await readSelfNumber(host))}`;
  const r = await runSsh(host, `${script}\n`, 60_000);
  if (r.code !== 0) throw new Error(`não consegui mudar a política: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou"}`);
  log(`[whatsapp] ${host}: dmPolicy=${policy}`);
  return whatsappStatus(host);
}



/** Política "só você" (ver setDmPolicy); também é o padrão gravado antes do primeiro login. */
export const SELF_POLICY_SH = `openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.dmPolicy allowlist && openclaw config set channels.whatsapp.allowFrom '[]' --strict-json && openclaw config set channels.whatsapp.selfChatMode true --strict-json && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json`;
/** Com o número já conhecido, ele entra no allowFrom: tira o aviso "allowFrom vazio" e deixa explícito quem é "você". */
const selfPolicySh = (number: string | null): string => number === null ? SELF_POLICY_SH : `${SELF_POLICY_SH.replace(`'[]'`, `'["+${number}"]'`)} && ${ownerLockSh(number)}`;

/** O que um contato que não é o dono não pode usar: gravar, editar, rodar comandos, agendar, mexer no gateway. */
export const NON_OWNER_DENY = ["write", "edit", "apply_patch", "exec", "process", "cron", "gateway"] as const;
/**
 * Trava do dono (`tools.toolsBySender`): o número pareado sem restrição; qualquer outro remetente sem as
 * ferramentas que mudam a máquina ou o próprio agente (nome, personalidade, arquivos). Sem isso, um contato
 * pedia e o agente reescrevia o IDENTITY.md. O claude-cli aplica por argv (`nativeToolMode: selectable`).
 * Só grava se estiver vazio ou já for a do meu-bot (tem `apply_patch`): uma regra feita à mão fica.
 */
export const ownerLockSh = (number: string): string => {
  const lock = JSON.stringify({ [`e164:+${number}`]: {}, "*": { deny: NON_OWNER_DENY } });
  return `{ cur=$(openclaw config get tools.toolsBySender 2>&1 || true); case "$cur" in *unset*|*apply_patch*) openclaw config set tools.toolsBySender '${lock}' --strict-json >/dev/null ;; esac; }`;
};

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
  # O sleep do cronômetro não pode herdar a saída: um sleep órfão seguraria o ssh aberto até o fim dos 5 min.
  ( sleep 300 >/dev/null 2>&1; kill $NODE 2>/dev/null ) >/dev/null 2>&1 & T=$!
  wait $NODE; rc=$?
  pkill -P $T 2>/dev/null; kill $T 2>/dev/null
  trap - HUP TERM INT
  restart
  exit $rc
fi
if command -v openclaw >/dev/null 2>&1; then
  echo '{"event":"meu-bot","step":"openclaw"}'
  if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then echo '{"event":"error","error":"OpenClaw instalado, mas sem configurar nesta máquina (não há ~/.openclaw/openclaw.json); rode o onboarding do OpenClaw antes de parear"}'; exit 2; fi
  if ! timeout 25 openclaw plugins list 2>/dev/null | grep -qi whatsapp; then echo '{"event":"error","error":"OpenClaw sem o plugin do WhatsApp; na máquina: openclaw plugins install clawhub:@openclaw/whatsapp"}'; exit 2; fi
  # Padrão do OpenClaw é "pairing": qualquer desconhecido que mandar DM recebe um código. Antes de conectar, sem
  # política autorada, deixa silencioso (ninguém é respondido); a pessoa escolhe depois, no app ou no tutorial.
  if [ -z "$(openclaw config get channels.whatsapp.dmPolicy 2>/dev/null | tr -d '"')" ] || openclaw config get channels.whatsapp.dmPolicy 2>&1 | grep -q unset; then
    ( ${SELF_POLICY_SH} ) >/dev/null 2>&1 && echo '{"event":"meu-bot","step":"silent"}'
  fi
  if [ "$RESET" = "1" ]; then timeout 60 openclaw channels logout --channel whatsapp >/dev/null 2>&1; echo '{"event":"meu-bot","step":"logged-out"}'; fi
  # Gateway: sob supervisord (computador do Grok Bot) o programa se chama openclaw-gateway; senão o daemon do próprio openclaw.
  GW=$(supervisorctl status 2>/dev/null | awk '/openclaw-gateway/ {print $1; exit}')
  restart() { if [ -n "$GW" ]; then supervisorctl restart "$GW" >/dev/null 2>&1; else openclaw gateway restart >/dev/null 2>&1; fi; echo '{"event":"meu-bot","step":"gateway-started"}'; }
  echo '{"event":"started"}'
  # O CLI pode ficar pendurado depois de vincular (sincronizando); a janela não deve esperar por isso.
  # Um vigia lê a saída: viu "linked/paired/…", dá 4 s para o CLI guardar as credenciais e o encerra.
  LOG=$(mktemp); rm -f "$LOG.linked"
  # O app só faz um pareamento por vez: um login que ainda roda aqui é órfão (app fechado ou reinstalado no
  # meio do QR; sem terminal o ssh caído não manda HUP) e faz o novo falhar na hora.
  pkill -u "$(id -u)" -f "openclaw channels login" 2>/dev/null && sleep 1
  openclaw channels login --channel whatsapp >"$LOG" 2>&1 &
  P=$!
  tail -n +1 -F --pid=$P "$LOG" 2>/dev/null & TAIL=$!
  # Vinculou = o creds.json do WhatsApp ganhou o número (me.id). Texto não serve: o próprio convite diz
  # "go to Linked Devices", e casar "linked" fechava o QR antes de alguém escanear.
  CREDS=$HOME/.openclaw/credentials/whatsapp/default/creds.json
  # Vinculou = o creds.json foi reescrito DEPOIS de o login começar e tem número. Comparar só o número falhava:
  # ao reparear, o logout ainda não tinha limpado o arquivo e o número antigo virava um "conectado" falso.
  T0=$(date +%s)
  linked_now() { [ -f "$CREDS" ] || return 1; [ "$(stat -c %Y "$CREDS" 2>/dev/null || echo 0)" -ge "$T0" ] || return 1; ME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$CREDS" 2>/dev/null); [ -n "$ME" ]; }
  ( while kill -0 $P 2>/dev/null; do
      if linked_now; then
        touch "$LOG.linked"; echo "{\"event\":\"connected\",\"user\":{\"id\":\"$ME\"}}"
        # "só você": o número recém-vinculado entra no allowFrom (antes do login ele não existia).
        if [ "$(openclaw config get channels.whatsapp.dmPolicy 2>/dev/null | tr -d '"')" = "allowlist" ]; then NUM=$(printf '%s' "$ME" | sed 's/[:@].*//'); openclaw config set channels.whatsapp.allowFrom "[\"+$NUM\"]" --strict-json >/dev/null 2>&1; fi
        sleep 4; kill $P 2>/dev/null; break
      fi
      sleep 1
    done ) & W=$!
  trap 'kill $P $W 2>/dev/null; exit 130' HUP TERM INT
  ( sleep 300 >/dev/null 2>&1; kill $P 2>/dev/null ) >/dev/null 2>&1 & T=$!
  wait $P; rc=$?
  pkill -P $T 2>/dev/null; pkill -P $W 2>/dev/null; kill $T $W 2>/dev/null; wait $TAIL 2>/dev/null
  trap - HUP TERM INT
  LINKED=0; [ -f "$LOG.linked" ] && LINKED=1
  # O CLI encerra sozinho logo depois de vincular, às vezes antes de o vigia olhar: confere uma última vez.
  if [ $LINKED -eq 0 ]; then
    for _ in 1 2 3 4 5; do
      if linked_now; then LINKED=1; echo "{\"event\":\"connected\",\"user\":{\"id\":\"$ME\"}}"; break; fi
      sleep 1
    done
  fi
  rm -f "$LOG" "$LOG.linked"
  if [ $rc -eq 0 ] || [ $LINKED -eq 1 ]; then restart; exit 0; fi
  exit $rc
fi
echo '{"event":"error","error":"esta máquina não tem Hermes nem OpenClaw com WhatsApp"}'; exit 2
`;

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
    let buf = ""; let connected = false; let stderr = ""; let openclaw = false; let qrRounds = 0;
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
      // Linhas conhecidas do CLI viram passos em pt-BR; o convite se repete a cada QR novo (~20 s) e vira contador.
      if (/^Waiting for WhatsApp connection/i.test(clean)) { send({ kind: "step", text: "aguardando o WhatsApp" }); return; }
      if (/scan this QR/i.test(clean)) {
        qrRounds += 1;
        send({ kind: qrRounds === 1 ? "step" : "log", text: qrRounds === 1 ? "QR pronto: escaneie no celular" : `↻ QR renovado (${qrRounds}º)` });
        return;
      }
      if (/timed out before login|fresh socket/i.test(clean)) { send({ kind: "log", text: "↻ conexão com o WhatsApp renovada" }); return; }
      if (/^OpenClaw \d|^│$|^◇\s*$/.test(clean) || /^[A-Z][^.]*—/.test(clean)) return; // banner, moldura e frase de efeito do CLI
      send({ kind: "log", text: clean });
      // Conectado só vem do vigia do script (creds.json com número), em JSON; o texto do CLI só vai para o log.
      if (!connected && OC_FAIL_RE.test(clean)) send({ kind: "error", text: clean });
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
          else if (ev.step === "silent") send({ kind: "step", text: "padrão: só você fala com o agente; ninguém mais recebe resposta nem código" });
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
        case "error": send({ kind: "error", text: ev.error === "logged_out" ? "o WhatsApp recusou a sessão (logged out). Use \"Desconectar\" e depois conecte de novo para gerar um QR novo." : (ev.error ?? "erro no bridge") }); break;
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

// ---- Espelho só-leitura das conversas do WhatsApp (OpenClaw): `openclaw gateway call` pela CLI da máquina,
// sem emparelhar dispositivo. O parse fica em whatsapp-chats.ts; aqui só o IO e o cache de nomes por host.
const chatNames = new Map<string, Map<string, string>>();
const namesOf = (host: string): Map<string, string> => { let m = chatNames.get(host); if (m === undefined) { m = new Map(); chatNames.set(host, m); } return m; };
/** Só chaves que o próprio OpenClaw gera entram no script remoto (vão dentro de aspas simples). */
const SAFE_KEY = /^[A-Za-z0-9:+._-]{1,200}$/;
const CREDS_ME = `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null`;

export async function whatsappChats(host: string): Promise<WhatsappChat[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
echo "self=$(${CREDS_ME})"
echo "list=$(timeout 40 openclaw gateway call sessions.list --json --params '{"limit":200}' 2>/dev/null | tr -d '\n')"
echo "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\n')"
`;
  const r = await runSsh(host, script, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ler as conversas do WhatsApp: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1)); }
  let list: unknown = null;
  try { list = JSON.parse(kv.get("list") || "null"); } catch { throw new Error("o gateway do OpenClaw não respondeu à lista de conversas"); }
  // Arquivado/excluído/nomes moram na máquina (whatsapp-lista.json), na mesma leitura: os dois apps veem a mesma lista.
  let marks: unknown = null;
  try { marks = JSON.parse(kv.get("marks") || "null"); } catch { /* arquivo corrompido = sem marcas; a próxima gravação o refaz */ }
  const parsed = parseWaMarks(marks);
  // O cache de nomes semeia a memória (o pushname lido nesta sessão, se houver, continua valendo mais).
  const names = namesOf(host);
  for (const [n, e] of Object.entries(parsed.names)) if (e.name !== null && !names.has(n)) names.set(n, e.name);
  return applyWaMarks(chatsFromSessions(list, phoneOf(kv.get("self") ?? ""), names), parsed);
}

/**
 * Nomes dos contatos ainda sem nome, de uma vez: lê o histórico recente de cada um (a sessão própria; sem ela, a
 * principal, uma vez só), tira o pushname com `threadFor` e guarda na máquina para as próximas aberturas, dos dois
 * apps. Devolve só os achados. Quem não escreveu ainda fica sem nome (a tela não insiste nesta abertura).
 */
export async function whatsappLearnNames(host: string, numbers: readonly string[]): Promise<Record<string, string>> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const want = [...new Set(numbers.map((n) => n.replace(/\D/g, "")))].filter((n) => /^\d{8,15}$/.test(n)).slice(0, 20);
  if (want.length === 0) return {};
  const chats = await whatsappChats(host);
  const keys = new Set<string>();
  for (const n of want) {
    const chat = chats.find((c) => c.number === n);
    if (chat === undefined) continue;
    const own = chat.sessionKeys.filter((k) => SAFE_KEY.test(k) && peerOfSessionKey(k) === n);
    for (const k of (own.length > 0 ? own : chat.sessionKeys.filter((k) => SAFE_KEY.test(k)))) keys.add(k);
  }
  if (keys.size === 0) return {};
  const lines = [...keys].map((k) => `printf 'H\t%s\t' '${k}'; timeout 40 openclaw gateway call chat.history --json --params '{"sessionKey":"${k}","limit":40}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${lines}\n`, 120_000);
  if (r.code !== 0) throw new Error(`não consegui ler os nomes: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const histories: SessionHistory[] = [];
  for (const line of r.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] !== "H" || parts.length < 3) continue;
    try { histories.push({ sessionKey: parts[1]!, history: JSON.parse(parts.slice(2).join("\t")) }); } catch { /* sessão sem resposta */ }
  }
  const found: Record<string, string> = {};
  const names = namesOf(host);
  for (const n of want) {
    const t = threadFor(n, histories);
    if (t.name === null) continue;
    found[n] = t.name; names.set(n, t.name);
  }
  const patches = Object.entries(found).map(([number, name]) => ({ number, name }));
  if (patches.length > 0) await whatsappSetMarks(host, patches).catch((e: unknown) => log(`whatsapp: nomes não gravados em ${host}: ${e instanceof Error ? e.message : String(e)}`));
  log(`whatsapp: nomes descobertos em ${host}: ${patches.length} de ${want.length}`);
  return found;
}

/** Grava na máquina os ajustes de arquivado/excluído (merge lá, para o admin e a pessoa não se sobrescreverem). */
export async function whatsappSetMarks(host: string, patches: readonly WaMarkPatch[]): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const r = await runSsh(host, waMarkSh(patches), 20_000);
  if (r.code !== 0 || !r.stdout.includes("MARKS=1")) throw new Error(`não deu para gravar na máquina: ${r.stderr.trim().split("\n").pop() || "ssh falhou"}`);
  log(`whatsapp: marcações gravadas em ${host}: ${patches.map((p) => `${p.number}${p.archived !== undefined ? ` a=${p.archived}` : ""}${p.deleted !== undefined ? ` d=${p.deleted}` : ""}`).join(", ")}`);
}

export async function whatsappThread(host: string, number: string): Promise<WhatsappThreadMessage[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  const want = number.replace(/\D/g, "");
  if (want.length < 8) throw new Error("número inválido");
  const chat = (await whatsappChats(host)).find((c) => c.number === want);
  if (chat === undefined) return [];
  const keys = chat.sessionKeys.filter((k) => SAFE_KEY.test(k));
  // Uma linha por sessão: "H<TAB>chave<TAB>json".
  const lines = keys.map((k) => `printf 'H\t%s\t' '${k}'; timeout 40 openclaw gateway call chat.history --json --params '{"sessionKey":"${k}","limit":200}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${lines}\n`, 90_000);
  if (r.code !== 0) throw new Error(`não consegui ler a conversa: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const histories: SessionHistory[] = [];
  for (const line of r.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] !== "H" || parts.length < 3) continue;
    try { histories.push({ sessionKey: parts[1]!, history: JSON.parse(parts.slice(2).join("\t")) }); } catch { /* sessão sem resposta: fica de fora */ }
  }
  const t = threadFor(want, histories);
  // Pushname novo ou mudado: memória e cache na máquina acompanham (em segundo plano; a conversa já está lida).
  if (t.name !== null && namesOf(host).get(want) !== t.name) {
    namesOf(host).set(want, t.name);
    void whatsappSetMarks(host, [{ number: want, name: t.name }]).catch(() => { /* cache é opcional */ });
  }
  return t.messages;
}

/**
 * "Conversar com o meu-bot" (menu "…"): conversa nova do meu-bot nesta máquina com a conversa do WhatsApp
 * como contexto. Relê o histórico aqui (a fonte é o gateway, não o que o renderer mostrou).
 */
export async function whatsappBranch(host: string, number: string): Promise<StoredConversation> {
  const want = number.replace(/\D/g, "");
  const msgs = await whatsappThread(host, want);
  if (msgs.length === 0) throw new Error("não há mensagens para levar");
  // O título da conversa nova usa o apelido que a pessoa deu, se houver; senão o pushname; senão o número.
  const chat = (await whatsappChats(host).catch(() => [] as WhatsappChat[])).find((c) => c.number === want);
  const name = chat?.alias ?? namesOf(host).get(want) ?? `+${want}`;
  const ctx = whatsappContextNote(name, want, msgs);
  log(`whatsapp: conversa nova do meu-bot com ${ctx.count} mensagens de +${want} em ${host}`);
  return createFromWhatsapp(host, { number: want, name, count: ctx.count, until: msgs.at(-1)!.at, messages: msgs.slice(msgs.length - ctx.count) }, ctx.note);
}


/** Conversa inteira para exportar: Markdown legível ou JSON com contato, máquina e mensagens. */
export async function whatsappExportBody(host: string, number: string, format: "md" | "json"): Promise<{ name: string; body: string }> {
  const want = number.replace(/\D/g, "");
  const messages = await whatsappThread(host, want);
  const name = namesOf(host).get(want) ?? `+${want}`;
  const exportedAt = new Date().toISOString();
  const body = format === "md"
    ? threadToMarkdown(name, want, host, messages, exportedAt)
    : `${JSON.stringify({ channel: "whatsapp", contact: { name, number: `+${want}` }, host, exportedAt, messages }, null, 2)}\n`;
  return { name, body };
}

/** O que "Limpar histórico" vai zerar: sessões só do contato e, se houver, a principal (de todos). */
export async function whatsappClearPlan(host: string, number: string): Promise<{ own: string[]; shared: string[] }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const want = number.replace(/\D/g, "");
  const keys = ((await whatsappChats(host)).find((c) => c.number === want)?.sessionKeys ?? []).filter((k) => SAFE_KEY.test(k));
  const own = ownSessionKeys(want, keys);
  return { own, shared: keys.filter((k) => !own.includes(k)) };
}

/**
 * Zera as sessões com `gateway call sessions.reset` (o mesmo "/reset" do OpenClaw: sessão nova, o
 * transcript antigo vai para o arquivo dele) e esquece as memórias tiradas delas.
 */
export async function whatsappClearSessions(host: string, keys: readonly string[]): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const safe = keys.filter((k) => SAFE_KEY.test(k));
  if (safe.length === 0) throw new Error("não há histórico desta conversa na máquina");
  const lines = safe.map((k) => [
    `printf 'R\t%s\t' '${k}'; timeout 60 openclaw gateway call sessions.reset --json --params '{"key":"${k}","reason":"reset"}' 2>/dev/null | tr -d '\n'; echo`,
    `timeout 60 openclaw memory forget --agent '${k.split(":")[1]}' --session '${k}' >/dev/null 2>&1 || true`,
  ].join("\n")).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${lines}\n`, 180_000);
  const failed = gatewayFailures(r.stdout, safe);
  if (failed.length > 0) throw new Error(`o OpenClaw não limpou ${failed.length === safe.length ? "o histórico" : `${failed.length} de ${safe.length} sessões`}`);
  log(`whatsapp: histórico limpo em ${host}: ${safe.join(", ")}`);
}

/**
 * Pausa ou retoma o agente para um contato: `sendPolicy` da sessão só dele (`deny` = o OpenClaw não entrega
 * respostas nem mostra "digitando"; `null` volta à regra geral). A mensagem da pessoa continua chegando e o agente
 * segue rodando, então ele ganha uma nota na conversa dizendo que foi pausado/retomado (um turno do agente em
 * segundo plano, whatsapp-pause.ts), e o AGENTS.md da máquina ganha a regra do que fazer com essas notas. A nota e
 * a regra não desfazem a pausa se falharem.
 */
export async function whatsappPause(host: string, number: string, paused: boolean, by: PauseBy): Promise<void> {
  const { own } = await whatsappClearPlan(host, number);
  if (own.length === 0) throw new Error("esta pessoa ainda não tem conversa própria com o agente; dá para pausar depois da próxima mensagem dela");
  const value = paused ? '"deny"' : "null";
  const note = pauseNoteText(paused ? "pause" : "resume", localWhenText(new Date()), by);
  const patch = own.map((k) => `printf 'R\t%s\t' '${k}'; timeout 60 openclaw gateway call sessions.patch --json --params '{"key":"${k}","sendPolicy":${value}}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
  const notes = own.map((k) => pauseNoteSh(k, note)).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${patch}\n${notes}\n${pauseRuleSh()}\n`, 120_000);
  const failed = gatewayFailures(r.stdout, own);
  if (failed.length > 0) throw new Error(`o OpenClaw não ${paused ? "pausou" : "retomou"} a conversa`);
  const noteState = /NOTA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
  const rule = /REGRA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
  log(`whatsapp: ${paused ? "pausado" : "retomado"} +${number.replace(/\D/g, "")} em ${host} (${by}); nota: ${noteState}; regra do AGENTS.md: ${rule}`);
}

/**
 * Desconecta o número desta máquina sem parear de novo. OpenClaw: `channels logout` (apaga as credenciais;
 * o gateway para o canal). Hermes: guarda a sessão como session.loggedout-… com o gateway parado.
 */
export async function whatsappLogout(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (current !== null) throw new Error("há um pareamento em andamento; feche o QR antes de desconectar");
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
S=$HOME/.hermes/whatsapp
if [ -d "$S" ]; then
  pm2 stop hermes-gateway >/dev/null 2>&1
  [ -d "$S/session" ] && mv "$S/session" "$S/session.loggedout-$(date +%s)"
  pm2 start hermes-gateway >/dev/null 2>&1
  echo OUT=hermes; exit 0
fi
command -v openclaw >/dev/null 2>&1 || { echo OUT=none; exit 0; }
pkill -u "$(id -u)" -f "openclaw channels login" 2>/dev/null
timeout 60 openclaw channels logout --channel whatsapp >/dev/null 2>&1
[ -s "$HOME/.openclaw/credentials/whatsapp/default/creds.json" ] && echo OUT=still || echo OUT=openclaw
`;
  const r = await runSsh(host, script, 90_000);
  const out = /OUT=(\w+)/.exec(r.stdout)?.[1];
  if (out === "none") throw new Error("não achei WhatsApp configurado nesta máquina");
  if (out === "still" || out === undefined) throw new Error(`não consegui desconectar${r.stderr.trim() !== "" ? `: ${r.stderr.trim().split("\n").pop()}` : ""}`);
  log(`[whatsapp] desconectado em ${host} (${out})`);
}
