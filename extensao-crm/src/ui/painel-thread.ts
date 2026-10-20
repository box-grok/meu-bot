/**
 * Painel lateral por conversa (threadView.addSidebarContentPanel): em qual caixa a conversa está, etapa, campos,
 * comentários; ou "Adicionar a um pipeline". A ficha (`fichaDaCaixa`) é a mesma da rota da caixa.
 */
import type { InboxSDK, ThreadView } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { CaixaFicha, CaixaView, Pipeline } from "../tipos.ts";
import { ROTA_CAIXA, normThreadId, threadIdValido } from "../rotas.ts";
import { corDaEtapa } from "../tema.ts";
import { T } from "../textos.ts";
import { h, limpar } from "./h.ts";
import { editorCampo } from "./campos.ts";
import { sugestoesDaConversa, type Participante } from "../sugestoes.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";

const ICONE = (): string => chrome.runtime.getURL("icones/crm-32.png");
const meuEmailDoSdk = (sdk: InboxSDK): string => { try { return sdk.User.getEmailAddress(); } catch { return ""; } };

/** Ficha de uma caixa (painel compacto ou página completa). */
export function fichaDaCaixa(sdk: InboxSDK, estado: Estado, pipeline: Pipeline, ficha: CaixaFicha, o: { completa: boolean; aoMudar: () => void; threadAtual?: string; participantes?: Participante[] }): HTMLElement {
  const b = ficha.box;
  const salvar = async (patch: Parameters<Estado["atualizarCaixa"]>[1]): Promise<void> => { const sv = sdk.ButterBar.showSaving({ text: T.salvando, confirmationText: T.salvo, showConfirmation: true, confirmationTime: 1500 }); try { await estado.atualizarCaixa(b.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); } o.aoMudar(); };
  const titulo = o.completa ? h("input", { class: "mbcrm-titulo", value: b.name, onChange: (ev: Event) => { const v = (ev.target as HTMLInputElement).value.trim(); if (v !== "" && v !== b.name) void salvar({ name: v }); } }) : h("a", { href: sdk.Router.createLink(ROTA_CAIXA, { key: b.key }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); } }, h("h3", null, b.name));
  const idx = pipeline.stages.findIndex((s) => s.key === b.stageKey);
  const selEtapa = h("select", null, ...pipeline.stages.map((s) => h("option", { value: s.key, selected: s.key === b.stageKey }, s.name)));
  selEtapa.addEventListener("change", () => { void salvar({ stageKey: selEtapa.value }); });
  const campos = h("div", { class: "mbcrm-col" }, ...pipeline.fields.map((f) => h("div", { class: "mbcrm-campo" }, h("label", null, f.name), editorCampo(f, b.fields[f.name] ?? "", (novo) => salvar({ fields: { [f.key]: novo } })))));
  const notas = h("textarea", { placeholder: T.notas, onChange: (ev: Event) => { void salvar({ notes: (ev.target as HTMLTextAreaElement).value }); } }, ficha.notes);
  const conversas = h("div", { class: "mbcrm-col" }, ...ficha.threads.map((t) => h("div", { class: "mbcrm-linha" }, h("a", { class: "mbcrm-cresce", href: sdk.Router.createLink(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }); }, title: t.emails.join(", ") }, t.assunto || t.threadGmailId), h("button", { class: "mbcrm-btn mbcrm-pequeno", title: T.desvincular, onClick: () => { estado.desvincularThread(b.key, t.threadGmailId).then(o.aoMudar, (e) => mostrarErro(sdk, e)); } }, "×"))));
  const contatos = h("div", { class: "mbcrm-linha" }, ...ficha.contatos.map((c) => h("span", { class: "mbcrm-chip", title: [...c.emails, ...c.telefones].join(" · ") }, c.nome || c.emails[0] || c.telefones[0] || "?")));
  // Pessoas desta conversa que ainda não são contatos da caixa: um clique adiciona (como a lateral do Streak).
  const sugestoes = sugestoesDaConversa(o.participantes ?? [], meuEmailDoSdk(sdk), ficha.contatos.flatMap((c) => c.emails));
  const pessoas = sugestoes.length === 0 ? null : h("div", { class: "mbcrm-col" }, h("h2", null, "Pessoas desta conversa"), ...sugestoes.slice(0, 6).map((p) => h("div", { class: "mbcrm-linha" },
    h("span", { class: "mbcrm-cresce", title: p.email }, p.nome ? `${p.nome} · ${p.email}` : p.email),
    h("button", { class: "mbcrm-btn mbcrm-pequeno", title: "Adicionar como contato desta caixa", onClick: (ev: Event) => { (ev.currentTarget as HTMLButtonElement).disabled = true; estado.vincularContato(b.key, { email: p.email, ...(p.nome ? { name: p.nome } : {}) }).then(o.aoMudar, (e) => mostrarErro(sdk, e)); } }, "＋"))));
  const lista = h("div", { class: "mbcrm-col" }, ...ficha.comentarios.slice().reverse().map((c) => h("div", { class: "mbcrm-comentario" }, h("div", { class: "mbcrm-meta" }, `${c.em.replace("T", " ")} · ${c.autor}`), h("div", null, c.texto))));
  const ta = h("textarea", { placeholder: T.escrevaUmComentario, rows: "2" });
  const btn = h("button", { class: "mbcrm-btn mbcrm-primario mbcrm-pequeno", onClick: () => { const t = ta.value.trim(); if (t === "") return; btn.disabled = true; estado.comentar(b.key, t).then(() => { ta.value = ""; o.aoMudar(); }, (e) => mostrarErro(sdk, e)).finally(() => { btn.disabled = false; }); } }, T.comentar);
  return h("div", { class: "mbcrm-col" },
    h("div", { class: "mbcrm-cartao" }, titulo, h("div", { class: "mbcrm-linha" }, h("span", { class: "mbcrm-chip" }, h("span", { class: "mbcrm-ponto", style: { background: corDaEtapa(idx) } }), T.etapa), selEtapa), campos, o.completa ? notas : null, ficha.contatos.length > 0 ? h("div", { class: "mbcrm-col" }, h("h2", null, T.contatos), contatos) : null, pessoas),
    ficha.threads.length > 0 ? h("div", { class: "mbcrm-cartao" }, h("h2", null, T.conversas), conversas) : null,
    h("div", { class: "mbcrm-cartao" }, h("h2", null, T.comentarios), ta, h("div", { class: "mbcrm-linha" }, btn), lista),
  );
}

/** Formulário "Nova caixa" (modal): nome, etapa; opcionalmente vincula a thread. */
export function formularioNovaCaixa(sdk: InboxSDK, estado: Estado, pipeline: Pipeline, thread: { gid: string; assunto: string; emails: string[]; nomes: string[] } | null, feito: (b: CaixaView) => void): Promise<void> {
  return new Promise((resolve) => {
    const nome = h("input", { type: "text", value: thread?.assunto ?? "", placeholder: T.nome, class: "mbcrm-cresce" });
    const etapa = h("select", null, ...pipeline.stages.map((s, i) => h("option", { value: s.key, selected: i === 0 }, s.name)));
    const erro = h("div", { class: "mbcrm-erro" });
    const el = h("div", { class: "mbcrm mbcrm-menu" }, h("div", { class: "mbcrm-campo" }, h("label", null, T.nome), nome), h("div", { class: "mbcrm-campo" }, h("label", null, T.etapa), etapa), erro);
    const modal = sdk.Widgets.showModalView({ el, title: `${T.novaCaixa} · ${pipeline.name}`, buttons: [{ text: T.adicionar, type: "PRIMARY_ACTION", onClick: () => { void criar(); } }] });
    async function criar(): Promise<void> {
      const n = nome.value.trim(); if (n === "") { erro.textContent = "Dê um nome."; return; }
      try {
        const b = await estado.criarCaixa(pipeline.key, { name: n, stageKey: etapa.value });
        if (thread) await estado.vincularThread(b.key, { threadGmailId: thread.gid, assunto: thread.assunto, emails: thread.emails, nomes: thread.nomes });
        modal.close(); feito(b);
      } catch (e) { erro.textContent = textoDoErro(e); }
    }
    modal.on("destroy", () => resolve());
    setTimeout(() => nome.focus(), 50);
  });
}

/** Dropdown/painel "Adicionar a um pipeline": escolhe o pipeline e abre o formulário. */
export async function escolherPipeline(sdk: InboxSDK, estado: Estado, el: HTMLElement, aoEscolher: (p: Pipeline) => void): Promise<void> {
  limpar(el);
  try {
    const ps = await estado.pipelines();
    if (ps.length === 0) { el.append(h("div", { class: "mbcrm-dica" }, T.nenhumPipeline)); return; }
    el.append(h("div", { class: "mbcrm-lista-simples" }, ...ps.map((p) => h("a", { href: "#", onClick: (ev: Event) => { ev.preventDefault(); estado.pipeline(p.key).then(aoEscolher, (e) => mostrarErro(sdk, e)); } }, `${p.name} · ${T.caixas(p.boxes)}`))));
  } catch (e) { el.append(h("div", { class: "mbcrm-erro" }, textoDoErro(e))); }
}

export function registrarPainelThread(sdk: InboxSDK, estado: Estado, tema: () => string): void {
  sdk.Conversations.registerThreadViewHandler((tv: ThreadView) => {
    const el = h("div", { class: `mbcrm mbcrm-painel ${tema()}` }, h("div", { class: "mbcrm-dica" }, T.carregando));
    tv.addSidebarContentPanel({ title: T.crm, iconUrl: ICONE(), el, id: "mbcrm-thread", orderHint: 0, appName: "meu-bot CRM" });
    let gid: string | null = null; let destruido = false; const fechar = estado.abrirVisao();
    const dadosThread = () => ({ gid: gid as string, assunto: tv.getSubject(), emails: [...new Set(tv.getMessageViews().flatMap((m) => { try { return [m.getSender().emailAddress, ...m.getRecipientEmailAddresses()]; } catch { return []; } }))].slice(0, 20), nomes: [...new Set(tv.getMessageViews().map((m) => { try { return m.getSender().name; } catch { return ""; } }).filter(Boolean))].slice(0, 20) });
    /** Remetentes (com nome) e destinatários de todas as mensagens abertas da conversa. */
    async function participantes(): Promise<Participante[]> {
      const out: Participante[] = [];
      for (const m of tv.getMessageViews()) {
        try { const s = m.getSender(); out.push({ email: s.emailAddress, nome: s.name ?? "" }); } catch { /* mensagem recolhida */ }
        try { for (const r of await m.getRecipientsFull()) out.push({ email: r.emailAddress, nome: r.name ?? "" }); } catch { /* sem destinatários */ }
      }
      return out;
    }
    async function render(): Promise<void> {
      if (destruido || gid === null) return;
      el.className = `mbcrm mbcrm-painel ${tema()}`;
      try {
        const caixa = await estado.caixaDaThread(gid);
        if (destruido) return;
        limpar(el);
        if (caixa === null) {
          const alvo = h("div", null);
          el.append(h("div", { class: "mbcrm-dica" }, T.semCaixa), h("h2", null, T.adicionarAoPipeline), alvo);
          await escolherPipeline(sdk, estado, alvo, (p) => { void formularioNovaCaixa(sdk, estado, p, dadosThread(), () => { void render(); }); });
          return;
        }
        const ficha = await estado.caixa(caixa.key); const pipeline = await estado.pipeline(ficha.pipelineKey);
        if (destruido) return;
        limpar(el);
        const ps = await participantes().catch(() => [] as Participante[]);
        if (destruido) return;
        el.append(fichaDaCaixa(sdk, estado, pipeline, ficha, { completa: false, aoMudar: () => { void render(); }, threadAtual: gid, participantes: ps }), h("div", { class: "mbcrm-linha" }, h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: () => { void sdk.Router.goto(ROTA_CAIXA, { key: caixa.key }); } }, T.abrirCaixa)));
      } catch (e) { if (destruido) return; limpar(el); el.append(h("div", { class: "mbcrm-erro" }, textoDoErro(e))); }
    }
    void tv.getThreadIDAsync().then((id) => { if (!threadIdValido(id)) { limpar(el); el.append(h("div", { class: "mbcrm-erro" }, "Não consegui identificar a conversa.")); return; } gid = normThreadId(id); void render(); });
    const off = estado.assinar(({ mudancas, reset }) => { if (reset || mudancas.some((m) => m.thread === gid || m.tipo === "import" || (m.box !== undefined))) void render(); });
    tv.on("destroy", () => { destruido = true; off(); fechar(); });
  });
}
