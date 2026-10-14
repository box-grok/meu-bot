import type { BackendModel, BackendStatusEvent, DoneEvent, ErrorEvent, SettingsView, StoredConversationView } from "../shared/ipc";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} não existe`);
  return el as T;
};

const tabsEl = $<HTMLElement>("tabs");
const panelsEl = $<HTMLElement>("panels");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("btn-send");
const newBtn = $<HTMLButtonElement>("btn-new");
const settingsBtn = $<HTMLButtonElement>("btn-settings");
const keyPill = $<HTMLSpanElement>("key-pill");
const hostPill = $<HTMLSpanElement>("host-pill");
const statusPill = $<HTMLSpanElement>("status-pill");
const dialog = $<HTMLDialogElement>("settings-dialog");
const form = $<HTMLFormElement>("settings-form");
const sshHostInput = $<HTMLInputElement>("ssh-host");
const sshHostsList = $<HTMLDataListElement>("ssh-hosts");
const sshHostHint = $<HTMLParagraphElement>("ssh-host-hint");
const backendModelSelect = $<HTMLSelectElement>("backend-model");
const backendPortInput = $<HTMLInputElement>("backend-port");
const settingsError = $<HTMLParagraphElement>("settings-error");
const cancelBtn = $<HTMLButtonElement>("btn-cancel");

interface Tab {
  id: string;
  tabEl: HTMLElement;
  titleEl: HTMLElement;
  dotEl: HTMLElement;
  messagesEl: HTMLElement;
  currentAssistant: HTMLElement | null;
  busy: boolean;
  draft: string;
  /** Já tem título automático pela primeira mensagem. */
  titled: boolean;
  /** Nome dado pelo usuário; não é trocado pelo título automático. */
  customTitle: boolean;
}

const tabs = new Map<string, Tab>();
let activeId: string | null = null;
let tabCount = 0;
let draggingId: string | null = null;

/** Ordem atual das abas no DOM, salva no processo principal. */
function persistOrder(): void {
  const ids = [...tabsEl.querySelectorAll<HTMLElement>(".tab")]
    .map((node) => [...tabs.values()].find((t) => t.tabEl === node)?.id)
    .filter((id): id is string => id !== undefined);
  void window.meuBot.reorderConversations(ids);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const active = (): Tab | null => (activeId === null ? null : (tabs.get(activeId) ?? null));

const scrollToBottom = (tab: Tab): void => { tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight; };

function addNotice(tab: Tab, text: string, kind: "info" | "error" | "warn" = "info"): void {
  const cls = kind === "error" ? "notice notice-error" : kind === "warn" ? "notice notice-warn" : "notice";
  tab.messagesEl.appendChild(el("div", cls, text));
  scrollToBottom(tab);
}

function syncComposer(): void {
  const tab = active();
  const busy = tab?.busy ?? true;
  inputEl.disabled = busy;
  sendBtn.disabled = busy;
  sendBtn.textContent = busy ? "Pensando…" : "Enviar";
  if (!busy) inputEl.focus();
}

function setBusy(tab: Tab, value: boolean): void {
  tab.busy = value;
  tab.tabEl.classList.toggle("busy", value);
  if (tab.id === activeId) syncComposer();
}

function activate(id: string): void {
  const prev = active();
  if (prev !== null) prev.draft = inputEl.value;
  for (const t of tabs.values()) {
    const on = t.id === id;
    t.tabEl.classList.toggle("active", on);
    t.messagesEl.hidden = !on;
    if (on) t.dotEl.hidden = true;
  }
  activeId = id;
  const tab = tabs.get(id);
  inputEl.value = tab?.draft ?? "";
  if (tab !== null && tab !== undefined) scrollToBottom(tab);
  syncComposer();
}

const shorten = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
};

/** Título automático: só quando o usuário não deu um nome. */
function setTitle(tab: Tab, text: string): void {
  if (tab.customTitle) return;
  tab.titleEl.textContent = shorten(text);
  tab.titleEl.title = text.replace(/\s+/g, " ").trim();
  tab.titled = true;
}

function applyCustomTitle(tab: Tab, title: string): void {
  tab.customTitle = true;
  tab.titled = true;
  tab.titleEl.textContent = shorten(title);
  tab.titleEl.title = title;
}

/** Dois cliques no título: campo de edição no lugar. Enter confirma, Esc cancela, vazio volta ao automático. */
function startRename(tab: Tab): void {
  if (tab.tabEl.querySelector("input") !== null) return;
  const input = el("input", "tab-rename");
  input.type = "text";
  input.value = tab.titleEl.title || tab.titleEl.textContent || "";
  input.maxLength = 60;
  tab.titleEl.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (commit: boolean): void => {
    if (finished) return;
    finished = true;
    input.replaceWith(tab.titleEl);
    if (!commit) return;
    const value = input.value.replace(/\s+/g, " ").trim();
    if (value === "") {
      tab.customTitle = false;
      tab.titled = false;
      const firstUser = tab.messagesEl.querySelector(".msg-user");
      if (firstUser !== null) setTitle(tab, firstUser.textContent ?? "");
      else tab.titleEl.textContent = "Nova conversa";
    } else {
      applyCustomTitle(tab, value);
    }
    void window.meuBot.renameConversation(tab.id, value);
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (ev) => ev.stopPropagation());
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (tab === undefined) return;
  tabs.delete(id);
  tab.tabEl.remove();
  tab.messagesEl.remove();
  void window.meuBot.closeConversation(id);
  if (activeId === id) {
    const last = [...tabs.keys()].at(-1);
    if (last !== undefined) activate(last);
    else await newTab();
  }
}

/** Cria a aba de uma conversa já existente (nova ou restaurada do disco). */
function buildTab(conversationId: string, restored?: StoredConversationView): Tab {
  tabCount += 1;
  const tabEl = el("div", "tab");
  const dotEl = el("span", "tab-dot");
  dotEl.hidden = true;
  const titleEl = el("span", "tab-title", `Conversa ${tabCount}`);
  const closeBtn = el("button", "tab-close", "×");
  closeBtn.type = "button";
  closeBtn.title = "Fechar aba";
  tabEl.append(dotEl, titleEl, closeBtn);
  const messagesEl = el("div", "messages");
  messagesEl.setAttribute("aria-live", "polite");
  const tab: Tab = { id: conversationId, tabEl, titleEl, dotEl, messagesEl, currentAssistant: null, busy: false, draft: "", titled: false, customTitle: false };
  tabs.set(conversationId, tab);
  tabsEl.appendChild(tabEl);
  panelsEl.appendChild(messagesEl);
  tabEl.addEventListener("click", () => activate(conversationId));
  tabEl.addEventListener("dblclick", (ev) => { ev.preventDefault(); startRename(tab); });
  tabEl.draggable = true;
  tabEl.addEventListener("dragstart", (ev) => {
    if (tabEl.querySelector("input") !== null) { ev.preventDefault(); return; }
    draggingId = conversationId;
    tabEl.classList.add("dragging");
    ev.dataTransfer?.setData("text/plain", conversationId);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  });
  tabEl.addEventListener("dragend", () => {
    tabEl.classList.remove("dragging");
    draggingId = null;
    persistOrder();
  });
  tabEl.addEventListener("dragover", (ev) => {
    if (draggingId === null || draggingId === conversationId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const dragged = tabs.get(draggingId)?.tabEl;
    if (dragged === undefined) return;
    const rect = tabEl.getBoundingClientRect();
    const before = ev.clientX < rect.left + rect.width / 2;
    const next = before ? tabEl : tabEl.nextSibling;
    if (dragged !== next) tabsEl.insertBefore(dragged, next);
  });
  tabEl.addEventListener("drop", (ev) => ev.preventDefault());
  closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void closeTab(conversationId); });
  if (restored !== undefined && restored.messages.length > 0) {
    for (const m of restored.messages) {
      tab.messagesEl.appendChild(el("div", m.role === "user" ? "msg msg-user" : "msg msg-assistant", m.content));
    }
    const first = restored.messages.find((m) => m.role === "user");
    if (first !== undefined) setTitle(tab, first.content);
  }
  if (restored?.title !== undefined && restored.title !== "") {
    applyCustomTitle(tab, restored.title);
  } else {
    addNotice(tab, "Nova conversa. Suas mensagens vão pro backend na VM, que roda o Claude Code por baixo.");
  }
  return tab;
}

async function newTab(): Promise<Tab> {
  const { conversationId } = await window.meuBot.newConversation();
  const tab = buildTab(conversationId);
  activate(conversationId);
  return tab;
}

/** Reabre as abas salvas; sem nenhuma, cria a primeira. */
async function restoreTabs(): Promise<void> {
  const saved = await window.meuBot.listConversations();
  const withContent = saved.filter((c) => c.messages.length > 0);
  // Conversas vazias salvas não viram abas; o backend as descarta ao fechar.
  for (const c of saved) if (c.messages.length === 0) void window.meuBot.closeConversation(c.id);
  if (withContent.length === 0) { await newTab(); return; }
  for (const c of withContent) buildTab(c.id, c);
  const latest = [...withContent].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  activate(latest?.id ?? withContent[withContent.length - 1]!.id);
}

function applySettings(view: SettingsView): void {
  keyPill.textContent = `backend VM · ${view.backendModel}`;
  hostPill.textContent = `VM: ${view.sshHost}`;
  sshHostInput.value = view.sshHost;
  backendModelSelect.value = view.backendModel;
  backendPortInput.value = String(view.backendPort);
}

async function sendMessage(): Promise<void> {
  const tab = active();
  const text = inputEl.value.trim();
  if (tab === null || text === "" || tab.busy) return;
  inputEl.value = "";
  tab.draft = "";
  tab.messagesEl.appendChild(el("div", "msg msg-user", text));
  if (!tab.titled) setTitle(tab, text);
  scrollToBottom(tab);
  setBusy(tab, true);
  tab.currentAssistant = null;
  try {
    await window.meuBot.send(tab.id, text);
  } catch (err) {
    addNotice(tab, err instanceof Error ? err.message : String(err), "error");
  } finally {
    if (tabs.has(tab.id)) setBusy(tab, false);
  }
}

const markUnread = (tab: Tab): void => { if (tab.id !== activeId) tab.dotEl.hidden = false; };

window.meuBot.on("chat:assistant-start", ({ conversationId }) => {
  const tab = tabs.get(conversationId);
  if (tab === undefined) return;
  tab.currentAssistant = el("div", "msg msg-assistant");
  tab.messagesEl.appendChild(tab.currentAssistant);
  scrollToBottom(tab);
});
window.meuBot.on("chat:delta", ({ conversationId, text }) => {
  const tab = tabs.get(conversationId);
  if (tab === undefined) return;
  if (tab.currentAssistant === null) {
    tab.currentAssistant = el("div", "msg msg-assistant");
    tab.messagesEl.appendChild(tab.currentAssistant);
  }
  tab.currentAssistant.textContent += text;
  markUnread(tab);
  scrollToBottom(tab);
});
window.meuBot.on("chat:done", (done: DoneEvent) => {
  const tab = tabs.get(done.conversationId);
  if (tab === undefined) return;
  if (tab.currentAssistant !== null && tab.currentAssistant.textContent === "") tab.currentAssistant.remove();
  if (done.refusal !== undefined) {
    const cat = done.refusal.category ?? "não informada";
    addNotice(tab, `A resposta foi recusada pelo modelo (categoria: ${cat}). ${done.refusal.explanation}`.trim(), "warn");
  }
  markUnread(tab);
});
window.meuBot.on("chat:error", (e: ErrorEvent) => {
  const tab = tabs.get(e.conversationId);
  if (tab === undefined) return;
  if (tab.currentAssistant !== null && tab.currentAssistant.textContent === "") tab.currentAssistant.remove();
  addNotice(tab, e.message, "error");
  markUnread(tab);
});
window.meuBot.on("backend:status", (st: BackendStatusEvent) => {
  statusPill.hidden = false;
  statusPill.textContent = st.detail;
  statusPill.className = `pill ${st.state === "ready" ? "pill-on" : st.state === "error" ? "pill-off" : "pill-neutral"}`;
});

tabsEl.addEventListener("dragover", (ev) => {
  if (draggingId === null) return;
  ev.preventDefault();
  const dragged = tabs.get(draggingId)?.tabEl;
  const last = tabsEl.lastElementChild;
  if (dragged !== undefined && last !== null && last !== dragged && ev.clientX > last.getBoundingClientRect().right) tabsEl.appendChild(dragged);
});
tabsEl.addEventListener("drop", (ev) => ev.preventDefault());

sendBtn.addEventListener("click", () => { void sendMessage(); });
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void sendMessage();
  }
});
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "t") { ev.preventDefault(); void newTab(); }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "w" && activeId !== null) { ev.preventDefault(); void closeTab(activeId); }
});
newBtn.addEventListener("click", () => { void newTab(); });
async function fillSshHosts(): Promise<void> {
  const hosts = await window.meuBot.listSshHosts();
  sshHostsList.replaceChildren(...hosts.map((h) => { const o = el("option"); o.value = h; return o; }));
  sshHostHint.textContent = hosts.length > 0
    ? `${hosts.length} host${hosts.length === 1 ? "" : "s"} no seu ~/.ssh/config. Também aceita digitar um hostname. O login precisa funcionar sem senha.`
    : "Nenhum host encontrado no ~/.ssh/config. Digite um hostname; o login precisa funcionar sem senha.";
}

settingsBtn.addEventListener("click", () => {
  settingsError.hidden = true;
  void fillSshHosts();
  dialog.showModal();
});
cancelBtn.addEventListener("click", () => dialog.close());
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  settingsError.hidden = true;
  const port = Number.parseInt(backendPortInput.value, 10);
  const update = {
    sshHost: sshHostInput.value.trim(),
    backendModel: backendModelSelect.value as BackendModel,
    ...(Number.isInteger(port) ? { backendPort: port } : {}),
  };
  window.meuBot.setSettings(update).then(
    (view) => {
      applySettings(view);
      dialog.close();
      const tab = active();
      if (tab !== null) addNotice(tab, "Configurações salvas.");
    },
    (err: unknown) => {
      settingsError.textContent = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(err);
      settingsError.hidden = false;
    },
  );
});

void (async () => {
  applySettings(await window.meuBot.getSettings());
  await restoreTabs();
})();
