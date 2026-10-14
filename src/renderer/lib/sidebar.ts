/** Funções puras da lista lateral: busca sem acento e agrupamento por data (ideia do Hermes Desktop). */

export interface SidebarConversation {
  id: string;
  title?: string;
  updatedAt: string;
  archived: boolean;
  text: string;
}

export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Todos os termos da busca precisam aparecer (título ou texto), sem acento e sem caixa. */
export function matches(conv: SidebarConversation, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter((t) => t !== "");
  if (terms.length === 0) return true;
  const hay = normalize(`${conv.title ?? ""}\n${conv.text}`);
  return terms.every((t) => hay.includes(t));
}

export interface DateGroup<T> {
  label: "Recentes" | "Hoje" | "Ontem" | "Esta semana" | "Mais antigas";
  items: T[];
}

const MIN_BREAK_MS = 30 * 60 * 1000;
const MAX_GAP_MS = 8 * 60 * 60 * 1000;
const TARGET_HEAD = 5;

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function bucket(ts: number, now: Date): DateGroup<never>["label"] {
  const today = startOfDay(now);
  if (ts >= today) return "Hoje";
  if (ts >= today - 86_400_000) return "Ontem";
  if (ts >= today - 6 * 86_400_000) return "Esta semana";
  return "Mais antigas";
}

/**
 * Agrupa por data, mais recentes primeiro. A cabeça "Recentes" é a sequência mais nova cortada no
 * intervalo ≥ 30 min cuja posição fica mais perto de 5 itens, nunca atravessando um intervalo > 8 h.
 */
export function groupByDate<T extends { updatedAt: string }>(convs: T[], now: Date = new Date()): DateGroup<T>[] {
  const sorted = [...convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const ts = sorted.map((c) => new Date(c.updatedAt).getTime());
  let headLen = 0;
  if (sorted.length >= 2) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (ts[i - 1] ?? 0) - (ts[i] ?? 0);
      if (gap > MAX_GAP_MS) { if (best === -1) best = i; break; }
      if (gap >= MIN_BREAK_MS) {
        const score = Math.abs(Math.log(i / TARGET_HEAD));
        if (score < bestScore) { bestScore = score; best = i; }
      }
    }
    headLen = best === -1 ? 0 : best;
  }
  const groups: DateGroup<T>[] = [];
  const push = (label: DateGroup<T>["label"], item: T): void => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  };
  const headItems = sorted.slice(0, headLen);
  if (headItems.length > 0) groups.push({ label: "Recentes", items: headItems });
  for (const item of sorted.slice(headLen)) push(bucket(new Date(item.updatedAt).getTime(), now), item);
  return groups;
}

/** Data curta para a linha da lista. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (startOfDay(d) === startOfDay(now)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
