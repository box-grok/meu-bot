/** Ids das rotas customizadas no Gmail e validações puras (testadas). */
/**
 * Endereços das páginas do CRM no Gmail, no padrão #meu-bot-crm/… (como o #streak/home do Streak).
 * Início: lista de pipelines e "Novo pipeline" (o item "CRM" do menu abre aqui).
 */
export const ROTA_INICIO = "meu-bot-crm/home";
export const ROTA_PIPELINE = "meu-bot-crm/pipeline/:key";
export const ROTA_CAIXA = "meu-bot-crm/caixa/:key";
export const ROTA_CONTATOS = "meu-bot-crm/contatos";
export const ROTA_CONTATO = "meu-bot-crm/contato/:key";
export const ROTA_ORGS = "meu-bot-crm/organizacoes";
export const ROTA_ORG = "meu-bot-crm/organizacao/:key";
export const ROTA_MALAS = "meu-bot-crm/mala-direta";
/** Endereços antigos (#crm/…): continuam abrindo, redirecionando para os novos. */
export const ROTAS_ANTIGAS = { inicio: "crm/inicio", pipeline: "crm/pipeline/:key", caixa: "crm/caixa/:key" } as const;
export const keyValida = (k: unknown): k is string => typeof k === "string" && /^[A-Za-z0-9_-]{4,400}$/.test(k);
export const threadIdValido = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{10,20}$/i.test(id);
export const normThreadId = (id: string): string => id.trim().toLowerCase();
/** `#meu-bot-crm/pipeline/<key>` (ou o antigo `#crm/…`) → {tipo, key}; `#meu-bot-crm/home` → {tipo: "inicio"}. */
export function parseHash(hash: string): { tipo: "pipeline" | "caixa"; key: string } | { tipo: "inicio" } | null {
  const h = hash.trim().replace(/^#/, "");
  if (h === "meu-bot-crm/home" || h === "meu-bot-crm" || h === "crm/inicio") return { tipo: "inicio" };
  const m = /^(?:meu-bot-crm|crm)\/(pipeline|caixa)\/([A-Za-z0-9_-]{4,400})$/.exec(h);
  return m ? { tipo: m[1] as "pipeline" | "caixa", key: m[2] as string } : null;
}
