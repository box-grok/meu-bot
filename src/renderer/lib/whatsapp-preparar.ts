/** Aba a reaproveitar para o pedido "preparar o WhatsApp": a de antes, se ainda está aberta; null = abrir uma nova. */
export function abaDoPedido(anterior: string | null, aberta: (id: string) => boolean): string | null {
  return anterior !== null && aberta(anterior) ? anterior : null;
}
