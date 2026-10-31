/**
 * Página "Gmail" (31 out): a caixa de entrada da Conta Google da máquina, com busca, leitura e lixeira (desfazível).
 * Recurso Pro, com a trava da Conta Google. O token fica no Mac (main › conta-google.ts); aqui só se lê e se pede.
 * Fábrica com dependências explícitas, como conta-google-page.ts. Saiu do cartão de teste da Conta Google para ter
 * um lugar próprio; o passo seguinte é o agente do chat ler e apagar daqui pela mesma API.
 */
import type { GmailApagado, GmailDetalhe, GmailLista, GmailMensagem, GoogleContaStatus, MeuBotApi } from "../../shared/ipc";
import type { LicenseView, PlanName } from "../../shared/ipc";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface GmailDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  /** Sem conta conectada, a página manda para a Conta Google. */
  openContaGoogle: () => void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  host: () => string;
  license: () => LicenseView | null;
  licenseKnown: () => boolean;
  planoExigido: PlanName;
  produto: string;
  api: Pick<MeuBotApi, "browserRequestPro" | "googleContaStatus" | "googleContaConectar" | "gmailListar" | "gmailLer" | "gmailApagar" | "gmailRestaurar" | "openExternal" | "on">;
}

/** Erros do main em frase: a conta caiu, falta o Pro, ou falta a permissão de escrita (token de antes de 31 out). */
export const erroGmailTexto = (e: unknown): string => ipcErrorText(e)
  .replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo")
  .replace(/^PRO_REQUIRED$/, "esta máquina não tem o plano Pro")
  .replace(/^GMAIL_SEM_PERMISSAO$/, "a autorização desta conta é de antes da lixeira: reconecte a Conta Google uma vez");
/** "Ana Silva <ana@x.com>" → "Ana Silva"; sem nome, o e-mail. */
export const remetenteCurto = (de: string): string => de.replace(/<.*>/, "").replace(/^"|"$/g, "").trim() || de;
/** Data do cabeçalho do e-mail em dd/mm hh:mm (pt-BR); o que não for data fica como veio. */
export const dataCurta = (data: string): string => { if (data === "") return ""; const d = new Date(data); return Number.isNaN(d.getTime()) ? data : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const tamanho = (bytes: number): string => { const kb = bytes / 1024; return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, kb).toFixed(0)} KB`; };

export function mountGmail(deps: GmailDeps): { open: () => void; refresh: () => Promise<void>; repintar: () => void } {
  const panel = el("section", "acervo-panel gmail-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let status: GoogleContaStatus | null = null;
  let lista: GmailLista | null = null; let listaErro: string | null = null;
  let detalhe: GmailDetalhe | null = null; let detalheErro: string | null = null; let abrindo: string | null = null;
  /** A última mensagem que foi para a lixeira por aqui: dá o "Desfazer". */
  let apagado: GmailApagado | null = null;
  let busca = "";
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  let proPedido = false;
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado && !st.precisaReconectar) void carregarLista(); } });

  async function refresh(): Promise<void> {
    try { status = await deps.api.googleContaStatus(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
    render();
    if (status?.conectado && !status.precisaReconectar && lista === null) await carregarLista();
  }
  async function carregarLista(pagina?: string): Promise<void> {
    if (pagina === undefined) { lista = null; listaErro = null; render(); }
    try {
      const r = await deps.api.gmailListar({ busca, max: 20, pagina });
      lista = pagina !== undefined && lista !== null ? { ...r, mensagens: [...lista.mensagens, ...r.mensagens] } : r;
    } catch (e) { if (pagina === undefined) listaErro = erroGmailTexto(e); else msg = { text: erroGmailTexto(e), bad: true }; }
    render();
  }
  async function abrir(id: string): Promise<void> {
    abrindo = id; detalhe = null; detalheErro = null; render();
    try { detalhe = await deps.api.gmailLer(id); } catch (e) { detalheErro = erroGmailTexto(e); }
    render();
  }
  function fechar(): void { detalhe = null; detalheErro = null; abrindo = null; render(); }
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: erroGmailTexto(e), bad: true }; }
    busy = false; render();
  }
  /** Lixeira: tira a mensagem da lista na hora e guarda o "Desfazer"; a lista inteira só recarrega na próxima busca. */
  async function apagar(m: GmailMensagem | GmailDetalhe): Promise<void> {
    await agir(async () => {
      apagado = await deps.api.gmailApagar(m.id);
      if (lista !== null) lista = { ...lista, mensagens: lista.mensagens.filter((x) => x.id !== m.id) };
      if (detalhe?.id === m.id) { detalhe = null; abrindo = null; }
    }, `"${m.assunto}" foi para a lixeira`);
  }
  async function restaurar(): Promise<void> {
    const a = apagado; if (a === null) return;
    await agir(async () => { await deps.api.gmailRestaurar(a.id); apagado = null; }, `"${a.assunto}" voltou da lixeira`);
    await carregarLista();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const card = (titulo: string): HTMLElement => { const c = el("div", "admin-card"); c.append(el("strong", "", titulo)); return c; };

  function render(): void {
    panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "gmail"), el("h2", "", "Gmail"), el("p", "", status !== null ? `A caixa de entrada da Conta Google da máquina ${status.maquina}. Leia, busque e mande para a lixeira; o que vai para a lixeira pode voltar por 30 dias. O acesso fica só neste Mac.` : "A caixa de entrada da Conta Google desta máquina."));
    head.append(hb); panel.append(head);
    // Módulo Pro: sem o plano, a página é o bloqueio (como a Conta Google), com o pedido ao admin.
    if (!deps.licenseKnown()) { panel.append(carregando("Consultando a licença desta máquina…")); return; }
    const acesso = browserAccess(deps.license(), deps.host(), deps.planoExigido, deps.produto);
    if (acesso !== "ok") {
      const t = proBlockText(acesso, deps.license(), "google", deps.produto);
      const c = card(t.title); c.append(el("p", "", t.text));
      const pg = pagamentoDoBloqueio(acesso, deps.license());
      if (pg !== null) c.append(blocoPagamento(pg));
      if (t.askAdmin) {
        const b = btn(proPedido ? "Pedido enviado ao admin ✓" : acesso === "assinatura" ? "Avisar o admin" : acesso === "expired" ? "Pedir a renovação ao admin" : "Pedir o Pro ao admin", "btn-primary", () => { void agir(async () => { await deps.api.browserRequestPro(); proPedido = true; }, "pedido enviado ao admin; assim que ele liberar, esta página abre"); });
        b.disabled = busy || proPedido; c.append(b);
      }
      panel.append(c); if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : ""}`, msg.text)); return;
    }
    if (status === null) { panel.append(carregando("Consultando a Conta Google desta máquina…")); return; }
    if (!status.configurado || !status.conectado || status.precisaReconectar) {
      const c = card(!status.configurado ? "Google ainda não configurado neste app" : !status.conectado ? "Conecte a Conta Google desta máquina" : "A Conta Google precisa reautorizar");
      c.append(el("p", "hint", !status.configurado ? "Este build veio sem o client OAuth do Google. A página Conta Google explica e busca sozinha na release." : !status.conectado ? "O Gmail usa a conta conectada na página Conta Google. Entre lá uma vez e volte aqui." : "Faltam permissões na autorização atual. Reconecte na página Conta Google e volte aqui."));
      const a = el("div", "admin-actions");
      a.append(btn("Abrir a Conta Google", "btn-primary", deps.openContaGoogle));
      if (status.configurado && !status.conectado) a.append(btn("Entrar com Google", "btn-ghost", () => { void agir(() => deps.api.googleContaConectar(), "login aberto no Navegador desta máquina; conclua lá e volte"); }));
      c.append(a); panel.append(c);
      if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
      return;
    }

    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (apagado !== null) {
      const u = el("div", "admin-actions");
      u.append(el("span", "hint", `Na lixeira: "${apagado.assunto}" (${remetenteCurto(apagado.de)})`), btn("Desfazer", "btn-ghost", () => { void restaurar(); }));
      panel.append(u);
    }
    if (abrindo !== null) { renderDetalhe(); return; }

    // Busca: a sintaxe é a do próprio Gmail; vazia, mostra a caixa de entrada.
    const bc = card("Caixa de entrada");
    const form = el("form", "admin-actions");
    const campo = el("label", "admin-field"); const inp = el("input"); inp.type = "search"; inp.placeholder = "buscar como no Gmail: from:ana is:unread has:attachment"; inp.value = busca; inp.maxLength = 200; inp.disabled = busy;
    campo.append(el("span", "hint", "Busca"), inp); form.append(campo);
    form.append(btn("Buscar", "btn-primary", () => { busca = inp.value.trim(); void carregarLista(); }));
    if (busca !== "") form.append(btn("Caixa de entrada", "btn-ghost", () => { busca = ""; void carregarLista(); }));
    form.append(btn("Atualizar", "btn-ghost", () => { void carregarLista(); }));
    form.addEventListener("submit", (ev) => { ev.preventDefault(); busca = inp.value.trim(); void carregarLista(); });
    bc.append(form);
    if (lista === null) {
      if (listaErro === null) bc.append(carregando("Carregando o Gmail…"));
      else bc.append(el("p", "hint bad-hint", `Não deu para ler o Gmail: ${listaErro}`), btn("Tentar de novo", "btn-ghost", () => { void carregarLista(); }));
    } else {
      bc.append(el("p", "hint", `${lista.email ?? ""} · ${lista.naoLidas} não ${lista.naoLidas === 1 ? "lida" : "lidas"} na caixa de entrada${lista.busca !== "" ? ` · busca: ${lista.busca}` : ""}`));
      if (lista.mensagens.length === 0) bc.append(el("p", "hint", lista.busca === "" ? "Nenhuma mensagem na caixa de entrada." : "Nada encontrado com essa busca."));
      for (const m of lista.mensagens) {
        const r = el("div", `conta-msg gmail-msg${m.naoLida ? " nova" : ""}`); r.tabIndex = 0; r.setAttribute("role", "button"); r.title = "Abrir a mensagem";
        const topo = el("div", "gmail-msg-topo"); topo.append(el("span", "hint conta-msg-de", remetenteCurto(m.de)), el("span", "hint gmail-msg-data", dataCurta(m.data)));
        r.append(topo, el("strong", "conta-msg-assunto", m.assunto), el("span", "hint conta-msg-resumo", m.resumo.slice(0, 140)));
        const ir = (): void => { void abrir(m.id); };
        r.addEventListener("click", ir); r.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ir(); } });
        bc.append(r);
      }
      if (lista.proxima !== null) { const pr = lista.proxima; bc.append(btn("Mais mensagens", "btn-ghost", () => { void carregarLista(pr); })); }
    }
    panel.append(bc);
  }

  function renderDetalhe(): void {
    const dc = card(detalhe?.assunto ?? "Mensagem");
    const acoes = el("div", "admin-actions");
    acoes.append(btn("← Voltar", "btn-ghost", fechar));
    if (detalhe === null) {
      dc.append(acoes);
      if (detalheErro === null) dc.append(carregando("Abrindo a mensagem…"));
      else dc.append(el("p", "hint bad-hint", `Não deu para abrir: ${detalheErro}`));
      panel.append(dc); return;
    }
    const d = detalhe;
    dc.append(el("p", "hint", `De: ${d.de}`), el("p", "hint", `Para: ${d.para || "(sem destinatário)"}`), el("p", "hint", `Data: ${dataCurta(d.data)}${d.naoLida ? " · não lida" : ""}`));
    if (d.anexos.length > 0) dc.append(el("p", "hint", `Anexos: ${d.anexos.map((a) => `${a.nome} (${tamanho(a.bytes)})`).join(", ")} · abra no Gmail para baixar`));
    dc.append(el("pre", "gmail-corpo", d.corpo === "" ? "(sem texto; a mensagem pode ser só imagem ou anexo)" : d.corpo));
    if (d.truncado) dc.append(el("p", "hint", "A mensagem é longa e foi cortada aqui; abra no Gmail para ver inteira."));
    acoes.append(btn("Abrir no Gmail", "btn-ghost", () => { void deps.api.openExternal(d.link); }));
    if (status?.gmailEscreve) { const lx = btn("Mover para a lixeira", "btn-ghost", () => { deps.armConfirm(lx, "Confirmar? vai para a lixeira (dá para desfazer)", () => { void apagar(d); }); }); acoes.append(lx); }
    else acoes.append(btn("Reconectar para poder apagar", "btn-ghost", () => { void agir(() => deps.api.googleContaConectar(), "reautorização aberta no Navegador; conclua lá e volte"); }));
    dc.append(acoes);
    panel.append(dc);
  }

  const page = deps.definePage("gmail", "Gmail", panel, () => { render(); void refresh(); });
  // `repintar`: a licença chegou depois de a página abrir (ela mostrava "consultando a licença").
  return { open: () => deps.openPage(page), refresh, repintar: () => { if (!panel.hidden) render(); } };
}
