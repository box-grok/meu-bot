/**
 * Variante: admin. O que o seletor do meu-bot-admin tem a mais: textos de "pessoas", o "Adicionar pessoa"
 * (colar o código MBS1.… ou um host do ~/.ssh/config), o ⇅ "sincronizar ssh" na mesma linha (no lugar do antigo
 * "Atualizar"), a leitura da caixa de entrada na primeira abertura e a linha vazia. O picker.ts
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
  api: Pick<PickerApi, "supportAdd" | "supportRefresh" | "list" | "produtosAbrir" | "vpsNova" | "on">;
  /** O ⇅ do meu-bot (picker.ts): enche o ~/.ssh/config com as máquinas do projeto e, no admin, põe cada uma na lista. */
  syncSsh(): Promise<void>;
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
  // No lugar do antigo "Atualizar": o mesmo ⇅ "sincronizar ssh" do meu-bot. A caixa de entrada continua sendo lida
  // sozinha (ao abrir e a cada 60 s) e também neste clique, antes do sync, para nada se perder.
  const syncBtn = el("button", "shortcut sync", "⇅"); syncBtn.type = "button";
  syncBtn.title = "Sincronizar ssh: acrescenta ao ~/.ssh/config deste Mac as máquinas do projeto que ainda faltam e põe cada uma na lista (lê a caixa de entrada antes)";
  syncBtn.setAttribute("aria-label", "sincronizar ssh");
  let syncing = false;
  syncBtn.addEventListener("click", () => {
    if (syncing) return;
    syncing = true; syncBtn.disabled = true;
    void refreshPeople().then(() => deps.syncSsh()).finally(() => { syncing = false; syncBtn.disabled = false; });
  });
  const archivedSwitch = el("label", "switch switch-row");
  const archivedBox = el("input"); archivedBox.type = "checkbox";
  archivedSwitch.append(archivedBox, el("span", "track"), el("span", "switch-label", "mostrar arquivadas"));
  archivedBox.addEventListener("change", () => deps.setShowArchived(archivedBox.checked));
  let peopleRefreshed = false;

  async function refreshPeople(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const r = await deps.api.supportRefresh();
      // Aviso da caixa (não respondeu) só fora do sync: a nota do sync é progresso e resultado, não pode ser coberta.
      if (r.warning !== null && !syncing) { deps.noteEl.hidden = false; deps.noteEl.textContent = `⚠ ${r.warning}`; }
      deps.reinit(await deps.api.list(), deps.selected());
    } catch (err) { deps.showError("caixa de entrada", err); }
    finally { refreshing = false; }
  }

  return {
    paint: (support) => {
      document.body.classList.add("admin");
      const h1 = document.querySelector("h1"); if (h1 !== null) h1.textContent = "Suporte: escolha uma pessoa";
      const sub = document.querySelector(".sub"); if (sub !== null) sub.textContent = "Cada pessoa é uma janela de suporte. ↑↓ escolhe · Enter abre · Esc fecha";
      deps.filterEl.placeholder = "filtrar pessoas…";
      document.title = "meu-bot-admin-gestao · escolher pessoa";
      if (!support.adminKey) { deps.noteEl.hidden = false; deps.noteEl.textContent = MISSING_ADMIN_KEY_TEXT; }
      // O interruptor só aparece quando há alguém arquivado.
      archivedSwitch.hidden = !support.people.some((p) => p.archived);
      if (addBox.isConnected) return;
      addBox.className = "add-person";
      const open = el("button", "btn btn-ghost btn-small", "Adicionar"); open.type = "button";
      const form = el("div", "add-form"); form.hidden = true;
      const input = el("textarea"); input.rows = 2; input.placeholder = "Cole o código de suporte (MBS1.…) que a pessoa mandou, ou um host do seu ~/.ssh/config (ssh agente-box-lv)";
      const add = el("button", "btn btn-primary btn-small", "Adicionar"); add.type = "button";
      const msg = el("p", "add-msg"); msg.hidden = true;
      open.addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) { vpsForm.hidden = true; input.focus(); } });
      add.addEventListener("click", () => {
        add.disabled = true;
        void deps.api.supportAdd(input.value).then(async (p) => {
          msg.hidden = false; msg.textContent = input.value.trim().startsWith("MBS1.") ? `✓ ${p.name} adicionada` : `✓ ${p.name} adicionada · preparando sozinho: Claude Code, login (abre no Terminal se faltar) e backend`; input.value = ""; form.hidden = true;
          deps.reinit(await deps.api.list(), p.alias);
        }).catch((err: unknown) => { msg.hidden = false; msg.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { add.disabled = false; });
      });
      form.append(input, add);
      // "Nova VPS": a VPS nasceu com a chave deste Mac cadastrada no painel; daqui um clique a leva ao fluxo inteiro
      // (alias root neste Mac, pessoa na lista, Preparar máquina, primeiro usuário). Progresso linha a linha abaixo.
      const vpsBtn = el("button", "btn btn-ghost btn-small", "Nova VPS"); vpsBtn.type = "button";
      vpsBtn.title = "Leva uma VPS recém-criada ao fluxo do meu-bot: alias root no ~/.ssh/config deste Mac, pessoa na lista, Preparar máquina e o primeiro usuário. A VPS precisa ter a chave ~/.ssh/id_ed25519.pub deste Mac cadastrada no painel do provedor";
      const vpsForm = el("div", "add-form vps-form"); vpsForm.hidden = true;
      const campo = (placeholder: string, valor = ""): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = placeholder; i.value = valor; i.spellcheck = false; return i; };
      const endereco = campo("IP ou endereço da VPS (ex.: 187.41.115.200)");
      const nome = campo("nome curto da máquina (vira <nome>-root e o nome na lista; ex.: agente)");
      const porta = campo("porta (22)");
      const dominio = campo("domínio do link público (opcional; ex.: meubot.com.br)");
      const caixa = (texto: string, marcado: boolean, title: string): { wrap: HTMLLabelElement; box: HTMLInputElement } => { const box = el("input"); box.type = "checkbox"; box.checked = marcado; const wrap = el("label", "switch-row"); wrap.title = title; wrap.append(box, el("span", "", texto)); return { wrap, box }; };
      const chromium = caixa("Chromium na tela do bot", false, "300 a 600 MB de RAM por janela aberta");
      const usuario1 = caixa("Criar o primeiro usuário (box-1)", true, "Conta box-1 com meu-bot, backend, Hermes e transcrição; depois é só o QR do WhatsApp");
      const reinstalada = caixa("VPS reinstalada (mesmo endereço, chave do servidor nova)", false, "Tira a chave antiga deste endereço do known_hosts antes de entrar");
      const go = el("button", "btn btn-primary btn-small", "Entrar no fluxo"); go.type = "button";
      const vpsLog = el("pre", "vps-log"); vpsLog.hidden = true;
      const vpsMsg = el("p", "add-msg"); vpsMsg.hidden = true;
      const bloco = el("pre", "vps-bloco"); bloco.hidden = true;
      const copiar = el("button", "btn btn-ghost btn-small", "Copiar bloco para o config/ssh-hosts.conf"); copiar.type = "button"; copiar.hidden = true;
      copiar.addEventListener("click", () => { void navigator.clipboard.writeText(bloco.textContent ?? "").then(() => { copiar.textContent = "✓ copiado"; }).catch(() => { copiar.textContent = "não consegui copiar: selecione o bloco"; }); });
      deps.api.on("picker:vps-nova-progresso", (p) => {
        const line = String((p as { line?: unknown } | null)?.line ?? "");
        if (line === "") return;
        vpsLog.hidden = false;
        vpsLog.textContent = `${vpsLog.textContent ?? ""}${line}\n`.split("\n").slice(-16).join("\n");
      });
      vpsBtn.addEventListener("click", () => { vpsForm.hidden = !vpsForm.hidden; if (!vpsForm.hidden) { form.hidden = true; endereco.focus(); } });
      go.addEventListener("click", () => {
        go.disabled = true; vpsLog.textContent = ""; vpsLog.hidden = true; vpsMsg.hidden = true; bloco.hidden = true; copiar.hidden = true; copiar.textContent = "Copiar bloco para o config/ssh-hosts.conf";
        void deps.api.vpsNova({ endereco: endereco.value, nome: nome.value, porta: porta.value.trim() === "" ? 22 : Number(porta.value), dominio: dominio.value, chromium: chromium.box.checked, primeiroUsuario: usuario1.box.checked, reinstalada: reinstalada.box.checked }).then(async (r) => {
          vpsMsg.hidden = false; vpsMsg.textContent = r.texto;
          if (!r.plano.some((x) => x.id === "modelo" && x.estado === "feito")) { bloco.hidden = false; bloco.textContent = r.blocoModelo; copiar.hidden = false; }
          deps.noteEl.hidden = false; deps.noteEl.className = `note ${r.plano.some((x) => x.estado === "pendente") ? "warn" : "ok"}`; deps.noteEl.textContent = r.texto;
          deps.reinit(await deps.api.list(), r.suporteAlias);
        }).catch((err: unknown) => { vpsMsg.hidden = false; vpsMsg.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { go.disabled = false; });
      });
      vpsForm.append(endereco, nome, porta, dominio, chromium.wrap, usuario1.wrap, reinstalada.wrap, go, vpsLog, vpsMsg, bloco, copiar);
      // Produtos (MVPs de bots verticais) moram numa janela própria (main/admin/produtos-janela.ts); daqui só se abre.
      const prodBtn = el("button", "btn btn-ghost btn-small", "◆ Produtos ↗"); prodBtn.type = "button"; prodBtn.title = "Abre a janela Produtos: registrar um novo bot personalizado (MVP) e ver o que já sai deste código";
      prodBtn.addEventListener("click", () => { void deps.api.produtosAbrir().catch((err: unknown) => deps.showError("produtos", err)); });
      const row = el("div", "add-actions"); row.append(open, vpsBtn, el("span", "foot-caption", "sincronizar ssh"), syncBtn, prodBtn);
      addBox.append(row, form, msg, vpsForm, archivedSwitch);
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
