/**
 * Variante: admin (só o super admin). Aba "Auditoria" da janela de uma pessoa, abaixo de Suporte na lateral: a
 * história da máquina desta janela (quem fez o quê, entregue por quem), o selo da corrente (central e máquina), as
 * linhas que sumiram da máquina e a exportação da prova. O main acha a máquina pela janela; a tela não escolhe.
 * Fábrica com dependências explícitas, como suporte-page.ts.
 */
import type { AuditoriaVisao, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface AuditoriaPageDeps {
  /** Nome da pessoa (ou o alias da máquina) para o título da aba. */
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminAuditoria" | "adminAuditoriaExportar">;
}
const TIPOS: Record<string, string> = { dono: "dono", admin: "admin", agente: "agente", sistema: "sistema", legado: "antigo" };
const quando = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };

export function mountAuditoriaPage(deps: AuditoriaPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let visao: AuditoriaVisao | null = null;
  let erro: string | null = null;
  let lendo = false;
  let filtroTipo = "";
  let filtroTexto = "";
  let msg = "";

  const selo = (v: AuditoriaVisao): HTMLElement => {
    const s = el("div", "auditoria-selos");
    s.append(el("span", `auditoria-selo ${v.centralQuebraEm === null ? "ok" : "bad"}`, v.centralQuebraEm === null ? "✓ central íntegra" : `✗ central adulterada a partir do registro ${v.centralQuebraEm}`));
    if (!v.maquinaLida) s.append(el("span", "auditoria-selo", v.maquinaErro !== null ? `máquina não lida: ${v.maquinaErro}` : "máquina não lida (suporte desligado)"));
    else s.append(el("span", `auditoria-selo ${v.maquinaQuebraEm === null ? "ok" : "bad"}`, v.maquinaQuebraEm === null ? "✓ cópia da máquina íntegra" : `✗ cópia da máquina adulterada (linha ${v.maquinaQuebraEm + 1})`));
    if (v.faltamNaMaquina > 0) s.append(el("span", "auditoria-selo bad", `✗ ${v.faltamNaMaquina} registro(s) apagado(s) da máquina`));
    return s;
  };

  const registro = (v: AuditoriaVisao, box: HTMLElement): void => {
    box.append(selo(v));
    const barra = el("div", "auditoria-barra");
    const tipo = el("select") as HTMLSelectElement;
    for (const [id, label] of [["", "todos"], ["dono", "dono"], ["admin", "admins"], ["agente", "agente"], ["sistema", "sistema"], ["legado", "antigos"]]) { const o = el("option", "", label) as HTMLOptionElement; o.value = id!; o.selected = filtroTipo === id; tipo.append(o); }
    tipo.addEventListener("change", () => { filtroTipo = tipo.value; render(); });
    const busca = el("input") as HTMLInputElement; busca.type = "search"; busca.placeholder = "filtrar (nome, número, ação…)"; busca.value = filtroTexto;
    busca.addEventListener("input", () => { filtroTexto = busca.value; const pos = busca.selectionStart; render(); const nova = page?.panel.querySelector<HTMLInputElement>(".auditoria-barra input[type=search]"); nova?.focus(); if (pos !== null) nova?.setSelectionRange(pos, pos); });
    const atualizar = el("button", "btn btn-ghost btn-small", "Atualizar"); atualizar.type = "button";
    atualizar.addEventListener("click", () => { void ler(); });
    const exp = el("button", "btn btn-ghost btn-small", "Exportar prova"); exp.type = "button";
    exp.addEventListener("click", () => { exp.disabled = true; void deps.api.adminAuditoriaExportar().then((r) => { msg = r === null ? "" : `✓ salvo em ${r.path} (e o .csv ao lado)`; render(); }).catch((e: unknown) => { msg = `✗ ${ipcErrorText(e)}`; render(); }); });
    barra.append(tipo, busca, atualizar, exp);
    box.append(barra);
    if (msg !== "") box.append(el("p", "hint", msg));
    const q = filtroTexto.trim().toLowerCase();
    const linhas = v.linhas.filter((l) => (filtroTipo === "" || l.quemTipo === filtroTipo) && (q === "" || `${l.quemNome} ${l.texto} ${l.detalhe} ${l.acao} ${l.via}`.toLowerCase().includes(q)));
    const t = el("table", "auditoria-tabela");
    const cab = el("tr"); for (const h of ["Quando", "Quem", "O quê", "Entregue por", "Máquina"]) cab.append(el("th", "", h));
    t.append(cab);
    for (const l of linhas) {
      const tr = el("tr", l.naMaquina === false ? "apagada" : "");
      const o = el("td", "", l.texto); if (l.detalhe !== "") o.title = l.detalhe;
      tr.append(el("td", "", quando(l.em)), el("td", "", `${l.quemNome || "—"} (${TIPOS[l.quemTipo] ?? l.quemTipo})`), o, el("td", "hint", `${l.via} · ${quando(l.recebidoEm)}`), el("td", "", l.naMaquina === null ? "—" : l.naMaquina ? "✓" : "apagada"));
      t.append(tr);
    }
    box.append(v.linhas.length === 0 ? el("p", "hint", "Nenhum registro desta máquina na central ainda.") : linhas.length === 0 ? el("p", "hint", "Nada com esse filtro.") : t);
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel;
    panel.replaceChildren();
    const head = el("div", "guide-head");
    const body = el("div", "tut-body");
    body.append(el("span", "tut-badge", "auditoria · cópia central"), el("h2", "", deps.who), el("p", "", "Tudo o que o dono, cada admin, o agente e o sistema fizeram nesta máquina. A cópia central só aceita linhas novas: ninguém apaga nem edita por SSH."));
    head.append(body);
    panel.append(head);
    const box = el("div", "auditoria-detalhe");
    if (erro !== null) box.append(el("p", "hint guide-pair-note", `Central de auditoria: ${erro}`));
    if (visao !== null) registro(visao, box);
    else if (lendo) box.append(espera("Lendo o registro…"));
    panel.append(box);
  }

  async function ler(): Promise<void> {
    lendo = true; erro = null; msg = ""; render();
    try { visao = await deps.api.adminAuditoria(); } catch (e) { erro = ipcErrorText(e); }
    lendo = false; render();
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel admin-panel"); panel.hidden = true;
        deps.panelsEl.append(panel);
        page = deps.definePage("auditoria", `Auditoria · ${deps.who}`, panel, render);
        void ler();
      }
      deps.openPage(page);
    },
  };
}
