/**
 * Estado da extensão (puro, testável): caches de pipelines, caixas e threads; dedupe de pedidos em voo; lote de
 * threads com concorrência limitada; feed de mudanças por polling (5 s com visão CRM aberta, 30 s de resto,
 * pausa com a aba escondida, recuo após falhas); escritas otimistas com rollback. Tudo o que fala com o host
 * passa pelo `api`; relógio e timer injetáveis.
 */
import type { ApiCrm } from "./api.ts";
import { ErroCrm } from "./api.ts";
import type { CaixaFicha, CaixaHome, CaixaResumo, CaixaView, Comentario, Etapa, Feed, Mudanca, Pipeline, PipelineResumo, ThreadLookup } from "./tipos.ts";

export interface Deps {
  api: ApiCrm;
  agora?: () => number;
  /** Agenda `fn` daqui a `ms`; devolve o cancelamento. Padrão: setTimeout. */
  timer?: (fn: () => void, ms: number) => () => void;
  /** A aba está escondida? Padrão: document.hidden. */
  escondida?: () => boolean;
  /** Quem está usando (o Gmail aberto): vira responsável das caixas que cria. */
  eu?: () => { email: string; nome: string } | null;
}
export type Conexao = "ok" | "proxy-fora" | "host-fora" | "nao-autorizado" | "assinatura" | "desconhecida";
export interface Ouvinte { (ev: { mudancas: Mudanca[]; reset: boolean; conexao: Conexao }): void }
const TTL_THREAD = 60_000;
const CONC = 6;

export function criarEstado(d: Deps) {
  const agora = d.agora ?? (() => Date.now());
  const timer = d.timer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const escondida = d.escondida ?? (() => typeof document !== "undefined" && document.hidden);
  const pipelines = new Map<string, Pipeline>();
  let listaPipelines: PipelineResumo[] | null = null;
  const caixas = new Map<string, CaixaFicha>();
  const threads = new Map<string, { key: string | null; em: number }>();
  const emVoo = new Map<string, Promise<unknown>>();
  const ouvintes = new Set<Ouvinte>();
  let seq = 0; let visoes = 0; let cancelar: (() => void) | null = null; let falhas = 0; let conexao: Conexao = "desconhecida"; let rodando = false;

  const avisar = (mudancas: Mudanca[], reset = false): void => { for (const o of ouvintes) { try { o({ mudancas, reset, conexao }); } catch { /* ouvinte não derruba o resto */ } } };
  const dedupe = <T>(k: string, fn: () => Promise<T>): Promise<T> => { const v = emVoo.get(k); if (v) return v as Promise<T>; const p = fn().finally(() => emVoo.delete(k)); emVoo.set(k, p); return p; };
  const conexaoDe = (e: unknown): Conexao => (e instanceof ErroCrm && (e.tipo === "proxy-fora" || e.tipo === "host-fora" || e.tipo === "nao-autorizado" || e.tipo === "assinatura") ? e.tipo : "ok");
  async function tentar<T>(fn: () => Promise<T>): Promise<T> {
    try { const r = await fn(); if (conexao !== "ok") { conexao = "ok"; falhas = 0; avisar([]); } return r; }
    catch (e) { const c = conexaoDe(e); if (c !== "ok" && c !== conexao) { conexao = c; avisar([]); } throw e; }
  }

  /** Invalida o que uma leva de mudanças afetou (e nada mais). */
  function aplicarMudancas(feed: Feed): void {
    if (feed.reset === true) { pipelines.clear(); listaPipelines = null; caixas.clear(); threads.clear(); seq = feed.seq; avisar([], true); return; }
    for (const m of feed.mudancas) {
      if (m.tipo.startsWith("pipeline.") || m.tipo === "import") { if (m.pipeline) pipelines.delete(m.pipeline); listaPipelines = null; }
      if (m.tipo === "import") { caixas.clear(); threads.clear(); }
      if (m.box) { caixas.delete(m.box); for (const [g, t] of threads) if (t.key === m.box || m.tipo === "box.thread") threads.delete(g); if (m.tipo === "box.delete") for (const [g, t] of threads) if (t.key === m.box) threads.delete(g); }
      if (m.tipo === "box.thread" && m.thread) threads.delete(m.thread);
      if (m.tipo === "box.create") listaPipelines = null;
    }
    if (feed.seq > seq) seq = feed.seq;
    if (feed.mudancas.length > 0) avisar(feed.mudancas);
  }

  async function poll(): Promise<void> {
    if (!rodando) return;
    cancelar = null;
    let ms = visoes > 0 ? 5000 : 30_000;
    if (!escondida()) {
      try { const feed = await tentar(() => d.api.mudancas(seq)); aplicarMudancas(feed); falhas = 0; }
      catch { falhas++; ms = Math.min(60_000, 10_000 * falhas); }
    }
    if (rodando) cancelar = timer(() => { void poll(); }, ms);
  }

  return {
    get seq() { return seq; },
    get conexao() { return conexao; },
    assinar(fn: Ouvinte): () => void { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; },
    /** Uma visão CRM (rota ou painel) está aberta: polling mais curto. Devolve o fechar(). */
    abrirVisao(): () => void { visoes++; return () => { visoes = Math.max(0, visoes - 1); }; },
    iniciarPolling(): void { if (rodando) return; rodando = true; void poll(); },
    pararPolling(): void { rodando = false; if (cancelar) { cancelar(); cancelar = null; } },
    aplicarMudancas,
    async pipelines(): Promise<PipelineResumo[]> { if (listaPipelines) return listaPipelines; return dedupe("pipelines", async () => { listaPipelines = await tentar(() => d.api.pipelines()); return listaPipelines; }); },
    async pipeline(key: string): Promise<Pipeline> { const c = pipelines.get(key); if (c) return c; return dedupe(`p:${key}`, async () => { const p = await tentar(() => d.api.pipeline(key)); pipelines.set(key, p); return p; }); },
    async caixasDoPipeline(key: string, o: { etapa?: string; q?: string; limit?: number } = {}): Promise<{ boxes: CaixaResumo[]; total: number; stages: Etapa[] }> { return tentar(() => d.api.caixas(key, o)); },
    async caixa(key: string): Promise<CaixaFicha> { const c = caixas.get(key); if (c) return c; return dedupe(`b:${key}`, async () => { const f = await tentar(() => d.api.caixa(key)); caixas.set(key, f); return f; }); },
    async caixaDaThread(gid: string): Promise<CaixaView | null> {
      const c = threads.get(gid);
      if (c && agora() - c.em < TTL_THREAD) return c.key === null ? null : (await this.caixa(c.key)).box;
      return dedupe(`t:${gid}`, async () => { const r = await tentar(() => d.api.caixaDaThread(gid)); threads.set(gid, { key: r?.box.key ?? null, em: agora() }); if (r) caixas.delete(r.box.key); return r?.box ?? null; });
    },
    /** Muitas threads de uma vez (linhas da lista): lote no host, só as que faltam no cache. */
    async caixasDasThreads(gids: string[]): Promise<Map<string, ThreadLookup | null>> {
      const out = new Map<string, ThreadLookup | null>(); const faltam: string[] = [];
      for (const g of gids) { const c = threads.get(g); if (c && agora() - c.em < TTL_THREAD && c.key === null) out.set(g, null); else faltam.push(g); }
      for (let i = 0; i < faltam.length; i += 200) {
        const parte = faltam.slice(i, i + 200);
        const r = await dedupe(`lk:${parte.join(",")}`, () => tentar(() => d.api.lookupThreads(parte)));
        for (const g of parte) { const hit = r[g] ?? null; out.set(g, hit); threads.set(g, { key: hit?.key ?? null, em: agora() }); }
      }
      return out;
    },
    /** Fila com concorrência limitada para pedidos por linha (quando o lote não cabe). */
    fila<T>(itens: T[], fn: (x: T) => Promise<void>): Promise<void> { let i = 0; return Promise.all(Array.from({ length: Math.min(CONC, itens.length) }, async () => { while (i < itens.length) { const x = itens[i++] as T; try { await fn(x); } catch { /* por item */ } } })).then(() => undefined); },
    async criarPipeline(dados: { name: string; stages: string[] }): Promise<Pipeline> { const p = await tentar(() => d.api.criarPipeline(dados)); listaPipelines = null; pipelines.set(p.key, p); avisar([{ seq, at: agora(), tipo: "pipeline.create", pipeline: p.key, por: "extensao" }]); return p; },
    async atualizarPipeline(key: string, patch: { name?: string; stages?: { key?: string; name: string }[]; fields?: { key?: string; name: string; type?: string; options?: { key?: string; name: string }[] }[]; moverPara?: string }): Promise<Pipeline> { const p = await tentar(() => d.api.atualizarPipeline(key, patch)); listaPipelines = null; pipelines.set(p.key, p); avisar([{ seq, at: agora(), tipo: "pipeline.update", pipeline: p.key, por: "extensao" }]); return p; },
    async apagarPipeline(key: string): Promise<void> { await tentar(() => d.api.apagarPipeline(key)); listaPipelines = null; pipelines.delete(key); avisar([{ seq, at: agora(), tipo: "pipeline.delete", pipeline: key, por: "extensao" }]); },
    async criarCaixa(pipeline: string, dados: { name: string; stageKey?: string; notes?: string; fields?: Record<string, unknown>; email?: string; phone?: string; contactName?: string; responsaveis?: { email: string; nome?: string }[] }): Promise<CaixaView> { const eu = d.eu?.() ?? null; const b = await tentar(() => d.api.criarCaixa(pipeline, dados.responsaveis === undefined && eu !== null ? { ...dados, responsaveis: [eu] } : dados)); listaPipelines = null; return b; },
    /** Otimista: muda o cache, avisa, grava; em erro restaura e relança. */
    async atualizarCaixa(key: string, patch: { name?: string; notes?: string; stageKey?: string; fields?: Record<string, unknown>; responsaveis?: { email: string; nome?: string }[] }, otimista?: (f: CaixaFicha) => CaixaFicha): Promise<CaixaView> {
      const antes = caixas.get(key);
      if (antes && otimista) { caixas.set(key, otimista(antes)); avisar([{ seq, at: agora(), tipo: "box.update", box: key, por: "extensao" }]); }
      try { const b = await tentar(() => d.api.atualizarCaixa(key, patch)); const f = caixas.get(key); if (f) caixas.set(key, { ...f, box: b }); return b; }
      catch (e) { if (antes) { caixas.set(key, antes); avisar([{ seq, at: agora(), tipo: "box.update", box: key, por: "extensao" }]); } throw e; }
    },
    async apagarCaixa(key: string): Promise<void> { await tentar(() => d.api.apagarCaixa(key)); caixas.delete(key); listaPipelines = null; for (const [g, t] of threads) if (t.key === key) threads.delete(g); avisar([{ seq, at: agora(), tipo: "box.delete", box: key, por: "extensao" }]); },
    async vincularContato(box: string, dados: { key?: string; name?: string; email?: string; phone?: string }): Promise<void> { await tentar(() => d.api.vincularContato(box, dados)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); },
    async desvincularContato(box: string, contato: string): Promise<void> { await tentar(() => d.api.desvincularContato(box, contato)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); },
    async comentar(key: string, texto: string): Promise<Comentario> { const c = await tentar(() => d.api.comentar(key, texto)); const f = caixas.get(key); if (f) caixas.set(key, { ...f, comentarios: [...f.comentarios, c] }); avisar([{ seq, at: agora(), tipo: "box.comment", box: key, por: "extensao" }]); return c; },
    async vincularThread(key: string, t: { threadGmailId: string; assunto?: string; emails?: string[]; nomes?: string[] }): Promise<void> { await tentar(() => d.api.vincularThread(key, t)); threads.set(t.threadGmailId, { key, em: agora() }); caixas.delete(key); avisar([{ seq, at: agora(), tipo: "box.thread", box: key, thread: t.threadGmailId, por: "extensao" }]); },
    async desvincularThread(key: string, gid: string): Promise<void> { await tentar(() => d.api.desvincularThread(key, gid)); threads.set(gid, { key: null, em: agora() }); caixas.delete(key); avisar([{ seq, at: agora(), tipo: "box.thread", box: key, thread: gid, por: "extensao" }]); },
    invalidarCaixa(key: string): void { caixas.delete(key); },
    async editarComentario(box: string, key: string, texto: string): Promise<void> { await tentar(() => d.api.editarComentario(box, key, texto)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.comment", box, por: "extensao" }]); },
    async apagarComentario(box: string, key: string): Promise<void> { await tentar(() => d.api.apagarComentario(box, key)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.comment", box, por: "extensao" }]); },
    conversasWhatsapp: () => tentar(() => d.api.conversasWhatsapp()),
    abrirWhatsapp: (telefone: string) => tentar(() => d.api.abrirWhatsapp(telefone)),
    async google(acao: Parameters<ApiCrm["google"]>[0]) { const r = await tentar(() => d.api.google(acao)); if (acao === "sincronizar" || acao === "conectar") avisar([{ seq, at: agora(), tipo: "contato.create", por: "extensao" }]); return r; },
    async gerarResumo(box: string) { const r = await tentar(() => d.api.gerarResumo(box)); const f = caixas.get(box); if (f) caixas.set(box, { ...f, resumoIA: r }); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); return r; },
    async enviarArquivo(box: string, a: Parameters<ApiCrm["enviarArquivo"]>[1]) { const r = await tentar(() => d.api.enviarArquivo(box, a)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); return r; },
    baixarArquivo: (box: string, key: string) => tentar(() => d.api.baixarArquivo(box, key)),
    baixarArquivoContato: (contato: string, key: string) => tentar(() => d.api.baixarArquivoContato(contato, key)),
    async apagarArquivo(box: string, key: string): Promise<void> { await tentar(() => d.api.apagarArquivo(box, key)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); },
    async vincularOrg(box: string, org: string): Promise<void> { await tentar(() => d.api.vincularOrg(box, org)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); },
    async desvincularOrg(box: string, org: string): Promise<void> { await tentar(() => d.api.desvincularOrg(box, org)); caixas.delete(box); avisar([{ seq, at: agora(), tipo: "box.update", box, por: "extensao" }]); },
    caixasPorChave: (keys: string[]): Promise<CaixaHome[]> => tentar(() => d.api.caixasPorChave(keys)),
    caixasEmAlta: (limit?: number): Promise<CaixaHome[]> => tentar(() => d.api.caixasEmAlta(limit)),
    /** Contatos e organizações: sem cache (listas pequenas; as páginas recarregam no feed). Escritas avisam os ouvintes. */
    contatos: (o?: Parameters<ApiCrm["contatos"]>[0]) => tentar(() => d.api.contatos(o)),
    contato: (key: string) => tentar(() => d.api.contato(key)),
    orgs: (o?: Parameters<ApiCrm["orgs"]>[0]) => tentar(() => d.api.orgs(o)),
    org: (key: string) => tentar(() => d.api.org(key)),
    async criarContato(dados: Parameters<ApiCrm["criarContato"]>[0]): Promise<string> { const k = await tentar(() => d.api.criarContato(dados)); avisar([{ seq, at: agora(), tipo: "contato.create", contato: k, por: "extensao" }]); return k; },
    async editarContato(key: string, patch: Parameters<ApiCrm["editarContato"]>[1]) { const c = await tentar(() => d.api.editarContato(key, patch)); avisar([{ seq, at: agora(), tipo: "contato.update", contato: key, por: "extensao" }]); return c; },
    async importarContatos(cs: Parameters<ApiCrm["importarContatos"]>[0]) { const r = await tentar(() => d.api.importarContatos(cs)); avisar([{ seq, at: agora(), tipo: "contato.create", por: "extensao" }]); return r; },
    async apagarContato(key: string): Promise<void> { await tentar(() => d.api.apagarContato(key)); caixas.clear(); avisar([{ seq, at: agora(), tipo: "contato.delete", contato: key, por: "extensao" }]); },
    async criarOrg(dados: Parameters<ApiCrm["criarOrg"]>[0]) { const r = await tentar(() => d.api.criarOrg(dados)); avisar([{ seq, at: agora(), tipo: "org.create", por: "extensao" }]); return r; },
    async editarOrg(key: string, patch: Parameters<ApiCrm["editarOrg"]>[1]) { const o = await tentar(() => d.api.editarOrg(key, patch)); avisar([{ seq, at: agora(), tipo: "org.update", por: "extensao" }]); return o; },
    async apagarOrg(key: string): Promise<void> { await tentar(() => d.api.apagarOrg(key)); avisar([{ seq, at: agora(), tipo: "org.delete", por: "extensao" }]); },
  };
}
export type Estado = ReturnType<typeof criarEstado>;
