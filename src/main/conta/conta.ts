/**
 * Conta meu-bot neste Mac (molde Rambox): "Entrar" abre a página de login no navegador do sistema (Google ou link por
 * e-mail, no Firebase), a página volta por deep link `<esquema>://auth?code&state` (deep-link.ts) e o app troca o
 * code por uma sessão no `POST /token` (PKCE + state, conta-core.ts). A sessão (refresh rotativo + acesso de 1 h + a
 * última cópia da conta) fica cifrada com safeStorage em userData/conta.bin, decifrada uma vez por processo (o diálogo
 * do Chaveiro prende o fio principal: ver conta-google.ts). O login pendente fica em conta-login.json (10 min) para o
 * app poder reabrir no meio. Nesta versão a conta ainda não muda a licença da máquina (ela continua vindo do backend).
 */
import { app, safeStorage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ContaView } from "../../shared/ipc";
import { marcar } from "../app/depuracao";
import { broadcast } from "../app/windows";
import { produto } from "../app/variant";
import { esquemaDe } from "../app/variant-core";
import { gravar, temKeychain } from "../google/comum";
import { log } from "../maquina/tunnel";
import { parseRetornoAuth } from "./deep-link-core";
import { deviceIdentidade, devicePedido } from "./device";
import { URLS, deveRenovar, erroDaApi, novoLogin, parseContaInfo, parseLoginPendente, parseSessao, retornoConfere, sessaoAcabou, urlDeLogin, type LoginPendente, type SessaoGuardada } from "./conta-core";

const ARQ = (): string => path.join(app.getPath("userData"), "conta.bin");
const ARQ_LOGIN = (): string => path.join(app.getPath("userData"), "conta-login.json");
const urls = (): { auth: string; api: string } => URLS[produto().canal];
const TEMPO_API_MS = 20_000;

let sessao: SessaoGuardada | null | undefined; // undefined = ainda não lida neste processo
let pendente: LoginPendente | null | undefined;
let erro: string | null = null;
let renovando: Promise<SessaoGuardada | null> | null = null;

function lerSessao(): SessaoGuardada | null {
  if (sessao !== undefined) return sessao;
  const f = ARQ();
  if (!fs.existsSync(f)) { sessao = null; return null; }
  marcar("safeStorage: decifrar conta.bin");
  try {
    const s = parseSessao(JSON.parse(safeStorage.decryptString(fs.readFileSync(f))));
    if (s === null) log("[conta] conta.bin não tem uma sessão válida; ignorado");
    sessao = s;
  } catch (e) { log(`[conta] não decifrou conta.bin: ${e instanceof Error ? e.message : String(e)}`); return null; } // Chaveiro negado: tenta de novo na próxima leitura
  return sessao;
}
function gravarSessao(s: SessaoGuardada): void { sessao = s; gravar(ARQ(), safeStorage.encryptString(JSON.stringify(s))); }
function apagarSessao(): void { sessao = null; try { fs.rmSync(ARQ(), { force: true }); } catch { /* ok */ } }
function lerPendente(): LoginPendente | null {
  if (pendente === undefined) { try { pendente = parseLoginPendente(JSON.parse(fs.readFileSync(ARQ_LOGIN(), "utf8"))); } catch { pendente = null; } }
  // Os 10 min contam também para o que já está em memória: um login abandonado deixa de ser "entrando" sozinho.
  return pendente === null ? null : parseLoginPendente(pendente);
}
function gravarPendente(p: LoginPendente | null): void {
  pendente = p;
  try { if (p === null) fs.rmSync(ARQ_LOGIN(), { force: true }); else gravar(ARQ_LOGIN(), JSON.stringify(p)); } catch (e) { log(`[conta] não gravou conta-login.json: ${e instanceof Error ? e.message : String(e)}`); }
}

export function contaView(): ContaView {
  const s = lerSessao(), p = lerPendente();
  return { situacao: s !== null ? "dentro" : erro !== null ? "erro" : p !== null ? "entrando" : "fora", conta: s?.conta ?? null, erro, keychain: temKeychain(), canal: produto().canal, device: deviceIdentidade().id, urlLogin: urls().auth };
}
const avisar = (): ContaView => { const v = contaView(); broadcast("conta:changed", v); return v; };

/** Pedido à API: JSON de ida e volta; `status` 0 = sem resposta (rede, tempo). */
async function api(metodo: "GET" | "POST", rota: string, corpo: unknown = null, bearer: string | null = null): Promise<{ status: number; corpo: unknown }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (corpo !== null) headers["content-type"] = "application/json";
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
  try {
    const r = await fetch(`${urls().api}${rota}`, { method: metodo, headers, ...(corpo === null ? {} : { body: JSON.stringify(corpo) }), signal: AbortSignal.timeout(TEMPO_API_MS) });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, corpo: { erro: `sem resposta da API da conta (${e instanceof Error ? e.name === "TimeoutError" ? "tempo esgotado" : e.message : String(e)})` } }; }
}

/** "Entrar": abre a página de login no navegador do sistema e fica esperando o deep link. */
export async function entrar(): Promise<ContaView> {
  erro = null;
  const p = novoLogin();
  gravarPendente(p);
  const url = urlDeLogin(urls().auth, { esquema: esquemaDe(produto()), state: p.state, challenge: p.challenge, app: produto().nome, versao: app.getVersion() });
  log(`[conta] login: abrindo ${urls().auth} no navegador (state ${p.state.slice(0, 6)}…)`);
  try { await shell.openExternal(url); } catch (e) { gravarPendente(null); erro = `não abriu o navegador: ${e instanceof Error ? e.message : String(e)}`; }
  return avisar();
}
export function cancelarEntrada(): ContaView { gravarPendente(null); erro = null; return avisar(); }

/** O deep link chegou (app aberto ou recém-aberto por ele): confere o state e troca o code pela sessão. */
export async function aoRetornarAuth(url: string): Promise<void> {
  const r = parseRetornoAuth(url, esquemaDe(produto()));
  if (r === null) return;
  if (!r.ok) { erro = r.erro; log(`[conta] retorno do login recusado: ${r.erro}`); avisar(); return; }
  const p = lerPendente();
  if (!retornoConfere(p, r.retorno.state)) { erro = p === null ? "o login demorou mais de 10 min ou não foi pedido por este app; clique em Entrar de novo" : "o retorno não é deste login (state diferente); clique em Entrar de novo"; log(`[conta] retorno do login: ${erro}`); avisar(); return; }
  const resp = await api("POST", "/token", { grant: "code", code: r.retorno.code, verifier: p!.verifier, device: devicePedido() });
  const s = resp.status === 200 ? parseSessao(resp.corpo) : null;
  if (s === null) { erro = resp.status === 200 ? "a API devolveu uma sessão fora do formato" : erroDaApi(resp.status, resp.corpo); log(`[conta] POST /token falhou (${resp.status}): ${erro}`); avisar(); return; }
  gravarSessao(s); gravarPendente(null); erro = null;
  log(`[conta] entrou: ${s.conta.email} (${s.conta.licenca.plan}, ${s.conta.devices.length} device(s))`);
  avisar();
  app.focus({ steal: true }); // a pessoa estava no navegador: o app volta para a frente com a conta na tela
}

/** Token de acesso válido (renova pelo refresh quando perto de vencer); null = sem sessão (a tela mostra "Entrar"). */
export async function tokenDeAcesso(): Promise<string | null> {
  const s = lerSessao();
  if (s === null) return null;
  if (!deveRenovar(s.expiraEm)) return s.acesso;
  if (renovando === null) renovando = renovar(s).finally(() => { renovando = null; });
  return (await renovando)?.acesso ?? null;
}
async function renovar(s: SessaoGuardada): Promise<SessaoGuardada | null> {
  const resp = await api("POST", "/token", { grant: "refresh", refresh: s.refresh });
  const novo = resp.status === 200 ? parseSessao(resp.corpo) : null;
  if (novo !== null) { gravarSessao(novo); erro = null; avisar(); return novo; }
  if (sessaoAcabou(resp.status)) { apagarSessao(); erro = erroDaApi(resp.status, resp.corpo); log(`[conta] sessão acabou: ${erro}`); avisar(); return null; }
  log(`[conta] renovar falhou (${resp.status}): ${erroDaApi(resp.status, resp.corpo)}; a sessão continua até a próxima tentativa`);
  return s; // rede ou API fora: o acesso guardado ainda pode valer
}
/** Relê a conta na API (plano, devices, pedidos) e guarda a cópia; sem rede devolve o que estava. */
export async function atualizarConta(): Promise<ContaView> {
  const tok = await tokenDeAcesso();
  const s = lerSessao();
  if (tok === null || s === null) return contaView();
  const resp = await api("GET", "/conta", null, tok);
  if (resp.status === 200) { const c = parseContaInfo(resp.corpo); if (c !== null) { gravarSessao({ ...s, conta: c }); erro = null; } }
  else if (sessaoAcabou(resp.status)) { apagarSessao(); erro = erroDaApi(resp.status, resp.corpo); log(`[conta] sessão acabou: ${erro}`); }
  else log(`[conta] GET /conta falhou (${resp.status}): ${erroDaApi(resp.status, resp.corpo)}`);
  return avisar();
}
/** "Sair": encerra a família de sessões na API (melhor esforço) e apaga a cópia local. */
export async function sair(): Promise<ContaView> {
  const s = lerSessao();
  if (s !== null) { const resp = await api("POST", "/sessao/sair", {}, s.acesso); if (resp.status !== 200) log(`[conta] sair: a API respondeu ${resp.status} (${erroDaApi(resp.status, resp.corpo)}); a cópia local sai mesmo assim`); }
  apagarSessao(); gravarPendente(null); erro = null;
  log("[conta] saiu");
  return avisar();
}
