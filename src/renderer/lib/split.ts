/**
 * Modo dividido (conversa à esquerda, uma página à direita). Regras puras, testadas: proporção do divisor com
 * mínimos, quando recolher por falta de largura, a preferência lembrada por máquina e o rótulo da ação.
 */
export const SPLIT_MIN_PX = 320;
export const SPLIT_COLLAPSE_PX = 760;

/** Proporção (0..1) da esquerda que respeita os dois mínimos; null quando nem os dois mínimos cabem. */
export function clampSplitRatio(ratio: number, totalWidth: number, min = SPLIT_MIN_PX): number | null {
  if (!Number.isFinite(totalWidth) || totalWidth < 2 * min) return null;
  const lo = min / totalWidth, hi = 1 - min / totalWidth;
  const r = Number.isFinite(ratio) ? ratio : 0.55;
  return Math.min(hi, Math.max(lo, r));
}
export const splitLayout = (width: number): "split" | "collapsed" => (width < SPLIT_COLLAPSE_PX ? "collapsed" : "split");

export interface SplitPref { pageId: string; ratio: number }
const PAGE_ID = /^(navegador|acervo|tutoriais|atividade|term-\d+|tut-[a-z0-9-]+|wa-\d+)$/;
/** A preferência gravada (`split:<host>`): só ids de página conhecidos e proporção plausível. */
export function parseSplitPref(json: string | null): SplitPref | null {
  if (json === null || json === "") return null;
  try {
    const o = JSON.parse(json) as { pageId?: unknown; ratio?: unknown };
    if (typeof o.pageId !== "string" || !PAGE_ID.test(o.pageId)) return null;
    const ratio = typeof o.ratio === "number" && o.ratio >= 0.2 && o.ratio <= 0.8 ? o.ratio : 0.55;
    return { pageId: o.pageId, ratio };
  } catch { return null; }
}
/** Terminais são novos a cada abertura: a preferência guarda só "um terminal", não o número. */
export const splitPrefPageId = (pageId: string): string => (pageId.startsWith("term-") ? "term-1" : pageId);

export const splitLabel = (splitTitle: string | null, pageTitle: string | null): string =>
  splitTitle !== null ? "Sair do modo dividido" : pageTitle !== null ? `Dividir a tela com ${pageTitle}` : "Dividir a tela (abre uma página ao lado da conversa)";
