/**
 * Comum ao OAuth do Google no app (Contatos do CRM em google.ts e a Conta Google geral em conta-google.ts): o
 * client "Desktop app" (google-oauth.json), gravação atômica cifrada, troca de formulário no endpoint de token e
 * o access token a partir do refresh. Sem estado: cada chamador guarda o seu token.
 */
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { URL_TOKEN, parseClienteOAuth, type ClienteOAuth } from "./google-core";
import { PASTA_BAIXADOS } from "./cliente-release-core";

/**
 * O client OAuth do app: userData/google-oauth.json, Resources/google-oauth.json (o JSON do Google Cloud) ou, por
 * último, o que o app baixou da release (userData/google-cliente-baixado/, cliente-release.ts) quando o build veio sem.
 */
export function cliente(): ClienteOAuth | null {
  for (const f of [path.join(app.getPath("userData"), "google-oauth.json"), path.join(process.resourcesPath ?? "", "google-oauth.json"), path.join(app.getPath("userData"), PASTA_BAIXADOS, "google-oauth.json")]) {
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
  return clienteContaOrigem()?.cliente ?? null;
}

/**
 * O mesmo client, com a procedência: de qual arquivo veio e de qual projeto do Google Cloud.
 *
 * Existe porque a procedência já custou caro: um `google-conta-oauth.json` velho, de um projeto em
 * modo Teste, continuava empacotado no app e vencia o client bom em silêncio. O Google só respondia
 * `access_denied` no navegador, longe daqui. Um arquivo largado em userData é pior ainda: ele
 * sobrevive a toda atualização e venceria para sempre. Mostrar isso na tela transforma uma caçada
 * em dois segundos de leitura.
 */
export function clienteContaOrigem(): { cliente: ClienteOAuth; origem: "pasta de dados" | "pacote do app" | "release" | "client do app"; projeto: string } | null {
  const projetoDe = (c: ClienteOAuth): string => c.clientId.split("-")[0] ?? "?";
  // O baixado da release fica atrás do manual e do pacote: um build que passe a trazer o arquivo vence o baixado.
  const tentativas: { f: string; origem: "pasta de dados" | "pacote do app" | "release" }[] = [
    { f: path.join(app.getPath("userData"), "google-conta-oauth.json"), origem: "pasta de dados" },
    { f: path.join(process.resourcesPath ?? "", "google-conta-oauth.json"), origem: "pacote do app" },
    { f: path.join(app.getPath("userData"), PASTA_BAIXADOS, "google-conta-oauth.json"), origem: "release" },
  ];
  for (const { f, origem } of tentativas) {
    try { const c = parseClienteOAuth(JSON.parse(fs.readFileSync(f, "utf8"))); if (c) return { cliente: c, origem, projeto: projetoDe(c) }; } catch { /* próximo */ }
  }
  const c = cliente();
  return c === null ? null : { cliente: c, origem: "client do app", projeto: projetoDe(c) };
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
