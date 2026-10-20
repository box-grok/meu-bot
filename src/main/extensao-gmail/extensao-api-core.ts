/**
 * Variante: produtos com extensão do Gmail (crm). Parte pura do proxy local da API do CRM: autorização por
 * token, origem permitida (só a extensão embutida e o Gmail), caminho sob /v1/crm/, cabeçalhos CORS e o
 * config.json que a extensão lê. Testado sem rede.
 */
import { timingSafeEqual } from "node:crypto";

export const PREFIXO = "/v1/crm";
/** Só caminhos sob /v1/crm/ (ou /v1/crm), sem "..", sem "//" e sem espaços; devolve o caminho normalizado ou null. */
export function rotaCrm(url: string | undefined): string | null {
  if (typeof url !== "string" || url.length > 2000 || /\s/.test(url) || url.includes("..") || url.includes("//")) return null;
  if (url !== PREFIXO && !url.startsWith(`${PREFIXO}/`) && !url.startsWith(`${PREFIXO}?`)) return null;
  return url;
}
/** `Authorization: Bearer <token>` em tempo constante. */
export function autorizado(header: string | string[] | undefined, token: string): boolean {
  const h = Array.isArray(header) ? header[0] ?? "" : header ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (t.length === 0 || t.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(t), Buffer.from(token));
}
/** O caminho está sob o prefixo (o próprio, `<prefixo>/…` ou `<prefixo>?…`)? */
export const sobPrefixo = (rota: string, prefixo: string): boolean => rota === prefixo || rota.startsWith(`${prefixo}/`) || rota.startsWith(`${prefixo}?`);
/**
 * Origem aceita: ausente (fetch do service worker sem Origin), o Gmail, ou uma extensão embutida dentro das rotas
 * dela (`extensoes`: id → prefixo; o Autenticador só alcança /v1/crm/autenticador).
 */
export function origemOk(origin: string | string[] | undefined, extensoes: ReadonlyMap<string, string>, rota: string): boolean {
  const o = Array.isArray(origin) ? origin[0] ?? "" : origin ?? "";
  if (o === "" || o === "null") return true;
  if (o === "https://mail.google.com") return true;
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(o);
  const prefixo = m === null ? undefined : extensoes.get(m[1]!);
  return prefixo !== undefined && sobPrefixo(rota, prefixo);
}
/** `Host` precisa ser o loopback com a nossa porta (anti DNS rebinding). */
export function hostOk(host: string | string[] | undefined, porta: number): boolean {
  const h = Array.isArray(host) ? host[0] ?? "" : host ?? "";
  return h === `127.0.0.1:${porta}` || h === `localhost:${porta}`;
}
export function corsHeaders(origin: string | string[] | undefined): Record<string, string> {
  const o = Array.isArray(origin) ? origin[0] ?? "" : origin ?? "";
  return {
    "Access-Control-Allow-Origin": o === "" || o === "null" ? "*" : o,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, accept, x-crm-por",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
/** O config.json que a extensão lê no service worker. */
export const configJson = (i: { porta: number; token: string; host: string; app: string }): string => `${JSON.stringify({ porta: i.porta, token: i.token, host: i.host, app: i.app })}\n`;
