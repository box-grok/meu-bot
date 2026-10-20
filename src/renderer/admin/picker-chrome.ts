/**
 * Variante: admin. O que o seletor do meu-bot-admin tem a mais: textos de "pessoas", o "Adicionar pessoa"
 * (colar o código MBS1.…), a leitura da caixa de entrada na primeira abertura e a linha vazia. O picker.ts
 * continua dono da lista e das linhas; aqui só o que é exclusivo do admin.
 */
import type { PickerApi, PickerInit } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { EMPTY_PEOPLE_TEXT, MISSING_ADMIN_KEY_TEXT } from "../lib/admin-view.js";
import { mountProdutosView } from "./produtos-page.js";
import { mountAuditoriaView } from "./auditoria-page.js";

export interface AdminPickerChromeDeps {
  listEl: HTMLElement;
  filterEl: HTMLInputElement;
  noteEl: HTMLElement;
  api: Pick<PickerApi, "supportAdd" | "supportRefresh" | "list" | "produtos" | "produtoSave" | "produtoRemove" | "produtoExport" | "auditoriaMaquinas" | "auditoriaRegistro" | "auditoriaExportar">;
  /** Interruptor "arquivadas": mostrar ou não as pessoas arquivadas na lista. */
  setShowArchived(show: boolean): void;
  /** Redesenha o seletor com um payload novo, mantendo a seleção se der. */
  reinit(payload: PickerInit, keepSelected: string | null): void;
  selected(): string | null;
  showError(prefix: string, err: unknown): void;
}

export interface AdminPickerChrome {
  /** Textos, rodapé e "Adicionar pessoa"; idempotente. */
  paint(support: NonNullable<PickerInit["support"]>): void;
  /** Lê a caixa de entrada ao abrir e depois a cada 60 s (pessoas que ligaram o suporte aparecem sozinhas). */
  refreshPeopleOnce(): void;
  emptyRow(): HTMLLIElement;
}

export function mountAdminPickerChrome(deps: AdminPickerChromeDeps): AdminPickerChrome {
  const addBox = document.createElement("div");
  let refreshing = false;
  const refreshBtn = el("button", "btn btn-ghost btn-small", "Atualizar pessoas"); refreshBtn.type = "button";
  refreshBtn.title = "Lê agora a caixa de entrada (as máquinas avisam sozinhas a cada 30 min; \"Avisar o admin agora\" no meu-bot delas avisa na hora)";
  refreshBtn.addEventListener("click", () => { void refreshPeople(); });
  const archivedSwitch = el("label", "switch switch-row");
  const archivedBox = el("input"); archivedBox.type = "checkbox";
  archivedSwitch.append(archivedBox, el("span", "track"), el("span", "switch-label", "mostrar arquivadas"));
  archivedBox.addEventListener("change", () => deps.setShowArchived(archivedBox.checked));
  let peopleRefreshed = false;

  async function refreshPeople(): Promise<void> {
    if (refreshing) return;
    refreshing = true; refreshBtn.disabled = true; refreshBtn.textContent = "Lendo a caixa…";
    try {
      const r = await deps.api.supportRefresh();
      if (r.warning !== null) { deps.noteEl.hidden = false; deps.noteEl.textContent = `⚠ ${r.warning}`; }
      deps.reinit(await deps.api.list(), deps.selected());
    } catch (err) { deps.showError("caixa de entrada", err); }
    finally { refreshing = false; refreshBtn.disabled = false; refreshBtn.textContent = "Atualizar pessoas"; }
  }

  return {
    paint: (support) => {
      document.body.classList.add("admin");
      const h1 = document.querySelector("h1"); if (h1 !== null) h1.textContent = "Suporte: escolha uma pessoa";
      const sub = document.querySelector(".sub"); if (sub !== null) sub.textContent = "Cada pessoa é uma janela, só leitura + ações de suporte. ↑↓ escolhe · Enter abre · Esc fecha";
      deps.filterEl.placeholder = "filtrar pessoas…";
      document.title = "meu-bot-admin · escolher pessoa";
      if (!support.adminKey) { deps.noteEl.hidden = false; deps.noteEl.textContent = MISSING_ADMIN_KEY_TEXT; }
      // O interruptor só aparece quando há alguém arquivado.
      archivedSwitch.hidden = !support.people.some((p) => p.archived);
      if (addBox.isConnected) return;
      addBox.className = "add-person";
      const open = el("button", "btn btn-ghost btn-small", "Adicionar pessoa"); open.type = "button";
      const form = el("div", "add-form"); form.hidden = true;
      const input = el("textarea"); input.rows = 2; input.placeholder = "Cole aqui o código de suporte (MBS1.…) que a pessoa mandou";
      const add = el("button", "btn btn-primary btn-small", "Adicionar"); add.type = "button";
      const msg = el("p", "add-msg"); msg.hidden = true;
      open.addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) input.focus(); });
      add.addEventListener("click", () => {
        add.disabled = true;
        void deps.api.supportAdd(input.value).then(async (p) => {
          msg.hidden = false; msg.textContent = `✓ ${p.name} adicionada`; input.value = ""; form.hidden = true;
          deps.reinit(await deps.api.list(), p.alias);
        }).catch((err: unknown) => { msg.hidden = false; msg.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { add.disabled = false; });
      });
      form.append(input, add);
      // Produtos: é aqui que um MVP de bot vertical (meu-bot-fit, meu-bot-vendas…) nasce; a lista e o formulário
      // são os mesmos da página "Produtos" da janela de uma pessoa.
      const prodBtn = el("button", "btn btn-ghost btn-small", "◆ Novo MVP / Produtos"); prodBtn.type = "button"; prodBtn.title = "Registrar um novo bot personalizado (MVP) ou ver os produtos que saem deste código";
      const prodBox = el("div", "add-form produtos-box"); prodBox.hidden = true;
      const prodView = mountProdutosView({ container: prodBox, api: { listar: () => deps.api.produtos(), salvar: (p) => deps.api.produtoSave(p), remover: (n) => deps.api.produtoRemove(n), exportar: (n) => deps.api.produtoExport(n) }, cabecalho: false, fixos: true });
      let prodLoaded = false;
      prodBtn.addEventListener("click", () => { prodBox.hidden = !prodBox.hidden; if (!prodBox.hidden) { form.hidden = true; if (!prodLoaded) { prodLoaded = true; void prodView.refresh().then(() => { if (prodBox.querySelectorAll(".admin-card").length <= 1) prodView.novo(); }); } } });
      // Auditoria: só no app do super admin (o botão aparece quando a central confirma).
      const audBtn = el("button", "btn btn-ghost btn-small", "🛡 Auditoria"); audBtn.type = "button"; audBtn.hidden = true;
      audBtn.title = "O que o dono, cada admin, o agente e o sistema fizeram em cada máquina (cópia central, à prova de edição)";
      const audBox = el("div", "add-form auditoria-box"); audBox.hidden = true;
      const audView = mountAuditoriaView({ container: audBox, api: deps.api });
      audBtn.addEventListener("click", () => { audBox.hidden = !audBox.hidden; if (!audBox.hidden) { form.hidden = true; prodBox.hidden = true; void audView.refresh(); } });
      void deps.api.auditoriaMaquinas().then((r) => { audBtn.hidden = !r.superAdmin; }).catch(() => { /* sem central: sem botão */ });
      const row = el("div", "add-actions"); row.append(open, refreshBtn, prodBtn, audBtn);
      addBox.append(row, form, msg, prodBox, audBox, archivedSwitch);
      deps.listEl.after(addBox);
    },
    refreshPeopleOnce: () => {
      if (peopleRefreshed) return;
      peopleRefreshed = true; void refreshPeople();
      window.setInterval(() => { if (document.visibilityState === "visible") void refreshPeople(); }, 60_000);
    },
    emptyRow: () => el("li", "row empty", EMPTY_PEOPLE_TEXT),
  };
}
