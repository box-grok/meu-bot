/**
 * Cliente da API do CRM. Os pedidos saem pelo service worker (relay por chrome.runtime.sendMessage: ele tem o
 * token e host_permissions para 127.0.0.1); se o fetch falhar lá por CORS/rede local, cai no fetch direto do
 * content script com a config pedida ao worker. Erros viram ErroCrm tipado; mensagens nunca carregam o token.
 */
import type { Arquivo, CaixaFicha, GoogleStatus, ResumoIA, CaixaHome, CaixaResumo, Contato, ContatoPagina, ContatoPatch, Org, OrgPagina, OrgPatch, CaixaView, Comentario, Etapa, Feed, Pipeline, PipelineResumo, Status, ThreadLookup, ThreadView } from "./tipos.ts";
import type { Config } from "./config.ts";
import type { ContatoImport } from "./csv.ts";

export type TipoErro = "proxy-fora" | "host-fora" | "nao-autorizado" | "assinatura" | "nao-encontrado" | "conflito" | "invalido" | "servidor";
export class ErroCrm extends Error {
  tipo: TipoErro; status: number; extra: unknown;
  constructor(tipo: TipoErro, message: string, status = 0, extra: unknown = null) { super(message); this.tipo = tipo; this.status = status; this.extra = extra; }
}
export interface Resposta { status: number; json: unknown }
export type Transporte = (req: { metodo: string; caminho: string; corpo?: unknown }) => Promise<Resposta>;

/** Mensagens content ⇄ worker. */
export type MensagemCrm = { tipo: "crm:fetch"; metodo: string; caminho: string; corpo?: unknown } | { tipo: "crm:config" };
export const CAMINHO_RE = /^\/[A-Za-z0-9/_?=&.%:+~-]*$/;
export const caminhoOk = (c: string): boolean => CAMINHO_RE.test(c) && !c.includes("..") && c.length <= 2000;

function erroDe(status: number, json: unknown, fallback: string): ErroCrm {
  const e = json !== null && typeof json === "object" ? (json as { error?: { message?: string; code?: string; box?: unknown }; erro?: string }) : {};
  const msg = e.error?.message ?? e.erro ?? fallback;
  if (status === 0 || status === 502 || status === 503) return new ErroCrm(status === 502 ? "host-fora" : "proxy-fora", msg, status);
  if (status === 401) return new ErroCrm("nao-autorizado", msg, status);
  if (status === 403) return new ErroCrm(e.error?.code === "crm_license" ? "assinatura" : "nao-autorizado", msg, status);
  if (status === 404) return new ErroCrm("nao-encontrado", msg, status);
  if (status === 409) return new ErroCrm("conflito", msg, status, e.error?.box ?? null);
  if (status >= 400 && status < 500) return new ErroCrm("invalido", msg, status);
  return new ErroCrm("servidor", msg, status);
}

/**
 * Relay pelo service worker. Leitura (GET): timeout curto; sem resposta, o chamador tenta o caminho direto.
 * Escrita: espera bem mais (resumo com IA, anexos grandes) e, se estourar, NÃO deixa repetir pelo outro caminho
 * (o pedido pode ter chegado ao CRM; repetir duplicaria).
 */
export function transporteRelay(timeoutMs = 4000, timeoutEscritaMs = 200_000): Transporte {
  return (req) => new Promise((resolve, reject) => {
    const escrita = req.metodo !== "GET";
    const t = setTimeout(() => reject(escrita ? new ErroCrm("servidor", "o CRM demorou demais para responder; confira antes de repetir") : new ErroCrm("proxy-fora", "o service worker da extensão não respondeu")), escrita ? timeoutEscritaMs : timeoutMs);
    try {
      chrome.runtime.sendMessage({ tipo: "crm:fetch", metodo: req.metodo, caminho: req.caminho, corpo: req.corpo } satisfies MensagemCrm, (r: Resposta | undefined) => {
        clearTimeout(t);
        if (chrome.runtime.lastError || r === undefined) reject(new ErroCrm("proxy-fora", chrome.runtime.lastError?.message ?? "sem resposta do worker"));
        else resolve(r);
      });
    } catch (e) { clearTimeout(t); reject(new ErroCrm("proxy-fora", e instanceof Error ? e.message : String(e))); }
  });
}
/** Fetch direto (content script → 127.0.0.1): o proxy do app responde CORS para mail.google.com. */
export function transporteDireto(config: () => Promise<Config>): Transporte {
  return async (req) => {
    const c = await config();
    const r = await fetch(`http://127.0.0.1:${c.porta}/v1/crm${req.caminho}`, { method: req.metodo, headers: { authorization: `Bearer ${c.token}`, ...(req.corpo === undefined ? {} : { "content-type": "application/json" }) }, body: req.corpo === undefined ? null : JSON.stringify(req.corpo) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
/** Relay primeiro; se o worker disser que o fetch dele falhou (status 0) ou não responder, direto por 60 s. */
export function transporteAuto(relay: Transporte, direto: Transporte, agora: () => number = Date.now): Transporte {
  let diretoAte = 0;
  return async (req) => {
    if (agora() < diretoAte) return direto(req);
    try {
      const r = await relay(req);
      if (r.status !== 0) return r;
    } catch (e) { if (e instanceof ErroCrm && e.tipo === "servidor") throw e; /* senão: relay fora */ }
    diretoAte = agora() + 60_000;
    return direto(req);
  };
}

export interface ApiCrm {
  status(): Promise<Status>;
  pipelines(): Promise<PipelineResumo[]>;
  pipeline(key: string): Promise<Pipeline>;
  criarPipeline(dados: { name: string; stages: string[] }): Promise<Pipeline>;
  atualizarPipeline(key: string, patch: { name?: string; stages?: { key?: string; name: string }[]; fields?: { key?: string; name: string; type?: string; options?: { key?: string; name: string }[] }[]; moverPara?: string }): Promise<Pipeline>;
  apagarPipeline(key: string): Promise<void>;
  caixas(pipeline: string, q?: { etapa?: string; q?: string; limit?: number }): Promise<{ boxes: CaixaResumo[]; total: number; stages: Etapa[] }>;
  caixa(key: string): Promise<CaixaFicha>;
  criarCaixa(pipeline: string, dados: { name: string; stageKey?: string; notes?: string; fields?: Record<string, unknown>; email?: string; phone?: string; contactName?: string; responsaveis?: { email: string; nome?: string }[] }): Promise<CaixaView>;
  atualizarCaixa(key: string, patch: { name?: string; notes?: string; stageKey?: string; fields?: Record<string, unknown>; responsaveis?: { email: string; nome?: string }[] }): Promise<CaixaView>;
  comentar(key: string, texto: string): Promise<Comentario>;
  apagarCaixa(key: string): Promise<void>;
  vincularContato(box: string, dados: { key?: string; name?: string; email?: string; phone?: string }): Promise<void>;
  desvincularContato(box: string, contato: string): Promise<void>;
  vincularThread(key: string, t: { threadGmailId: string; assunto?: string; emails?: string[]; nomes?: string[] }): Promise<ThreadView[]>;
  desvincularThread(key: string, gid: string): Promise<void>;
  caixaDaThread(gid: string): Promise<{ box: CaixaView; pipelineKey: string } | null>;
  lookupThreads(gids: string[]): Promise<Record<string, ThreadLookup>>;
  mudancas(since: number, wait?: number): Promise<Feed>;
  caixasPorChave(keys: string[]): Promise<CaixaHome[]>;
  editarComentario(box: string, key: string, texto: string): Promise<void>;
  apagarComentario(box: string, key: string): Promise<void>;
  vincularOrg(box: string, org: string): Promise<void>;
  gerarResumo(box: string): Promise<ResumoIA>;
  conversasWhatsapp(): Promise<Record<string, { sessao: string | null; nome: string | null }>>;
  abrirWhatsapp(telefone: string): Promise<boolean>;
  google(acao: "status" | "conectar" | "sincronizar" | "desconectar"): Promise<GoogleStatus>;
  enviarArquivo(box: string, a: { nome: string; tipo: string; base64: string }): Promise<Arquivo>;
  baixarArquivo(box: string, key: string): Promise<{ nome: string; tipo: string; base64: string }>;
  baixarArquivoContato(contato: string, key: string): Promise<{ nome: string; tipo: string; base64: string }>;
  apagarArquivo(box: string, key: string): Promise<void>;
  desvincularOrg(box: string, org: string): Promise<void>;
  caixasEmAlta(limit?: number): Promise<CaixaHome[]>;
  contatos(o?: { q?: string; org?: string; limit?: number; phone?: string }): Promise<{ total: number; contatos: Contato[] }>;
  contato(key: string): Promise<ContatoPagina>;
  criarContato(dados: { name?: string; email?: string; phone?: string; cargo?: string }): Promise<string>;
  editarContato(key: string, patch: ContatoPatch): Promise<Contato>;
  apagarContato(key: string): Promise<void>;
  importarContatos(contatos: ContatoImport[]): Promise<{ criados: number; atualizados: number; ignorados: number; orgsCriadas: number }>;
  orgs(o?: { q?: string; limit?: number }): Promise<{ total: number; orgs: Org[] }>;
  org(key: string): Promise<OrgPagina>;
  criarOrg(dados: OrgPatch & { nome?: string; dominio?: string }): Promise<{ nova: boolean; org: Org }>;
  editarOrg(key: string, patch: OrgPatch): Promise<Org>;
  apagarOrg(key: string): Promise<void>;
}

export function criarApi(t: Transporte): ApiCrm {
  async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    if (!caminhoOk(caminho)) throw new ErroCrm("invalido", "caminho inválido");
    let r: Resposta;
    try { r = await t({ metodo, caminho, corpo }); }
    catch (e) { if (e instanceof ErroCrm) throw e; throw new ErroCrm("proxy-fora", e instanceof Error ? e.message : String(e)); }
    if (r.status !== 200) throw erroDe(r.status, r.json, `o CRM respondeu ${r.status}`);
    if (r.json === null || typeof r.json !== "object") throw new ErroCrm("servidor", "resposta vazia do CRM", 200);
    return r.json as T;
  }
  const q = (o: Record<string, string | number | undefined>): string => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v)); const s = p.toString(); return s === "" ? "" : `?${s}`; };
  const enc = encodeURIComponent;
  return {
    status: () => chamar<Status>("GET", "/status"),
    pipelines: async () => (await chamar<{ pipelines: PipelineResumo[] }>("GET", "/pipelines")).pipelines,
    pipeline: (key) => chamar<Pipeline>("GET", `/pipelines/${enc(key)}`),
    criarPipeline: async (dados) => (await chamar<{ pipeline: Pipeline }>("POST", "/pipelines", dados)).pipeline,
    atualizarPipeline: async (key, patch) => (await chamar<{ pipeline: Pipeline }>("PATCH", `/pipelines/${enc(key)}`, patch)).pipeline,
    apagarPipeline: async (key) => { await chamar("DELETE", `/pipelines/${enc(key)}`); },
    caixas: (pipeline, o = {}) => chamar("GET", `/pipelines/${enc(pipeline)}/boxes${q({ stage: o.etapa, q: o.q, limit: o.limit ?? 500 })}`),
    caixa: (key) => chamar<CaixaFicha>("GET", `/boxes/${enc(key)}`),
    criarCaixa: async (pipeline, dados) => (await chamar<{ box: CaixaView }>("POST", `/pipelines/${enc(pipeline)}/boxes`, dados)).box,
    atualizarCaixa: async (key, patch) => (await chamar<{ box: CaixaView }>("PATCH", `/boxes/${enc(key)}`, patch)).box,
    comentar: async (key, texto) => { const r = await chamar<{ comentario: string; em: string }>("POST", `/boxes/${enc(key)}/comments`, { texto, autor: "extensao" }); return { key: r.comentario, em: r.em.slice(0, 16), autor: "extensao", texto }; },
    apagarCaixa: async (key) => { await chamar("DELETE", `/boxes/${enc(key)}`); },
    vincularContato: async (box, dados) => { await chamar("POST", "/contacts", { ...dados, box }); },
    desvincularContato: async (box, contato) => { await chamar("DELETE", `/boxes/${enc(box)}/contacts/${enc(contato)}`); },
    vincularThread: async (key, t) => (await chamar<{ threads: ThreadView[] }>("PUT", `/boxes/${enc(key)}/threads`, t)).threads,
    desvincularThread: async (key, gid) => { await chamar("DELETE", `/boxes/${enc(key)}/threads/${enc(gid)}`); },
    caixaDaThread: async (gid) => { try { return await chamar<{ box: CaixaView; pipelineKey: string }>("GET", `/threads/${enc(gid)}`); } catch (e) { if (e instanceof ErroCrm && e.tipo === "nao-encontrado") return null; throw e; } },
    lookupThreads: async (gids) => (await chamar<{ boxes: Record<string, ThreadLookup> }>("POST", "/threads/lookup", { ids: gids })).boxes,
    mudancas: (since, wait) => chamar<Feed>("GET", `/changes${q({ since, wait })}`),
    caixasPorChave: async (keys) => keys.length === 0 ? [] : (await chamar<{ boxes: CaixaHome[] }>("GET", `/boxes${q({ keys: keys.join(","), limit: keys.length })}`)).boxes,
    editarComentario: async (box, key, texto) => { await chamar("PATCH", `/boxes/${enc(box)}/comments/${enc(key)}`, { texto }); },
    apagarComentario: async (box, key) => { await chamar("DELETE", `/boxes/${enc(box)}/comments/${enc(key)}`); },
    conversasWhatsapp: async () => (await chamar<{ conversas: Record<string, { sessao: string | null; nome: string | null }> }>("GET", "/app/whatsapp")).conversas,
    abrirWhatsapp: async (telefone) => (await chamar<{ ok: boolean }>("POST", "/app/whatsapp/abrir", { telefone })).ok,
    google: (acao) => chamar<GoogleStatus>(acao === "status" ? "GET" : "POST", `/google/${acao}`, acao === "status" ? undefined : {}),
    gerarResumo: async (box) => (await chamar<{ resumoIA: ResumoIA }>("POST", `/boxes/${enc(box)}/resumo`, {})).resumoIA,
    enviarArquivo: async (box, a) => (await chamar<{ arquivo: Arquivo }>("POST", `/boxes/${enc(box)}/files`, a)).arquivo,
    baixarArquivo: (box, key) => chamar("GET", `/boxes/${enc(box)}/files/${enc(key)}`),
    baixarArquivoContato: (contato, key) => chamar("GET", `/contacts/${enc(contato)}/files/${enc(key)}`),
    apagarArquivo: async (box, key) => { await chamar("DELETE", `/boxes/${enc(box)}/files/${enc(key)}`); },
    vincularOrg: async (box, org) => { await chamar("POST", `/boxes/${enc(box)}/orgs`, { key: org }); },
    desvincularOrg: async (box, org) => { await chamar("DELETE", `/boxes/${enc(box)}/orgs/${enc(org)}`); },
    contatos: (o = {}) => chamar("GET", `/contacts${q({ q: o.q, org: o.org, phone: o.phone, limit: o.limit ?? 1000 })}`),
    contato: (key) => chamar<ContatoPagina>("GET", `/contacts/${enc(key)}`),
    criarContato: async (dados) => (await chamar<{ contato: string }>("POST", "/contacts", dados)).contato,
    editarContato: async (key, patch) => (await chamar<{ contato: Contato }>("PATCH", `/contacts/${enc(key)}`, patch)).contato,
    importarContatos: (contatos) => chamar("POST", "/contacts/import", { contatos }),
    apagarContato: async (key) => { await chamar("DELETE", `/contacts/${enc(key)}`); },
    orgs: (o = {}) => chamar("GET", `/orgs${q({ q: o.q, limit: o.limit ?? 1000 })}`),
    org: (key) => chamar<OrgPagina>("GET", `/orgs/${enc(key)}`),
    criarOrg: (dados) => chamar<{ nova: boolean; org: Org }>("POST", "/orgs", dados),
    editarOrg: async (key, patch) => (await chamar<{ org: Org }>("PATCH", `/orgs/${enc(key)}`, patch)).org,
    apagarOrg: async (key) => { await chamar("DELETE", `/orgs/${enc(key)}`); },
    caixasEmAlta: async (limit = 20) => (await chamar<{ boxes: CaixaHome[] }>("GET", `/boxes${q({ ordem: "atividade", limit })}`)).boxes,
  };
}
