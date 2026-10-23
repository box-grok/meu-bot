/**
 * Google Contatos → CRM da máquina, automático (anda com a extensão do CRM, que segue a licença da máquina). O login é o oficial do Google para apps de desktop
 * (navegador do Mac + retorno em 127.0.0.1, PKCE), só leitura de contatos. O refresh token fica cifrado pelo
 * safeStorage (Keychain) em userData/google-contatos.bin e nunca sai do Mac. A sincronização lê a API People e
 * manda para o POST /v1/crm/contacts/import da máquina pelo túnel (completa sem apagar; quem não mudou não é
 * regravado): ao abrir o app, a cada 30 min e no "Sincronizar agora" da página Contatos.
 *
 * O client OAuth do app vem de userData/google-oauth.json ou Resources/google-oauth.json (o JSON que o Google
 * Cloud baixa para um client "Desktop app").
 */
import { app, safeStorage, shell } from "electron";
import { acessoDeRefresh, cliente, gravar, postForm } from "./comum";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ensureTunnel, log } from "../tunnel";
import { getBackendPort } from "../settings";
import { browserAsk, browserWebContents, reservarRetornoLocal } from "../browser";
import { CAMPOS_PESSOA, URL_TOKEN, caminhoNoDrive, consultaPasta, corpoUpload, temDrive, emailDePessoaEu, faltantesNoGoogle, parseClienteOAuth, pessoaDoWhatsapp, pessoaParaContato, pkce, temEscrita, urlDeAutorizacao, type ClienteOAuth, type ContatoGoogle, type ContatoWhatsapp } from "./google-core";

export interface GoogleStatus { configurado: boolean; conectado: boolean; conectando: boolean; escrita: boolean; precisaReconectar: boolean; email: string | null; sincronizando: boolean; ultimaSync: string | null; total: number | null; criados: number | null; atualizados: number | null; whatsappSalvos: number | null; whatsappErro: string | null; erro: string | null }
const ARQ_TOKEN = (): string => path.join(app.getPath("userData"), "google-contatos.bin");
const ARQ_ESTADO = (): string => path.join(app.getPath("userData"), "google-contatos.json");
/** Números do WhatsApp já criados no Google por nós (nunca recria) e o marcador "WhatsApp". */
const ARQ_WA = (): string => path.join(app.getPath("userData"), "google-whatsapp.json");
const INTERVALO = 30 * 60_000;

function lerToken(): { refresh: string; email: string | null; escopo: string } | null {
  try { const j = JSON.parse(safeStorage.decryptString(fs.readFileSync(ARQ_TOKEN()))) as { refresh?: unknown; email?: unknown; escopo?: unknown }; return typeof j.refresh === "string" ? { refresh: j.refresh, email: typeof j.email === "string" ? j.email : null, escopo: typeof j.escopo === "string" ? j.escopo : "" } : null; } catch { return null; }
}
type Estado = Omit<GoogleStatus, "configurado" | "conectado" | "conectando" | "escrita" | "precisaReconectar" | "email" | "sincronizando">;
const ESTADO_VAZIO: Estado = { ultimaSync: null, total: null, criados: null, atualizados: null, whatsappSalvos: null, whatsappErro: null, erro: null };
const lerEstado = (): Estado => { try { return { ...ESTADO_VAZIO, ...(JSON.parse(fs.readFileSync(ARQ_ESTADO(), "utf8")) as Partial<Estado>) }; } catch { return { ...ESTADO_VAZIO }; } };
const lerWa = (): { criados: string[]; grupo: string | null } => { try { const j = JSON.parse(fs.readFileSync(ARQ_WA(), "utf8")) as { criados?: unknown; grupo?: unknown }; return { criados: Array.isArray(j.criados) ? j.criados.filter((x): x is string => typeof x === "string") : [], grupo: typeof j.grupo === "string" ? j.grupo : null }; } catch { return { criados: [], grupo: null }; } };
const sincronizando = new Set<string>();
const conectando = new Set<string>();

export function googleStatus(host: string): GoogleStatus {
  const t = lerToken();
  const escrita = t !== null && temEscrita(t.escopo);
  // Reconectar também quando falta o Drive (guardar as conversas do WhatsApp ao limpar o histórico).
  return { configurado: cliente() !== null, conectado: t !== null, conectando: conectando.has(host), escrita, precisaReconectar: t !== null && (!escrita || !temDrive(t.escopo)), email: t?.email ?? null, sincronizando: sincronizando.has(host), ...lerEstado() };
}


/**
 * Abre o login do Google no navegador do Mac e volta na hora (`conectando: true`); o retorno no loopback (até 5
 * min) grava a autorização e dispara a 1ª sincronização. A página acompanha pelo status.
 */
export async function googleConectar(host: string): Promise<GoogleStatus> {
  const c = cliente(); if (c === null) throw new Error("o app ainda não tem o client OAuth do Google (google-oauth.json)");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("este Mac não tem o Keychain disponível para guardar a autorização");
  if (!conectando.has(host)) {
    conectando.add(host);
    void fluxoLogin(host, c).catch((e: unknown) => { const msg = e instanceof Error ? e.message : String(e); gravar(ARQ_ESTADO(), JSON.stringify({ ...lerEstado(), erro: msg })); log(`[google ${host}] login não concluído: ${msg}`); }).finally(() => { conectando.delete(host); });
  }
  return googleStatus(host);
}
async function fluxoLogin(host: string, c: ClienteOAuth): Promise<void> {
  const { verifier, challenge } = pkce(); const state = randomBytes(16).toString("hex");
  const codigo = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/oauth") { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      // Fluxo completo: a aba volta sozinha para a página Contatos do CRM no Gmail (lá aparece a sincronização).
      const volta = "https://mail.google.com/mail/u/0/#meu-bot-crm/contatos";
      res.end(`<!doctype html><meta charset="utf-8"><title>meu-bot CRM</title>${ok ? `<meta http-equiv="refresh" content="2;url=${volta}">` : ""}<body style="font:16px system-ui;padding:40px">${ok ? `✅ Google Contatos conectado. Voltando para os Contatos do meu-bot CRM… <a href="${volta}">ir agora</a>` : `Não deu: ${u.searchParams.get("error") ?? "retorno inválido"}. Feche esta aba e tente de novo.`}</body>`);
      clearTimeout(t); srv.close();
      if (ok) resolve({ code: u.searchParams.get("code") as string, redirect }); else reject(new Error(u.searchParams.get("error") === "access_denied" ? "você não autorizou o acesso aos contatos" : "retorno inválido do Google"));
    });
    let redirect = "";
    const t = setTimeout(() => { srv.close(); reject(new Error("o login do Google não foi concluído em 5 minutos")); }, 5 * 60_000);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address(); const port = typeof a === "object" && a !== null ? a.port : 0;
      srv.on("close", reservarRetornoLocal(port)); // o retorno deste loopback é local (Mac), não entrega por SSH
      redirect = `http://127.0.0.1:${port}/oauth`;
      // Numa aba do Navegador do app (já logado na conta do Gmail); sem o Navegador aberto, no navegador do Mac.
      const url = urlDeAutorizacao({ clientId: c.clientId, redirect, challenge, state });
      const navAberto = browserWebContents(host).some((w) => { try { return w.getURL().startsWith("http"); } catch { return false; } });
      if (!navAberto || !browserAsk(host, { kind: "new-tab", url })) void shell.openExternal(url);
    });
  });
  const tok = await postForm(URL_TOKEN, { code: codigo.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: codigo.redirect, grant_type: "authorization_code", code_verifier: verifier });
  if (typeof tok["refresh_token"] !== "string") throw new Error("o Google não devolveu a autorização permanente; tente conectar de novo");
  let email: string | null = null;
  try { const r = await fetch("https://people.googleapis.com/v1/people/me?personFields=emailAddresses", { headers: { authorization: `Bearer ${String(tok["access_token"])}` } }); if (r.ok) email = emailDePessoaEu(await r.json()); } catch { /* sem e-mail: mostra "conectado" */ }
  gravar(ARQ_TOKEN(), safeStorage.encryptString(JSON.stringify({ refresh: tok["refresh_token"], email, escopo: typeof tok["scope"] === "string" ? tok["scope"] : "" })));
  gravar(ARQ_ESTADO(), JSON.stringify({ ...lerEstado(), erro: null }));
  log(`[google ${host}] Google Contatos conectado (${email ?? "conta sem e-mail visível"})`);
  await googleSincronizar(host);
}

export async function googleDesconectar(host: string): Promise<GoogleStatus> {
  const t = lerToken();
  if (t) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh)}`, { method: "POST" }); } catch { /* revogar é cortesia */ } }
  for (const f of [ARQ_TOKEN(), ARQ_ESTADO()]) { try { fs.rmSync(f, { force: true }); } catch { /* ok */ } } // google-whatsapp.json fica: reconectar não recria ninguém
  log(`[google ${host}] Google Contatos desconectado`);
  return googleStatus(host);
}

/** Todos os contatos da conta (API People, páginas de 1000). */
async function lerContatos(acesso: string): Promise<ContatoGoogle[]> {
  const out: ContatoGoogle[] = []; let pagina: string | undefined;
  do {
    const q = new URLSearchParams({ personFields: CAMPOS_PESSOA, pageSize: "1000", ...(pagina ? { pageToken: pagina } : {}) });
    const r = await fetch(`https://people.googleapis.com/v1/people/me/connections?${q.toString()}`, { headers: { authorization: `Bearer ${acesso}` } });
    const j = (await r.json().catch(() => ({}))) as { connections?: unknown[]; nextPageToken?: string; error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message ?? `API People respondeu ${r.status}`);
    for (const p of j.connections ?? []) { const c = pessoaParaContato(p); if (c) out.push(c); }
    pagina = j.nextPageToken;
  } while (pagina !== undefined && out.length < 25_000);
  return out;
}
async function importar(host: string, contatos: ContatoGoogle[]): Promise<{ criados: number; atualizados: number }> {
  const tunnel = await ensureTunnel(host, getBackendPort(host)); let criados = 0; let atualizados = 0;
  for (let i = 0; i < contatos.length; i += 2000) {
    const r = await fetch(`http://127.0.0.1:${tunnel.localPort}/v1/crm/contacts/import`, { method: "POST", headers: { authorization: `Bearer ${tunnel.apiKey}`, "content-type": "application/json", "x-crm-por": "google" }, body: JSON.stringify({ contatos: contatos.slice(i, i + 2000) }) });
    const j = (await r.json().catch(() => ({}))) as { criados?: number; atualizados?: number; error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message ?? `o CRM respondeu ${r.status}`);
    criados += j.criados ?? 0; atualizados += j.atualizados ?? 0;
  }
  return { criados, atualizados };
}

/** Marcador "WhatsApp" no Google Contatos (cria uma vez; guarda o resourceName). */
async function grupoWhatsapp(acesso: string): Promise<string | null> {
  const salvo = lerWa().grupo; if (salvo) return salvo;
  const h = { authorization: `Bearer ${acesso}`, "content-type": "application/json" };
  const l = (await (await fetch("https://people.googleapis.com/v1/contactGroups?pageSize=1000", { headers: h })).json().catch(() => ({}))) as { contactGroups?: { resourceName?: string; name?: string; formattedName?: string }[] };
  let g = (l.contactGroups ?? []).find((x) => x.name === "WhatsApp" || x.formattedName === "WhatsApp")?.resourceName ?? null;
  if (!g) { const r = await fetch("https://people.googleapis.com/v1/contactGroups", { method: "POST", headers: h, body: JSON.stringify({ contactGroup: { name: "WhatsApp" } }) }); const j = (await r.json().catch(() => ({}))) as { resourceName?: string }; g = r.ok ? j.resourceName ?? null : null; }
  if (g) gravar(ARQ_WA(), JSON.stringify({ ...lerWa(), grupo: g }));
  return g;
}
/** Cria no Google os números do WhatsApp que ele ainda não tem (lotes de 200; quota estourada → tenta na próxima). */
async function salvarWhatsapp(host: string, acesso: string, telefonesGoogle: string[]): Promise<{ salvos: number; erro: string | null }> {
  const estado = lerWa();
  try {
    const tunnel = await ensureTunnel(host, getBackendPort(host));
    const r = await fetch(`http://127.0.0.1:${tunnel.localPort}/v1/crm/whatsapp/contatos`, { headers: { authorization: `Bearer ${tunnel.apiKey}`, "x-crm-por": "google" } });
    const j = (await r.json().catch(() => ({}))) as { contatos?: ContatoWhatsapp[]; error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message ?? `o CRM respondeu ${r.status}`);
    const faltam = faltantesNoGoogle(j.contatos ?? [], telefonesGoogle, estado.criados);
    if (faltam.length === 0) return { salvos: estado.criados.length, erro: null };
    const grupo = await grupoWhatsapp(acesso);
    let criados = [...estado.criados];
    for (let i = 0; i < faltam.length; i += 200) {
      const lote = faltam.slice(i, i + 200);
      const c = await fetch("https://people.googleapis.com/v1/people:batchCreateContacts", { method: "POST", headers: { authorization: `Bearer ${acesso}`, "content-type": "application/json" }, body: JSON.stringify({ contacts: lote.map((x) => ({ contactPerson: pessoaDoWhatsapp(x, grupo) })), readMask: "names,phoneNumbers" }) });
      const cj = (await c.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!c.ok) throw new Error(cj.error?.message ?? `Google respondeu ${c.status}`);
      criados = [...criados, ...lote.map((x) => x.telefone)];
      gravar(ARQ_WA(), JSON.stringify({ ...lerWa(), criados }));
    }
    log(`[google ${host}] WhatsApp → Google: ${faltam.length} contatos novos criados (marcador WhatsApp)`);
    return { salvos: criados.length, erro: null };
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); log(`[google ${host}] WhatsApp → Google falhou: ${msg}`); return { salvos: lerWa().criados.length, erro: msg }; }
}

export async function googleSincronizar(host: string): Promise<GoogleStatus> {
  const c = cliente(); const t = lerToken();
  if (c === null || t === null) return googleStatus(host);
  if (sincronizando.has(host)) return googleStatus(host);
  sincronizando.add(host);
  try {
    const tok = await postForm(URL_TOKEN, { refresh_token: t.refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" });
    const acesso = String(tok["access_token"]);
    const contatos = await lerContatos(acesso);
    const r = contatos.length > 0 ? await importar(host, contatos) : { criados: 0, atualizados: 0 };
    // WhatsApp → Google: todo número novo das conversas diretas vira contato no Google (só com a permissão de escrita).
    let wa: { salvos: number; erro: string | null } = { salvos: lerEstado().whatsappSalvos ?? 0, erro: null };
    if (temEscrita(t.escopo)) wa = await salvarWhatsapp(host, acesso, contatos.flatMap((c) => c.telefones));
    gravar(ARQ_ESTADO(), JSON.stringify({ ultimaSync: new Date().toISOString(), total: contatos.length, ...r, whatsappSalvos: wa.salvos, whatsappErro: wa.erro, erro: null }));
    log(`[google ${host}] sincronizado: ${contatos.length} contatos (${r.criados} novos, ${r.atualizados} completados)${temEscrita(t.escopo) ? `; WhatsApp: ${wa.salvos} salvos no Google${wa.erro ? ` (erro: ${wa.erro})` : ""}` : "; WhatsApp: falta reconectar com permissão de escrita"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Autorização revogada na conta Google: some o token para a página pedir para conectar de novo.
    if (/invalid_grant|revoked|expired/i.test(msg)) { try { fs.rmSync(ARQ_TOKEN(), { force: true }); } catch { /* ok */ } }
    gravar(ARQ_ESTADO(), JSON.stringify({ ...lerEstado(), erro: msg }));
    log(`[google ${host}] sincronização falhou: ${msg}`);
  } finally { sincronizando.delete(host); }
  return googleStatus(host);
}

const agendados = new Map<string, ReturnType<typeof setInterval>>();
/** Uma vez por máquina (quando a extensão do CRM sobe): 20 s depois e a cada 30 min, se estiver conectado. */
export function agendarSincronizacaoGoogle(host: string): void {
  if (agendados.has(host)) return;
  const rodar = (): void => { if (lerToken() !== null) void googleSincronizar(host); };
  setTimeout(rodar, 20_000).unref();
  const i = setInterval(rodar, INTERVALO); i.unref(); agendados.set(host, i);
}
export function pararSincronizacaoGoogle(host: string): void { const i = agendados.get(host); if (i) clearInterval(i); agendados.delete(host); }

/**
 * Guarda a conversa no Google Drive (só `drive.file`): meu-bot / <máquina> / WhatsApp / <contato> / conversa-….md.
 * null = o Google não está conectado neste Mac (o Drive não foi configurado: a limpeza segue só com o CRM). Conectado
 * sem a permissão do Drive, ou falha da API, é erro: quem chama não limpa.
 */
export async function guardarNoDrive(maquina: string, nome: string, numero: string, conteudo: string, ultimaEm: number): Promise<{ link: string; caminho: string } | null> {
  const s = await sessaoDrive();
  if (s === null) return null;
  const { pastas, arquivo } = caminhoNoDrive(maquina, nome, numero, ultimaEm);
  const pai = await s.pasta(pastas);
  const fronteira = `meu-bot-${Date.now().toString(36)}`;
  const up = await s.api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "content-type": `multipart/related; boundary=${fronteira}` }, body: corpoUpload({ name: arquivo, parents: [pai], mimeType: "text/markdown" }, conteudo, fronteira) });
  const caminho = [...pastas, arquivo].join(" / ");
  log(`[google] conversa guardada no Drive: ${caminho}`);
  return { link: typeof up["webViewLink"] === "string" ? up["webViewLink"] : "", caminho };
}

export interface SessaoDrive {
  /** Chamada autenticada à API do Drive; erro da API vira Error com a mensagem do Google. */
  api: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  /** Desce (criando o que faltar) a sequência de pastas a partir da raiz e devolve o id da última. */
  pasta: (pastas: readonly string[]) => Promise<string>;
}
/**
 * Sessão autenticada no Drive com o token de Contatos do CRM (escopo `drive.file`: o app só enxerga o que ele
 * mesmo criou). Dono de tudo o que grava no Drive: as conversas do WhatsApp e a cópia do CRM usam esta função,
 * para o token e o tratamento de erro ficarem num lugar só.
 *
 * `null` = o Google não está conectado neste Mac. Conectado sem a permissão do Drive é erro, não silêncio.
 */
export async function sessaoDrive(): Promise<SessaoDrive | null> {
  const c = cliente(); const t = lerToken();
  if (c === null || t === null) return null;
  if (!temDrive(t.escopo)) throw new Error("o Google deste Mac está conectado sem a permissão do Drive: clique em \"Reconectar\" na aba Pessoas do CRM (Gmail)");
  const tok = await postForm(URL_TOKEN, { refresh_token: t.refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" });
  const auth = { authorization: `Bearer ${String(tok["access_token"])}` };
  const api = async (url: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const r = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(`Google Drive respondeu ${r.status}${typeof (j["error"] as { message?: unknown } | undefined)?.message === "string" ? `: ${(j["error"] as { message: string }).message}` : ""}`);
    return j;
  };
  const pasta = async (pastas: readonly string[]): Promise<string> => {
    let pai = "root";
    for (const p of pastas) {
      const achou = await api(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: consultaPasta(p, pai), fields: "files(id)", spaces: "drive", pageSize: "1" })}`);
      const id = Array.isArray(achou["files"]) && typeof (achou["files"][0] as { id?: unknown } | undefined)?.id === "string" ? (achou["files"][0] as { id: string }).id : null;
      pai = id ?? String((await api("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: p, mimeType: "application/vnd.google-apps.folder", parents: [pai] }) }))["id"]);
    }
    return pai;
  };
  return { api, pasta };
}
