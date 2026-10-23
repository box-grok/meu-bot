/**
 * Comum ao OAuth do Google no app (Contatos do CRM em google.ts e a Conta Google geral em conta-google.ts): o
 * client "Desktop app" (google-oauth.json), gravação atômica cifrada, troca de formulário no endpoint de token e
 * o access token a partir do refresh. Sem estado: cada chamador guarda o seu token.
 */
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { URL_TOKEN, parseClienteOAuth, type ClienteOAuth } from "./google-core";

/** O client OAuth do app: userData/google-oauth.json ou Resources/google-oauth.json (o JSON do Google Cloud). */
export function cliente(): ClienteOAuth | null {
  for (const f of [path.join(app.getPath("userData"), "google-oauth.json"), path.join(process.resourcesPath ?? "", "google-oauth.json")]) {
    try { const c = parseClienteOAuth(JSON.parse(fs.readFileSync(f, "utf8"))); if (c) return c; } catch { /* próximo */ }
  }
  return null;
}

/**
 * O client OAuth da "Conta Google" geral. Prefere userData/Resources google-conta-oauth.json (projeto próprio,
 * separado do CRM); se não houver, cai no client do app (cliente()). Assim login/Gmail/Agenda/Sheets podem morar
 * num projeto do Google Cloud diferente do meu-bot-crm sem invalidar o token de Contatos do CRM.
 */
export function clienteConta(): ClienteOAuth | null {
  for (const f of [path.join(app.getPath("userData"), "google-conta-oauth.json"), path.join(process.resourcesPath ?? "", "google-conta-oauth.json")]) {
    try { const c = parseClienteOAuth(JSON.parse(fs.readFileSync(f, "utf8"))); if (c) return c; } catch { /* próximo */ }
  }
  return cliente();
}

/** Gravação atômica 0600 (tmp + rename). */
export function gravar(f: string, dados: Buffer | string): void { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, dados, { mode: 0o600 }); fs.renameSync(tmp, f); }

/** POST application/x-www-form-urlencoded; devolve o JSON, lança com a mensagem do Google em erro. */
export async function postForm(url: string, corpo: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(corpo).toString() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof j["error_description"] === "string" ? j["error_description"] : typeof j["error"] === "string" ? j["error"] : `Google respondeu ${r.status}`);
  return j;
}

/** access token a partir do refresh token (grant_type=refresh_token). */
export async function acessoDeRefresh(c: ClienteOAuth, refresh: string): Promise<string> {
  const tok = await postForm(URL_TOKEN, { refresh_token: refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" });
  const a = tok["access_token"];
  if (typeof a !== "string" || a === "") throw new Error("o Google não devolveu o acesso (refresh inválido)");
  return a;
}

export const temKeychain = (): boolean => safeStorage.isEncryptionAvailable();
