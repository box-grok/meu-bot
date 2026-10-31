/** Fallback entre provedores do agente (Claude, Grok): quem é a reserva de um primário e a frase que explica a corrente. Puro, com teste. */

export interface FallbackProvider { name: string; available: boolean }
/** Modelos que entram na corrente de fallback (os outros respondem sozinhos, sem reserva). */
export const FALLBACK_PRIMARIES: readonly string[] = ["agente", "grok-4"];
/** A reserva de um primário: quem mais está disponível na corrente, em ordem (vazio = sem reserva). */
export const fallbackReserve = (primary: string, chain: readonly FallbackProvider[]): string[] => chain.filter((p) => p.available && p.name !== primary).map((p) => p.name);
/** A linha "Primário: … Reserva: …" das Configurações e do tutorial 6, a partir do que o backend informa. */
export function fallbackOrderText(primary: string, chain: readonly FallbackProvider[] | null): string {
  if (chain === null || chain.length === 0) return "O backend desta máquina ainda não informa a corrente de provedores.";
  if (!chain.some((p) => p.name === primary)) return `${primary} fica fora da corrente: sem reserva. Com agente ou grok-4 como primário a reserva é automática.`;
  const reserve = fallbackReserve(primary, chain);
  return reserve.length === 0 ? `Primário: ${primary}. Sem reserva disponível nesta máquina.` : `Primário: ${primary}. Reserva: ${reserve.join(" → ")}, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.`;
}
