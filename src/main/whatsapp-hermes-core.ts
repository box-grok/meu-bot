/**
 * Conversas do WhatsApp numa máquina com o Hermes Agent, para o espelho só-leitura do app. O Hermes guarda tudo em
 * `~/.hermes/state.db` (SQLite): `sessions` (uma por contato, `session_key` = `agent:<perfil>:whatsapp:dm:<número>`,
 * `display_name` = o nome do contato) e `messages` (`role` user/assistant/tool/session_meta, `content`, `timestamp`
 * em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp). Os programas Python
 * abaixo leem o banco em modo só-leitura na máquina e devolvem JSON numa linha; as funções puras viram isso nos
 * tipos do contrato. É a fronteira dona desse formato: o renderer nunca vê o esquema do Hermes.
 */
import type { WhatsappChat, WhatsappDmPolicy, WhatsappGroup, WhatsappGroupAgent, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappThreadMessage } from "../shared/ipc";
import { JID_RE, parseCacheGrupos } from "./whatsapp-grupos-core";

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

// ------------------------------------------------------------------ grupos (config.yaml do Hermes)
/**
 * Grupos no Hermes: dois portões por mensagem. (1) O grupo é admitido? `platforms.whatsapp.group_policy` do
 * ~/.hermes/config.yaml: `allowlist` com `group_allow_from` (jids), `open` = todos, `disabled`/`pairing` = nenhum.
 * (2) O agente responde a tudo ou só quando chamado? `require_mention` (global) com as exceções `free_response_chats`
 * (jids que respondem sempre). Quem fala dentro de um grupo admitido passa pela MESMA lista global das conversas
 * diretas (WHATSAPP_ALLOWED_USERS): não existe "quem aciona" por grupo no Hermes. O config.yaml tem precedência
 * sobre o .env e os dois são lidos na subida do gateway, então gravar exige reiniciar (HERMES_RESTART_SH).
 *
 * Tradução para o contrato do app (o mesmo do OpenClaw): `desligado` = fora da lista; `sempre` = admitido e
 * (sem menção obrigatória ou nas exceções); `mencao` = admitido com menção obrigatória. "Quando chamado" num
 * grupo liga `require_mention` para todos e põe os outros ligados nas exceções, para ninguém mudar sem querer.
 */
export type HermesGroupPolicy = "open" | "allowlist" | "disabled" | "pairing";
export interface HermesGroupCfg { policy: HermesGroupPolicy; allow: string[]; requireMention: boolean; free: string[] }

/** Python do runtime do Hermes (tem PyYAML e ruamel); sem ele, o python3 da máquina. Deixa em $PY. */
const HERMES_PY_SH = `export PATH=$HOME/.local/bin:$PATH; R=$(hermes --version 2>/dev/null | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; PY=$R/venv/bin/python; [ -x "$PY" ] || PY=python3`;

/** Imprime `gcfg=<json>` com a política de grupos: config.yaml (platforms.whatsapp, chaves soltas ou em `extra`) e, faltando, o .env. */
export const HERMES_GROUP_CFG_SH = `${HERMES_PY_SH}; "$PY" -c '
import json, os, re
e = {}
try:
    for l in open(os.path.expanduser("~/.hermes/.env")):
        m = re.match(r"\\s*(?:export\\s+)?([A-Z0-9_]+)\\s*=\\s*(.*)$", l)
        if m: e[m.group(1)] = m.group(2).strip().strip("\\"").strip("\\x27")
except Exception:
    pass
try:
    import yaml
    c = yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
except Exception:
    c = {}
w = (c.get("platforms") or {}).get("whatsapp") or {}
if not isinstance(w, dict): w = {}
x = w.get("extra") if isinstance(w.get("extra"), dict) else {}
def pick(k, envk):
    if k in w: return w[k]
    if k in x: return x[k]
    return e.get(envk)
print("gcfg=" + json.dumps({"group_policy": pick("group_policy", "WHATSAPP_GROUP_POLICY"), "group_allow_from": pick("group_allow_from", "WHATSAPP_GROUP_ALLOWED_USERS"), "require_mention": pick("require_mention", "WHATSAPP_REQUIRE_MENTION"), "free_response_chats": pick("free_response_chats", "WHATSAPP_FREE_RESPONSE_CHATS")}, ensure_ascii=True))
'`;

/**
 * Grava a política de grupos em ~/.hermes/config.yaml (platforms.whatsapp), com backup ao lado e escrita atômica.
 * ruamel (round-trip) preserva comentários e os prompts por grupo; sem ele, PyYAML sem reordenar. As mesmas chaves
 * em `extra:` saem, para a precedência não enganar. Imprime `cfgset=ok`.
 */
export function hermesGroupCfgSetSh(cfg: HermesGroupCfg): string {
  const b64 = Buffer.from(JSON.stringify({ group_policy: cfg.policy, group_allow_from: cfg.allow, require_mention: cfg.requireMention, free_response_chats: cfg.free }), "utf8").toString("base64");
  return `${HERMES_PY_SH}; "$PY" -c '
import base64, json, os, shutil, sys, time
p = os.path.expanduser("~/.hermes/config.yaml")
novo = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
try:
    from ruamel.yaml import YAML
    y = YAML(); y.preserve_quotes = True; y.width = 4096; y.indent(mapping=2, sequence=4, offset=2)
    doc = (y.load(open(p)) if os.path.exists(p) else None)
    if doc is None:
        from ruamel.yaml.comments import CommentedMap
        doc = CommentedMap()
    def dump(d, f): y.dump(d, f)
except Exception:
    import yaml
    doc = (yaml.safe_load(open(p)) if os.path.exists(p) else None) or {}
    def dump(d, f): yaml.safe_dump(d, f, allow_unicode=True, sort_keys=False)
pl = doc.get("platforms")
if not isinstance(pl, dict): doc["platforms"] = pl = type(doc)()
w = pl.get("whatsapp")
if not isinstance(w, dict): pl["whatsapp"] = w = type(doc)()
x = w.get("extra")
for k in ("group_policy", "group_allow_from", "require_mention", "free_response_chats"):
    w[k] = novo[k]
    if isinstance(x, dict): x.pop(k, None)
if os.path.exists(p): shutil.copy2(p, p + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
tmp = p + ".tmp"
with open(tmp, "w") as f: dump(doc, f)
os.chmod(tmp, 0o600); os.replace(tmp, p)
print("cfgset=ok")
' '${b64}'`;
}

const jidsDe = (v: unknown): string[] => {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(parts.map((s) => String(s).trim()).filter((s) => s === "*" || JID_RE.test(s)))];
};
/** O JSON de HERMES_GROUP_CFG_SH no contrato; null quando não veio objeto (não deu para ler). */
export function parseHermesGroupCfg(raw: unknown): HermesGroupCfg | null {
  if (!isObj(raw)) return null;
  const p = String(raw["group_policy"] ?? "").trim().toLowerCase();
  const policy: HermesGroupPolicy = p === "open" || p === "allowlist" || p === "disabled" ? p : "pairing";
  const rm = raw["require_mention"];
  const requireMention = typeof rm === "boolean" ? rm : typeof rm === "string" ? truthy(rm) : false;
  return { policy, allow: jidsDe(raw["group_allow_from"]), requireMention, free: jidsDe(raw["free_response_chats"]) };
}
/** Todos os grupos admitidos (`open`, ou `allowlist` com "*"): o mesmo "perigoso" da tela. */
export const hermesTodosAdmitidos = (cfg: HermesGroupCfg | null): boolean => cfg !== null && (cfg.policy === "open" || (cfg.policy === "allowlist" && cfg.allow.includes("*")));
const hermesAdmitido = (cfg: HermesGroupCfg, jid: string): boolean => cfg.policy === "open" || (cfg.policy === "allowlist" && (cfg.allow.includes(jid) || cfg.allow.includes("*")));
/** Estado de um grupo no contrato do app, pela config (null = sem config legível: nada ligado). */
export function hermesEstadoDoGrupo(cfg: HermesGroupCfg | null, jid: string): WhatsappGroupAgent {
  if (cfg === null || !hermesAdmitido(cfg, jid)) return "desligado";
  return !cfg.requireMention || cfg.free.includes(jid) ? "sempre" : "mencao";
}
/**
 * Config nova para o pedido da tela; null = nada a mudar. "Quem aciona" não existe por grupo no Hermes: a tela é
 * mandada para "Quem o agente responde", que é a lista única. Desligar o último grupo volta a `disabled` (lista
 * vazia com `allowlist` já é nenhum grupo, mas `disabled` diz isso sem depender da leitura). Com todos os grupos
 * admitidos (`open`/"*") não há lista para tirar um grupo nem para preservar os outros: explica em vez de chutar.
 */
export function hermesGroupCfgPara(cfg: HermesGroupCfg | null, jid: string, pedido: WhatsappGroupPatch): HermesGroupCfg | null {
  if (pedido.quemAciona !== undefined) throw new Error("no Hermes quem pode chamar o agente é uma lista só, a mesma das conversas diretas: mude em \"Quem o agente responde\", na tela do WhatsApp desta máquina");
  if (pedido.agente === undefined) return null;
  const base: HermesGroupCfg = cfg ?? { policy: "pairing", allow: [], requireMention: false, free: [] };
  if (hermesEstadoDoGrupo(base, jid) === pedido.agente) return null;
  const todos = hermesTodosAdmitidos(base);
  if (todos && pedido.agente === "desligado") throw new Error("a configuração do Hermes admite TODOS os grupos (group_policy open ou \"*\"): para desligar um grupo, troque group_allow_from por uma lista no ~/.hermes/config.yaml");
  if (todos && pedido.agente === "mencao" && !base.requireMention) throw new Error("com TODOS os grupos admitidos não dá para deixar só este \"quando chamado\" sem mudar os outros: troque group_allow_from por uma lista no ~/.hermes/config.yaml");
  let allow = [...base.allow]; let free = [...base.free]; let { policy, requireMention } = base;
  if (pedido.agente === "desligado") {
    allow = allow.filter((j) => j !== jid); free = free.filter((j) => j !== jid);
    policy = allow.length === 0 ? "disabled" : "allowlist";
  } else {
    if (!todos) { policy = "allowlist"; if (!allow.includes(jid)) allow.push(jid); }
    if (pedido.agente === "sempre") { if (requireMention && !free.includes(jid)) free.push(jid); }
    else {
      // Primeiro grupo "quando chamado" numa máquina que respondia a tudo: a menção passa a valer para todos e os
      // outros ligados viram exceção, para continuarem respondendo sempre.
      if (!requireMention) { requireMention = true; for (const j of base.allow) if (j !== jid && j !== "*" && !free.includes(j)) free.push(j); }
      free = free.filter((j) => j !== jid);
    }
  }
  return { policy, allow, requireMention, free };
}

const msDe = (v: unknown): number => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0; return !Number.isFinite(n) || n <= 0 ? 0 : n < 1e11 ? n * 1000 : n; };
/**
 * Grupos da máquina com Hermes no contrato do app: a lista admitida (config) mais os grupos com sessão no state.db
 * (HERMES_GROUPS_PY; uma sessão por remetente, a mais recente dá hora, chave e id). `quemAciona` é a lista única
 * das conversas diretas (quem chama o agente nos grupos é quem ele responde no privado); nunca "herdado", porque
 * no Hermes não há lista própria para herdar de. O Hermes guarda a sessão de grupo com o id como nome, então o nome
 * vem do cache da skill whatsapp-grupos quando ele existe na máquina (`cache`); sem ele, fica sem nome (apelido na tela).
 */
export function gruposHermes(cfg: HermesGroupCfg | null, data: unknown, self: string | null, quemAciona: string[] | "todos", cache: unknown = null): WhatsappGroups {
  const byJid = new Map<string, WhatsappGroup>();
  const get = (jid: string): WhatsappGroup => {
    let g = byJid.get(jid);
    if (g === undefined) { g = { jid, nome: null, apelido: null, membros: null, participantes: [], agente: "desligado", sessionKey: null, sessionId: null, transcript: null, updatedAt: null, agenteRespondeu: false, deleted: false }; byJid.set(jid, g); }
    return g;
  };
  const lido = parseCacheGrupos(cache);
  for (const c of lido.grupos) { const g = get(c.jid); if (c.nome !== "") g.nome = c.nome; g.membros = c.membros; g.participantes = c.participantes; }
  const rows = isObj(data) && Array.isArray(data.sessions) ? data.sessions : [];
  for (const s of rows) {
    if (!isObj(s) || typeof s.key !== "string") continue;
    const k = hermesGroupOfKey(s.key);
    if (k === null) continue;
    const g = get(k.jid);
    const last = msDe(s.last) || msDe(s.started);
    if (last > 0 && (g.updatedAt === null || last > Date.parse(g.updatedAt))) { g.updatedAt = new Date(last).toISOString(); g.sessionKey = s.key; g.sessionId = typeof s.id === "string" && HERMES_ID_RE.test(s.id) ? s.id : null; }
    if (g.nome === null) g.nome = nameOf(s.name);
    if (typeof s.count === "number" && s.count > 0) g.agenteRespondeu = true;
  }
  if (cfg !== null) for (const jid of cfg.allow) if (JID_RE.test(jid)) get(jid);
  for (const g of byJid.values()) g.agente = hermesEstadoDoGrupo(cfg, g.jid);
  const peso = (g: WhatsappGroup): number => (g.agente === "desligado" ? 1 : 0);
  const grupos = [...byJid.values()].sort((a, b) => peso(a) - peso(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (a.nome ?? a.jid).localeCompare(b.nome ?? b.jid));
  return { grupos, quemAciona, quemAcionaHerdado: false, todosAdmitidos: hermesTodosAdmitidos(cfg), cacheEm: lido.em, skill: false, self: self === null ? null : (self.split(/[:@]/)[0] ?? "").replace(/\D/g, "") || null };
}
