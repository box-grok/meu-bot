/** Ranqueamento da paleta de comandos: escada de qualidade como no Hermes Desktop. Puro e testável. */

export type PaletteKind = "action" | "conversation" | "setting";

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  detail?: string;
  keywords?: string[];
  /** Maior = mais recente; desempata. */
  recency?: number;
}

const KIND_ORDER: Record<PaletteKind, number> = { action: 0, conversation: 1, setting: 2 };

const normalize = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function subsequence(label: string, term: string): number {
  let i = 0;
  let runs = 0;
  let prev = -2;
  for (let j = 0; j < label.length && i < term.length; j++) {
    if (label[j] === term[i]) {
      if (j === prev + 1) runs++;
      prev = j;
      i++;
    }
  }
  return i === term.length ? Math.min(0.05 * runs, 0.09) : -1;
}

/** 0 = não bate. Senão, 0.4 a 1.0. */
export function scoreItem(item: PaletteItem, query: string): number {
  const q = normalize(query).trim();
  if (q === "") return 0.5;
  const label = normalize(item.label);
  const keywords = normalize((item.keywords ?? []).join(" "));
  const terms = q.split(/\s+/);
  if (label === q) return 1;
  if (label.startsWith(q)) return 0.9;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 0.8;
  if (label.includes(q)) return 0.7;
  if (terms.length > 1 && terms.every((t) => label.includes(t))) return 0.6;
  const sub = terms.length === 1 ? subsequence(label, q) : -1;
  if (sub >= 0 && q.length >= 3) return 0.5 + sub;
  if (terms.every((t) => keywords.includes(t) || label.includes(t))) return 0.4;
  return 0;
}

export function rankPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  const scored = items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) =>
      b.score - a.score
      || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind]
      || (b.item.recency ?? 0) - (a.item.recency ?? 0)
      || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((x) => x.item);
}
