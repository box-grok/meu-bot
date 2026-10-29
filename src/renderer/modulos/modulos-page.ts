/**
 * Página "Módulos" (apps com caps.modulos, como o meu-bot-diego): um cartão por módulo do repositório do produto, com
 * liga/desliga, as chaves (coladas aqui, gravadas na máquina e nunca mostradas de volta), as opções e o progresso do
 * instalador. O estado mora na máquina (main › modulos/modulos.ts); aqui só se mostra e se pede. Fábrica com
 * dependências explícitas, como finance/finance-page.ts.
 */
import type { MeuBotApi, ModuloVista, ModulosLista } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface ModulosPageDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  api: Pick<MeuBotApi, "modulosListar" | "modulosLigar" | "modulosDesligar" | "modulosCredenciais" | "modulosOpcoes" | "on">;
  /** Rótulo do add-on (de caps.addons) para os textos. */
  rotulo: string;
}

const MSG_LICENCA = (rotulo: string): string => `Os módulos ainda não estão liberados nesta máquina: peça ao admin para incluir o add-on "${rotulo}" na licença (Configurações › Suporte).`;

export function mountModulosPage(deps: ModulosPageDeps): { open: () => void } {
  const panel = el("section", "acervo-panel modulos-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let page: PageTab | null = null;
  let lista: ModulosLista | null = null;
  let erro: string | null = null;
  let lendo = false;
  /** Módulo com ação em andamento (só um por vez) e o que cada um disse por último. */
  let ocupado: string | null = null;
  const logs = new Map<string, { linhas: string[]; ruim: boolean }>();
  /** O que a pessoa digitou e ainda não salvou (credenciais e opções), por módulo. */
  const rascunhoCred = new Map<string, Record<string, string>>();
  const rascunhoOpc = new Map<string, Record<string, string | number | boolean>>();

  deps.api.on("modulos:progress", ({ id, line }) => {
    const l = logs.get(id) ?? { linhas: [], ruim: false };
    logs.set(id, { linhas: [...l.linhas, line].slice(-8), ruim: false });
    if (!panel.hidden) render();
  });

  async function ler(): Promise<void> {
    lendo = true; erro = null; render();
    try { lista = await deps.api.modulosListar(); } catch (e) { erro = ipcErrorText(e); }
    lendo = false; render();
  }
  async function acao(id: string, rodar: () => Promise<{ ok: boolean; log: string[] }>): Promise<void> {
    ocupado = id; logs.set(id, { linhas: [], ruim: false }); render();
    try {
      const r = await rodar();
      const antes = logs.get(id)?.linhas ?? [];
      logs.set(id, { linhas: [...antes, ...r.log.filter((l) => !antes.includes(l))].slice(-8), ruim: !r.ok });
    } catch (e) { logs.set(id, { linhas: [ipcErrorText(e)], ruim: true }); }
    ocupado = null;
    await ler();
  }

  const btn = (label: string, cls: string, run: () => void, desligado = false): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = desligado || ocupado !== null; b.addEventListener("click", run); return b; };
  const field = (label: string, ctl: HTMLElement, ajuda: string): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); if (ajuda) w.title = ajuda; return w; };

  function cartao(m: ModuloVista, l: ModulosLista): HTMLElement {
    const c = el("div", "admin-card");
    const h = el("div", "admin-card-head");
    const estado = m.estado.ligado ? (m.desatualizado ? `ligado · ${m.estado.versao} → ${m.versao}` : `ligado · ${m.estado.versao ?? m.versao}`) : "desligado";
    h.append(el("strong", "", m.rotulo), el("span", `auditoria-selo ${m.estado.ligado ? "ok" : ""}`, estado));
    c.append(h);
    if (m.descricao) c.append(el("p", "hint", m.descricao));
    const avisos: string[] = [...m.requisitos];
    const gwOk = m.gateways.length === 0 || (l.gateway !== null && m.gateways.includes(l.gateway));
    if (!gwOk) avisos.unshift(`Precisa do WhatsApp pelo ${m.gateways.join(" ou ")}; esta máquina usa ${l.gateway ?? "nenhum"}.`);
    if (avisos.length > 0) { const ul = el("ul", "admin-health"); for (const a of avisos) ul.append(el("li", "", a)); c.append(ul); }

    // Chaves: campo de senha; o que já tem valor aparece como "preenchida" (o valor nunca volta da máquina).
    if (m.credenciais.length > 0) {
      const rc = rascunhoCred.get(m.id) ?? {};
      const f = el("div", "admin-actions");
      for (const cr of m.credenciais) {
        const i = el("input"); i.type = "password"; i.autocomplete = "off"; i.maxLength = 4000;
        i.placeholder = m.estado.preenchidas.includes(cr.chave) ? "preenchida ✓ (cole para trocar)" : "cole aqui";
        i.value = rc[cr.chave] ?? ""; i.disabled = ocupado !== null;
        i.addEventListener("input", () => { rascunhoCred.set(m.id, { ...(rascunhoCred.get(m.id) ?? {}), [cr.chave]: i.value }); });
        f.append(field(cr.rotulo, i, cr.ajuda));
      }
      f.append(btn("Salvar chaves", "btn-ghost", () => {
        const patch = Object.fromEntries(Object.entries(rascunhoCred.get(m.id) ?? {}).filter(([, v]) => v.trim() !== ""));
        if (Object.keys(patch).length === 0) return;
        void acao(m.id, async () => { lista = await deps.api.modulosCredenciais(m.id, patch); rascunhoCred.delete(m.id); return { ok: true, log: ["chaves salvas na máquina"] }; });
      }, !l.liberado));
      c.append(f);
    }

    if (m.opcoes.length > 0) {
      const ro = rascunhoOpc.get(m.id) ?? {};
      const f = el("div", "admin-actions");
      for (const o of m.opcoes) {
        const atual = ro[o.chave] ?? m.estado.opcoes[o.chave] ?? o.padrao;
        const set = (v: string | number | boolean): void => { rascunhoOpc.set(m.id, { ...(rascunhoOpc.get(m.id) ?? {}), [o.chave]: v }); };
        let ctl: HTMLInputElement;
        if (o.tipo === "booleano") { ctl = el("input"); ctl.type = "checkbox"; ctl.checked = atual === true; ctl.addEventListener("change", () => set(ctl.checked)); }
        else { ctl = el("input"); ctl.type = o.tipo === "numero" ? "number" : "text"; ctl.value = String(atual); ctl.maxLength = 2000; ctl.addEventListener("input", () => set(o.tipo === "numero" ? Number(ctl.value) : ctl.value)); }
        ctl.disabled = ocupado !== null;
        f.append(field(o.rotulo, ctl, o.ajuda));
      }
      f.append(btn("Salvar opções", "btn-ghost", () => {
        const patch = rascunhoOpc.get(m.id) ?? {};
        if (Object.keys(patch).length === 0) return;
        void acao(m.id, async () => { const r = await deps.api.modulosOpcoes(m.id, patch); if (r.ok) rascunhoOpc.delete(m.id); return r; });
      }, !l.liberado));
      c.append(f);
    }

    const a = el("div", "admin-actions");
    if (ocupado === m.id) a.append(carregando(m.estado.ligado ? "Trabalhando na máquina…" : "Ligando na máquina…"));
    else if (m.estado.ligado) {
      if (m.desatualizado) a.append(btn("Atualizar", "btn-primary", () => { void acao(m.id, () => deps.api.modulosLigar(m.id)); }, !l.liberado));
      const d = btn("Desligar", "btn-ghost", () => { /* armConfirm abaixo */ });
      deps.armConfirm(d, "Confirmar desligar?", () => { void acao(m.id, () => deps.api.modulosDesligar(m.id)); });
      a.append(d);
    } else {
      const faltam = m.credenciais.filter((cr) => !m.estado.preenchidas.includes(cr.chave));
      a.append(btn("Ligar", "btn-primary", () => { void acao(m.id, () => deps.api.modulosLigar(m.id)); }, !l.liberado || !gwOk || faltam.length > 0));
      if (faltam.length > 0) a.append(el("span", "hint", `Falta: ${faltam.map((x) => x.rotulo).join(", ")}`));
    }
    c.append(a);
    const lg = logs.get(m.id);
    if (lg !== undefined && lg.linhas.length > 0) { const pre = el("pre", lg.ruim ? "modulo-log bad-hint" : "modulo-log hint"); pre.textContent = lg.linhas.join("\n"); c.append(pre); }
    return c;
  }

  function render(): void {
    if (page === null) return;
    panel.replaceChildren();
    const head = el("div", "guide-head");
    const body = el("div", "tut-body");
    body.append(el("span", "tut-badge", `módulos · ${deps.rotulo}`), el("h2", "", "Módulos"), el("p", "", "Cada módulo é uma peça à parte: ligue só o que for usar. As chaves ficam na máquina, só com você."));
    const atualizar = el("button", "btn btn-ghost btn-small", "Atualizar lista"); atualizar.type = "button"; atualizar.disabled = lendo || ocupado !== null;
    atualizar.addEventListener("click", () => { void ler(); });
    body.append(atualizar);
    head.append(body);
    panel.append(head);
    const box = el("div", "auditoria-detalhe");
    if (erro !== null) box.append(el("p", "hint bad-hint", erro));
    if (lista === null) { if (lendo) box.append(carregando("Lendo os módulos da máquina…")); }
    else {
      if (!lista.liberado) box.append(el("p", "hint guide-pair-note", MSG_LICENCA(deps.rotulo)));
      for (const m of lista.modulos) box.append(cartao(m, lista));
    }
    panel.append(box);
  }

  return {
    open: () => {
      if (page === null) { page = deps.definePage("modulos", "Módulos", panel, render); void ler(); }
      deps.openPage(page);
    },
  };
}
