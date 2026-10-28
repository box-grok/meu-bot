/**
 * WhatsApp pela API oficial (Cloud API da Meta), lado do app (puro, testado). Na máquina mora o receptor
 * backend-colima/wa-cloud.js (instalado por install-wa-cloud.sh); aqui ficam os trechos de shell que o app roda por
 * SSH e a leitura do que eles imprimem, no mesmo contrato `chave=valor` dos outros gateways (whatsapp.ts).
 *
 * Diferente de OpenClaw/Hermes/PicoClaw: não há QR. "Conectar" é colar as credenciais do app da Meta (token, ID do
 * número, App Secret); o número que atende é o do Meta Business da pessoa. O dono (quem o agente sempre atende) é o
 * WhatsApp pessoal dela, gravado no wa-cloud.json.
 */
import type { WhatsappDmPolicy, WhatsappStatus } from "../../shared/ipc";
import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";

export const WA_CLOUD_ENV = "$HOME/.config/meu-bot/wa-cloud.env";
export const WA_CLOUD_ESTADO = "$HOME/.local/share/meu-bot/wa-cloud.json";
export const WA_CLOUD_STATUS = "$HOME/.local/share/meu-bot/wa-cloud-status.json";
export const WA_CLOUD_HIST = "$HOME/.local/share/meu-bot/wa-cloud";

/**
 * Ramo do STATUS_SCRIPT quando a escolha é a API oficial: só fatos, nunca o valor de um segredo (o token e o App
 * Secret aparecem como "tem ou não tem"). Termina com `exit 0`, como os outros ramos.
 */
export const CLOUD_STATUS_SH = `
  echo gateway=cloud-api; echo present=1
  ${BACKEND_DIR_SH}
  [ -f "$BD/wa-cloud.js" ] && echo files=1 || echo files=0
  E="${WA_CLOUD_ENV}"
  v() { grep "^$1=" "$E" 2>/dev/null | head -1 | cut -d= -f2-; }
  [ -n "$(v WA_TOKEN)" ] && echo tok=1 || echo tok=0
  [ -n "$(v WA_APP_SECRET)" ] && echo secret=1 || echo secret=0
  echo "phoneid=$(v WA_PHONE_NUMBER_ID)"
  echo "display=$(v WA_DISPLAY_PHONE)"
  echo "nome=$(v WA_VERIFIED_NAME)"
  P=$(v WA_CLOUD_PORT); echo "porta=$P"
  echo "svc=$(systemctl --user is-active meu-bot-wa-cloud 2>/dev/null || systemctl is-active meu-bot-wa-cloud 2>/dev/null)"
  [ -n "$P" ] && echo "health=$(curl -s -m 3 "http://127.0.0.1:$P/health" 2>/dev/null | tr -d '\\n')"
  echo "st=$(tr -d '\\n' < "${WA_CLOUD_STATUS}" 2>/dev/null)"
  echo "estado=$(tr -d '\\n' < "${WA_CLOUD_ESTADO}" 2>/dev/null)"
  exit 0`;

const jsonOr = (raw: string | undefined): Record<string, unknown> => {
  try { const v: unknown = JSON.parse(raw ?? ""); return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
};
const digitos = (v: unknown): string | null => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 8 && d.length <= 15 ? d : null; };
const lista = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map(digitos).filter((x): x is string => x !== null))];

/** "Quem o agente responde" do wa-cloud.json, no contrato das outras telas (dmPolicy + allowFrom "+55…"). */
export function politicaCloud(estado: Record<string, unknown>): { dmPolicy: WhatsappDmPolicy; allowFrom: string[]; dono: string | null; pausados: string[] } {
  const politica = estado["politica"] === "open" || estado["politica"] === "list" ? estado["politica"] : "self";
  const pausados = lista(estado["pausados"]);
  const dono = digitos(estado["dono"]);
  if (politica === "open") return { dmPolicy: "open", allowFrom: ["*"], dono, pausados };
  // "só eu" = allowlist vazia, como no OpenClaw (a tela traduz de volta); "lista" = os números, pausados inclusive.
  const nums = politica === "list" ? [...new Set([...lista(estado["lista"]), ...pausados])] : [];
  return { dmPolicy: "allowlist", allowFrom: nums.map((n) => `+${n}`), dono, pausados };
}

/** O status a partir do que o CLOUD_STATUS_SH imprimiu (o invólucro de whatsapp.ts anexa as capacidades). */
export function cloudApiStatus(kv: Map<string, string>): Omit<WhatsappStatus, "capacidades"> {
  const agent = "WhatsApp pela API oficial (Meta)";
  const base = { present: true, gateway: "cloud-api" as const, agent, loggedOut: false, channelConfig: null };
  if (kv.get("files") !== "1") return { ...base, ready: false, missing: "o backend desta máquina é antigo: atualize o backend (1.4.0 ou mais) para usar a API oficial", connected: false, state: "backend antigo", number: null, detail: "backend sem o receptor da API oficial", dmPolicy: null };
  const credenciais = kv.get("tok") === "1" && kv.get("secret") === "1" && (kv.get("phoneid") ?? "") !== "";
  const svc = (kv.get("svc") ?? "").trim();
  let ouvindo = false;
  try { const h = jsonOr(kv.get("health")); ouvindo = h["ok"] === true && h["configurado"] === true; } catch { /* fora do ar */ }
  const st = jsonOr(kv.get("st"));
  const estado = jsonOr(kv.get("estado"));
  const pol = politicaCloud(estado);
  const number = digitos(kv.get("display"));
  const connected = credenciais && svc === "active" && ouvindo;
  const erro = typeof st["erro"] === "string" && st["erro"] !== "" ? st["erro"] : null;
  const ultima = typeof st["ultimaMensagem"] === "string" ? st["ultimaMensagem"] : null;
  const verificado = typeof st["verificadoEm"] === "string";
  const state = !credenciais ? "sem credenciais" : svc !== "active" ? "receptor parado" : !ouvindo ? "receptor sem resposta" : "conectado";
  const detail = !credenciais ? "falta conectar à Meta (token, ID do número e App Secret)"
    : svc !== "active" ? "credenciais gravadas, mas o receptor está parado nesta máquina"
    : !ouvindo ? "o receptor não respondeu agora"
    : erro !== null ? `conectado; último problema: ${erro}`
    : !verificado ? "conectado; a Meta ainda não confirmou o endereço do webhook"
    : ultima !== null ? "conectado" : "conectado; nenhuma mensagem recebida ainda";
  const nome = (kv.get("nome") ?? "").trim();
  const channelConfig = JSON.stringify({ numero: number === null ? null : `+${number}`, nome: nome === "" ? null : nome, dono: pol.dono === null ? null : `+${pol.dono}`, politica: estado["politica"] ?? "self", lista: pol.allowFrom, pausados: pol.pausados.map((n) => `+${n}`), webhookConfirmado: verificado, ultimaMensagem: ultima }, null, 2);
  return { ...base, channelConfig, ready: true, missing: null, connected, state, number, detail, dmPolicy: pol.dmPolicy, allowFrom: pol.allowFrom };
}

/** Versão da Graph API (a mesma do receptor, wa-cloud-core.js). */
export const GRAPH_VERSAO = "v21.0";

/** O que a pessoa cola para conectar: as credenciais do app da Meta e o WhatsApp pessoal dela (o dono). */
export interface CredenciaisCloud { token: string; phoneNumberId: string; wabaId: string; appSecret: string; dono: string }

/**
 * Confere o formato antes de qualquer rede: token de acesso (usuário de sistema, longo, sem espaços), IDs numéricos do
 * número e da conta (WABA), App Secret (32 hex) e o número do dono com DDI. Devolve os valores limpos ou o erro em pt-BR.
 */
export function validarCredenciais(raw: unknown): { ok: true; c: CredenciaisCloud } | { ok: false; erro: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (k: string): string => String(o[k] ?? "").trim();
  const token = s("token"); const phoneNumberId = s("phoneNumberId"); const wabaId = s("wabaId"); const appSecret = s("appSecret");
  const dono = s("dono").replace(/\D/g, "");
  if (!/^[A-Za-z0-9_\-.|]{20,2048}$/.test(token)) return { ok: false, erro: "token de acesso inválido: copie o token permanente do usuário de sistema (Meta Business › Usuários do sistema)" };
  if (!/^\d{6,30}$/.test(phoneNumberId)) return { ok: false, erro: "ID do número de telefone inválido: são só dígitos (WhatsApp › Configuração da API)" };
  if (!/^\d{6,30}$/.test(wabaId)) return { ok: false, erro: "ID da conta do WhatsApp Business inválido: são só dígitos" };
  if (!/^[a-f0-9]{32}$/i.test(appSecret)) return { ok: false, erro: "App Secret inválido: são 32 caracteres (Configurações do app › Básico › Chave secreta do app)" };
  if (dono.length < 10 || dono.length > 15) return { ok: false, erro: "seu WhatsApp pessoal: o número com DDI e DDD (ex.: +55 11 99999-0000)" };
  return { ok: true, c: { token, phoneNumberId, wabaId, appSecret, dono } };
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v), "utf8").toString("base64");

/**
 * Grava chaves no wa-cloud.env (0600, tmp+mv), mantendo as outras (porta e verify token do instalador). Os valores vão
 * em base64 dentro do script (stdin do ssh), nunca na linha de comando de um processo. Só chaves conhecidas.
 */
export function envSetSh(pares: Record<string, string>): string {
  const permitidas = new Set(["WA_TOKEN", "WA_APP_SECRET", "WA_PHONE_NUMBER_ID", "WA_WABA_ID", "WA_DISPLAY_PHONE", "WA_VERIFIED_NAME"]);
  for (const [k, v] of Object.entries(pares)) if (!permitidas.has(k) || /[\r\n]/.test(v)) throw new Error(`chave inválida para o wa-cloud.env: ${k}`);
  return `python3 - "${WA_CLOUD_ENV}" '${b64(pares)}' <<'PY'
import base64, json, os, sys
p = os.path.expandvars(sys.argv[1]); novos = json.loads(base64.b64decode(sys.argv[2]))
linhas = []
try: linhas = open(p).read().splitlines()
except FileNotFoundError: pass
out = [l for l in linhas if l.split("=", 1)[0] not in novos]
out += ["%s=%s" % (k, v) for k, v in novos.items() if v != ""]
os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
t = p + ".tmp"; fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: f.write("\\n".join(out) + "\\n")
os.replace(t, p); print("ENV=ok")
PY`;
}
/** Tira chaves do wa-cloud.env (desconectar apaga token e App Secret; porta e verify token ficam). */
export function envUnsetSh(chaves: string[]): string {
  return `python3 - "${WA_CLOUD_ENV}" '${b64(chaves)}' <<'PY'
import base64, json, os, sys
p = os.path.expandvars(sys.argv[1]); fora = set(json.loads(base64.b64decode(sys.argv[2])))
try: linhas = open(p).read().splitlines()
except FileNotFoundError: print("ENV=ok"); sys.exit(0)
t = p + ".tmp"; fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: f.write("\\n".join(l for l in linhas if l.split("=", 1)[0] not in fora) + "\\n")
os.replace(t, p); print("ENV=ok")
PY`;
}
/** Junta campos ao wa-cloud.json (política, dono, lista, pausados), relendo o arquivo atual; o receptor relê a cada mensagem. */
export function estadoPatchSh(patch: { politica?: "self" | "open" | "list"; dono?: string; lista?: string[]; pausados?: string[] }): string {
  return `python3 - "${WA_CLOUD_ESTADO}" '${b64(patch)}' <<'PY'
import base64, json, os, sys
p = os.path.expandvars(sys.argv[1]); patch = json.loads(base64.b64decode(sys.argv[2]))
try: d = json.load(open(p))
except Exception: d = {}
if not isinstance(d, dict): d = {}
d.update(patch)
os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
t = p + ".tmp"; fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: json.dump(d, f)
os.replace(t, p); print("ESTADO=ok")
PY`;
}
/** Reinicia o receptor (lê o .env ao subir), de usuário ou de sistema. */
export const CLOUD_RESTART_SH = `systemctl --user restart meu-bot-wa-cloud 2>/dev/null || sudo -n systemctl restart meu-bot-wa-cloud 2>/dev/null || systemctl restart meu-bot-wa-cloud 2>/dev/null; echo RESTART=ok`;

/** A saída do install-wa-cloud.sh: porta e verify token (o que a pessoa cola na Meta), ou o erro. */
export function lerInstalacao(out: string): { ok: true; porta: number; verifyToken: string } | { ok: false; erro: string } {
  const erro = /^ERRO=(.*)$/m.exec(out)?.[1];
  if (erro !== undefined) return { ok: false, erro };
  const porta = Number(/^PORTA=(\d+)$/m.exec(out)?.[1]);
  const verifyToken = /^VERIFY_TOKEN=([0-9a-f]{16,})$/m.exec(out)?.[1];
  if (!/^WA_CLOUD=ok$/m.test(out) || !Number.isInteger(porta) || verifyToken === undefined) return { ok: false, erro: `o receptor não confirmou a instalação: ${out.trim().split("\n").pop() ?? "sem resposta"}` };
  return { ok: true, porta, verifyToken };
}
