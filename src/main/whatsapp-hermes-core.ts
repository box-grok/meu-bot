/**
 * Conversas do WhatsApp numa máquina com o Hermes Agent, para o espelho só-leitura do app. O Hermes guarda tudo em
 * `~/.hermes/state.db` (SQLite): `sessions` (uma por contato, `session_key` = `agent:<perfil>:whatsapp:dm:<número>`,
 * `display_name` = o nome do contato) e `messages` (`role` user/assistant/tool/session_meta, `content`, `timestamp`
 * em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp). Os programas Python
 * abaixo leem o banco em modo só-leitura na máquina e devolvem JSON numa linha; as funções puras viram isso nos
 * tipos do contrato. É a fronteira dona desse formato: o renderer nunca vê o esquema do Hermes.
 */
import type { WhatsappChat, WhatsappThreadMessage } from "../shared/ipc";

const digits = (s: string): string => s.replace(/\D/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Chave de sessão de contato do Hermes: `agent:main:whatsapp:dm:5521…` (grupos são `…:whatsapp:group:<jid>:<quem>`). */
export const hermesPeerOfKey = (key: string): string | null => { const m = /^agent:[^:]+:whatsapp:dm:\+?(\d{8,15})$/.exec(key); return m === null ? null : m[1]!; };
export const isHermesKey = (key: string): boolean => /^agent:[^:]+:whatsapp:(dm|group):/.test(key);
/** Id de sessão do Hermes (`20261024_175234_c37905b9`): o que pode ir num argumento de shell sem escapar. */
export const HERMES_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Número do próprio aparelho, do creds.json do bridge do Hermes. */
export const HERMES_SELF_SH = `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.hermes/whatsapp/session/creds.json" 2>/dev/null`;

/** Lista das sessões de contato (source whatsapp, chat_type dm) em JSON numa linha; `null` sem banco. */
export const HERMES_LIST_PY = `python3 -c '
import json, os, sqlite3
p = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(p):
    print("null"); raise SystemExit
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
rows = c.execute("select id, session_key, display_name, message_count, started_at, last_activity_at, archived, hidden, ended_at from sessions where source = ? and chat_type = ?", ("whatsapp", "dm")).fetchall()
print(json.dumps({"sessions": [{"id": r[0], "key": r[1], "name": r[2], "count": r[3], "started": r[4], "last": r[5], "archived": r[6], "hidden": r[7], "ended": r[8]} for r in rows]}, ensure_ascii=True))
'`;

/** Mensagens das sessões pedidas (ids em argv; o último argumento é o limite por sessão), em JSON numa linha. */
export const HERMES_THREAD_PY = `python3 -c '
import json, os, sqlite3, sys
ids = sys.argv[1:-1]; limit = int(sys.argv[-1])
p = os.path.expanduser("~/.hermes/state.db")
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
out = []
for sid in ids:
    rows = c.execute("select id, role, content, timestamp, display_kind from messages where session_id = ? and role in (?, ?) order by id desc limit ?", (sid, "user", "assistant", limit)).fetchall()
    out.extend({"sid": sid, "role": r[1], "content": r[2], "ts": r[3], "kind": r[4]} for r in reversed(rows))
print(json.dumps({"messages": out}, ensure_ascii=True))
'`;

/**
 * Encerra sessões (ids em argv) do jeito que o próprio `/reset` do gateway faz: `SessionDB.end_session(id,
 * "session_reset")` carimba `ended_at`/`end_reason` e avança a geração da conversa; na próxima mensagem do contato o
 * gateway vê a rota encerrada no state.db, descarta a entrada em memória e abre uma sessão nova (auto-cura #54878).
 * Roda com o Python do próprio Hermes (venv do runtime), nunca escrevendo no banco à mão. Imprime "ok".
 */
export const HERMES_END_SH = `export PATH=$HOME/.local/bin:$PATH; R=$(hermes --version 2>/dev/null | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; cd "$R" && "$R/venv/bin/python3" -c '
import sys, hermes_state
db = hermes_state.SessionDB()
for sid in sys.argv[1:]:
    db.end_session(sid, "session_reset")
print("ok")
'`;

/** Nome útil: o display_name do Hermes, exceto vazio, só dígitos ou um id interno do WhatsApp (`…@lid`). */
const nameOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && !/^\d+$/.test(v.trim()) && !/@lid$/.test(v) ? v.trim() : null);
const isoOf = (seconds: unknown): string => (typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "");

/**
 * Lista de conversas a partir das sessões do Hermes. Uma sessão por contato (sempre "própria"); `self` marca o
 * próprio aparelho; `names` (cache do main) vence só quando o Hermes não tem o nome. Sessões escondidas no Hermes
 * ficam de fora; arquivado/apelido/excluído vêm das marcas da máquina (whatsapp-marks.ts), como no OpenClaw.
 */
export function chatsFromHermes(list: unknown, self: string | null, names: ReadonlyMap<string, string> = new Map()): WhatsappChat[] {
  const sessions = isObj(list) && Array.isArray(list.sessions) ? list.sessions : [];
  // "5516992294486:36@s.whatsapp.net": o sufixo de aparelho (:36) e o domínio não fazem parte do número.
  const selfN = self === null ? null : digits(self.replace(/[:@].*$/, ""));
  const byNumber = new Map<string, { keys: string[]; ids: Record<string, string>; started: Record<string, number>; updated: string; name: string | null }>();
  for (const s of sessions) {
    if (!isObj(s) || typeof s.key !== "string" || typeof s.id !== "string" || s.hidden === 1 || s.hidden === true) continue;
    const number = hermesPeerOfKey(s.key);
    if (number === null) continue;
    const updated = isoOf(s.last ?? s.started);
    const cur = byNumber.get(number) ?? { keys: [], ids: {}, started: {}, updated: "", name: null };
    if (!cur.keys.includes(s.key)) cur.keys.push(s.key);
    // A sessão viva mais recente da chave é a que vale para ler e limpar; uma encerrada ("Limpar histórico") só
    // mantém o contato na lista, com a conversa vazia, até ele escrever de novo e o gateway abrir outra.
    const ended = s.ended !== null && s.ended !== undefined;
    const started = typeof s.started === "number" ? s.started : 0;
    if (!ended && HERMES_ID_RE.test(s.id) && started >= (cur.started[s.key] ?? -1)) { cur.ids[s.key] = s.id; cur.started[s.key] = started; }
    if (updated > cur.updated) { cur.updated = updated; cur.name = nameOf(s.name) ?? cur.name; } else cur.name ??= nameOf(s.name);
    byNumber.set(number, cur);
  }
  return [...byNumber.entries()]
    .map(([number, v]) => ({
      number, name: v.name ?? names.get(number) ?? null, isSelf: number === selfN, sessionKeys: v.keys, sessionIds: v.ids,
      ownSession: true, paused: false, updatedAt: v.updated, alias: null, archived: false, deleted: false,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Conversa de um contato a partir das mensagens das sessões dele: `user` é o contato, `assistant` é o agente. Fica
 * de fora o que não foi ao WhatsApp: ferramentas, metadados, respostas vazias (turno só de ferramenta), `NO_REPLY` e
 * mensagens marcadas hidden/internal_notification.
 */
export function threadFromHermes(data: unknown): WhatsappThreadMessage[] {
  const rows = isObj(data) && Array.isArray(data.messages) ? data.messages : [];
  const out: WhatsappThreadMessage[] = [];
  for (const m of rows) {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.kind === "string" && m.kind !== "") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text === "" || text === "NO_REPLY") continue;
    out.push({ role: m.role === "user" ? "contact" : "agent", text, at: isoOf(m.ts) });
  }
  const seen = new Set<string>();
  return out.filter((m) => { const k = `${m.role}|${m.at}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at.localeCompare(b.at));
}
