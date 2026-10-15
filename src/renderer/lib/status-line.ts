/** Status line do chat (modelo da box: modelo | Ctx | conta | Sessão | Semanal). Puro: testável. */
import type { AccountStatus } from "../../shared/ipc";

export interface Segment { kind: "model" | "ctx" | "turn" | "account" | "session" | "weekly" | "age"; text: string; title?: string }

/** 1234 → "1.2k", 2500000 → "2.5M" (igual ao fmt do statusline.sh). */
export const fmtK = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Tempo até um epoch (s): "now", "35min", "1h35m", "4d23h". */
export function timeUntil(resetEpochSec: number, nowMs = Date.now()): string {
  const mins = Math.floor((resetEpochSec * 1000 - nowMs) / 60_000);
  if (mins <= 0) return "now";
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d${Math.floor((mins % 1440) / 60)}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60}m`;
  return `${mins}min`;
}

/** "há 12 min" para o updated (epoch s) do cache; "" se não há. */
export function ageText(updatedEpochSec: number | null, nowMs = Date.now()): string {
  if (updatedEpochSec === null) return "";
  const mins = Math.floor((nowMs - updatedEpochSec * 1000) / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  if (mins < 1440) return `há ${Math.floor(mins / 60)} h`;
  return `há ${Math.floor(mins / 1440)} d`;
}

/** Limiares de aviso (os mesmos do alerta do Hermes no WhatsApp). */
export const SESSION_THRESHOLDS = [80, 90, 95] as const;

/** Maior limiar cruzado por `pct` que ainda não foi avisado (`warned` = último avisado). */
export function thresholdToWarn(pct: number | null, warned: number): number | null {
  if (pct === null) return null;
  let hit: number | null = null;
  for (const t of SESSION_THRESHOLDS) if (pct >= t && t > warned) hit = t;
  return hit;
}

export const isClaudeModel = (model: string): boolean => model !== "grok-4";

export interface StatusInput {
  model: string;
  ctx: { tokens: number; budget: number } | null;
  turn: { ms: number; completion: number } | null;
  account: AccountStatus | null;
  nowMs?: number;
}

export function buildSegments(input: StatusInput): Segment[] {
  const now = input.nowMs ?? Date.now();
  const out: Segment[] = [{ kind: "model", text: input.model }];
  if (input.ctx !== null && input.ctx.budget > 0) {
    const pct = Math.min(999, Math.round((input.ctx.tokens / input.ctx.budget) * 100));
    out.push({ kind: "ctx", text: `Ctx: ${pct}% · ${fmtK(input.ctx.tokens)}/${fmtK(input.ctx.budget)}`, title: "tokens estimados enviados ao backend / orçamento de contexto" });
  }
  if (input.turn !== null && input.turn.ms > 0) {
    const tps = input.turn.completion > 0 ? ` · ${Math.round(input.turn.completion / (input.turn.ms / 1000))} t/s` : "";
    out.push({ kind: "turn", text: `${(input.turn.ms / 1000).toFixed(1)} s${input.turn.completion > 0 ? ` · ${fmtK(input.turn.completion)} tok` : ""}${tps}`, title: "último turno" });
  }
  const a = input.account;
  if (a !== null && isClaudeModel(input.model)) {
    if (a.email !== null) out.push({ kind: "account", text: a.assento !== null ? `${a.email} (${a.assento})` : a.email });
    if (a.sessionPct !== null) out.push({ kind: "session", text: `Sessão: ${Math.round(a.sessionPct)}%${a.sessionResets !== null ? ` · ${timeUntil(a.sessionResets, now)}` : ""}`, title: "limite de 5 horas do Claude" });
    if (a.weeklyPct !== null) out.push({ kind: "weekly", text: `Semanal: ${Math.round(a.weeklyPct)}%${a.weeklyResets !== null ? ` · ${timeUntil(a.weeklyResets, now)}` : ""}`, title: "limite de 7 dias do Claude" });
    const age = ageText(a.updated, now);
    if (age !== "" && (a.sessionPct !== null || a.weeklyPct !== null)) out.push({ kind: "age", text: age, title: "idade do cache do statusline.sh na máquina" });
  }
  return out;
}
