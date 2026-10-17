/**
 * Marcações das conversas do WhatsApp guardadas na máquina (a VM), para que o meu-bot da pessoa e o meu-bot-admin
 * vejam a mesma lista (como a pausa, que mora no OpenClaw): arquivado, excluído e os nomes (o pushname em cache e o
 * apelido dado na tela). Puro: a leitura e a gravação por SSH ficam em whatsapp.ts.
 *
 * Arquivo: { "archived": { "<número>": "<ISO>" }, "deleted": { "<número>": "<ISO da exclusão>" },
 *           "names": { "<número>": { "name": "<pushname>", "alias": "<apelido>", "at": "<ISO>" } } }.
 * Excluída fica oculta enquanto `updatedAt <= deletedAt`; mensagem nova do contato traz a conversa de volta nos dois
 * apps. O nome em cache poupa a leitura do histórico só para saber quem é; o apelido vence o nome na lista.
 */
import type { WhatsappChat } from "../shared/ipc";

export const WA_MARKS_FILE = "$HOME/.local/share/meu-bot/whatsapp-lista.json";

export interface WaName { name: string | null; alias: string | null; at: string }
export interface WaMarks { archived: Record<string, string>; deleted: Record<string, string>; names: Record<string, WaName> }
/** Um ajuste: `at` só a migração do localStorage manda (sem ele, a máquina usa a hora dela); `name`/`alias` vazios apagam. */
export interface WaMarkPatch { number: string; archived?: boolean; deleted?: boolean; name?: string; alias?: string; at?: string }

const NUMBER_RE = /^\d{8,15}$/;
const NAME_MAX = 80;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
/** Nome/apelido vindo de fora: uma linha, 1–80 caracteres; senão null. */
const nameOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= NAME_MAX ? s : null;
};

function parseMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, at] of Object.entries(v)) {
    const iso = isoOrNull(at);
    if (NUMBER_RE.test(k) && iso !== null) out[k] = iso;
  }
  return out;
}
function parseNames(v: unknown): Record<string, WaName> {
  const out: Record<string, WaName> = {};
  if (!isObj(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (!NUMBER_RE.test(k) || !isObj(e)) continue;
    const name = nameOrNull(e.name), alias = nameOrNull(e.alias);
    if (name === null && alias === null) continue;
    out[k] = { name, alias, at: isoOrNull(e.at) ?? "" };
  }
  return out;
}

/** O que veio da máquina, saneado (lixo ou arquivo corrompido = sem marcas). */
export function parseWaMarks(raw: unknown): WaMarks {
  if (!isObj(raw)) return { archived: {}, deleted: {}, names: {} };
  return { archived: parseMap(raw.archived), deleted: parseMap(raw.deleted), names: parseNames(raw.names) };
}

/**
 * Preenche `archived`/`deleted`/`alias` e completa `name` pelo cache quando a memória do main não tem (o pushname
 * recém-lido nesta sessão vence o arquivo, por ser mais fresco). Excluída só enquanto não chegou mensagem depois.
 */
export function applyWaMarks(chats: readonly WhatsappChat[], marks: WaMarks): WhatsappChat[] {
  return chats.map((c) => {
    const del = marks.deleted[c.number];
    const nm = marks.names[c.number];
    return { ...c, name: c.name ?? nm?.name ?? null, alias: nm?.alias ?? null, archived: marks.archived[c.number] !== undefined, deleted: del !== undefined && Date.parse(c.updatedAt) <= Date.parse(del) };
  });
}

/** Saneia os ajustes que vêm da tela; recusa número fora do padrão e limita a quantidade (a migração manda vários). */
export function parseWaMarkPatches(payload: unknown): WaMarkPatch[] {
  const list = (payload as { marks?: unknown } | null)?.marks;
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) throw new Error("ajustes inválidos");
  return list.map((p: unknown): WaMarkPatch => {
    if (!isObj(p) || typeof p.number !== "string") throw new Error("número inválido");
    const number = p.number.replace(/\D/g, "");
    if (!NUMBER_RE.test(number)) throw new Error("número inválido");
    const out: WaMarkPatch = { number };
    if (typeof p.archived === "boolean") out.archived = p.archived;
    if (typeof p.deleted === "boolean") out.deleted = p.deleted;
    for (const field of ["name", "alias"] as const) {
      const v = p[field];
      if (typeof v !== "string") continue;
      const clean = v.replace(/\s+/g, " ").trim();
      if (clean.length > NAME_MAX) throw new Error(`${field === "name" ? "nome" : "apelido"} longo demais (máximo ${NAME_MAX})`);
      out[field] = clean; // vazio = apagar
    }
    const at = isoOrNull(p.at);
    if (at !== null) out.at = at;
    if (out.archived === undefined && out.deleted === undefined && out.name === undefined && out.alias === undefined) throw new Error("ajuste vazio");
    return out;
  });
}

/**
 * Script remoto: lê o arquivo atual, aplica os ajustes e grava (tmp + mv). O merge é na máquina para o admin e a
 * pessoa não se sobrescreverem. Os ajustes vão em base64 (sem problema de aspas); python3 já é exigido pelo app.
 */
export function waMarkSh(patches: readonly WaMarkPatch[]): string {
  for (const p of patches) {
    if (!NUMBER_RE.test(p.number)) throw new Error("número inválido");
    for (const v of [p.name, p.alias]) if (v !== undefined && (v.length > NAME_MAX || /[\r\n]/.test(v))) throw new Error("nome inválido");
  }
  const b64 = Buffer.from(JSON.stringify(patches), "utf8").toString("base64");
  return `command -v python3 >/dev/null 2>&1 || { echo "a máquina não tem python3" >&2; exit 2; }
mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64}' | base64 -d | python3 -c '
import json, sys, os, time
f = os.path.expandvars("${WA_MARKS_FILE}")
try:
    cur = json.load(open(f))
    assert isinstance(cur, dict)
except Exception:
    cur = {}
arch = cur.get("archived") if isinstance(cur.get("archived"), dict) else {}
dele = cur.get("deleted") if isinstance(cur.get("deleted"), dict) else {}
names = cur.get("names") if isinstance(cur.get("names"), dict) else {}
now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
for p in json.load(sys.stdin):
    n = p["number"]; at = p.get("at") or now
    if "archived" in p:
        if p["archived"]: arch[n] = at
        else: arch.pop(n, None)
    if "deleted" in p:
        if p["deleted"]: dele[n] = at
        else: dele.pop(n, None)
    if "name" in p or "alias" in p:
        e = names.get(n) if isinstance(names.get(n), dict) else {}
        if "name" in p: e["name"] = p["name"] or None
        if "alias" in p: e["alias"] = p["alias"] or None
        e["at"] = at
        if e.get("name") or e.get("alias"): names[n] = e
        else: names.pop(n, None)
tmp = f + ".tmp"
with open(tmp, "w") as o: json.dump({"archived": arch, "deleted": dele, "names": names}, o, indent=1, ensure_ascii=False)
os.chmod(tmp, 0o600); os.replace(tmp, f)
print("MARKS=1")
'
`;
}

/**
 * Texto do registro de suporte para um ajuste (admin): só um ajuste "de verdade" da tela; migração (com `at`) e
 * cache de nome (`name` sozinho) não registram.
 */
export function waMarkLogText(patches: readonly WaMarkPatch[]): string | null {
  if (patches.length !== 1) return null;
  const p = patches[0]!;
  if (p.at !== undefined) return null;
  const who = `a conversa do WhatsApp de +${p.number}`;
  if (p.deleted === true) return `excluiu ${who}`;
  if (p.archived === true) return `arquivou ${who}`;
  if (p.archived === false) return `desarquivou ${who}`;
  if (p.alias !== undefined) return p.alias === "" ? `tirou o apelido d${who}` : `renomeou ${who} para "${p.alias}"`;
  return null;
}
