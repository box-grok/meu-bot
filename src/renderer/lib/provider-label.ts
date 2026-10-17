/**
 * Rótulo "quem respondeu" de uma bolha do assistente. Puro. Vazio sem provedor (respostas antigas, antes de o app
 * guardar isso); o nome quando é o modelo da conversa; "respondeu X (fallback de Y)" quando o backend caiu para
 * outro provedor (o aviso do backend vai no title da bolha).
 */
export function providerLabel(model: string, provider: string | undefined, fallback?: string): string {
  if (provider === undefined || provider === "") return "";
  if (provider === model) return provider;
  return `respondeu ${provider} (fallback de ${model})${fallback !== undefined && fallback !== "" ? " ⚠" : ""}`;
}
