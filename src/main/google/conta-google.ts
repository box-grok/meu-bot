/**
 * Conta Google geral do Mac (login + Gmail + Agenda + Sheets + Drive), separada do token de Contatos do CRM
 * (google-contatos.bin): mesmo fluxo oficial de app de desktop (loopback 127.0.0.1 + PKCE + authorization code), o
 * refresh token cifrado com safeStorage (Keychain) em userData/google-conta.bin e nunca sai do Mac. A verificação de
 * telefone/QR, quando o Google pede, é feita pela pessoa na tela oficial; o app só recebe o token.
 */
import { app, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { safeStorage } from "electron";
import { log } from "../tunnel";
import { browserAsk, browserWebContents, reservarRetornoLocal } from "../browser";
import { ESCOPOS_CONTA, URL_TOKEN, parseIdToken, temTodosEscopos, urlDeAutorizacao, type PerfilGoogle } from "./google-core";
import { acessoDeRefresh, clienteConta, clienteContaOrigem, gravar, postForm, temKeychain } from "./comum";

export interface GoogleContaStatus { configurado: boolean; conectado: boolean; conectando: boolean; precisaReconectar: boolean; perfil: PerfilGoogle | null; escopos: string[]; cliente: { projeto: string; origem: string } | null }
const ARQ = (): string => path.join(app.getPath("userData"), "google-conta.bin");
interface Guardado { refresh: string; perfil: PerfilGoogle | null; escopo: string }
function lerToken(): Guardado | null {
  try {
    const j = JSON.parse(safeStorage.decryptString(fs.readFileSync(ARQ()))) as Partial<Guardado>;
    if (typeof j.refresh !== "string") return null;
    const p = (j.perfil ?? null) as PerfilGoogle | null;
    // Tokens gravados antes do cache da foto nao tem `fotoLocal`: aqui ela vira null explicito, nao undefined.
    const perfil = p === null ? null : { ...p, fotoLocal: typeof p.fotoLocal === "string" ? p.fotoLocal : null };
    return { refresh: j.refresh, perfil, escopo: typeof j.escopo === "string" ? j.escopo : "" };
  } catch { return null; }
}
const conectando = new Set<string>();
/** Teto da foto de perfil guardada em data URL; um avatar do Google fica muito abaixo disso. */
const FOTO_MAX = 512 * 1024;
const TIPO_FOTO = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Baixa a foto de perfil aqui no main e devolve data URL. A tela roda com `img-src 'self' data:`, entao a URL do
 * googleusercontent seria bloqueada; baixando aqui a imagem aparece e o renderer continua sem falar com o Google.
 * Falha vira null: o perfil sem foto e um estado normal, nao um erro de login.
 */
async function baixarFoto(url: string): Promise<string | null> {
  try {
    if (new URL(url).protocol !== "https:") return null;
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return null;
    const tipo = (r.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!TIPO_FOTO.test(tipo)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > FOTO_MAX) return null;
    return `data:${tipo};base64,${bytes.toString("base64")}`;
  } catch { return null; }
}
const comFoto = async (p: PerfilGoogle | null): Promise<PerfilGoogle | null> =>
  p === null || p.foto === null ? p : { ...p, fotoLocal: await baixarFoto(p.foto) };

/** Uma tentativa por (conta, URL) enquanto o app vive: sem foto a tela so fica sem avatar, nao vale repetir em loop. */
const fotoTentada = new Set<string>();
/**
 * Completa a foto de quem ja estava conectado antes deste cache (ou quando o download falhou no login). Devolve o
 * status novo so quando realmente gravou, para o chamador avisar as telas; null quando nao havia o que fazer.
 */
export async function garantirFotoPerfil(): Promise<GoogleContaStatus | null> {
  const t = lerToken();
  if (t === null || t.perfil === null || t.perfil.foto === null || t.perfil.fotoLocal !== null) return null;
  const chave = `${t.perfil.sub} ${t.perfil.foto}`;
  if (fotoTentada.has(chave)) return null;
  fotoTentada.add(chave);
  const fotoLocal = await baixarFoto(t.perfil.foto);
  if (fotoLocal === null) return null;
  const atual = lerToken();
  // Desconectou ou reconectou durante o download: o token de agora manda, nao reescreve por cima.
  if (atual === null || atual.perfil === null || atual.refresh !== t.refresh || atual.perfil.fotoLocal !== null) return null;
  gravar(ARQ(), safeStorage.encryptString(JSON.stringify({ ...atual, perfil: { ...atual.perfil, fotoLocal } })));
  return contaStatus();
}
/** Access token em cache (expira antes da hora real, com folga), para não trocar o refresh a cada chamada. */
let cache: { acesso: string; expira: number } | null = null;

export function contaStatus(): GoogleContaStatus {
  const t = lerToken();
  const c = clienteContaOrigem();
  return { configurado: c !== null, conectado: t !== null, conectando: conectando.size > 0, precisaReconectar: t !== null && !temTodosEscopos(t.escopo, ESCOPOS_CONTA), perfil: t?.perfil ?? null, escopos: t ? t.escopo.split(/\s+/).filter(Boolean) : [], cliente: c === null ? null : { projeto: c.projeto, origem: c.origem } };
}

export async function contaConectar(host: string): Promise<GoogleContaStatus> {
  const c = clienteConta(); if (c === null) throw new Error("o app ainda não tem o client OAuth do Google (google-oauth.json)");
  if (!temKeychain()) throw new Error("este Mac não tem o Keychain disponível para guardar a autorização");
  if (conectando.size === 0) {
    conectando.add(host);
    void fluxo(host, c).catch((e: unknown) => log(`[google conta] login não concluído: ${e instanceof Error ? e.message : String(e)}`)).finally(() => conectando.delete(host));
  }
  return contaStatus();
}
async function fluxo(host: string, c: { clientId: string; clientSecret: string }): Promise<void> {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = (await import("node:crypto")).createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const codigo = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/oauth") { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>meu-bot</title><body style="font:16px system-ui;padding:40px">${ok ? "✅ Conta Google conectada. Pode fechar esta aba e voltar ao meu-bot." : "❌ Não foi possível conectar. Volte ao meu-bot e tente de novo."}</body>`);
      clearTimeout(timer); srv.close();
      // `access_denied` não é só "a pessoa recusou": o Google manda o mesmo quando o projeto está em
      // modo Teste e o e-mail não é testador. Dizer só "você não autorizou" manda procurar no lugar errado.
      if (ok) resolve({ code: u.searchParams.get("code") as string, redirect });
      else reject(new Error(u.searchParams.get("error") === "access_denied" ? "o Google recusou: ou você não autorizou, ou este e-mail não tem acesso ao projeto do Google Cloud (app em modo Teste só aceita testadores aprovados)" : "retorno inválido do Google"));
    });
    let redirect = "";
    const timer = setTimeout(() => { srv.close(); reject(new Error("o login do Google não foi concluído em 5 minutos")); }, 5 * 60_000);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address(); const port = typeof a === "object" && a !== null ? a.port : 0;
      srv.on("close", reservarRetornoLocal(port)); // o retorno deste loopback é local (Mac), não entrega por SSH
      redirect = `http://127.0.0.1:${port}/oauth`;
      const url = urlDeAutorizacao({ clientId: c.clientId, redirect, challenge, state, scope: ESCOPOS_CONTA.join(" ") });
      const navAberto = browserWebContents(host).some((w) => { try { return w.getURL().startsWith("http"); } catch { return false; } });
      if (!navAberto || !browserAsk(host, { kind: "new-tab", url })) void shell.openExternal(url);
    });
  });
  const tok = await postForm(URL_TOKEN, { code: codigo.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: codigo.redirect, grant_type: "authorization_code", code_verifier: verifier });
  if (typeof tok["refresh_token"] !== "string") throw new Error("o Google não devolveu a autorização permanente; tente conectar de novo");
  const perfil = await comFoto(parseIdToken(tok["id_token"]));
  gravar(ARQ(), safeStorage.encryptString(JSON.stringify({ refresh: tok["refresh_token"], perfil, escopo: typeof tok["scope"] === "string" ? tok["scope"] : "" })));
  cache = null;
  log(`[google conta] conectada (${perfil?.email ?? "conta sem e-mail"})`);
}

export async function contaDesconectar(): Promise<GoogleContaStatus> {
  const t = lerToken();
  if (t) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh)}`, { method: "POST" }); } catch { /* cortesia */ } }
  try { fs.rmSync(ARQ(), { force: true }); } catch { /* ok */ }
  cache = null; log("[google conta] desconectada");
  return contaStatus();
}

/** access token válido para as APIs; renova pelo refresh quando o cache venceu. Em invalid_grant, apaga o token. */
export async function acessoValido(): Promise<string> {
  const t = lerToken(); const c = clienteConta();
  if (t === null || c === null) throw new Error("GOOGLE_CONTA_DESCONECTADA");
  if (cache !== null && cache.expira > Date.now()) return cache.acesso;
  try {
    const acesso = await acessoDeRefresh(c, t.refresh);
    cache = { acesso, expira: Date.now() + 50 * 60_000 };
    return acesso;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant|revoked|expired/i.test(msg)) { try { fs.rmSync(ARQ(), { force: true }); } catch { /* ok */ } cache = null; throw new Error("GOOGLE_CONTA_DESCONECTADA"); }
    throw e;
  }
}
