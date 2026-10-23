/**
 * Página "Conta Google" (login + Gmail + Agenda + Sheets) no visual do meu-bot. A conta mora neste Mac (token cifrado
 * no Keychain, via main › conta-google.ts); aqui só se conecta, lê e escreve. A verificação de telefone/QR, quando o
 * Google pede, é feita pela pessoa na tela oficial. Fábrica com dependências explícitas, como finance-page.ts.
 */
import type { AgendaEvento, GmailResumo, GoogleContaStatus, MeuBotApi, PlanilhaLeitura } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface ContaGoogleDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  api: Pick<MeuBotApi, "googleContaStatus" | "googleContaConectar" | "googleContaDesconectar" | "gmailResumo" | "agendaProximos" | "agendaCriar" | "planilhaLer" | "planilhaEscrever" | "on">;
}

export function mountContaGoogle(deps: ContaGoogleDeps): { open: () => void; refresh: () => Promise<void> } {
  const panel = el("section", "acervo-panel conta-google-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let status: GoogleContaStatus | null = null;
  let gmail: GmailResumo | null = null;
  let agenda: AgendaEvento[] | null = null;
  let planilha: PlanilhaLeitura | null = null;
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  let plId = ""; let plRange = "Página1!A1:C10";
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado) void carregarDados(); } });

  async function refresh(): Promise<void> {
    try { status = await deps.api.googleContaStatus(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
    render();
    if (status?.conectado && !status.precisaReconectar) await carregarDados();
  }
  async function carregarDados(): Promise<void> {
    try { gmail = await deps.api.gmailResumo(); } catch { gmail = null; }
    try { agenda = await deps.api.agendaProximos(7); } catch { agenda = null; }
    render();
  }
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: ipcErrorText(e).replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo"), bad: true }; }
    busy = false; await refresh();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const input = (ph: string, val = "", max = 120): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = ph; i.value = val; i.maxLength = max; i.disabled = busy; return i; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const card = (titulo: string): HTMLElement => { const c = el("div", "admin-card"); c.append(el("strong", "", titulo)); return c; };

  function render(): void {
    panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "conta google"), el("h2", "", "Conta Google"), el("p", "", "Entre com a sua conta do Google para o meu-bot ler seu Gmail e sua Agenda e ler/escrever em planilhas. A conta fica guardada só neste Mac."));
    head.append(hb); panel.append(head);
    if (status === null) { panel.append(el("p", "hint", "Consultando…")); return; }
    if (!status.configurado) { const c = card("Google não configurado neste app"); c.append(el("p", "", "Falta o client OAuth do Google (google-oauth.json) neste build. Instale a versão com o CRM/Google habilitado.")); panel.append(c); return; }

    // Perfil
    const pc = card("Sua conta");
    if (!status.conectado) {
      pc.append(el("p", "hint", "Ao entrar, o login abre no Navegador. Qualquer verificação de telefone é feita por você, no seu celular, na tela do Google."));
      pc.append(btn("Entrar com Google", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "login aberto no Navegador; conclua lá e volte"); }));
    } else {
      const linha = el("div", "conta-perfil");
      // Sempre a `fotoLocal` (data URL): a URL do Google cai no CSP `img-src 'self' data:` e nao carregaria.
      if (status.perfil?.fotoLocal) { const img = el("img", "conta-foto"); img.src = status.perfil.fotoLocal; img.alt = ""; linha.append(img); }
      const info = el("div"); info.append(el("strong", "", status.perfil?.nome ?? "conta conectada"), el("div", "hint", status.perfil?.email ?? ""));
      linha.append(info); pc.append(linha);
      if (status.precisaReconectar) { pc.append(el("p", "hint bad-hint", "Faltam permissões (Gmail, Agenda ou Sheets). Clique em Reconectar para autorizar.")); pc.append(btn("Reconectar", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "reautorização aberta no Navegador"); })); }
      const d = btn("Desconectar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? tira a conta deste Mac", () => { void agir(() => deps.api.googleContaDesconectar(), "conta desconectada"); }); });
      pc.append(d);
    }
    panel.append(pc);
    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (status.conectando) panel.append(el("p", "hint", "Esperando você concluir o login no Navegador…"));
    if (!status.conectado || status.precisaReconectar) return;

    // Gmail
    const gc = card("Gmail");
    if (gmail === null) gc.append(el("p", "hint", "Carregando…"));
    else {
      gc.append(el("p", "hint", `${gmail.email ?? ""} · ${gmail.naoLidas} não ${gmail.naoLidas === 1 ? "lida" : "lidas"} na caixa de entrada`));
      for (const m of gmail.mensagens.slice(0, 8)) { const r = el("div", `conta-msg${m.naoLida ? " nova" : ""}`); r.append(el("strong", "conta-msg-assunto", m.assunto), el("span", "hint conta-msg-de", m.de.replace(/<.*>/, "").trim() || m.de), el("span", "hint conta-msg-resumo", m.resumo.slice(0, 120))); gc.append(r); }
      if (gmail.mensagens.length === 0) gc.append(el("p", "hint", "Nenhuma mensagem recente."));
    }
    panel.append(gc);

    // Agenda
    const ac = card("Agenda (próximos 7 dias)");
    if (agenda === null) ac.append(el("p", "hint", "Carregando…"));
    else if (agenda.length === 0) ac.append(el("p", "hint", "Nenhum evento nos próximos dias."));
    else for (const e of agenda) { const r = el("div", "conta-evento"); r.append(el("strong", "", e.titulo), el("span", "hint", `${fmtData(e.inicio)}${e.local ? " · " + e.local : ""}`)); ac.append(r); }
    const nova = el("div", "admin-actions");
    const et = input("título do evento"); const ei = input("início (ex.: 2026-10-23T14:00:00-03:00)", "", 40); const ef = input("fim", "", 40);
    nova.append(field("Novo evento", et), field("Início", ei), field("Fim", ef), btn("Criar evento", "btn-ghost", () => { if (et.value.trim() === "" || ei.value.trim() === "" || ef.value.trim() === "") return; const b = nova.querySelector("button"); if (b) deps.armConfirm(b as HTMLButtonElement, "Confirmar? cria na sua Agenda", () => { void agir(() => deps.api.agendaCriar({ titulo: et.value, inicio: ei.value, fim: ef.value }), "evento criado"); }); }));
    ac.append(nova); panel.append(ac);

    // Planilha
    const sc = card("Planilha (ler e gravar)");
    sc.append(el("p", "hint", "Cole o id da planilha (da URL, entre /d/ e /edit) e o intervalo (ex.: Página1!A1:C10)."));
    const f = el("div", "admin-actions");
    const id = input("id da planilha", plId); id.addEventListener("input", () => { plId = id.value; });
    const rg = input("intervalo", plRange, 100); rg.addEventListener("input", () => { plRange = rg.value; });
    f.append(field("Planilha", id), field("Intervalo", rg), btn("Ler", "btn-ghost", () => { void agir(async () => { planilha = await deps.api.planilhaLer(id.value.trim(), rg.value.trim()); }, "leitura feita"); }));
    sc.append(f);
    if (planilha !== null) {
      const t = el("table", "conta-tabela");
      for (const linha of planilha.valores.slice(0, 20)) { const tr = el("tr"); for (const c of linha.slice(0, 12)) tr.append(el("td", "", c)); t.append(tr); }
      if (planilha.valores.length === 0) sc.append(el("p", "hint", "Intervalo vazio."));
      else sc.append(t);
    }
    const g = el("div", "admin-actions");
    const cel = input("valor a gravar na 1ª célula do intervalo", "", 200);
    g.append(field("Gravar (teste)", cel), btn("Gravar", "btn-ghost", () => { if (cel.value.trim() === "") return; const b = g.querySelector("button"); if (b) deps.armConfirm(b as HTMLButtonElement, "Confirmar? escreve na planilha", () => { void agir(() => deps.api.planilhaEscrever(id.value.trim(), rg.value.trim(), [[cel.value]]), "gravado"); }); }));
    sc.append(g); panel.append(sc);
  }
  const fmtData = (iso: string): string => { if (iso === "") return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

  const page = deps.definePage("conta-google", "Conta Google", panel, () => { render(); void refresh(); });
  return { open: () => deps.openPage(page), refresh };
}
