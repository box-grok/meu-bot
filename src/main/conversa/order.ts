/** Ordem das abas por máquina. Puro: testável com node --test. */

export interface Orderable { id: string; host: string; order: number }

/** Próxima posição livre entre as ordens dadas (0 quando não há nenhuma). */
export const nextOrderAmong = (orders: readonly number[]): number => (orders.length === 0 ? 0 : Math.max(...orders) + 1);

/**
 * Nova ordem para as conversas de `host`: primeiro as ids recebidas (na ordem dada, só as que
 * existem nesse host, sem repetir), depois as demais do host na ordem antiga. Outras máquinas
 * não aparecem no resultado e ficam intactas.
 */
export function reorderWithin(items: readonly Orderable[], ids: readonly string[], host: string): Map<string, number> {
  const mine = new Map(items.filter((it) => it.host === host).map((it) => [it.id, it] as const));
  const out = new Map<string, number>();
  let i = 0;
  for (const id of ids) {
    if (!mine.has(id) || out.has(id)) continue;
    out.set(id, i++);
  }
  for (const it of [...mine.values()].sort((a, b) => a.order - b.order)) {
    if (!out.has(it.id)) out.set(it.id, i++);
  }
  return out;
}
