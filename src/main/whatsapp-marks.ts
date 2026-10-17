/**
 * Marcações de arquivado/excluído das conversas do WhatsApp, guardadas na máquina (a VM), para que o meu-bot da
 * pessoa e o meu-bot-admin vejam a mesma lista (como a pausa, que mora no OpenClaw). Puro: a leitura e a
 * gravação por SSH ficam em whatsapp.ts.
 *
 * Arquivo: { "archived": { "<número>": "<ISO>" }, "deleted": { "<número>": "<ISO da exclusão>" } }. Excluída fica
 * oculta enquanto `updatedAt <= deletedAt`; mensagem nova do contato traz a conversa de volta nos dois apps.
 */
import type { WhatsappChat } from "../shared/ipc";

export const WA_MARKS_FILE = "$HOME/.local/share/meu-bot/whatsapp-lista.json";

export interface WaMarks { archived: Record<string, string>; deleted: Record<string, string> }
/** Um ajuste: `at` só a migração do localStorage manda (sem ele, a máquina usa a hora dela). */
export interface WaMarkPatch { number: string; archived?: boolean; deleted?: boolean; at?: string }

const NUMBER_RE = /^\d{8,15}$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

function parseMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, at] of Object.entries(v)) {
    const iso = isoOrNull(at);
    if (NUMBER_RE.test(k) && iso !== null) out[k] = iso;
  }
  return out;
}

/** O que veio da máquina, saneado (lixo ou arquivo corrompido = sem marcas). */
export function parseWaMarks(raw: unknown): WaMarks {
  if (!isObj(raw)) return { archived: {}, deleted: {} };
  return { archived: parseMap(raw.archived), deleted: parseMap(raw.deleted) };
}

/** Preenche `archived`/`deleted` de cada conversa. Excluída só enquanto não chegou mensagem depois da exclusão. */
export function applyWaMarks(chats: readonly WhatsappChat[], marks: WaMarks): WhatsappChat[] {
  return chats.map((c) => {
    const del = marks.deleted[c.number];
    return { ...c, archived: marks.archived[c.number] !== undefined, deleted: del !== undefined && Date.parse(c.updatedAt) <= Date.parse(del) };
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
    const at = isoOrNull(p.at);
    if (at !== null) out.at = at;
    if (out.archived === undefined && out.deleted === undefined) throw new Error("ajuste vazio");
    return out;
  });
}

/**
 * Script remoto: lê o arquivo atual, aplica os ajustes e grava (tmp + mv). O merge é na máquina para o admin e a
 * pessoa não se sobrescreverem. Os ajustes vão em base64 (sem problema de aspas); python3 já é exigido pelo app.
 */
export function waMarkSh(patches: readonly WaMarkPatch[]): string {
  for (const p of patches) if (!NUMBER_RE.test(p.number)) throw new Error("número inválido");
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
now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
for p in json.load(sys.stdin):
    n = p["number"]; at = p.get("at") or now
    if "archived" in p:
        if p["archived"]: arch[n] = at
        else: arch.pop(n, None)
    if "deleted" in p:
        if p["deleted"]: dele[n] = at
        else: dele.pop(n, None)
tmp = f + ".tmp"
with open(tmp, "w") as o: json.dump({"archived": arch, "deleted": dele}, o, indent=1)
os.chmod(tmp, 0o600); os.replace(tmp, f)
print("MARKS=1")
'
`;
}

/** Texto do registro de suporte para um ajuste (admin): só o primeiro ajuste "de verdade"; migração não registra. */
export function waMarkLogText(patches: readonly WaMarkPatch[]): string | null {
  if (patches.length !== 1) return null;
  const p = patches[0]!;
  if (p.at !== undefined) return null;
  const who = `a conversa do WhatsApp de +${p.number}`;
  if (p.deleted === true) return `excluiu ${who}`;
  if (p.archived === true) return `arquivou ${who}`;
  if (p.archived === false) return `desarquivou ${who}`;
  return null;
}
