/**
 * Variante: admin. O que o seletor do meu-bot-admin tem a mais: textos de "pessoas", o "Adicionar pessoa"
 * (colar o código MBS1.…), a leitura da caixa de entrada na primeira abertura e a linha vazia. O picker.ts
 * continua dono da lista e das linhas; aqui só o que é exclusivo do admin.
 */
import type { PickerApi, PickerInit } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { EMPTY_PEOPLE_TEXT, MISSING_ADMIN_KEY_TEXT } from "../lib/admin-view.js";

export interface AdminPickerChromeDeps {
  listEl: HTMLElement;
  filterEl: HTMLInputElement;
  noteEl: HTMLElement;
  api: Pick<PickerApi, "supportAdd" | "supportRefresh" | "list">;
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
  /** Lê a caixa de entrada uma vez por sessão (pessoas que ligaram o suporte aparecem sozinhas). */
  refreshPeopleOnce(): void;
  emptyRow(): HTMLLIElement;
}

export function mountAdminPickerChrome(deps: AdminPickerChromeDeps): AdminPickerChrome {
  const addBox = document.createElement("div");
  const archivedSwitch = el("label", "switch switch-row");
  const archivedBox = el("input"); archivedBox.type = "checkbox";
  archivedSwitch.append(archivedBox, el("span", "track"), el("span", "switch-label", "mostrar arquivadas"));
  archivedBox.addEventListener("change", () => deps.setShowArchived(archivedBox.checked));
  let peopleRefreshed = false;

  async function refreshPeople(): Promise<void> {
    try {
      const r = await deps.api.supportRefresh();
      if (r.warning !== null) { deps.noteEl.hidden = false; deps.noteEl.textContent = `⚠ ${r.warning}`; }
      deps.reinit(await deps.api.list(), deps.selected());
    } catch (err) { deps.showError("caixa de entrada", err); }
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
      addBox.append(open, form, msg, archivedSwitch);
      deps.listEl.after(addBox);
    },
    refreshPeopleOnce: () => { if (!peopleRefreshed) { peopleRefreshed = true; void refreshPeople(); } },
    emptyRow: () => el("li", "row empty", EMPTY_PEOPLE_TEXT),
  };
}
