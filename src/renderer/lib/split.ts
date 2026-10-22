/**
 * Modo dividido (conversa à esquerda, páginas em colunas à direita, quantas a largura comportar). Regras puras, testadas: proporção
 * do divisor com mínimos, quando recolher por falta de largura, como entra uma coluna nova, a preferência lembrada por
 * máquina e o rótulo da ação.
 */
export const SPLIT_MIN_PX = 320;
export const SPLIT_COL_MIN_PX = 260;
export const SPLIT_COLLAPSE_PX = 760;
/** Teto absoluto de páginas ao lado (lembradas); quantas aparecem depende da largura (`maxColunas`). */
export const MAX_SPLIT = 8;
/** Quantas colunas de página cabem ao lado da conversa nesta largura (no mínimo 1). */
export const maxColunas = (width: number): number =>
  Math.min(MAX_SPLIT, Math.max(1, Math.floor(((Number.isFinite(width) ? width : 0) - SPLIT_MIN_PX - 6) / (SPLIT_COL_MIN_PX + 1))));

/** Largura mínima da direita com `n` colunas. */
export const minDireita = (n: number): number => Math.max(SPLIT_MIN_PX, Math.max(1, n) * SPLIT_COL_MIN_PX);

/** Proporção (0..1) da esquerda que respeita os mínimos dos dois lados; null quando eles não cabem. */
export function clampSplitRatio(ratio: number, totalWidth: number, min = SPLIT_MIN_PX, minRight = min): number | null {
  if (!Number.isFinite(totalWidth) || totalWidth < min + minRight) return null;
  const lo = min / totalWidth, hi = 1 - minRight / totalWidth;
  const r = Number.isFinite(ratio) ? ratio : 0.55;
  return Math.min(hi, Math.max(lo, r));
}
export const splitLayout = (width: number): "split" | "collapsed" => (width < SPLIT_COLLAPSE_PX ? "collapsed" : "split");

/** Coluna nova: já aberta fica onde está; com espaço entra no fim; cheia, substitui a última. */
export function splitAdd(ids: readonly string[], id: string, max = MAX_SPLIT): string[] {
  if (ids.includes(id)) return [...ids];
  return ids.length < max ? [...ids, id] : [...ids.slice(0, max - 1), id];
}

export interface SplitPref { pageIds: string[]; ratio: number }
const PAGE_ID = /^(navegador|acervo|tutoriais|atividade|term-\d+|tut-[a-z0-9-]+|wa-\d+)$/;
/** A preferência gravada (`split:<host>`): só ids de página conhecidos, sem repetir, até MAX_SPLIT; aceita o formato antigo `{pageId}`. */
export function parseSplitPref(json: string | null): SplitPref | null {
  if (json === null || json === "") return null;
  try {
    const o = JSON.parse(json) as { pageId?: unknown; pageIds?: unknown; ratio?: unknown };
    const brutos = Array.isArray(o.pageIds) ? o.pageIds : [o.pageId];
    const pageIds = [...new Set(brutos.filter((x): x is string => typeof x === "string" && PAGE_ID.test(x)))].slice(0, MAX_SPLIT);
    if (pageIds.length === 0) return null;
    const ratio = typeof o.ratio === "number" && o.ratio >= 0.2 && o.ratio <= 0.8 ? o.ratio : 0.55;
    return { pageIds, ratio };
  } catch { return null; }
}
/** Terminais são novos a cada abertura: a preferência guarda "um terminal" por coluna (term-1, term-2…), não o número. */
export function splitPrefPageIds(pageIds: readonly string[]): string[] {
  let t = 0;
  return pageIds.map((id) => (id.startsWith("term-") ? `term-${++t}` : id));
}

export const splitLabel = (splitTitle: string | null, pageTitle: string | null): string =>
  splitTitle !== null ? "Sair do modo dividido" : pageTitle !== null ? `Dividir a tela com ${pageTitle}` : "Dividir a tela (abre uma página ao lado da conversa)";
