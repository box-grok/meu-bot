/**
 * Texto do fim de uma pausa com prazo, para a lista, o menu e o cabeçalho da conversa (puro, testável).
 * "até 14:30" se é hoje; "até amanhã, 09:15"; senão "até 31/10, 14:30". Sem prazo ou inválido: "".
 */
export function pausaAteTexto(ate: string | null | undefined, agora: Date = new Date()): string {
  if (ate === null || ate === undefined) return "";
  const t = new Date(ate);
  if (Number.isNaN(t.getTime())) return "";
  const hora = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const dia = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (dia(t) === dia(agora)) return `até ${hora}`;
  const amanha = new Date(agora); amanha.setDate(amanha.getDate() + 1);
  if (dia(t) === dia(amanha)) return `até amanhã, ${hora}`;
  return `até ${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}, ${hora}`;
}
