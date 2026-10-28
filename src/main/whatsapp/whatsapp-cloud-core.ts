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
