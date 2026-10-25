/**
 * Conversas do WhatsApp numa máquina com o Hermes Agent, para o espelho só-leitura do app. O Hermes guarda tudo em
 * `~/.hermes/state.db` (SQLite): `sessions` (uma por contato, `session_key` = `agent:<perfil>:whatsapp:dm:<número>`,
 * `display_name` = o nome do contato) e `messages` (`role` user/assistant/tool/session_meta, `content`, `timestamp`
 * em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp). Os programas Python
 * abaixo leem o banco em modo só-leitura na máquina e devolvem JSON numa linha; as funções puras viram isso nos
 * tipos do contrato. É a fronteira dona desse formato: o renderer nunca vê o esquema do Hermes.
 */
import type { WhatsappChat, WhatsappDmPolicy, WhatsappReplyChoice, WhatsappThreadMessage } from "../shared/ipc";

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

/**
 * Sessões de grupo (source whatsapp, chat_type group): no Hermes há UMA por grupo e por remetente
 * (`agent:<perfil>:whatsapp:group:<jid>:<número de quem falou>`); `user_name` do origin_json é o nome de quem falou.
 */
export const HERMES_GROUPS_PY = `python3 -c '
import json, os, sqlite3
p = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(p):
    print("null"); raise SystemExit
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
rows = c.execute("select id, session_key, display_name, origin_json, message_count, started_at, last_activity_at, hidden, ended_at from sessions where source = ? and chat_type = ?", ("whatsapp", "group")).fetchall()
out = []
for r in rows:
    try: o = json.loads(r[3] or "{}") or {}
    except Exception: o = {}
    out.append({"id": r[0], "key": r[1], "name": r[2], "user": o.get("user_name"), "count": r[4], "started": r[5], "last": r[6], "hidden": r[7], "ended": r[8]})
print(json.dumps({"sessions": out}, ensure_ascii=True))
'`;
/** Jid e remetente de uma chave de sessão de grupo do Hermes. */
export const hermesGroupOfKey = (key: string): { jid: string; sender: string } | null => { const m = /^agent:[^:]+:whatsapp:group:(\d{10,25}(?:-\d+)?@g\.us):\+?(\d{8,15})$/.exec(key); return m === null ? null : { jid: m[1]!, sender: m[2]! }; };
export interface HermesGroupSession { id: string; sender: string; nome: string | null; ended: boolean; started: number }
/** Sessões de um grupo (todas, com a marca de encerrada), da mais antiga para a mais nova. */
export function hermesGroupSessions(data: unknown, jid: string): HermesGroupSession[] {
  const rows = isObj(data) && Array.isArray(data.sessions) ? data.sessions : [];
  const out: HermesGroupSession[] = [];
  for (const s of rows) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.key !== "string" || !HERMES_ID_RE.test(s.id)) continue;
    const g = hermesGroupOfKey(s.key);
    if (g === null || g.jid !== jid) continue;
    out.push({ id: s.id, sender: g.sender, nome: typeof s.user === "string" && s.user.trim() !== "" ? s.user.trim() : null, ended: s.ended !== null && s.ended !== undefined, started: typeof s.started === "number" ? s.started : 0 });
  }
  return out.sort((a, b) => a.started - b.started);
}

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
export function threadFromHermes(data: unknown, autores: ReadonlyMap<string, string> = new Map()): WhatsappThreadMessage[] {
  const rows = isObj(data) && Array.isArray(data.messages) ? data.messages : [];
  const out: WhatsappThreadMessage[] = [];
  for (const m of rows) {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.kind === "string" && m.kind !== "") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text === "" || text === "NO_REPLY") continue;
    // Grupo: cada sessão é de um remetente; `autores` (id da sessão → nome ou +número) diz quem falou.
    const autor = m.role === "user" && typeof m.sid === "string" ? autores.get(m.sid) : undefined;
    out.push({ role: m.role === "user" ? "contact" : "agent", text, at: isoOf(m.ts), ...(autor === undefined ? {} : { autor }) });
  }
  const seen = new Set<string>();
  return out.filter((m) => { const k = `${m.role}|${m.at}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at.localeCompare(b.at));
}

// ---- Quem o agente responde (política de DM) no Hermes: vive em ~/.hermes/.env.
// WHATSAPP_MODE (self-chat | bot), WHATSAPP_DM_POLICY (pairing | allowlist | open | disabled), WHATSAPP_ALLOWED_USERS
// (lista separada por vírgula; "*" = todos) e WHATSAPP_ALLOW_ALL_USERS (opt-in obrigatório do "open": sem ele o
// gateway se recusa a subir). A lista é relida a cada mensagem; modo, política e opt-in só valem depois de
// reiniciar o gateway. Esta é a fronteira dona desse formato.
/** Imprime `wamode=`, `wadm=`, `waallow=` e `waall=` a partir de ~/.hermes/.env (aspas e `export` tolerados). */
export const HERMES_POLICY_PY = `python3 -c '
import os, re
p = os.path.expanduser("~/.hermes/.env"); kv = {}
try:
    for l in open(p):
        m = re.match(r"\\s*(?:export\\s+)?([A-Z0-9_]+)\\s*=\\s*(.*?)\\s*$", l)
        if m:
            v = m.group(2)
            kv[m.group(1)] = v[1:-1] if len(v) > 1 and v[0] == v[-1] and v[0] in "\\x27\\x22" else v
except Exception:
    pass
for k, n in (("WHATSAPP_MODE", "wamode"), ("WHATSAPP_DM_POLICY", "wadm"), ("WHATSAPP_ALLOWED_USERS", "waallow"), ("WHATSAPP_ALLOW_ALL_USERS", "waall")):
    print("%s=%s" % (n, kv.get(k, "")))
'`;

/** Valores lidos do .env do Hermes (strings cruas; vazio = ausente). */
export interface HermesWaEnv { mode: string; dm: string; allow: string; all: string }
export const hermesEnvOf = (kv: Map<string, string>): HermesWaEnv => ({ mode: kv.get("wamode") ?? "", dm: kv.get("wadm") ?? "", allow: kv.get("waallow") ?? "", all: kv.get("waall") ?? "" });
const truthy = (v: string): boolean => /^(true|1|yes|on)$/i.test(v.trim());
const listaDe = (allow: string): string[] => [...new Set(allow.split(",").map((s) => s.trim()).filter((s) => s !== ""))];
const comMais = (n: string): string => (n === "*" || n.startsWith("+") ? n : `+${n}`);

/**
 * O .env do Hermes → a política no contrato do app (a mesma que o OpenClaw devolve): self-chat é "só você";
 * open só vale com o opt-in (sem ele o gateway nem sobe: tratado como desligado); "*" na lista também é todo mundo;
 * lista preenchida é allowlist; pairing sem lista fica pairing.
 */
export function politicaHermes(env: HermesWaEnv, self: string | null): { dmPolicy: WhatsappDmPolicy; allowFrom: string[] } {
  const mode = (env.mode.trim().toLowerCase() || "self-chat");
  const dm = (env.dm.trim().toLowerCase() || "pairing");
  const lista = listaDe(env.allow);
  if (mode === "self-chat") return { dmPolicy: "allowlist", allowFrom: self === null ? [] : [`+${self}`] };
  if (dm === "disabled") return { dmPolicy: "disabled", allowFrom: lista.map(comMais) };
  if ((dm === "open" && truthy(env.all)) || lista.includes("*")) return { dmPolicy: "open", allowFrom: ["*"] };
  if (dm === "open") return { dmPolicy: "disabled", allowFrom: lista.map(comMais) };
  if (lista.length > 0) return { dmPolicy: "allowlist", allowFrom: lista.map(comMais) };
  return { dmPolicy: dm === "allowlist" ? "allowlist" : "pairing", allowFrom: [] };
}

/** O que gravar no .env para cada cartão. "open" mantém a lista como está (volta intacta se trocar de novo). */
export function hermesEnvPara(escolha: WhatsappReplyChoice, self: string | null, numbers: readonly string[] = []): Record<string, string> {
  if (escolha === "open") return { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "open", WHATSAPP_ALLOW_ALL_USERS: "true" };
  const lista = [...new Set([...(self === null ? [] : [self]), ...numbers.map((n) => n.replace(/\D/g, ""))])].filter((n) => n !== "");
  if (escolha === "self") return { WHATSAPP_MODE: "self-chat", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: lista.join(","), WHATSAPP_ALLOW_ALL_USERS: "false" };
  return { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: lista.join(","), WHATSAPP_ALLOW_ALL_USERS: "false" };
}

/** Modo, política e opt-in são lidos na subida do gateway; só a lista é ao vivo. */
export function hermesPrecisaReiniciar(antes: HermesWaEnv, depois: Record<string, string>): boolean {
  const norm = (v: string | undefined, padrao: string): string => (v ?? "").trim().toLowerCase() || padrao;
  return norm(antes.mode, "self-chat") !== norm(depois["WHATSAPP_MODE"], "self-chat")
    || norm(antes.dm, "pairing") !== norm(depois["WHATSAPP_DM_POLICY"], "pairing")
    || truthy(antes.all) !== truthy(depois["WHATSAPP_ALLOW_ALL_USERS"] ?? "");
}

/** Valores que podem ir num argumento de shell entre aspas simples (os nossos: palavras, números, vírgulas). */
export const HERMES_ENV_VALUE_RE = /^[A-Za-z0-9_,.*+-]*$/;
/** `KEY=valor …` em argv: grava em ~/.hermes/.env (linha existente trocada, senão acrescentada), com backup ao lado. */
export const HERMES_ENV_SET_PY = `python3 -c '
import os, re, sys, shutil, time
p = os.path.expanduser("~/.hermes/.env")
lines = open(p).read().splitlines(True) if os.path.exists(p) else []
if os.path.exists(p):
    shutil.copy2(p, p + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
for a in sys.argv[1:]:
    k, _, v = a.partition("=")
    done = False
    for i, l in enumerate(lines):
        if re.match(r"\\s*(?:export\\s+)?" + re.escape(k) + r"\\s*=", l):
            lines[i] = "%s=%s\\n" % (k, v); done = True
    if not done:
        if lines and not lines[-1].endswith("\\n"):
            lines[-1] += "\\n"
        lines.append("%s=%s\\n" % (k, v))
tmp = p + ".tmp"
open(tmp, "w").write("".join(lines)); os.chmod(tmp, 0o600); os.replace(tmp, p)
print("envset=ok")
'`;

/** Reinicia o gateway do Hermes onde ele estiver: processo do PM2 que roda `hermes gateway`, senão o serviço do próprio Hermes. */
export const HERMES_RESTART_SH = `export PATH=$HOME/.local/bin:$HOME/.npm-global/bin:$PATH
N=$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    for p in json.load(sys.stdin):
        e = p.get("pm2_env", {}); a = " ".join([str(e.get("pm_exec_path", "")), str(e.get("args", ""))])
        if "hermes" in a and "gateway" in a:
            print(p["name"]); break
except Exception:
    pass
')
if [ -n "$N" ]; then pm2 restart "$N" --update-env >/dev/null 2>&1 && echo "restart=pm2:$N" || echo "restart=falhou: pm2 restart $N"
elif command -v hermes >/dev/null 2>&1; then hermes gateway restart >/dev/null 2>&1 && echo "restart=hermes" || echo "restart=falhou: hermes gateway restart"
else echo "restart=sem-servico"; fi`;
