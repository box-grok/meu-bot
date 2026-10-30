/**
 * Preferências da status line por máquina (Tutoriais › Status line › "Escolher o que aparece"): quais
 * segmentos a barra do Claude Code mostra. Ficam na própria máquina, em ~/.claude/statusline-segments.json,
 * lidas pelo statusline.sh (barra do terminal) e pelo backend (rodapé do app): os dois sempre combinam.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StatusLineSegments } from "../../shared/ipc";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { runSsh } from "../whatsapp/whatsapp";

export const SEGMENT_KEYS = ["model", "ctx", "account", "session", "weekly", "espaco"] as const;
const REMOTE_FILE = "$HOME/.claude/statusline-segments.json";

/** Objeto válido: cada chave true salvo `false` explícito; null se não é um objeto. */
export function normalizeSegments(v: unknown): StatusLineSegments | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out = {} as StatusLineSegments;
  for (const k of SEGMENT_KEYS) out[k] = o[k] !== false;
  return out;
}

export async function readSegments(host: string): Promise<StatusLineSegments | null> {
  if (host === LOCAL_HOST) {
    try { return normalizeSegments(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "statusline-segments.json"), "utf8"))); } catch { return null; }
  }
  if (!isValidHost(host)) return null;
  const r = await runSsh(host, `cat ${REMOTE_FILE} 2>/dev/null\n`, 20_000);
  if (r.code !== 0 || r.stdout.trim() === "") return null;
  try { return normalizeSegments(JSON.parse(r.stdout)); } catch { return null; }
}

/** Grava as preferências (pelo menos um segmento ligado), atômico e só para o dono do arquivo. */
export async function writeSegments(host: string, prefs: unknown): Promise<StatusLineSegments> {
  const p = normalizeSegments(prefs);
  if (p === null) throw new Error("preferências inválidas");
  if (!SEGMENT_KEYS.some((k) => p[k])) throw new Error("deixe pelo menos um segmento ligado");
  const json = `${JSON.stringify(p)}\n`;
  if (host === LOCAL_HOST) {
    const dir = path.join(os.homedir(), ".claude"); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "statusline-segments.json");
    fs.writeFileSync(`${file}.tmp`, json, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
    return p;
  }
  if (!isValidHost(host)) throw new Error("máquina inválida");
  const b64 = Buffer.from(json, "utf8").toString("base64");
  const r = await runSsh(host, `umask 077; mkdir -p "$HOME/.claude" && printf '%s' '${b64}' | base64 -d > ${REMOTE_FILE}.tmp && mv ${REMOTE_FILE}.tmp ${REMOTE_FILE}\n`, 20_000);
  if (r.code !== 0) throw new Error(`não consegui gravar na máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  return p;
}
