/**
 * Conversas excluídas pelo admin, para sumirem também no app da pessoa (puro, testado). O admin apaga a sessão na
 * máquina e anota o id em `~/.local/share/meu-bot/conversas-apagadas.json` (`{ ids: { <id>: <ISO da exclusão> } }`);
 * o meu-bot dela lê o arquivo e tira da lista as conversas daquela máquina com esse id. O id é o da sessão do Claude
 * Code (`claude.sessionId` que o app guarda depois de um turno) ou o da própria conversa (provedor externo, que o
 * backend grava com o id da conversa). Conversa que mudou depois da exclusão fica (ela voltou a usar).
 */
import { isBotChatId } from "./bot-chats";

export const APAGADAS_FILE = "$HOME/.local/share/meu-bot/conversas-apagadas.json";
/** O arquivo guarda as exclusões mais recentes; as antigas já foram aplicadas nos apps abertos desde então. */
export const APAGADAS_MAX = 500;

/** O arquivo da máquina: só ids válidos com data válida; corrompido ou ausente = nenhum. */
export function parseApagadas(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; }
  const ids = raw !== null && typeof raw === "object" ? (raw as { ids?: unknown }).ids : undefined;
  if (ids === null || typeof ids !== "object" || Array.isArray(ids)) return out;
  for (const [id, at] of Object.entries(ids as Record<string, unknown>)) {
    if (isBotChatId(id) && typeof at === "string" && !Number.isNaN(Date.parse(at))) out.set(id, at);
  }
  return out;
}

/** Ids das conversas locais desta máquina que a exclusão alcança (pela sessão ou pelo próprio id). */
export function conversasApagadas(convs: { id: string; updatedAt: string; claude?: { sessionId: string } }[], apagadas: Map<string, string>): string[] {
  const out: string[] = [];
  for (const c of convs) {
    const at = apagadas.get(c.claude?.sessionId ?? "") ?? apagadas.get(c.id);
    if (at !== undefined && Date.parse(c.updatedAt) <= Date.parse(at)) out.push(c.id);
  }
  return out;
}

/**
 * Script (bash + python3) que anota `id` no arquivo da máquina: lê o atual (corrompido = vazio), acrescenta, guarda as
 * `APAGADAS_MAX` mais recentes e grava tmp+mv com 0600, como as marcações do WhatsApp. O id já foi validado.
 */
export function anotarApagadaSh(id: string, at: string): string {
  if (!isBotChatId(id) || Number.isNaN(Date.parse(at))) throw new Error("conversa inválida");
  return `python3 - "${APAGADAS_FILE}" '${id}' '${at}' <<'PY'
import json, os, sys
p = os.path.expandvars(sys.argv[1]); i, at = sys.argv[2], sys.argv[3]
try:
    d = json.load(open(p))
    ids = d.get("ids") if isinstance(d, dict) and isinstance(d.get("ids"), dict) else {}
except Exception:
    ids = {}
ids[i] = at
ids = dict(sorted(ids.items(), key=lambda kv: str(kv[1]))[-${APAGADAS_MAX}:])
os.makedirs(os.path.dirname(p), exist_ok=True)
t = p + ".tmp"
fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: json.dump({"ids": ids}, f)
os.replace(t, p)
PY`;
}
