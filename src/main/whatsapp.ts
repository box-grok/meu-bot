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
import { politicaGravada, politicaNaoBate } from "./whatsapp-chats";
import { isVozId } from "./vozes-core";
import { spawn, type ChildProcess } from "node:child_process";
import { toDataURL } from "qrcode";
import { BlockQrCollector, blocksToSvgDataUrl, stripAnsi } from "./qr-blocks";
import type { Gateway, VoiceReplyMode, WhatsappChat, WhatsappDmPolicy, WhatsappEvent, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "../shared/ipc";
import { DESCONHECIDO_DENY, NAV_DENY } from "./navegador-whatsapp-core";
import { JID_RE, aplicarPatch, estadoDoGrupo, gruposDaMaquina, patchGrupo, threadDoGrupo } from "./whatsapp-grupos-core";
import { chatsFromSessions, ownSessionKeys, gatewayFailures, grupoToMarkdown, peerOfSessionKey, SAFE_KEY, threadFor, threadToMarkdown, whatsappContextNote, type SessionHistory } from "./whatsapp-chats";
import { WA_MARKS_FILE, applyWaMarks, parseWaMarks, waMarkSh, type WaMarkPatch } from "./whatsapp-marks";
import { SEND_POLICY_READ_SH, localWhenText, pauseNoteSh, pauseNoteText, pauseRulePrefixes, pauseRuleSh, pausedNumbersOfPolicy, sendPolicySh, withPauseRule, type PauseBy } from "./whatsapp-pause";
import { createFromWhatsapp, type StoredConversation } from "./conversation";
import { log } from "./backend";
import { LOCAL_HOST } from "./localBackend";
import { isValidHost } from "./settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

/**
 * Gateway do OpenClaw desta conta apontando para o gateway de OUTRA conta (duas contas na mesma máquina: a
 * segunda fica sem \`gateway.port\`, a CLI cai no padrão 18789, que é da primeira, e tudo responde "gateway token
 * mismatch"; o serviço dela, preso à mesma porta, nunca sobe). Conserto: a primeira porta livre a partir da
 * configurada vira \`gateway.port\`, o serviço é regravado nela (\`gateway install --force --port\`) e esperamos o
 * \`channels status\` responder. Só para gateway local sob systemd; sob supervisord (computador do Grok Bot)
 * ou modo remoto, não mexe. Imprime a porta nova em stdout; falha em silêncio (código 1).
 */
/**
 * O plugin do WhatsApp do OpenClaw está instalado e ligado? Pelo id exato ("whatsapp") no `plugins list --json`:
 * contar a palavra no texto da lista dava falso positivo com os plugins do meu-bot ("guarda do WhatsApp",
 * "CRM pelo WhatsApp"), e numa VM nova o login caía num assistente que se cancela ("wizard cancelled").
 */
const WA_PLUGIN_SH = `wa_plugin() { timeout 40 openclaw plugins list --json 2>/dev/null | python3 -c 'import json,sys
t=sys.stdin.read(); i=t.find("{")
try: d=json.loads(t[i:]) if i>=0 else {}
except Exception: d={}
print(int(any(p.get("id")=="whatsapp" and p.get("enabled",True) is not False for p in d.get("plugins",[]) if isinstance(p,dict))))' 2>/dev/null || echo 0; }`;
const GATEWAY_FIX_SH = `
gw_mismatch() { timeout 25 openclaw channels status --json 2>&1 | grep -q 'token mismatch'; }
gw_fix() {
  [ "$(openclaw config get gateway.mode 2>/dev/null | tr -d '"')" = "local" ] || return 1
  [ -d /run/systemd/system ] || return 1
  supervisorctl status 2>/dev/null | grep -q openclaw-gateway && return 1
  P=$(openclaw config get gateway.port 2>/dev/null); case "$P" in *unset*) P=;; esac; P=$(printf '%s' "$P" | tr -dc 0-9); [ -n "$P" ] || P=18789
  L=$(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null)
  N=$P; while echo "$L" | grep -q ":$N "; do N=$((N+1)); [ $N -gt $((P+30)) ] && return 1; done
  openclaw config set gateway.port "$N" >/dev/null 2>&1 || return 1
  timeout 150 openclaw gateway install --force --port "$N" >/dev/null 2>&1 || return 1
  systemctl --user reset-failed openclaw-gateway.service >/dev/null 2>&1
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 3; if timeout 20 openclaw channels status --json >/dev/null 2>&1; then echo "$N"; return 0; fi; done
  return 1
}
# Agente do WhatsApp sem modelo (OpenClaw recém-instalado cai num padrão sem chave, ex. openai/gpt-6-astra, e não
# responde nada): com o Claude Code logado nesta conta, usa o Claude por ele (runtime claude-cli), como na agente-box.
# Modelo já escolhido (à mão ou antes) nunca é trocado. Imprime "set" quando gravou.
oc_model_ensure() {
  M=$(openclaw config get agents.defaults.model 2>&1 || true)
  case "$M" in *unset*|"") ;; *) return 0 ;; esac
  { [ -s "$HOME/.claude/.credentials.json" ] || grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null; } || return 0
  openclaw config set agents.defaults.models '{"anthropic/claude-opus-5-5":{"agentRuntime":{"id":"claude-cli"}},"anthropic/claude-sonnet-5-5":{"agentRuntime":{"id":"claude-cli"}},"anthropic/claude-haiku-5-5":{"agentRuntime":{"id":"claude-cli"}}}' --strict-json >/dev/null 2>&1 || return 1
  openclaw config set agents.defaults.model '{"primary":"anthropic/claude-opus-5-5"}' --strict-json >/dev/null 2>&1 || return 1
  echo set
}
# Conta nova (outra conta de uma VM já usada, ou VM recém-criada) sem o serviço do gateway: sem ele o QR vincula,
# mas o WhatsApp nunca fica "conectado". Instala como o onboarding do OpenClaw faria: modo local, primeira porta livre
# a partir da configurada (18789; outra conta pode ter a dela) e as pastas do systemd sem escrita de grupo (contas com
# umask 002 nascem assim e o OpenClaw recusa instalar). Imprime a porta; sem systemd ou sob supervisord, não faz nada.
gw_ensure() {
  [ -d /run/systemd/system ] || return 0
  supervisorctl status 2>/dev/null | grep -q openclaw-gateway && return 0
  systemctl --user cat openclaw-gateway.service >/dev/null 2>&1 && return 0
  mkdir -p "$HOME/.config/systemd/user"
  for d in "$HOME/.config" "$HOME/.config/systemd" "$HOME/.config/systemd/user"; do [ -O "$d" ] && chmod go-w "$d"; done
  case "$(openclaw config get gateway.mode 2>/dev/null | tr -d '"')" in local) ;; *) openclaw config set gateway.mode local >/dev/null 2>&1 || return 1 ;; esac
  P=$(openclaw config get gateway.port 2>/dev/null); case "$P" in *unset*) P=;; esac; P=$(printf '%s' "$P" | tr -dc 0-9); [ -n "$P" ] || P=18789
  L=$(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null)
  N=$P; while echo "$L" | grep -q ":$N "; do N=$((N+1)); [ $N -gt $((P+30)) ] && return 1; done
  openclaw config set gateway.port "$N" >/dev/null 2>&1 || return 1
  timeout 150 openclaw gateway install --force --port "$N" >/dev/null 2>&1 || return 1
  echo "$N"
}`;

const STATUS_SCRIPT = `
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
${GATEWAY_FIX_SH}
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
  ${WA_PLUGIN_SH}
  echo "plugin=$(wa_plugin)"
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
  echo "vozid=$(cat "$HOME/.local/share/meu-bot/voz/voz-atual" 2>/dev/null || { [ -s "$HOME/.local/share/meu-bot/voz/faber.onnx" ] && echo faber; })"
  # Uma consulta só; "token mismatch" = esta conta aponta para o gateway de outra: conserta e consulta de novo.
  CS=$(timeout 25 openclaw channels status --channel whatsapp --json 2>&1)
  if printf '%s' "$CS" | grep -q 'token mismatch'; then
    if N=$(gw_fix); then echo "gwfix=$N"; CS=$(timeout 25 openclaw channels status --channel whatsapp --json 2>&1); else echo "gwfix=fail"; fi
  fi
  # Agente sem modelo e Claude logado: configura o Claude (uma vez; depois o modelo existe e isto não faz nada).
  echo "ocmodel=$(oc_model_ensure 2>/dev/null)"
  echo "oc=$(printf '%s' "$CS" | python3 -c 'import json,sys
d=json.load(sys.stdin); c=d.get("channels",{}).get("whatsapp") or {}
print(json.dumps({"linked":c.get("linked"),"connected":c.get("connected"),"state":c.get("statusState"),"lifecycle":c.get("lifecycle"),"loggedOut":(c.get("lastDisconnect") or {}).get("loggedOut"),"e164":(c.get("self") or {}).get("e164"),"starting":d.get("status")=="starting"}))' 2>/dev/null)"
  exit 0
fi
# PicoClaw (sipeed): o canal "whatsapp" do config.json em modo nativo (whatsmeow dentro do gateway). A sessão
# é o store.db na pasta do canal; "no ar" é o /health do gateway. Serviço: runit no Termux, systemd de usuário fora.
if command -v picoclaw >/dev/null 2>&1 && [ -f "$HOME/.picoclaw/config.json" ]; then
  echo gateway=picoclaw; echo present=1
  echo "bin=$(command -v picoclaw)"
  echo "ver=$(NO_COLOR=1 timeout 10 picoclaw version 2>/dev/null | grep -o 'picoclaw [^ ]*' | head -1)"
  python3 - <<'PY' 2>/dev/null
import json, os, sqlite3
h = os.path.expanduser("~/.picoclaw")
c = json.load(open(h + "/config.json"))
w = (c.get("channel_list") or {}).get("whatsapp") or {}
s = w.get("settings") or {}
print("enabled=%d" % bool(w.get("enabled")))
print("type=%s" % (w.get("type") or ""))
print("native=%d" % bool(s.get("use_native")))
print("selfchat=%d" % bool(s.get("self_chat_only")))
print("allow=%s" % ",".join(str(x) for x in (w.get("allow_from") or [])))
print("port=%s" % ((c.get("gateway") or {}).get("port") or 18790))
ws = ((c.get("agents") or {}).get("defaults") or {}).get("workspace") or (h + "/workspace")
db = os.path.join(s.get("session_store_path") or os.path.join(ws, "whatsapp"), "store.db")
print("store=%d" % os.path.exists(db))
print("channel=%s" % json.dumps(w))
try:
    r = sqlite3.connect(db).execute("select jid from whatsmeow_device").fetchone()
    print("me=%s" % (r[0] if r else ""))
except Exception:
    print("me=")
PY
  P=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.picoclaw/config.json")));print((c.get("gateway") or {}).get("port") or 18790)' 2>/dev/null)
  echo "health=$(curl -s -m 3 "http://127.0.0.1:\${P:-18790}/health" 2>/dev/null | tr -d '\\n')"
  echo "svc=$( { [ -n "$PREFIX" ] && SVDIR=$PREFIX/var/service sv status picoclaw 2>/dev/null; } || systemctl --user is-active picoclaw-gateway 2>/dev/null)"
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

/** Estado do WhatsApp do agente da máquina. `present=false` quando não há Hermes, OpenClaw nem PicoClaw. */
export async function whatsappStatus(host: string): Promise<WhatsappStatus> {
  const none: WhatsappStatus = { present: false, gateway: null, agent: "", ready: false, missing: null, connected: false, state: "ausente", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  // Normalmente segundos; com o conserto do gateway (gw_fix: install --force + espera) passa de um minuto.
  const r = await runSsh(host, STATUS_SCRIPT, 240_000);
  if (r.code !== 0) return { ...none, detail: `não consegui consultar: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}` };
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  if (kv.get("present") !== "1") return none;
  const gateway: Gateway = kv.get("gateway") === "openclaw" ? "openclaw" : kv.get("gateway") === "picoclaw" ? "picoclaw" : "hermes";
  if (gateway === "openclaw") return openclawStatus(kv);
  if (gateway === "picoclaw") return picoclawStatus(kv);
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
  // /data/data/<app>/ é a área do app no Android (Termux): também é só desta conta.
  const scope = bin === "" ? "" : bin.startsWith("/home/") || bin.startsWith("/Users/") || bin.startsWith("/root/") || bin.startsWith("/data/data/") ? " (só deste usuário)" : ` (global, todos os usuários${real !== "" && real !== bin ? `; ${real.replace(/\/[^/]+$/, "")}` : ""})`;
  return `${name}${ver === "" ? "" : ` ${ver}`}${where}${scope}`;
}

/** `channels status --json` do OpenClaw; sem gateway no ar, sobra o número do creds.json. */
function openclawStatus(kv: Map<string, string>): WhatsappStatus {
  const agent = describeInstall("OpenClaw", kv);
  const plugin = Number(kv.get("plugin") ?? "0") > 0;
  const cfg = kv.get("cfg") === "1";
  if (!plugin || !cfg) {
    const faltas = [...(!cfg ? ["sem configuração (~/.openclaw/openclaw.json)"] : []), ...(!plugin ? ["sem o plugin do WhatsApp (o \"Gerar QR\" instala sozinho, na versão do OpenClaw da máquina)"] : [])];
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
  let allowFrom: string[] | undefined;
  try {
    const raw = kv.get("channel") ?? "";
    if (raw !== "") {
      const parsed = JSON.parse(raw) as { allowFrom?: unknown };
      channelConfig = JSON.stringify(parsed, null, 2);
      if (Array.isArray(parsed.allowFrom)) allowFrom = parsed.allowFrom.filter((x): x is string => typeof x === "string");
    }
  } catch { /* sem bloco ainda */ }
  const voz = kv.get("voz");
  const audioOut: VoiceReplyMode | null = voz === "inbound" || voz === "always" ? voz : voz === undefined || voz === "" ? null : "off";
  const vozid = (kv.get("vozid") ?? "").trim();
  const audioVoice = isVozId(vozid) ? vozid : null;
  const gwfix = kv.get("gwfix") ?? "";
  const repaired = /^\d+$/.test(gwfix) ? `o gateway do OpenClaw desta conta apontava para o gateway de outra conta da máquina (token diferente); ganhou a porta própria ${gwfix}` : null;
  const unrepaired = gwfix === "fail" ? "o gateway do OpenClaw desta conta aponta para o gateway de outra conta da máquina (token diferente) e não consegui dar a ele uma porta própria; na máquina: openclaw config set gateway.port <porta livre> && openclaw gateway install --force --port <porta livre>" : null;
  return { present: true, gateway: "openclaw", agent, ready: true, missing: null, connected, state, number, loggedOut, detail: unrepaired ?? detail, dmPolicy, channelConfig, ...(allowFrom !== undefined ? { allowFrom } : {}), audioIn: kv.get("audioin") === "1", audioOut, audioVoice, ...(repaired !== null ? { repaired } : {}) };
}

/**
 * PicoClaw: o canal `whatsapp` do config.json (modo nativo), a sessão (store.db) e o /health do gateway. Puro
 * sobre o `chave=valor` do STATUS_SCRIPT, para o teste. Sem `channels status` como o OpenClaw: "conectado" é
 * sessão pareada + gateway no ar (o canal reconecta sozinho ao subir).
 */
export function picoclawStatus(kv: Map<string, string>): WhatsappStatus {
  const agent = describeInstall("PicoClaw", kv);
  const enabled = kv.get("enabled") === "1";
  const native = kv.get("type") === "whatsapp_native" || kv.get("native") === "1";
  if (!enabled || !native) {
    const missing = !enabled ? "o canal whatsapp está desligado no ~/.picoclaw/config.json (channel_list.whatsapp.enabled)" : "o canal whatsapp não está em modo nativo (type \"whatsapp_native\" + settings.use_native no config.json)";
    return { present: true, gateway: "picoclaw", agent, ready: false, missing, connected: false, state: "sem configurar", number: null, loggedOut: false, detail: `PicoClaw instalado, mas ${!enabled ? "com o WhatsApp desligado" : "sem o WhatsApp nativo"}`, dmPolicy: null, channelConfig: null };
  }
  const number = phoneOf(kv.get("me") ?? "");
  const paired = kv.get("store") === "1" && number !== null;
  let running = false;
  try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; running = h.status === "ok"; } catch { /* gateway fora do ar */ }
  const svc = (kv.get("svc") ?? "").trim();
  const state = running ? (paired ? "conectado" : "sem sessão") : svc.startsWith("down") ? "gateway parado" : svc.startsWith("run") ? "gateway iniciando" : "gateway fora do ar";
  const connected = running && paired;
  const detail = connected ? "conectado" : !paired ? "sem sessão; precisa parear (o QR sai no registro do gateway)" : state === "gateway parado" ? "sessão pareada, gateway parado (serviço picoclaw)" : `sessão pareada, ${state}`;
  // Quem responde: self_chat_only = só a conversa do próprio número; allow_from = lista; nada = todo mundo.
  const allow = (kv.get("allow") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
  const dmPolicy: WhatsappDmPolicy = kv.get("selfchat") === "1" || allow.length > 0 ? "allowlist" : "open";
  let channelConfig: string | null = null;
  try { const raw = kv.get("channel") ?? ""; if (raw !== "") channelConfig = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* bloco ilegível */ }
  return { present: true, gateway: "picoclaw", agent, ready: true, missing: null, connected, state, number, loggedOut: false, detail, dmPolicy, channelConfig, ...(allow.length > 0 ? { allowFrom: allow } : {}) };
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

export async function setDmPolicy(host: string, policy: WhatsappReplyChoice, numbers: readonly string[] = []): Promise<WhatsappStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  let script: string;
  if (policy === "open") {
    // O "*" antes do "open": "open" com allowFrom sem "*" descarta TODAS as mensagens (e foi o que sobrou numa máquina).
    script = `export PATH=$HOME/.local/bin:$PATH; set -e; openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.allowFrom '["*"]' --strict-json && openclaw config set channels.whatsapp.dmPolicy open && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json${await ownerLockFor(host)}`;
  } else if (policy === "list") {
    // Você + os números escolhidos: allowlist com allowFrom explícito. O dono entra sempre (sem ele, a pessoa
    // perdia o próprio agente); a trava de ferramentas continua só para o dono.
    const bad = numbers.filter((n) => !/^\d{8,15}$/.test(n));
    if (bad.length > 0) throw new Error(`número inválido na lista: ${bad.join(", ")} (só dígitos, com DDI, 8 a 15)`);
    const self = await readSelfNumber(host);
    const list = [...new Set([...(self === null ? [] : [self]), ...numbers])].map((n) => `+${n}`);
    const allow = JSON.stringify(list).replace(/'/g, "");
    script = `export PATH=$HOME/.local/bin:$PATH; set -e; openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.dmPolicy allowlist && openclaw config set channels.whatsapp.allowFrom '${allow}' --strict-json && openclaw config set channels.whatsapp.selfChatMode true --strict-json && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json${self === null ? "" : ` && ${ownerLockSh(self)}`}`;
  } else {
    script = `export PATH=$HOME/.local/bin:$PATH; set -e; ${selfPolicySh(await readSelfNumber(host))}`;
  }
  // Relê o que ficou gravado: a política só vale se dmPolicy e allowFrom batem com a escolha.
  const confere = `python3 -c 'import json,os;w=((json.load(open(os.path.expanduser("~/.openclaw/openclaw.json"))).get("channels") or {}).get("whatsapp") or {});print("POLICY=%s ALLOW=%s" % (w.get("dmPolicy",""), json.dumps(w.get("allowFrom",[]))))'`;
  const r = await runSsh(host, `${script}\n${confere}\n`, 60_000);
  if (r.code !== 0) throw new Error(`não consegui mudar a política: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou"}`);
  const ficou = politicaGravada(r.stdout);
  const erro = ficou === null ? null : politicaNaoBate(policy, ficou);
  if (erro !== null) throw new Error(`a política não ficou gravada como escolhida: ${erro}. Tente de novo.`);
  log(`[whatsapp] ${host}: dmPolicy=${policy}`);
  return whatsappStatus(host);
}



/** Política "só você" (ver setDmPolicy); também é o padrão gravado antes do primeiro login. */
export const SELF_POLICY_SH = `openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.dmPolicy allowlist && openclaw config set channels.whatsapp.allowFrom '[]' --strict-json && openclaw config set channels.whatsapp.selfChatMode true --strict-json && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json`;
/** Com o número já conhecido, ele entra no allowFrom: tira o aviso "allowFrom vazio" e deixa explícito quem é "você". */
const selfPolicySh = (number: string | null): string => number === null ? SELF_POLICY_SH : `${SELF_POLICY_SH.replace(`'[]'`, `'["+${number}"]'`)} && ${ownerLockSh(number)}`;

/** O que um contato que não é o dono não pode usar: gravar, editar, rodar comandos, agendar, mexer no gateway. */
export const NON_OWNER_DENY = ["write", "edit", "apply_patch", "exec", "process", "code_execution", "cron", "gateway", "group:automation", "group:nodes", "terminal", "skill_workshop", "sessions_spawn"] as const;
/**
 * Trava do dono (`tools.toolsBySender`): o número pareado sem restrição; qualquer outro remetente sem as
 * ferramentas que mudam a máquina ou o próprio agente (nome, personalidade, arquivos). Sem isso, um contato
 * pedia e o agente reescrevia o IDENTITY.md. O claude-cli aplica por argv (`nativeToolMode: selectable`).
 * Só grava se estiver vazio ou já for a do meu-bot (tem `apply_patch`): uma regra feita à mão fica.
 */
export const ownerLockSh = (number: string): string => {
  const lock = JSON.stringify({ [`e164:+${number}`]: {}, "*": { deny: [...NON_OWNER_DENY, ...DESCONHECIDO_DENY, ...NAV_DENY] } });
  return `{ cur=$(openclaw config get tools.toolsBySender 2>&1 || true); case "$cur" in *unset*|*apply_patch*) openclaw config set tools.toolsBySender '${lock}' --strict-json >/dev/null ;; esac; }`;
};

const PAIR_SCRIPT = `
set -u
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
${GATEWAY_FIX_SH}
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
  # Sem o plugin do WhatsApp (VM nova: ele não vem de fábrica), instala do ClawHub e segue para o QR.
  ${WA_PLUGIN_SH}
  if [ "$(wa_plugin)" != "1" ]; then
    echo '{"event":"meu-bot","step":"plugin-installing"}'
    # Na versão do OpenClaw da máquina: a última do ClawHub costuma exigir um runtime mais novo ("requires plugin API").
    OCV=$(timeout 20 openclaw --version 2>/dev/null | grep -Eo '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1)
    { [ -n "$OCV" ] && timeout 300 openclaw plugins install "clawhub:@openclaw/whatsapp@$OCV" >/dev/null 2>&1; } || timeout 300 openclaw plugins install clawhub:@openclaw/whatsapp >/dev/null 2>&1 || true
    timeout 60 openclaw plugins enable whatsapp >/dev/null 2>&1 || true
    if [ "$(wa_plugin)" != "1" ]; then echo "{\\"event\\":\\"error\\",\\"error\\":\\"OpenClaw sem o plugin do WhatsApp e a instalação automática falhou; na máquina: openclaw plugins install clawhub:@openclaw/whatsapp@$OCV\\"}"; exit 2; fi
    echo '{"event":"meu-bot","step":"plugin-installed"}'
  fi
  # Padrão do OpenClaw é "pairing": qualquer desconhecido que mandar DM recebe um código. Antes de conectar, sem
  # política autorada, deixa silencioso (ninguém é respondido); a pessoa escolhe depois, no app ou no tutorial.
  if [ -z "$(openclaw config get channels.whatsapp.dmPolicy 2>/dev/null | tr -d '"')" ] || openclaw config get channels.whatsapp.dmPolicy 2>&1 | grep -q unset; then
    ( ${SELF_POLICY_SH} ) >/dev/null 2>&1 && echo '{"event":"meu-bot","step":"silent"}'
  fi
  # Agente sem modelo: com o Claude Code logado, usa o Claude (senão o WhatsApp conecta e nada responde).
  [ "$(oc_model_ensure 2>/dev/null)" = set ] && echo '{"event":"meu-bot","step":"model-set"}'
  # Sem o serviço do gateway nesta conta: instala antes do QR (senão vincula e nunca conecta).
  if GWN=$(gw_ensure); then [ -n "$GWN" ] && echo "{\\"event\\":\\"meu-bot\\",\\"step\\":\\"gateway-installed\\",\\"port\\":$GWN}"; else echo '{"event":"error","error":"esta conta não tem o gateway do OpenClaw como serviço e não consegui instalar. Na máquina: chmod go-w ~/.config ~/.config/systemd ~/.config/systemd/user; openclaw config set gateway.mode local; openclaw gateway install --port <porta livre>"}'; exit 2; fi
  # Esta conta apontando para o gateway de outra (token mismatch): o login falharia na hora. Dá uma porta própria antes.
  if gw_mismatch; then
    if N=$(gw_fix); then echo "{\\"event\\":\\"meu-bot\\",\\"step\\":\\"gateway-port\\",\\"port\\":$N}"; else echo '{"event":"error","error":"o gateway do OpenClaw desta conta aponta para o gateway de outra conta desta máquina (token diferente) e não consegui dar a ele uma porta própria. Na máquina: openclaw config set gateway.port <porta livre> && openclaw gateway install --force --port <porta livre>"}'; exit 2; fi
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
        touch "$LOG.linked"; echo "{\\"event\\":\\"connected\\",\\"user\\":{\\"id\\":\\"$ME\\"}}"
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
      if linked_now; then LINKED=1; echo "{\\"event\\":\\"connected\\",\\"user\\":{\\"id\\":\\"$ME\\"}}"; break; fi
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
      let ev: { event?: string; qr?: string; step?: string; port?: unknown; user?: { id?: string }; error?: string; reason?: unknown; session?: string };
      try { ev = JSON.parse(line) as typeof ev; } catch { if (openclaw) handleText(line); else send({ kind: "log", text: line }); return; }
      switch (ev.event) {
        case "meu-bot":
          if (ev.step === "openclaw") { openclaw = true; send({ kind: "step", text: "OpenClaw nesta máquina; usando `openclaw channels login`" }); }
          else if (ev.step === "gateway-stopped") send({ kind: "step", text: "gateway do Hermes pausado durante o pareamento" });
          else if (ev.step === "session-moved") send({ kind: "step", text: "sessão deslogada guardada como session.loggedout-…" });
          else if (ev.step === "logged-out") send({ kind: "step", text: "sessão anterior desfeita (channels logout)" });
          else if (ev.step === "model-set") send({ kind: "step", text: "o agente desta conta não tinha modelo; passou a usar o Claude (pelo Claude Code logado aqui)" });
          else if (ev.step === "gateway-installed") send({ kind: "step", text: `esta conta não tinha o gateway do OpenClaw; instalado na porta ${String(ev.port ?? "?")}` });
          else if (ev.step === "plugin-installing") send({ kind: "step", text: "esta máquina não tinha o plugin do WhatsApp do OpenClaw; instalando (até 1–2 min)" });
          else if (ev.step === "plugin-installed") send({ kind: "step", text: "plugin do WhatsApp instalado" });
          else if (ev.step === "silent") send({ kind: "step", text: "padrão: só você fala com o agente; ninguém mais recebe resposta nem código" });
          else if (ev.step === "gateway-started") send({ kind: "step", text: "gateway de volta no ar" });
          else if (ev.step === "gateway-port") send({ kind: "step", text: `o gateway desta conta apontava para o gateway de outra conta da máquina; ganhou a porta própria ${String(ev.port ?? "?")}` });
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
export const CREDS_ME = `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null`;

export async function whatsappChats(host: string): Promise<WhatsappChat[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
echo "self=$(${CREDS_ME})"
echo "list=$(timeout 40 openclaw gateway call sessions.list --json --params '{"limit":200}' 2>/dev/null | tr -d '\n')"
echo "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\n')"
${SEND_POLICY_READ_SH}
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
  // Pausados pela lista durável do openclaw.json contam mesmo quando a sessão perdeu a marca (conversa limpa).
  let policy: unknown = null;
  try { policy = JSON.parse(kv.get("policy") || "null"); } catch { /* sem lista legível: só a marca da sessão */ }
  return applyWaMarks(chatsFromSessions(list, phoneOf(kv.get("self") ?? ""), names, pausedNumbersOfPolicy(policy)), parsed);
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

export async function whatsappThread(host: string, number: string, limit = 200): Promise<WhatsappThreadMessage[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  const want = number.replace(/\D/g, "");
  if (want.length < 8) throw new Error("número inválido");
  const chat = (await whatsappChats(host)).find((c) => c.number === want);
  if (chat === undefined) return [];
  const keys = chat.sessionKeys.filter((k) => SAFE_KEY.test(k));
  // Uma linha por sessão: "H<TAB>chave<TAB>json".
  const lines = keys.map((k) => `printf 'H\t%s\t' '${k}'; timeout 40 openclaw gateway call chat.history --json --params '{"sessionKey":"${k}","limit":${Math.min(1000, Math.max(1, Math.trunc(limit)))}}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${lines}\n`, 90_000);
  if (r.code !== 0) throw new Error(`não consegui ler a conversa: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const histories: SessionHistory[] = [];
  for (const line of r.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] !== "H" || parts.length < 3) continue;
    try { histories.push({ sessionKey: parts[1]!, history: JSON.parse(parts.slice(2).join("\t")) }); } catch { /* sessão sem resposta: conta como falha abaixo */ }
  }
  // Sessão sem resposta (gateway ocupado: tempo esgotado) é erro, nunca "conversa vazia": senão guardar no CRM antes de
  // limpar via "nada a guardar" e o histórico era zerado sem ir para o CRM.
  if (histories.length < keys.length) throw new Error("o gateway do OpenClaw não devolveu a conversa inteira a tempo; nada foi limpo. Tente de novo em instantes");
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
export async function whatsappExportBody(host: string, number: string, format: "md" | "json", limit = 200): Promise<{ name: string; body: string; messages: WhatsappThreadMessage[] }> {
  const want = number.replace(/\D/g, "");
  const messages = await whatsappThread(host, want, limit);
  const name = namesOf(host).get(want) ?? `+${want}`;
  const exportedAt = new Date().toISOString();
  const body = format === "md"
    ? threadToMarkdown(name, want, host, messages, exportedAt)
    : `${JSON.stringify({ channel: "whatsapp", contact: { name, number: `+${want}` }, host, exportedAt, messages }, null, 2)}\n`;
  return { name, body, messages };
}

/** A sessão do agente neste grupo, saneada; null = ninguém falou com ele no grupo ainda (nada a limpar). */
async function grupoSessionKey(host: string, jid: string): Promise<string | null> {
  if (!JID_RE.test(jid)) throw new Error("grupo inválido");
  const g = (await whatsappGroups(host)).grupos.find((x) => x.jid === jid);
  return g?.sessionKey !== null && g?.sessionKey !== undefined && SAFE_KEY.test(g.sessionKey) ? g.sessionKey : null;
}

/** Transcrição de um grupo para guardar no CRM, no mesmo formato do export de contato. */
export async function whatsappGroupExportBody(host: string, jid: string, limit = 200): Promise<{ nome: string; body: string; messages: WhatsappThreadMessage[] }> {
  const messages = await whatsappGroupThread(host, jid, limit);
  const g = (await whatsappGroups(host)).grupos.find((x) => x.jid === jid);
  const nome = g?.nome ?? jid;
  return { nome, body: grupoToMarkdown(nome, jid, host, messages, new Date().toISOString()), messages };
}

/** O que "Limpar histórico" de um grupo vai zerar: a sessão do agente nele (grupo não tem sessão principal). */
export async function whatsappGroupClearPlan(host: string, jid: string): Promise<{ sessoes: number }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  return { sessoes: (await grupoSessionKey(host, jid)) === null ? 0 : 1 };
}

/** Zera a sessão do agente no grupo. Reusa whatsappClearSessions: mesma chamada `sessions.reset` do contato. */
export async function whatsappGroupClear(host: string, jid: string): Promise<void> {
  const key = await grupoSessionKey(host, jid);
  if (key === null) throw new Error("o agente ainda não tem histórico neste grupo");
  await whatsappClearSessions(host, [key]);
}

/** O que "Limpar histórico" vai zerar: sessões só do contato e, se houver, a principal (de todos); e se ele está pausado. */
export async function whatsappClearPlan(host: string, number: string): Promise<{ own: string[]; shared: string[]; paused: boolean }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const want = number.replace(/\D/g, "");
  const chat = (await whatsappChats(host)).find((c) => c.number === want);
  const keys = (chat?.sessionKeys ?? []).filter((k) => SAFE_KEY.test(k));
  const own = ownSessionKeys(want, keys);
  return { own, shared: keys.filter((k) => !own.includes(k)), paused: chat?.paused === true };
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
  const want = number.replace(/\D/g, "");
  const { own } = await whatsappClearPlan(host, want);
  // A lista durável (session.sendPolicy do openclaw.json) vale mesmo sem sessão própria e sobrevive a limpar.
  const policy = withPauseRule(await readSendPolicy(host), want, paused, pauseRulePrefixes(want, own));
  const value = paused ? '"deny"' : "null";
  const note = pauseNoteText(paused ? "pause" : "resume", localWhenText(new Date()), by);
  const patch = own.map((k) => `printf 'R\t%s\t' '${k}'; timeout 60 openclaw gateway call sessions.patch --json --params '{"key":"${k}","sendPolicy":${value}}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
  const notes = own.map((k) => pauseNoteSh(k, note)).join("\n");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${sendPolicySh(policy)}\n${patch}\n${notes}\n${pauseRuleSh()}\n`, 120_000);
  const failed = gatewayFailures(r.stdout, own);
  if (failed.length > 0 || !/POL=1/.test(r.stdout)) throw new Error(`o OpenClaw não ${paused ? "pausou" : "retomou"} a conversa${failed.length === 0 ? " (lista de pausados do openclaw.json)" : ""}`);
  const noteState = own.length === 0 ? "sem sessão" : /NOTA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
  const rule = /REGRA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
  log(`whatsapp: ${paused ? "pausado" : "retomado"} +${want} em ${host} (${by}); lista do openclaw.json: ok; nota: ${noteState}; regra do AGENTS.md: ${rule}`);
}

/** session.sendPolicy atual do openclaw.json (null se não há ou não deu para ler). */
async function readSendPolicy(host: string): Promise<unknown> {
  const r = await runSsh(host, `${SEND_POLICY_READ_SH}\n`, 30_000);
  const line = r.stdout.split("\n").find((l) => l.startsWith("policy="));
  try { return JSON.parse(line?.slice("policy=".length) || "null"); } catch { return null; }
}

/**
 * Contato pausado que vai ter a conversa limpa: garante a regra dele na lista durável antes (pausas
 * antigas só tinham a marca na sessão, que o reset leva). Já na lista: não grava nada.
 */
export async function whatsappKeepPaused(host: string, number: string, own: readonly string[]): Promise<void> {
  const want = number.replace(/\D/g, "");
  const cur = await readSendPolicy(host);
  if (pausedNumbersOfPolicy(cur).has(want)) return;
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${sendPolicySh(withPauseRule(cur, want, true, pauseRulePrefixes(want, own)))}\n`, 90_000);
  if (!/POL=1/.test(r.stdout)) throw new Error("não consegui manter a pausa deste contato (lista de pausados do openclaw.json); nada foi limpo");
  log(`whatsapp: +${want} pausado entrou na lista do openclaw.json antes de limpar (${host})`);
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

// ── Grupos (área "Grupos" da lista e tutorial 12). As regras ficam em whatsapp-grupos-core.ts; aqui só o IO. ──
const WA_GRUPOS_DIR = "$HOME/.claude/skills/whatsapp-grupos";
/** channels.whatsapp do openclaw.json (só essa seção: nada de tokens). */
const WA_CONFIG_SH = `echo "wa=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")));print(json.dumps((c.get("channels") or {}).get("whatsapp") or {}))' 2>/dev/null)"`;
const kvOf = (out: string): Map<string, string> => {
  const kv = new Map<string, string>();
  for (const line of out.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1)); }
  return kv;
};
const jsonOr = (v: string | undefined): unknown => { try { return JSON.parse(v || "null"); } catch { return null; } };

/**
 * Sessões de grupo pelo banco do OpenClaw, só leitura: UUID atual, a transcrição do Claude Code (o .jsonl do runtime
 * claude-cli, para o ID da aba), assunto e hora. Vale também quando o gateway não responde ao sessions.list.
 */
const GRUPOS_DO_BANCO_SH = `echo "banco=$(python3 - <<'MEUBOT_PY' 2>/dev/null
import sqlite3, os, json, glob, re
db = os.path.expanduser("~/.openclaw/agents/main/agent/openclaw-agent.sqlite")
out = {}
try:
    c = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=5)
    for k, e in c.execute("select session_key, entry_json from session_nodes where session_key like '%:group:%'"):
        try:
            d = json.loads(e or "{}") or {}
        except Exception:
            d = {}
        cli = ((d.get("cliSessionBindings") or {}).get("claude-cli") or {}).get("sessionId") or (d.get("cliSessionIds") or {}).get("claude-cli")
        j = None
        if isinstance(cli, str) and re.fullmatch(r"[A-Za-z0-9-]{8,80}", cli):
            m = glob.glob(os.path.expanduser("~/.claude/projects/*/" + cli + ".jsonl"))
            if m:
                j = "~" + m[0][len(os.path.expanduser("~")):]
        resp = False
        for (ev,) in c.execute("select event_json from transcript_events where session_id=? and event_json is not null order by seq desc limit 200", (d.get("sessionId") or "",)):
            try:
                m = (json.loads(ev) or {}).get("message") or {}
            except Exception:
                continue
            if m.get("role") == "assistant" and m.get("stopReason") != "tool_use":
                resp = True
                break
        out[k] = {"sessionId": d.get("sessionId"), "jsonl": j, "subject": d.get("subject"), "updatedAt": d.get("updatedAt"), "respondeu": resp}
except Exception:
    pass
print(json.dumps(out))
MEUBOT_PY
)"`;

/** Grupos da máquina: sessões de grupo, a config de grupos e o cache da skill, numa leitura só. */
export async function whatsappGroups(host: string): Promise<WhatsappGroups> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
echo "self=$(${CREDS_ME})"
echo "list=$(timeout 15 openclaw gateway call sessions.list --json --params '{"limit":200}' 2>/dev/null | tr -d '\n')"
${WA_CONFIG_SH}
echo "cache=$(cat "${WA_GRUPOS_DIR}/data/grupos-live.json" 2>/dev/null | tr -d '\n')"
echo "skill=$([ -f "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" ] && echo 1 || echo 0)"
${GRUPOS_DO_BANCO_SH}
`;
  const r = await runSsh(host, script, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ler os grupos do WhatsApp: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const kv = kvOf(r.stdout);
  const g = gruposDaMaquina(jsonOr(kv.get("list")), jsonOr(kv.get("wa")), jsonOr(kv.get("cache")), kv.get("self") ?? null, jsonOr(kv.get("banco")));
  return { ...g, skill: kv.get("skill") === "1" };
}

/**
 * Mensagens da sessão atual de um grupo direto do banco do OpenClaw (só leitura): o mesmo formato do `chat.history`
 * (`{ messages: [...] }`), sem depender do gateway (que ocupado demorava minutos e a tela via "sem mensagens").
 * Sem o banco (OpenClaw antigo), cai no `chat.history`. Imprime `OK <json>` ou `FALHA <motivo>`.
 */
const grupoThreadSh = (jid: string, n: number): string => `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
python3 - '${jid}' ${n} <<'MEUBOT_PY'
import sqlite3, os, json, sys, subprocess
jid, n = sys.argv[1], int(sys.argv[2])
db = os.path.expanduser("~/.openclaw/agents/main/agent/openclaw-agent.sqlite")
def ev(js, zb):
    if js:
        return json.loads(js)
    if zb is None:
        return None
    try:
        import zstandard
        return json.loads(zstandard.ZstdDecompressor().decompress(zb))
    except ImportError:
        p = subprocess.run(["zstd", "-dc"], input=bytes(zb), capture_output=True, timeout=10)
        return json.loads(p.stdout) if p.returncode == 0 else None
try:
    c = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=5)
    row = next((r for r in c.execute("select session_key, current_session_id, entry_json from session_nodes where session_key like ?", ("%:group:" + jid,))), None)
    if row is None:
        print("OK " + json.dumps({"messages": []}))
        sys.exit(0)
    msgs = []
    for js, zb in c.execute("select event_json, event_zstd from (select seq, event_json, event_zstd from transcript_events where session_id=? order by seq desc limit ?) order by seq", (row[1], n * 4)):
        try:
            e = ev(js, zb)
        except Exception:
            continue
        if not isinstance(e, dict):
            continue
        # "Limpar histórico" grava um evento de reset NA MESMA sessão, em vez de abrir outra: o que
        # veio antes dele o agente já esqueceu. Sem isto a aba seguia mostrando a conversa limpa.
        if e.get("type") == "reset":
            msgs = []
            continue
        if e.get("type") == "message" and isinstance(e.get("message"), dict):
            msgs.append(e["message"])
    try:
        subject = (json.loads(row[2] or "{}") or {}).get("subject")
    except Exception:
        subject = None
    print("OK " + json.dumps({"messages": msgs[-n:], "subject": subject}))
except Exception as e:
    print("FALHA " + type(e).__name__)
MEUBOT_PY
`;

/** Conversa de um grupo (só leitura), com o autor de cada mensagem. */
export async function whatsappGroupThread(host: string, jid: string, limit = 200): Promise<WhatsappThreadMessage[]> {
  if (!JID_RE.test(jid)) throw new Error("grupo inválido");
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const n = Math.min(1000, Math.max(1, Math.trunc(limit)));
  const r = await runSsh(host, grupoThreadSh(jid, n), 60_000);
  const ok = /^OK (.*)$/m.exec(r.stdout);
  // O nome do grupo (para filtrar o senderName) vem na mesma leitura: nada espera o gateway.
  if (ok !== null) { const h = jsonOr(ok[1]) as { subject?: unknown } | null; return threadDoGrupo(h, namesOf(host), typeof h?.subject === "string" ? h.subject : null); }
  // Sem o banco legível: o gateway (formato igual); vazio por tempo esgotado vira erro, não "sem mensagens".
  const grupo = (await whatsappGroups(host)).grupos.find((x) => x.jid === jid);
  if (grupo === undefined || grupo.sessionKey === null || !SAFE_KEY.test(grupo.sessionKey)) return [];
  const h = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\ntimeout 60 openclaw gateway call chat.history --json --params '{"sessionKey":"${grupo.sessionKey}","limit":${n}}' 2>/dev/null | tr -d '\n'\n`, 90_000);
  const hist = jsonOr(h.stdout.trim());
  if (h.code !== 0 || hist === null) throw new Error("não consegui ler a conversa do grupo: o gateway do OpenClaw não respondeu a tempo");
  return threadDoGrupo(hist, namesOf(host), grupo.nome);
}

/**
 * Liga/desliga o agente num grupo e/ou muda quem o aciona: `openclaw config patch --stdin` (validado, com
 * recarga do canal, como o habilitar.py da skill), relê e confere. Devolve os grupos já com a mudança.
 */
export async function whatsappSetGroup(host: string, jid: string, pedido: WhatsappGroupPatch): Promise<WhatsappGroups> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (!JID_RE.test(jid)) throw new Error("grupo inválido");
  const read = await runSsh(host, `echo "self=$(${CREDS_ME})"\n${WA_CONFIG_SH}\n`, 30_000);
  const kv = kvOf(read.stdout);
  const wa = jsonOr(kv.get("wa"));
  if (wa === null) throw new Error("não consegui ler a configuração do WhatsApp nesta máquina (~/.openclaw/openclaw.json)");
  const self = phoneOf(kv.get("self") ?? "");
  const patch = patchGrupo(wa, jid, pedido, self);
  if (patch !== null) {
    const b64 = Buffer.from(JSON.stringify(patch), "utf8").toString("base64");
    const w = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\nprintf '%s' '${b64}' | base64 -d | timeout 60 openclaw config patch --stdin 2>&1 | tail -n 3\necho "rc=\${PIPESTATUS[2]}"\n`, 90_000);
    if (!/rc=0/.test(w.stdout)) throw new Error(`o OpenClaw recusou a mudança: ${w.stdout.replace(/rc=\d+/, "").trim().split("\n").pop() || w.stderr.trim().split("\n").pop() || "sem resposta"}`);
  }
  const depois = await whatsappGroups(host);
  // Confere pelo openclaw.json relido: o que ficou gravado tem de ser o que o patch pedia.
  const reread = await runSsh(host, `${WA_CONFIG_SH}\n`, 30_000);
  const gravado = jsonOr(kvOf(reread.stdout).get("wa"));
  const esperado = patch === null ? wa : aplicarPatch(wa, patch);
  if (estadoDoGrupo(gravado, jid) !== estadoDoGrupo(esperado, jid)) throw new Error("a mudança não ficou gravada na máquina (o openclaw.json relido não bate); tente de novo");
  log(`whatsapp: grupo ${jid} em ${host}: ${patch === null ? "sem mudança" : JSON.stringify(patch)}`);
  return depois;
}

/**
 * Atualiza a lista de grupos pelo WhatsApp (skill whatsapp-grupos: `wa-admin.sh listar`). Ela PARA o gateway
 * ~30 s (o WhatsApp do agente fica parado; as mensagens chegam quando ele volta): a tela pede confirmação antes.
 */
export async function whatsappRefreshGroups(host: string): Promise<WhatsappGroups> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
[ -f "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" ] || { echo "SKILL=0"; exit 0; }
L=$(mktemp); timeout 420 bash "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" listar --json >/dev/null 2>"$L"; echo "RC=$?"
tail -n 2 "$L" 2>/dev/null | sed 's/^/LOG=/'; rm -f "$L"
`, 480_000);
  if (/SKILL=0/.test(r.stdout)) throw new Error("a skill whatsapp-grupos não está nesta máquina: atualize a guarda do WhatsApp pelo seletor");
  if (!/RC=0/.test(r.stdout)) throw new Error(`não consegui listar os grupos: ${r.stdout.split("\n").filter((l) => l.startsWith("LOG=")).map((l) => l.slice(4)).join(" ").trim() || r.stderr.trim().split("\n").pop() || "sem resposta"}`);
  log(`whatsapp: lista de grupos atualizada em ${host}`);
  return whatsappGroups(host);
}
