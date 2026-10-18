/**
 * Tutorial 11 · CRM pelo WhatsApp (módulo Pro), parte pura: os scripts de shell que leem/gravam a configuração
 * na máquina (`~/.local/share/meu-bot/crm.json`, 0600, com a chave da API do Streak) e o parse do que volta.
 * Mesmo molde do objetivo-core.ts: patch em base64 pelo stdin, merge em python3, gravação atômica. Testado.
 */
import type { CrmInfo } from "../shared/ipc";

export const CRM_FILE = "$HOME/.local/share/meu-bot/crm.json";
export const CRM_DIR = "$HOME/.local/share/meu-bot/crm";
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

export interface CrmPatch { apiKey?: string; pipelineKey?: string | null; pipelineName?: string | null; silencioMin?: number; criarSemPerguntar?: boolean }

/** Valida o que a tela mandou; devolve o patch limpo ou lança com a mensagem para a pessoa. */
export function parseCrmPatch(payload: unknown): CrmPatch {
  const p = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const out: CrmPatch = {};
  if ("apiKey" in p) {
    const k = typeof p["apiKey"] === "string" ? p["apiKey"].trim() : "";
    if (!/^[A-Za-z0-9_.-]{16,200}$/.test(k)) throw new Error("a chave da API do Streak parece inválida (copie inteira, sem espaços)");
    out.apiKey = k;
  }
  if ("pipelineKey" in p) {
    if (p["pipelineKey"] === null) out.pipelineKey = null;
    else { const k = typeof p["pipelineKey"] === "string" ? p["pipelineKey"].trim() : ""; if (!/^[A-Za-z0-9_-]{8,400}$/.test(k)) throw new Error("pipeline inválido"); out.pipelineKey = k; }
    if (typeof p["pipelineName"] === "string") out.pipelineName = p["pipelineName"].replace(/\s+/g, " ").trim().slice(0, 80);
  }
  if ("silencioMin" in p) { const n = Number(p["silencioMin"]); if (!Number.isInteger(n) || n < 1 || n > 240) throw new Error("o silêncio vai de 1 a 240 minutos"); out.silencioMin = n; }
  if ("criarSemPerguntar" in p) { if (typeof p["criarSemPerguntar"] !== "boolean") throw new Error("valor inválido"); out.criarSemPerguntar = p["criarSemPerguntar"]; }
  if (Object.keys(out).length === 0) throw new Error("nada para gravar");
  return out;
}

/** Lê crm.json (sem a chave: só `configured`) e se o lado da máquina está instalado. Linhas `C=` e `I=`. */
export function crmInfoSh(): string {
  return `python3 -c '
import json, os
f = os.path.expandvars("${CRM_FILE}")
try:
    c = json.load(open(f)); assert isinstance(c, dict)
except Exception:
    c = {}
out = {"configured": isinstance(c.get("apiKey"), str) and c.get("apiKey") != "", "pipelineKey": c.get("pipelineKey"), "pipelineName": c.get("pipelineName"), "silencioMin": c.get("silencioMin", 10), "criarSemPerguntar": c.get("criarSemPerguntar") is True, "savedAt": c.get("savedAt")}
print("C=" + json.dumps(out, ensure_ascii=False))
' 2>/dev/null || echo 'C={}'
[ -f "${CRM_DIR}/crm-job.mjs" ] && [ -f "${CRM_DIR}/streak.mjs" ] && echo I=1 || echo I=0
`;
}

/** Grava o patch em crm.json (merge; a chave só entra se vier no patch) e, se o plugin existe, atualiza o silêncio nele. */
export function setCrmSh(patch: CrmPatch): string {
  const p = { ...patch, savedAt: new Date().toISOString() };
  return `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64(JSON.stringify(p))}' | base64 -d | python3 -c '
import json, sys, os
f = os.path.expandvars("${CRM_FILE}")
try:
    cur = json.load(open(f)); assert isinstance(cur, dict)
except Exception:
    cur = {}
cur.update(json.load(sys.stdin))
tmp = f + ".tmp"
json.dump(cur, open(tmp, "w"), ensure_ascii=False, indent=1); os.chmod(tmp, 0o600); os.replace(tmp, f)
print("CRM=1")
'${typeof patch.silencioMin === "number" ? `
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; command -v openclaw >/dev/null 2>&1 && timeout 60 openclaw config set plugins.entries.meu-bot-crm.config.silencioMin ${patch.silencioMin} --strict-json >/dev/null 2>&1 || true` : ""}`;
}

/** Roda o streak.mjs da máquina para um subcomando sem argumentos da pessoa (diag/pipelines). Linha `S=`. */
export function streakSh(sub: "diag" | "pipelines"): string {
  return `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
if [ -f "${CRM_DIR}/streak.mjs" ]; then echo "S=$(timeout 60 node "${CRM_DIR}/streak.mjs" ${sub} 2>/dev/null | tail -n1)"; else echo 'S={"erro":"o CRM ainda não foi instalado nesta máquina"}'; fi
`;
}

/** "Refazer do zero": apaga a configuração (chave incluída) e o estado do job; o plugin fica. */
export const resetCrmSh = (): string => `rm -f "${CRM_FILE}" "${CRM_DIR}/estado.json" "${CRM_DIR}/tracker.json" && echo CRM=1`;

export function parseCrmInfo(stdout: string): Omit<CrmInfo, "available"> {
  const c = stdout.split("\n").find((l) => l.startsWith("C="));
  let raw: Record<string, unknown> = {};
  try { const v: unknown = JSON.parse((c ?? "C=").slice(2) || "{}"); if (v !== null && typeof v === "object" && !Array.isArray(v)) raw = v as Record<string, unknown>; } catch { raw = {}; }
  const n = Number(raw["silencioMin"]);
  return {
    installed: stdout.includes("I=1"),
    configured: raw["configured"] === true,
    pipelineKey: typeof raw["pipelineKey"] === "string" ? raw["pipelineKey"] : null,
    pipelineName: typeof raw["pipelineName"] === "string" ? raw["pipelineName"] : null,
    silencioMin: Number.isInteger(n) && n >= 1 && n <= 240 ? n : 10,
    criarSemPerguntar: raw["criarSemPerguntar"] === true,
    savedAt: typeof raw["savedAt"] === "string" ? raw["savedAt"] : null,
  };
}
/** Saída do streak.mjs (linha `S=`): o JSON, ou `{erro}` quando não veio nada. */
export function parseStreakOut(stdout: string): Record<string, unknown> {
  const s = stdout.split("\n").find((l) => l.startsWith("S="));
  const body = (s ?? "S=").slice(2).trim();
  if (body !== "") { try { const v: unknown = JSON.parse(body); if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* abaixo */ } }
  return { erro: "o streak.mjs não respondeu (node ausente ou sem chave)" };
}
