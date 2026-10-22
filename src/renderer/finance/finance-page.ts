/**
 * Página "Finanças" (produto meu-bot-finance), no visual do meu-bot: o que o agente lançou pelo WhatsApp e pelo chat,
 * o que depende da pessoa (checklist do mês: pendências, renda, dinheiro vivo, fechar o mês anterior), contas e o
 * mês por categoria. Os números moram na máquina (/v1/finance pelo túnel, via main › finance-local.ts); aqui só se
 * mostra e se pede. Fábrica com dependências explícitas, como admin/produtos-page.ts.
 */
import type { BackendModel, FinanceCategoria, FinanceInfo, FinanceLancamento, LicenseView, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { financeOk, proBlockText } from "../lib/pro.js";

export interface FinancePageDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  api: Pick<MeuBotApi, "financeInfo" | "financeLancamentos" | "financeCategorias" | "financeLancar" | "financeConfirmar" | "financeDescartar" | "financeCorrigir" | "financeComprovante" | "financeConfirmarTodas" | "financeContaCriar" | "financeMes" | "financeFecharMes" | "installFinance" | "financePedir" | "on">;
  host(): string;
  license(): LicenseView | null;
  /** A licença desta janela já foi lida (antes disso, nada de bloqueio precipitado). */
  licenseKnown(): boolean;
  goToChat(message: string, hint: string, model?: BackendModel): Promise<void>;
  /** Avisa a janela (tutorial 14, contador da lateral) quando o estado muda. */
  onInfo(info: FinanceInfo | null): void;
}

const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", foto: "foto", chat: "chat", app: "app", agente: "agente" };
const TIPOS: [string, string][] = [["corrente", "Conta corrente"], ["cartao", "Cartão de crédito"], ["poupanca", "Poupança"], ["dinheiro", "Dinheiro vivo"], ["outra", "Outra"]];
const dataCurta = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const brl = (cent: number): string => (cent / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function mountFinancePage(deps: FinancePageDeps): { open: () => void; refresh: () => Promise<void>; info: () => FinanceInfo | null } {
  const panel = el("section", "acervo-panel finance-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let info: FinanceInfo | null = null;
  let ultimos: FinanceLancamento[] = [];
  let pendentes: FinanceLancamento[] = [];
  let categorias: FinanceCategoria[] = [];
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  let instLog: string[] = []; let instalando = false;
  deps.api.on("finance:progress", ({ line }) => { instLog = [...instLog, line].slice(-6); if (!panel.hidden) render(); });

  async function refresh(): Promise<void> {
    if (!financeOk(deps.license(), deps.host())) { info = null; deps.onInfo(null); render(); return; }
    try {
      info = await deps.api.financeInfo();
      if (info.estado !== null) {
        const [l, p, c] = await Promise.all([deps.api.financeLancamentos({ limite: 15 }), deps.api.financeLancamentos({ status: "pendente", limite: 100 }), categorias.length > 0 ? Promise.resolve(categorias) : deps.api.financeCategorias()]);
        ultimos = l.lancamentos; pendentes = p.lancamentos; categorias = c;
      }
    } catch (e) { info = { modulo: null, estado: null, erro: ipcErrorText(e) }; }
    deps.onInfo(info);
    render();
  }
  /** Roda uma ação, mostra o resultado e relê tudo. */
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: ipcErrorText(e).replace(/^FINANCE_REQUIRED$/, "o financeiro não está liberado nesta máquina"), bad: true }; }
    busy = false; await refresh();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const input = (placeholder: string, value = "", max = 80): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = placeholder; i.value = value; i.maxLength = max; i.disabled = busy; return i; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const selectCategoria = (atual: string, renda: boolean): HTMLSelectElement => {
    const s = el("select"); s.disabled = busy;
    for (const c of categorias.filter((x) => x.renda === renda)) { const o = el("option", "", c.nome); o.value = c.key; if (c.key === atual) o.selected = true; s.append(o); }
    return s;
  };
  /** Cartões recolhíveis (Contas, Lançar à mão): fechados por padrão; o que a pessoa abriu continua aberto ao repintar. */
  const abertos = new Set<string>();
  const dobra = (id: string, titulo: string, resumo?: string): HTMLElement => {
    const d = el("details", "admin-card admin-logs-card finance-dobra"); d.open = abertos.has(id);
    const sm = el("summary", "admin-card-head"); sm.append(el("strong", "", titulo)); if (resumo) sm.append(el("span", "hint", resumo));
    d.append(sm);
    d.addEventListener("toggle", () => { if (d.open) abertos.add(id); else abertos.delete(id); });
    return d;
  };
  const card = (titulo: string, extra?: HTMLElement): HTMLElement => { const c = el("div", "admin-card"); const h = el("div", "admin-card-head"); h.append(el("strong", "", titulo)); if (extra) h.append(extra); c.append(h); return c; };

  /** Lançamento aberto (detalhe e edição) e as fotos de comprovante já lidas da máquina (sha256 → data URL). */
  let aberto: string | null = null;
  const fotos = new Map<string, string | null>();
  const contasDe = (): { key: string; nome: string }[] => info?.estado?.contas ?? [];
  const dataBr = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const ORIGEM_LONGA: Record<string, string> = { whatsapp: "WhatsApp (o agente lançou)", foto: "foto de comprovante", chat: "chat do app", app: "lançado à mão no app", agente: "o agente lançou" };
  const DUVIDA: Record<string, string> = { categoria: "categoria incerta", valor: "valor lido de foto", duplicado: "parece repetido", conta: "sem conta" };

  /** Detalhe de um lançamento: tudo o que se sabe dele, a foto do comprovante (se houver) e a edição de cada campo. */
  function detalhe(l: FinanceLancamento): HTMLElement {
    const box = el("div", "finance-detalhe");
    const meta = el("p", "hint");
    meta.textContent = [`Origem: ${ORIGEM_LONGA[l.origem] ?? l.origem}`, l.status === "pendente" ? "pendente" : "confirmado", ...l.duvidas.map((d) => DUVIDA[d] ?? d)].join(" · ");
    box.append(meta);
    if (l.midia) {
      const foto = fotos.get(l.midia.sha256);
      if (foto === undefined) { box.append(el("p", "hint", "Carregando o comprovante…")); void deps.api.financeComprovante(l.midia.sha256).then((u) => { fotos.set(l.midia!.sha256, u); render(); }).catch(() => { fotos.set(l.midia!.sha256, null); render(); }); }
      else if (foto === null) box.append(el("p", "hint bad-hint", "A foto do comprovante não está mais na máquina."));
      else { const img = el("img", "finance-foto"); img.src = foto; img.alt = `Comprovante: ${l.midia.nome}`; img.addEventListener("click", () => img.classList.toggle("grande")); box.append(img); }
    }
    const f = el("div", "admin-actions");
    const valor = input("48,90", (Math.abs(l.valorCent) / 100).toFixed(2).replace(".", ","), 20);
    const data = input("dd/mm/aaaa", dataBr(l.data), 12);
    const fav = input("onde / de quem", l.favorecido);
    const cat = selectCategoria(l.categoria, l.valorCent > 0);
    const conta = el("select"); conta.disabled = busy;
    for (const c of [{ key: "", nome: "sem conta" }, ...contasDe()]) { const o = el("option", "", c.nome); o.value = c.key; if ((l.conta ?? "") === c.key) o.selected = true; conta.append(o); }
    const notas = input("notas (opcional)", l.notas ?? "", 500);
    f.append(field("Valor", valor), field("Data", data), field("Onde", fav), field("Categoria", cat), field("Conta", conta), field("Notas", notas));
    box.append(f);
    const acoes = el("div", "admin-actions");
    acoes.append(btn("Salvar", "btn-primary", () => {
      const patch: { valor?: string; favorecido?: string; categoria?: string; conta?: string | null; data?: string; notas?: string } = {};
      if (valor.value.trim() !== "" && valor.value.trim() !== (Math.abs(l.valorCent) / 100).toFixed(2).replace(".", ",")) patch.valor = valor.value.trim();
      if (data.value.trim() !== dataBr(l.data)) patch.data = data.value.trim();
      if (fav.value.trim() !== l.favorecido) patch.favorecido = fav.value.trim();
      if (cat.value !== l.categoria) patch.categoria = cat.value;
      if (conta.value !== (l.conta ?? "")) patch.conta = conta.value === "" ? null : conta.value;
      if (notas.value.trim() !== (l.notas ?? "")) patch.notas = notas.value.trim();
      if (Object.keys(patch).length === 0) { aberto = null; render(); return; }
      void agir(() => deps.api.financeCorrigir(l.id, patch), "lançamento corrigido");
    }));
    if (l.status === "pendente") acoes.append(btn("Confirmar", "btn-ghost", () => { void agir(() => deps.api.financeConfirmar(l.id, cat.value), "confirmado"); }));
    const d = btn("Descartar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? apaga o lançamento", () => { aberto = null; void agir(() => deps.api.financeDescartar(l.id), "lançamento descartado"); }); });
    acoes.append(d, btn("Fechar", "btn-ghost", () => { aberto = null; render(); }));
    box.append(acoes);
    return box;
  }

  function linhaLanc(l: FinanceLancamento, comAcoes: boolean): HTMLElement {
    const wrap = el("div", "finance-item");
    const row = el("div", `finance-row${l.status === "pendente" ? " pendente" : ""}${aberto === l.id ? " aberto" : ""}`);
    wrap.append(row);
    const main = el("div", "finance-row-main finance-clicavel");
    main.tabIndex = 0; main.setAttribute("role", "button"); main.title = "Ver detalhes e editar";
    const alternar = (): void => { aberto = aberto === l.id ? null : l.id; render(); };
    main.addEventListener("click", alternar);
    main.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); } });
    main.append(el("span", "finance-data", dataCurta(l.data)), el("strong", "finance-fav", l.favorecido || "(sem nome)"), el("span", "hint finance-meta", [l.categoriaNome, l.contaNome, ORIGEM[l.origem] ?? l.origem].filter(Boolean).join(" · ")));
    if (l.midia) main.append(el("span", "finance-clip", "📎"));
    row.append(main, el("span", `finance-valor ${l.valorCent < 0 ? "gasto" : "renda"}`, l.valor));
    if (comAcoes) {
      const acoes = el("div", "finance-acoes");
      if (l.duplicadoDe) acoes.append(el("span", "hint bad-hint", "parece repetido"));
      const sel = selectCategoria(l.categoria, l.valorCent > 0);
      acoes.append(sel, btn("Confirmar", "btn-primary", () => { void agir(() => deps.api.financeConfirmar(l.id, sel.value), `confirmado em ${sel.selectedOptions[0]?.textContent ?? ""}`); }));
      const d = btn("Descartar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? apaga o lançamento", () => { void agir(() => deps.api.financeDescartar(l.id), "lançamento descartado"); }); });
      acoes.append(d);
      row.append(acoes);
    }
    if (aberto === l.id) wrap.append(detalhe(l));
    return wrap;
  }

  function render(): void {
    panel.replaceChildren();
    const e = info?.estado ?? null;
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "financeiro"), el("h2", "", e !== null ? `Finanças · ${e.resumo.nome}` : "Finanças"), el("p", "", "O agente lança o que você conta no WhatsApp ou no chat (e o que você fotografa). Aqui você confere, corrige e faz só o que depende de você."));
    head.append(hb); panel.append(head);
    const host = deps.host();
    if (!deps.licenseKnown()) { panel.append(el("p", "hint", "Consultando a licença desta máquina…")); return; }
    if (!financeOk(deps.license(), host)) {
      const t = proBlockText(host === "local" ? "unknown" : "assinatura", deps.license(), "finance", "meu-bot-finance");
      const c = card(host === "local" ? "O financeiro mora numa máquina" : t.title);
      c.append(el("p", "", host === "local" ? "Abra uma janela numa máquina por SSH (é lá que ficam o agente do WhatsApp e os seus dados)." : t.text));
      if (host !== "local" && t.askAdmin) c.append(btn("Pedir ao admin", "btn-primary", () => { void agir(() => deps.api.financePedir(), "pedido enviado ao admin; assim que ele liberar, esta página abre") }));
      panel.append(c); if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : ""}`, msg.text)); return;
    }
    const topo = el("div", "admin-actions");
    topo.append(btn(busy ? "Atualizando…" : "Atualizar", "btn-ghost", () => { void refresh(); }), btn("Lançar pelo chat", "btn-ghost", () => { void deps.goToChat("gastei 48 no mercado", "O agente usa o financeiro desta máquina: lança, categoriza e responde. Troque pelo seu gasto de verdade.", "agente"); }));
    panel.append(topo);
    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (info === null) { panel.append(el("p", "hint", "Consultando o financeiro desta máquina…")); return; }
    if (info.modulo === false || (info.modulo === null && e === null)) {
      const c = card("Ativar o financeiro nesta máquina");
      c.append(el("p", "", "Instala na máquina a ferramenta do agente e o financeiro do WhatsApp. Seus dados ficam só nela."));
      c.append(btn(instalando ? "Instalando…" : "Ativar agora", "btn-primary", () => { instalando = true; instLog = []; void agir(async () => { try { const r = await deps.api.installFinance(); if (!r.ok) throw new Error(r.log.at(-1) ?? "a instalação falhou"); } finally { instalando = false; } }, "financeiro ativado") }));
      if (instLog.length > 0) c.append(el("pre", "admin-logs", instLog.join("\n")));
      panel.append(c);
    }
    if (e === null) { if (info.erro) panel.append(el("p", "hint bad-hint", info.erro)); return; }

    // Checklist do mês: só o que depende da pessoa.
    const ck = card(`O que depende de você em ${e.resumo.nome}`);
    const lista = el("ul", "admin-health finance-checklist");
    for (const it of e.checklist) {
      const li = el("li", it.feito ? "ok" : ""); li.append(el("span", "", it.titulo));
      if (it.id === "orcamento") {
        // Quanto gastar no mês: vale para os meses seguintes até mudar (o mês novo já começa com ele).
        const o = e.resumo.orcamento;
        const v = input("ex.: 3.000", "", 20);
        li.append(v, btn(o === null ? "Definir orçamento" : "Mudar", "btn-ghost", () => { if (v.value.trim() === "") return; void agir(() => deps.api.financeMes(e.mes, { orcamento: v.value }), "orçamento do mês salvo"); }));
      }
      if (!it.feito && it.id === "dinheiro") li.append(btn("Nada em dinheiro este mês", "btn-ghost", () => { void agir(() => deps.api.financeMes(e.mes, { dinheiroInformado: true }), "anotado") }), btn("Contar ao agente", "btn-ghost", () => { void deps.goToChat("Este mês gastei em dinheiro: ", "Complete com os gastos em dinheiro vivo (ex.: 20 na feira, 15 no estacionamento); o agente lança cada um.", "agente"); }));
      if (!it.feito && it.id === "fechar") li.append(btn(`Fechar ${e.mesAnterior.slice(5, 7)}/${e.mesAnterior.slice(0, 4)}`, "btn-ghost", () => { void agir(() => deps.api.financeFecharMes(e.mesAnterior), "mês fechado") }));
      lista.append(li);
    }
    ck.append(lista);

    // Pendências.
    let pendCard: HTMLElement | null = null;
    if (pendentes.length > 0) {
      const extra = btn("Confirmar todas", "btn-ghost", () => { void agir(() => deps.api.financeConfirmarTodas(), "pendências confirmadas"); });
      const pc = card(`Para confirmar (${pendentes.length})`, extra);
      pc.append(el("p", "hint", "O agente lançou e ficou na dúvida (categoria, valor de foto ou possível repetição). Confira a categoria e confirme: ele aprende e da próxima vez já acerta."));
      for (const l of pendentes) pc.append(linhaLanc(l, true));
      pendCard = pc;
    }

    // Mês atual.
    const r = e.resumo;
    const mc = card(`Mês atual · ${r.nome}`);
    const nums = el("div", "finance-nums");
    // Investimento com retorno: o que se gastou, o teto do mês, o que voltou (direto + indireto) e o ROI.
    const roiTxt = (v: number | null): string => (v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
    const orcTile = r.orcamento ?? null;
    const tiles: [string, string, string, string][] = [
      ["Gastos (investido)", r.gastos, "gasto", orcTile ? `${orcTile.usadoPct}% do orçamento` : ""],
      ["Orçamento do mês", orcTile ? orcTile.valor : "—", "", orcTile ? (orcTile.restanteCent >= 0 ? `restam ${orcTile.restante}` : `passou ${brl(-orcTile.restanteCent)}`) : "defina no checklist"],
      ["Ganhos", r.ganhos ?? "R$ 0,00", "renda", `diretos ${r.ganhoDireto ?? "R$ 0,00"} · indiretos ${r.ganhoIndireto ?? "R$ 0,00"}`],
      // Projetado até o fim do mês (investimento = orçamento; ganhos no ritmo de hoje); embaixo, o de hoje para comparar.
      ...(r.projecao ? [["ROI do mês projetado", roiTxt(r.projecao.roiTotal), (r.projecao.roiTotal ?? 0) < 0 ? "gasto" : "renda", `hoje ${roiTxt(r.roiTotal ?? null)} · projetado só diretos ${roiTxt(r.projecao.roiDireto)} · ${r.projecao.base === "real" ? "mês encerrado: é o real" : `até o dia ${r.projecao.diasMes}: investimento ${r.projecao.gastos}${r.projecao.base === "orcamento" ? " (o orçamento)" : " (no ritmo de hoje)"}, ganhos ${r.projecao.ganhos} no ritmo de hoje`}`] as [string, string, string, string]] : [["ROI do mês", roiTxt(r.roiTotal ?? null), (r.roiTotal ?? 0) < 0 ? "gasto" : "renda", `só diretos ${roiTxt(r.roiDireto ?? null)}`] as [string, string, string, string]]),
    ];
    // O ROI projetado é o número da página: vem primeiro e em destaque.
    const ordem = [...tiles.filter((t) => t[0].includes("projetado")), ...tiles.filter((t) => !t[0].includes("projetado"))];
    for (const [rot, v, cls, sub] of ordem) { const b = el("div", `finance-num${rot.includes("projetado") ? " destaque" : ""}`); b.append(el("span", "hint", rot), el("strong", `finance-valor ${cls}`, v)); if (sub) b.append(el("span", "hint finance-sub", sub)); nums.append(b); }
    mc.append(nums);
    const o = r.orcamento ?? null; // backend antigo não manda o orçamento
    if (o !== null) {
      const linha = el("div", "finance-orcamento");
      const bar = el("div", `finance-bar${o.usadoPct >= 100 ? " estourou" : o.usadoPct >= 80 ? " alerta" : ""}`); const fill = el("span", "finance-bar-fill"); fill.style.width = `${Math.min(100, o.usadoPct)}%`; bar.append(fill);
      linha.append(el("span", "", `Orçamento ${o.valor} · ${o.usadoPct}% usado · ${o.restanteCent >= 0 ? `restam ${o.restante}` : `passou ${brl(-o.restanteCent)}`}`), bar);
      mc.append(linha);
    } else mc.append(el("p", "hint", "Sem orçamento ainda: diga quanto quer gastar no mês (no checklist) e o agente acompanha e avisa antes de estourar."));
    const ac = e.acumulado;
    if (ac !== undefined && (ac.gastosCent > 0 || ac.ganhosCent > 0)) mc.append(el("p", "hint finance-acumulado", `Desde o início: investido ${ac.gastos} · ganhos ${ac.ganhos} · ROI ${roiTxt(ac.roiTotal)} (só diretos ${roiTxt(ac.roiDireto)})`));
    mc.append(el("span", "hint", "Onde o dinheiro está indo"));
    const gastosCat = r.porCategoria.filter((c) => c.cent < 0);
    const maior = Math.max(1, ...gastosCat.map((c) => -c.cent));
    if (gastosCat.length === 0) mc.append(el("p", "hint", "Nenhum gasto lançado ainda este mês. Conte um ao agente: \"gastei 48 no mercado\"."));
    for (const c of gastosCat) {
      const linha = el("div", "finance-bar-row");
      const bar = el("div", "finance-bar"); const fill = el("span", "finance-bar-fill"); fill.style.width = `${Math.round((-c.cent / maior) * 100)}%`; bar.append(fill);
      linha.append(el("span", "finance-bar-nome", c.nome), bar, el("span", "finance-bar-valor", brl(-c.cent)));
      mc.append(linha);
    }

    // Contas.
    const total = e.contas.reduce((n, c) => n + c.saldoCent, 0);
    const cc = dobra("contas", "Contas do Agente", e.contas.length === 0 ? "nenhuma ainda" : `${e.contas.length} · saldo ${brl(total)}`);
    if (e.contas.length === 0) cc.append(el("p", "hint", "Nenhuma conta ainda. Crie as que você usa (banco, cartão, dinheiro vivo): o agente lança em cada uma pelo jeito de pagar."));
    for (const c of e.contas) { const row = el("div", "finance-row"); const m = el("div", "finance-row-main"); m.append(el("strong", "finance-fav", c.nome), el("span", "hint finance-meta", `${TIPOS.find(([k]) => k === c.tipo)?.[1] ?? c.tipo}${c.padrao ? " · padrão" : ""}`)); row.append(m, el("span", `finance-valor ${c.saldoCent < 0 ? "gasto" : "renda"}`, c.saldo)); cc.append(row); }
    const nova = el("div", "admin-actions");
    const nome = input("Nubank, Itaú, Carteira…"); const tipo = el("select"); tipo.disabled = busy; for (const [k, t] of TIPOS) { const o = el("option", "", t); o.value = k; tipo.append(o); }
    const saldo = input("saldo hoje (opcional)", "", 20);
    nova.append(field("Nova conta", nome), field("Tipo", tipo), field("Saldo", saldo), btn("Criar conta", "btn-ghost", () => { if (nome.value.trim() === "") return; void agir(() => deps.api.financeContaCriar({ nome: nome.value, tipo: tipo.value as never, ...(saldo.value.trim() !== "" ? { saldoInicial: saldo.value } : {}) }), "conta criada"); }));
    cc.append(nova);

    // Lançar à mão.
    const lc = dobra("lancar", "Lançar à mão", "o agente lança pelo WhatsApp e pelo chat");
    const f = el("div", "admin-actions");
    const valor = input("48,90", "", 20); const fav = input("onde / de quem"); const tipoL = el("select"); tipoL.disabled = busy;
    for (const [k, t] of [["gasto", "Gasto (investimento)"], ["direto", "Ganho direto"], ["indireto", "Ganho indireto"]] as const) { const o = el("option", "", t); o.value = k; tipoL.append(o); }
    let cat = selectCategoria("mercado", false);
    tipoL.addEventListener("change", () => { const ganho = tipoL.value !== "gasto"; const novo = selectCategoria(tipoL.value === "indireto" ? "ganho-indireto" : ganho ? "ganho-direto" : "mercado", ganho); cat.replaceWith(novo); cat = novo; });
    f.append(field("Valor", valor), field("Tipo", tipoL), field("Onde", fav), field("Categoria", cat), btn("Lançar", "btn-primary", () => { if (valor.value.trim() === "") return; void agir(() => deps.api.financeLancar({ valor: valor.value, favorecido: fav.value, tipo: tipoL.value === "gasto" ? "gasto" : "renda", ...(tipoL.value === "indireto" ? { retorno: "indireto" as const } : tipoL.value === "direto" ? { retorno: "direto" as const } : {}), categoria: cat.value }), "lançado"); }));
    lc.append(f);

    // Meta de ganhos (projeção): o que se espera receber no mês. Puxa só o projetado; o realizado continua o que entrou.
    const pj = r.projecao; const mt = r.meta ?? null;
    const metaCard = dobra("meta", "Meta de ganhos (projeção)", mt === null ? "sem meta: a projeção segue o ritmo de hoje" : `diretos ${mt.direto} · indiretos ${mt.indireto}${mt.herdadoDe ? " (mantida do mês anterior)" : ""}`);
    if (pj) metaCard.append(el("p", "hint", `Para empatar com o investimento projetado (${pj.empate}) o agente precisa trazer ${pj.empate} em ganhos no mês. Projeção atual de ganhos: ${pj.ganhos} (${pj.ganhosBase === "meta" ? "pela meta" : pj.ganhosBase === "real" ? "real" : "no ritmo de hoje"}).`));
    if (mt?.notas) metaCard.append(el("p", "hint", `Como a meta foi calculada: ${mt.notas}`));
    const mf = el("div", "admin-actions");
    const md = input("ex.: 1.000", mt ? (mt.diretoCent / 100).toFixed(2).replace(".", ",") : "", 20);
    const mi = input("ex.: 500", mt ? (mt.indiretoCent / 100).toFixed(2).replace(".", ",") : "", 20);
    const mn = input("como chegou no valor (opcional)", mt?.notas ?? "", 500);
    mf.append(field("Ganho direto esperado", md), field("Ganho indireto esperado", mi), field("Conta", mn), btn("Salvar meta", "btn-ghost", () => {
      void agir(() => deps.api.financeMes(e.mes, { metaDireto: md.value.trim() === "" ? null : md.value, metaIndireto: mi.value.trim() === "" ? null : mi.value, metaNotas: mn.value }), "meta do mês salva");
    }));
    metaCard.append(mf);

    // Últimos lançamentos.
    const uc = card("Últimos lançamentos");
    if (ultimos.length === 0) uc.append(el("p", "hint", "Nada lançado ainda."));
    for (const l of ultimos) uc.append(linhaLanc(l, false));
    // Ordem: o mês e o que o agente lançou primeiro; depois o que depende da pessoa; contas e lançar à mão no fim.
    panel.append(mc, metaCard, uc, ck, ...(pendCard ? [pendCard] : []), cc, lc);
  }

  const page = deps.definePage("financas", "Finanças", panel, () => { render(); void refresh(); });
  return { open: () => deps.openPage(page), refresh, info: () => info };
}
