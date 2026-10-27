/**
 * Variante: admin. Página "Produtos" do meu-bot-admin: os produtos que saem deste código (tabela fixa) e os MVPs
 * de bots verticais que o admin registra (meu-bot-fit, meu-bot-vendas…): formulário de pontapé inicial, status,
 * pipeline modelo, e a definição exportável (produto.json + checklist) que vira o insumo da implementação.
 * Vive na janela Produtos do admin (produtos.ts; abre pelo "◆ Produtos" do seletor). Fábrica com dependências
 * explícitas, como suporte-page.ts. O que já sai deste código vem do catálogo do main (app/variant-core.ts).
 */
import type { ProdutoMvp, ProdutoMvpPatch, ProdutoStatus, ProdutosCatalogo } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

/** A API dos produtos (window.produtos da janela Produtos). */
export interface ProdutosApi {
  listar(): Promise<ProdutoMvp[]>;
  salvar(patch: ProdutoMvpPatch): Promise<ProdutoMvp[]>;
  remover(nome: string): Promise<ProdutoMvp[]>;
  exportar(nome: string): Promise<{ json: string; checklist: string[] }>;
}
export interface ProdutosViewDeps {
  /** Onde desenhar. */
  container: HTMLElement;
  api: ProdutosApi;
  /** Botão de dois cliques (o segundo confirma); sem ele, a vista usa um "confirmar?" próprio. */
  armConfirm?: (btn: HTMLButtonElement, label: string, run: () => void) => void;
  /** O que já sai deste código (apps e add-ons); sem ele, a vista mostra só os MVPs. */
  catalogo?: () => Promise<ProdutosCatalogo>;
}
const STATUS: { id: ProdutoStatus; label: string }[] = [{ id: "ideia", label: "Ideia" }, { id: "mvp", label: "MVP" }, { id: "beta", label: "Beta" }, { id: "lancado", label: "Lançado" }];

/** A vista (catálogo + MVPs + formulário + exportação) da janela Produtos. */
export function mountProdutosView(deps: ProdutosViewDeps): { refresh: () => Promise<void>; novo: () => void } {
  const panel = deps.container;
  const armConfirm = deps.armConfirm ?? ((btn, label, run) => { const t = btn.textContent; btn.textContent = label; const once = (): void => { btn.removeEventListener("click", once); run(); }; setTimeout(() => btn.addEventListener("click", once), 0); setTimeout(() => { btn.removeEventListener("click", once); btn.textContent = t; }, 4000); });
  let lista: ProdutoMvp[] = []; let editando: string | null = null; let novo = false; let msg = ""; let exportado: { nome: string; json: string; checklist: string[] } | null = null;
  let catalogo: ProdutosCatalogo | null = null;
  /** Aba do catálogo: o que está com as pessoas, o que está em teste, os add-ons. */
  let abaCat: "estavel" | "staging" | "addons" = "estavel";
  const input = (value: string, placeholder: string, max = 240): HTMLInputElement => { const i = el("input") as HTMLInputElement; i.type = "text"; i.value = value; i.placeholder = placeholder; i.maxLength = max; return i; };
  const area = (value: string, placeholder: string, rows = 3): HTMLTextAreaElement => { const t = el("textarea") as HTMLTextAreaElement; t.value = value; t.placeholder = placeholder; t.rows = rows; return t; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.addEventListener("click", run); return b; };

  async function refresh(): Promise<void> {
    try { const [l, c] = await Promise.all([deps.api.listar(), deps.catalogo?.() ?? Promise.resolve(null)]); lista = l; catalogo = c; msg = ""; } catch (e) { msg = ipcErrorText(e); }
    render();
  }

  // Formulário curto (27 out): nome, a ideia e os módulos à vista; pipeline, notas e status em "Mais detalhes". Vertical,
  // público, extras, campos do pipeline e próximos passos saíram da tela: só iam para o texto exportado. O patch não os
  // manda, e o main mantém o que um MVP antigo já tinha guardado neles (aplicarPatch parte do registro salvo).
  function form(p: ProdutoMvp | null): HTMLElement {
    const card = el("div", "admin-card");
    card.append(el("strong", "", p === null ? "Novo produto (MVP)" : `Editar ${p.nome}`));
    const nome = input(p?.nome ?? "meu-bot-", "meu-bot-fit", 40); nome.disabled = p !== null;
    const pitch = input(p?.pitch ?? "", "Ex.: academias atendem e matriculam pelo WhatsApp");
    const chk = (label: string, on: boolean): { wrap: HTMLElement; box: HTMLInputElement } => { const w = el("label", "switch"); const b = el("input") as HTMLInputElement; b.type = "checkbox"; b.checked = on; w.append(b, el("span", "track"), el("span", "switch-label", label)); return { wrap: w, box: b }; };
    const chat = chk("chat com o agente", p?.modulos.chat ?? true), wa = chk("WhatsApp", p?.modulos.whatsapp ?? true), nav = chk("Navegador", p?.modulos.navegador ?? true), crm = chk("CRM próprio (Gmail)", p?.modulos.crm ?? true);
    const etapas = input(p?.pipeline.etapas.join(" | ") ?? "", "Lead | Aula experimental | Matrícula | Ativo", 600);
    const status = el("select") as HTMLSelectElement; for (const s of STATUS) { const o = el("option", "", s.label) as HTMLOptionElement; o.value = s.id; o.selected = (p?.status ?? "ideia") === s.id; status.append(o); }
    const notas = area(p?.notas ?? "", "Referências, módulos extras, próximos passos…", 3);
    const err = el("p", "hint"); err.hidden = true;
    const mods = el("div", "admin-actions"); mods.append(chat.wrap, wa.wrap, nav.wrap, crm.wrap);
    const etapasField = field("Etapas do pipeline (separadas por |)", etapas);
    const syncEtapas = (): void => { etapasField.hidden = !crm.box.checked; }; crm.box.addEventListener("change", syncEtapas); syncEtapas();
    const mais = el("details", "produtos-mais"); mais.append(el("summary", "", "Mais detalhes"), etapasField, field("Notas", notas), field("Status", status));
    if (p !== null && (p.pipeline.etapas.length > 0 || p.notas !== "" || p.status !== "ideia")) mais.open = true;
    card.append(field("Nome (meu-bot-<slug>)", nome), field("A ideia em uma frase", pitch), el("span", "hint", "Módulos"), mods, mais, err);
    const salvar = btn("Salvar", "btn-primary", () => {
      const patch: ProdutoMvpPatch = {
        nome: nome.value.trim().toLowerCase(), pitch: pitch.value,
        modulos: { chat: chat.box.checked, whatsapp: wa.box.checked, navegador: nav.box.checked, crm: crm.box.checked, extras: p?.modulos.extras ?? "" },
        pipeline: { etapas: etapas.value.split("|").map((x) => x.trim()).filter(Boolean), campos: p?.pipeline.campos ?? [] },
        status: status.value as ProdutoStatus, notas: notas.value,
      };
      salvar.disabled = true;
      deps.api.salvar(patch).then((l) => { lista = l; editando = null; novo = false; msg = `${patch.nome} salvo.`; render(); }, (e) => { err.hidden = false; err.textContent = ipcErrorText(e); salvar.disabled = false; });
    });
    const acoes = el("div", "admin-actions"); acoes.append(salvar, btn("Cancelar", "btn-ghost", () => { editando = null; novo = false; render(); }));
    card.append(acoes);
    return card;
  }

  function cartao(p: ProdutoMvp): HTMLElement {
    const c = el("div", "admin-card");
    const head = el("div", "admin-card-head"); head.append(el("strong", "", p.nome), el("span", "hint", `${STATUS.find((s) => s.id === p.status)?.label ?? p.status}${p.vertical !== "" ? ` · ${p.vertical}` : ""}`));
    c.append(head);
    if (p.pitch !== "") c.append(el("p", "", p.pitch));
    const ul = el("ul", "admin-health");
    const li = (t: string): void => { ul.append(el("li", "", t)); };
    if (p.publico !== "") li(`Público: ${p.publico}`);
    li(`Módulos: ${[p.modulos.chat ? "chat" : "", p.modulos.whatsapp ? "WhatsApp" : "", p.modulos.navegador ? "Navegador" : "", p.modulos.crm ? "CRM próprio" : ""].filter(Boolean).join(", ") || "nenhum"}${p.modulos.extras !== "" ? ` + ${p.modulos.extras.split("\n").filter(Boolean).length} extra(s)` : ""}`);
    if (p.pipeline.etapas.length > 0) li(`Pipeline: ${p.pipeline.etapas.join(" → ")}${p.pipeline.campos.length > 0 ? ` · ${p.pipeline.campos.length} campo(s)` : ""}`);
    if (p.proximos !== "") li(`Próximo: ${p.proximos.split("\n")[0]}`);
    li(`Atualizado ${new Date(p.updatedAt).toLocaleString("pt-BR")}`);
    c.append(ul);
    const acoes = el("div", "admin-actions");
    const rm = btn("Remover", "btn-ghost", () => {}); rm.addEventListener("click", () => armConfirm(rm, "remover?", () => { void deps.api.remover(p.nome).then((l) => { lista = l; render(); }); }));
    acoes.append(btn("Editar", "btn-ghost", () => { editando = p.nome; novo = false; render(); }), btn("Pontapé inicial (exportar)", "btn-primary", () => { void deps.api.exportar(p.nome).then((r) => { exportado = { nome: p.nome, ...r }; render(); }, (e) => { msg = ipcErrorText(e); render(); }); }), rm);
    c.append(acoes);
    if (exportado !== null && exportado.nome === p.nome) {
      const ex = el("div", "admin-card");
      ex.append(el("strong", "", "Definição do produto (produto.json) e o que falta para virar um app"));
      const ol = el("ol", "admin-health"); for (const item of exportado.checklist) ol.append(el("li", "", item)); ex.append(ol);
      const pre = el("pre", "admin-logs", exportado.json); ex.append(pre);
      const a = el("div", "admin-actions");
      a.append(btn("Copiar JSON", "btn-ghost", () => { void navigator.clipboard.writeText(exportado?.json ?? ""); }), btn("Copiar checklist", "btn-ghost", () => { void navigator.clipboard.writeText((exportado?.checklist ?? []).map((x, i) => `${i + 1}. ${x}`).join("\n")); }), btn("Fechar", "btn-ghost", () => { exportado = null; render(); }));
      ex.append(a); c.append(ex);
    }
    return c;
  }

  function render(): void {
    panel.replaceChildren();
    if (msg !== "") panel.append(el("p", "hint", msg));
    if (catalogo !== null) {
      // Abas no mesmo desenho do seletor de máquinas: Produção · Staging · Add-ons, com a versão publicada de cada canal.
      const fixos = el("div", "admin-card"); fixos.append(el("strong", "", "Apps e add-ons do meu-bot"));
      const v = catalogo.versoes;
      const abas: { id: typeof abaCat; rotulo: string; itens: { nome: string; texto: string }[]; versao: string }[] = [
        { id: "estavel", rotulo: "Produção", itens: catalogo.apps.filter((a) => a.canal === "estavel").map((a) => ({ nome: a.nome, texto: a.descricao })), versao: v.estavel !== null ? `Publicada: ${v.estavel}` : "Nenhuma versão publicada encontrada (sem internet?)" },
        { id: "staging", rotulo: "Staging", itens: catalogo.apps.filter((a) => a.canal === "staging").map((a) => ({ nome: a.nome, texto: a.descricao })), versao: v.staging !== null ? `Publicada: ${v.staging}` : "Nenhuma versão de staging publicada" },
        { id: "addons", rotulo: "Add-ons", itens: catalogo.addons.map((a) => ({ nome: `${a.nome} (${a.rotulo})`, texto: a.descricao })), versao: "Liberados pela licença, em qualquer canal" },
      ];
      const bar = el("div", "pk-tipos pr-abas");
      for (const a of abas) {
        const b = el("button", a.id === abaCat ? "on" : ""); b.type = "button";
        b.append(a.rotulo, el("span", "n", String(a.itens.length)));
        b.addEventListener("click", () => { abaCat = a.id; render(); });
        bar.append(b);
      }
      fixos.append(bar);
      const atual = abas.find((a) => a.id === abaCat) ?? abas[0]!;
      fixos.append(el("p", "hint", atual.id === "addons" ? atual.versao : `${atual.versao} · este admin: ${v.local}${v.estavel !== null && `v${v.local}` !== v.estavel ? " (build local, não publicado)" : ""}`));
      const ul = el("ul", "admin-health");
      for (const it of atual.itens) { const li = el("li", "ok"); li.append(el("strong", "", it.nome), document.createTextNode(` · ${it.texto}`)); ul.append(li); }
      fixos.append(ul);
      panel.append(fixos);
    }
    if (novo) panel.append(form(null));
    for (const p of lista) panel.append(editando === p.nome ? form(p) : cartao(p));
    if (lista.length === 0 && !novo) panel.append(el("p", "hint", "Nenhum MVP registrado ainda. Clique em ＋ Novo MVP: por exemplo meu-bot-fit, para academias e estúdios."));
  }
  return { refresh, novo: () => { novo = true; editando = null; render(); } };
}

