/**
 * Variante: crm. Google Contatos → CRM, parte pura (testada sem rede): o client OAuth do app, PKCE, o endereço de
 * autorização (retorno no loopback, como o Google pede para apps de desktop), a troca de código e a conversão das
 * pessoas da API People para o formato do POST /v1/crm/contacts/import.
 */
import { createHash, randomBytes } from "node:crypto";

/**
 * Contatos com escrita (decisão do dono, 2026-10-20: todo contato novo do WhatsApp vai para o Google Contatos);
 * nada além disso. O e-mail da conta vem da própria API People, se ela der.
 */
export const ESCOPO_ESCRITA = "https://www.googleapis.com/auth/contacts";
export const ESCOPOS = [ESCOPO_ESCRITA] as const;
/** A autorização guardada permite criar contatos? (a antiga, só leitura, pede "Reconectar"). */
export const temEscrita = (escopo: unknown): boolean => typeof escopo === "string" && escopo.split(/\s+/).includes(ESCOPO_ESCRITA);
export const URL_AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth";
export const URL_TOKEN = "https://oauth2.googleapis.com/token";
export const CAMPOS_PESSOA = "names,emailAddresses,phoneNumbers,organizations,urls,biographies,metadata";

export interface ClienteOAuth { clientId: string; clientSecret: string }
/** O JSON que o Google Cloud baixa ("installed": {client_id, client_secret}) ou o formato simples. null se inválido. */
export function parseClienteOAuth(v: unknown): ClienteOAuth | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base = (typeof o["installed"] === "object" && o["installed"] !== null ? o["installed"] : o) as Record<string, unknown>;
  const id = base["client_id"] ?? base["clientId"]; const sec = base["client_secret"] ?? base["clientSecret"];
  if (typeof id !== "string" || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) || typeof sec !== "string" || sec.length < 8) return null;
  return { clientId: id, clientSecret: sec };
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export function urlDeAutorizacao(o: { clientId: string; redirect: string; challenge: string; state: string }): string {
  const p = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirect, response_type: "code", scope: ESCOPOS.join(" "), code_challenge: o.challenge, code_challenge_method: "S256", state: o.state, access_type: "offline", prompt: "consent" });
  return `${URL_AUTORIZACAO}?${p.toString()}`;
}
/** E-mail principal do `people/me` (pode não vir só com contacts.readonly: aí a página mostra só "conectado"). */
export function emailDePessoaEu(p: unknown): string | null {
  const es = p !== null && typeof p === "object" ? (p as { emailAddresses?: { value?: unknown; metadata?: { primary?: unknown } }[] }).emailAddresses : undefined;
  if (!Array.isArray(es)) return null;
  const e = es.find((x) => x.metadata?.primary === true) ?? es[0];
  return typeof e?.value === "string" ? e.value : null;
}

export interface ContatoGoogle { nome: string; emails: string[]; telefones: string[]; cargo: string; empresa: string; notas: string; instagram: string; linkedin: string; googleId: string }
interface Valor { value?: unknown; canonicalForm?: unknown; displayName?: unknown; name?: unknown; title?: unknown; metadata?: { primary?: unknown } }
const lista = (v: unknown): Valor[] => (Array.isArray(v) ? (v as Valor[]) : []);
const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const primeiroPrincipal = (vs: Valor[]): Valor | undefined => vs.find((x) => x.metadata?.primary === true) ?? vs[0];
/** instagram.com/fulano, @fulano… → "fulano"; linkedin.com/in/fulano → a URL. */
function redes(urls: Valor[]): { instagram: string; linkedin: string } {
  let instagram = ""; let linkedin = "";
  for (const u of urls) {
    const v = txt(u.value);
    const ig = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(v); if (ig && instagram === "") instagram = ig[1] as string;
    if (/linkedin\.com\//i.test(v) && linkedin === "") linkedin = v;
  }
  return { instagram, linkedin };
}
/** Uma pessoa da API People → contato para importar; null se não tem nome, e-mail nem telefone. */
export function pessoaParaContato(p: unknown): ContatoGoogle | null {
  if (p === null || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const googleId = txt(o["resourceName"]); if (!/^people\/[A-Za-z0-9_-]{1,80}$/.test(googleId)) return null;
  const nome = txt(primeiroPrincipal(lista(o["names"]))?.displayName);
  const emails = [...new Set(lista(o["emailAddresses"]).map((e) => txt(e.value).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  const telefones = [...new Set(lista(o["phoneNumbers"]).map((t) => txt(t.canonicalForm) || txt(t.value)).filter((t) => t.replace(/\D/g, "").length >= 8))];
  if (nome === "" && emails.length === 0 && telefones.length === 0) return null;
  const org = primeiroPrincipal(lista(o["organizations"]));
  return { nome, emails, telefones, cargo: txt(org?.title), empresa: txt(org?.name), notas: txt(primeiroPrincipal(lista(o["biographies"]))?.value).slice(0, 2000), ...redes(lista(o["urls"])), googleId };
}

// ---- WhatsApp → Google Contatos ---------------------------------------------------------------------------------
export interface ContatoWhatsapp { telefone: string; nome: string }
/** Os 10 últimos dígitos: o mesmo número com ou sem +55/DDI casa (o Google guarda do jeito que foi digitado). */
export const chaveTelefone = (t: string): string => t.replace(/\D/g, "").slice(-10);
/** Números do WhatsApp que o Google ainda não tem (nem foram criados por nós antes), sem repetir. */
export function faltantesNoGoogle(wa: ContatoWhatsapp[], telefonesGoogle: string[], jaCriados: string[]): ContatoWhatsapp[] {
  const tem = new Set([...telefonesGoogle, ...jaCriados].map(chaveTelefone).filter((k) => k.length >= 8));
  const out: ContatoWhatsapp[] = [];
  for (const c of wa) { const k = chaveTelefone(c.telefone); if (k.length < 8 || tem.has(k)) continue; tem.add(k); out.push(c); }
  return out;
}
/** Pessoa para o people:batchCreateContacts: nome do WhatsApp (ou "WhatsApp +N"), celular e o marcador. */
export function pessoaDoWhatsapp(c: ContatoWhatsapp, grupo: string | null): Record<string, unknown> {
  return {
    names: [{ givenName: c.nome.trim() !== "" ? c.nome.trim() : `WhatsApp ${c.telefone}` }],
    phoneNumbers: [{ value: c.telefone, type: "mobile" }],
    ...(grupo ? { memberships: [{ contactGroupMembership: { contactGroupResourceName: grupo } }] } : {}),
  };
}
