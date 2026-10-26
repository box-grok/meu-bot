/**
 * Variante: admin. Página "Produtos" do meu-bot-admin: os produtos que saem deste código (tabela fixa) e os MVPs
 * de bots verticais que o admin registra (meu-bot-fit, meu-bot-vendas…): formulário de pontapé inicial, status,
 * pipeline modelo, e a definição exportável (produto.json + checklist) que vira o insumo da implementação.
 * Vive no seletor do admin ("Novo MVP / Produtos"). Fábrica com dependências explícitas, como suporte-page.ts.
 */
import type { ProdutoMvp, ProdutoMvpPatch, ProdutoStatus } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

/** A API dos produtos (no seletor: `produtos`, `produtoSave`…). */
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
  /** Mostrar a lista dos produtos fixos (meu-bot, meu-bot-admin, meu-bot-crm). */
  fixos?: boolean;
}
const FIXOS = [
  { nome: "meu-bot", texto: "O app da pessoa: chat e WhatsApp no plano Free; Navegador e CRM próprio no Gmail no Pro. Add-ons por cima, com ou sem o Pro." },
  { nome: "meu-bot-admin", texto: "Este app: suporte, licenças, espelho das máquinas e o registro de produtos." },
  { nome: "meu-bot-finance", texto: "Add-on do meu-bot (com ou sem o Pro): o agente vira o financeiro da pessoa no WhatsApp e no chat; página Finanças e tutorial 14." },
  { nome: "meu-bot-staging · meu-bot-finance-staging", texto: "Canal de teste, ao lado do estável (como o VS Code Insiders): recebe o que está em teste; a licença é a do estável." },
];
const STATUS: { id: ProdutoStatus; label: string }[] = [{ id: "ideia", label: "Ideia" }, { id: "mvp", label: "MVP" }, { id: "beta", label: "Beta" }, { id: "lancado", label: "Lançado" }];

/** A vista (lista + formulário + exportação) do seletor do admin. */
export function mountProdutosView(deps: ProdutosViewDeps): { refresh: () => Promise<void>; novo: () => void } {
  const panel = deps.container;
  const armConfirm = deps.armConfirm ?? ((btn, label, run) => { const t = btn.textContent; btn.textContent = label; const once = (): void => { btn.removeEventListener("click", once); run(); }; setTimeout(() => btn.addEventListener("click", once), 0); setTimeout(() => { btn.removeEventListener("click", once); btn.textContent = t; }, 4000); });
  let lista: ProdutoMvp[] = []; let editando: string | null = null; let novo = false; let msg = ""; let exportado: { nome: string; json: string; checklist: string[] } | null = null;
  const input = (value: string, placeholder: string, max = 240): HTMLInputElement => { const i = el("input") as HTMLInputElement; i.type = "text"; i.value = value; i.placeholder = placeholder; i.maxLength = max; return i; };
  const area = (value: string, placeholder: string, rows = 3): HTMLTextAreaElement => { const t = el("textarea") as HTMLTextAreaElement; t.value = value; t.placeholder = placeholder; t.rows = rows; return t; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.addEventListener("click", run); return b; };

  async function refresh(): Promise<void> { try { lista = await deps.api.listar(); msg = ""; } catch (e) { msg = ipcErrorText(e); } render(); }

  function form(p: ProdutoMvp | null): HTMLElement {
    const card = el("div", "admin-card");
    card.append(el("strong", "", p === null ? "Novo produto (MVP)" : `Editar ${p.nome}`));
    const nome = input(p?.nome ?? "meu-bot-", "meu-bot-fit", 40); nome.disabled = p !== null;
    const vertical = input(p?.vertical ?? "", "academia, estúdio de dança, aulas coletivas", 80);
    const pitch = input(p?.pitch ?? "", "Uma frase: o que a pessoa ganha");
    const publico = input(p?.publico ?? "", "Para quem é");
    const chk = (label: string, on: boolean): { wrap: HTMLElement; box: HTMLInputElement } => { const w = el("label", "switch"); const b = el("input") as HTMLInputElement; b.type = "checkbox"; b.checked = on; w.append(b, el("span", "track"), el("span", "switch-label", label)); return { wrap: w, box: b }; };
    const chat = chk("chat com o agente", p?.modulos.chat ?? true), wa = chk("WhatsApp", p?.modulos.whatsapp ?? true), nav = chk("Navegador", p?.modulos.navegador ?? true), crm = chk("CRM próprio (Gmail)", p?.modulos.crm ?? true);
    const extras = area(p?.modulos.extras ?? "", "Módulos extras, um por linha (ex.: agenda de aulas, cobrança de mensalidade, check-in)", 3);
    const etapas = input(p?.pipeline.etapas.join(" | ") ?? "", "Etapas do pipeline modelo, separadas por |  (ex.: Lead | Aula experimental | Matrícula | Ativo | Inativo)", 600);
    const campos = area(p?.pipeline.campos.map((c) => `${c.nome}: ${c.tipo}`).join("\n") ?? "", "Campos, um por linha: Nome: TIPO  (TEXT, NUMBER, DATE, DROPDOWN, TAG, CHECKBOX)", 3);
    const status = el("select") as HTMLSelectElement; for (const s of STATUS) { const o = el("option", "", s.label) as HTMLOptionElement; o.value = s.id; o.selected = (p?.status ?? "ideia") === s.id; status.append(o); }
    const notas = area(p?.notas ?? "", "Notas da ideia, referências, o que já existe no meu-bot que serve", 4);
    const proximos = area(p?.proximos ?? "", "Próximos passos", 3);
    const err = el("p", "hint");
    const mods = el("div", "admin-actions"); mods.append(chat.wrap, wa.wrap, nav.wrap, crm.wrap);
    card.append(field("Nome (meu-bot-<slug>)", nome), field("Vertical", vertical), field("Pitch", pitch), field("Público", publico), el("span", "hint", "Módulos"), mods, field("Extras", extras), field("Pipeline modelo · etapas", etapas), field("Pipeline modelo · campos", campos), field("Status", status), field("Notas", notas), field("Próximos passos", proximos), err);
    const salvar = btn("Salvar", "btn-primary", () => {
      const patch: ProdutoMvpPatch = {
        nome: nome.value.trim().toLowerCase(), vertical: vertical.value, pitch: pitch.value, publico: publico.value,
        modulos: { chat: chat.box.checked, whatsapp: wa.box.checked, navegador: nav.box.checked, crm: crm.box.checked, extras: extras.value },
        pipeline: { etapas: etapas.value.split("|").map((s) => s.trim()).filter(Boolean), campos: campos.value.split("\n").map((l) => { const m = /^(.+?)\s*:\s*([A-Za-z]+)\s*$/.exec(l.trim()); return m ? { nome: m[1] as string, tipo: (m[2] as string).toUpperCase() as ProdutoMvp["pipeline"]["campos"][number]["tipo"] } : l.trim() === "" ? null : { nome: l.trim(), tipo: "TEXT" as const }; }).filter((c): c is ProdutoMvp["pipeline"]["campos"][number] => c !== null) },
        status: status.value as ProdutoStatus, notas: notas.value, proximos: proximos.value,
      };
      salvar.disabled = true;
      deps.api.salvar(patch).then((l) => { lista = l; editando = null; novo = false; msg = `${patch.nome} salvo.`; render(); }, (e) => { err.textContent = ipcErrorText(e); salvar.disabled = false; });
    });
    const acoes = el("div", "admin-actions"); acoes.append(salvar, btn("Cancelar", "btn-ghost", () => { editando = null; novo = false; render(); }));
    card.append(acoes);
    return card;
  }

  function cartao(p: ProdutoMvp): HTMLElement {
    const c = el("div", "admin-card");
    const head = el("div", "admin-card-head"); head.append(el("strong", "", p.nome), el("span", "hint", `${STATUS.find((s) => s.id === p.status)?.label ?? p.status} · ${p.vertical || "sem vertical"}`));
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
    if (deps.fixos !== false) {
      const fixos = el("div", "admin-card"); fixos.append(el("strong", "", "Produtos existentes"));
      const ul = el("ul", "admin-health"); for (const f of FIXOS) { const li = el("li", "ok"); li.append(el("strong", "", f.nome), document.createTextNode(` · ${f.texto}`)); ul.append(li); } fixos.append(ul); panel.append(fixos);
    }
    if (novo) panel.append(form(null));
    for (const p of lista) panel.append(editando === p.nome ? form(p) : cartao(p));
    if (lista.length === 0 && !novo) panel.append(el("p", "hint", "Nenhum MVP registrado ainda. Clique em ＋ Novo MVP: por exemplo meu-bot-fit, para academias e estúdios."));
  }
  return { refresh, novo: () => { novo = true; editando = null; render(); } };
}

