/**
 * Zoom da janela (interface inteira), no modelo do VS Code/Cursor: nível inteiro de -8 a 8, fator 1.2^nível
 * (0 = 100%). Puro: testável com node --test. Quem aplica nas janelas é zoom.ts; quem guarda é settings.ts.
 * O zoom por site da aba do Navegador é outra coisa (renderer, por host) e não passa por aqui.
 */
import type { ZoomAction, ZoomState } from "../../shared/ipc";

export const ZOOM_MIN = -8;
export const ZOOM_MAX = 8;
export const ZOOM_BASE = 1.2;

export const isZoomLevel = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= ZOOM_MIN && v <= ZOOM_MAX;
/** Arredonda e prende à faixa; NaN/infinito viram 0. */
export const clampZoom = (n: number): number => (Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n))) : 0);
export const zoomFactor = (level: number): number => Math.pow(ZOOM_BASE, clampZoom(level));
export const zoomPercent = (level: number): number => Math.round(zoomFactor(level) * 100);
export const zoomState = (level: number): ZoomState => { const l = clampZoom(level); return { level: l, factor: zoomFactor(l), percent: zoomPercent(l) }; };

/** Nível resultante de uma ação sobre o nível atual (já preso à faixa). */
export function applyZoomAction(current: number, a: ZoomAction): number {
  switch (a.action) {
    case "step": return clampZoom(clampZoom(current) + a.delta);
    case "set": return clampZoom(a.level);
    case "reset": return 0;
  }
}

/** Payload vindo do renderer: só as três ações, com os campos certos; qualquer outra coisa é null. */
export function parseZoomAction(v: unknown): ZoomAction | null {
  if (v === null || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (p["action"] === "reset") return { action: "reset" };
  if (p["action"] === "step" && (p["delta"] === 1 || p["delta"] === -1)) return { action: "step", delta: p["delta"] };
  if (p["action"] === "set" && typeof p["level"] === "number" && Number.isFinite(p["level"])) return { action: "set", level: p["level"] };
  return null;
}
