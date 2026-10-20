/** Filtro e ordem de planilha para as grades (Contatos…): puro, testado. Cada coluna dá os valores de uma linha. */
export type Filtro = { tipo: "preenchido" } | { tipo: "vazio" } | { tipo: "valor"; valor: string };
export interface Vista { ordem: { col: string; dir: "asc" | "desc" } | null; filtros: Record<string, Filtro> }
export const VISTA_VAZIA: Vista = { ordem: null, filtros: {} };

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Linhas que passam em todos os filtros, na ordem pedida (vazios sempre por último; empate mantém a ordem original). */
export function aplicarVista<T>(linhas: T[], valores: (linha: T, col: string) => string[], v: Vista): T[] {
  const passa = (l: T): boolean => Object.entries(v.filtros).every(([col, f]) => {
    const vs = valores(l, col).filter((x) => x.trim() !== "");
    return f.tipo === "preenchido" ? vs.length > 0 : f.tipo === "vazio" ? vs.length === 0 : vs.some((x) => norm(x) === norm(f.valor));
  });
  const out = linhas.filter(passa);
  if (v.ordem === null) return out;
  const { col, dir } = v.ordem; const sinal = dir === "asc" ? 1 : -1;
  const chave = (l: T): string => valores(l, col).filter((x) => x.trim() !== "").join(", ");
  return out.map((l, i) => ({ l, i, k: chave(l) })).sort((a, b) => {
    if (a.k === "" && b.k !== "") return 1; if (b.k === "" && a.k !== "") return -1;
    const c = a.k.localeCompare(b.k, "pt-BR", { sensitivity: "base", numeric: true });
    return c !== 0 ? sinal * c : a.i - b.i;
  }).map((x) => x.l);
}
/** Valores distintos de uma coluna (para o menu do cabeçalho), em ordem alfabética, com a contagem. */
export function valoresDaColuna<T>(linhas: T[], valores: (linha: T, col: string) => string[], col: string, max = 20): { valor: string; n: number }[] {
  const m = new Map<string, { valor: string; n: number }>();
  for (const l of linhas) for (const x of new Set(valores(l, col).map((y) => y.trim()).filter(Boolean))) { const k = norm(x); const cur = m.get(k); if (cur) cur.n++; else m.set(k, { valor: x, n: 1 }); }
  return [...m.values()].sort((a, b) => a.valor.localeCompare(b.valor, "pt-BR", { sensitivity: "base" })).slice(0, max);
}
export const textoFiltro = (f: Filtro): string => (f.tipo === "preenchido" ? "preenchido" : f.tipo === "vazio" ? "vazio" : `= ${f.valor}`);
/** Lê a vista guardada (localStorage), tolerante a lixo. */
export function parseVista(raw: string | null): Vista {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Vista> | null;
    const ordem = v?.ordem && typeof v.ordem.col === "string" && (v.ordem.dir === "asc" || v.ordem.dir === "desc") ? { col: v.ordem.col, dir: v.ordem.dir } : null;
    const filtros: Record<string, Filtro> = {};
    for (const [c, f] of Object.entries(v?.filtros ?? {})) if (f && (f.tipo === "preenchido" || f.tipo === "vazio" || (f.tipo === "valor" && typeof (f as { valor?: unknown }).valor === "string"))) filtros[c] = f as Filtro;
    return { ordem, filtros };
  } catch { return { ordem: null, filtros: {} }; }
}
