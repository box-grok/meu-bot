import type { AccountStatus, ClaudeAuthInfo, ClaudeLoginEvent, WhatsappEvent, WhatsappStatus, BackendModel, BackendStatusEvent, ContextEvent, DoneEvent, ErrorEvent, ExportFormat, MemoryView, SettingsView, StoredConversationView, TabMenuAction, Theme } from "../shared/ipc";
import { hostAccent } from "./lib/host-color.js";
import { renderMarkdown } from "./lib/markdown.js";
import { groupByDate, matches, shortDate, type SidebarConversation } from "./lib/sidebar.js";
import { rankPalette, type PaletteItem } from "./lib/palette-rank.js";
import { buildSegments, thresholdToWarn, timeUntil } from "./lib/status-line.js";
import { advanceOnboard, EXAMPLE_MESSAGE, FINAL_MESSAGE, SKIPPED_MESSAGE, initialOnboardState, ONBOARD_STEPS, pickFeedback, type Feedback, type OnboardEvent, type OnboardState } from "./lib/onboarding.js";

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
const modelSelect = $<HTMLSelectElement>("model-select");
const dialog = $<HTMLDialogElement>("settings-dialog");
const form = $<HTMLFormElement>("settings-form");
/** Máquina desta janela; vem do main em window:info e não muda. */
let windowHost = "";
const lastHostEl = $<HTMLParagraphElement>("last-host");
const backendModelSelect = $<HTMLSelectElement>("backend-model");
const backendPortInput = $<HTMLInputElement>("backend-port");
const fontSizeInput = $<HTMLInputElement>("font-size");
const themeSelect = $<HTMLSelectElement>("theme");
const settingsError = $<HTMLParagraphElement>("settings-error");
const cancelBtn = $<HTMLButtonElement>("btn-cancel");
const notificationsInput = $<HTMLInputElement>("notifications");
const contextBudgetInput = $<HTMLInputElement>("context-budget");
const memoryEveryInput = $<HTMLInputElement>("memory-every");
const memoryPerfil = $<HTMLTextAreaElement>("memory-perfil");
const memoryNotas = $<HTMLTextAreaElement>("memory-notas");
const perfilCount = $<HTMLSpanElement>("perfil-count");
const notasCount = $<HTMLSpanElement>("notas-count");
const ctxLine = $<HTMLElement>("ctx-line");
const quickEnabled = $<HTMLInputElement>("quick-enabled");
const quickShortcut = $<HTMLInputElement>("quick-shortcut");
const quickStatus = $<HTMLSpanElement>("quick-status");
const sidebarEl = $<HTMLElement>("sidebar");
const sidebarBtn = $<HTMLButtonElement>("btn-sidebar");
const sidebarSearch = $<HTMLInputElement>("sidebar-search");
const sidebarArchived = $<HTMLInputElement>("sidebar-archived");
const sidebarList = $<HTMLElement>("sidebar-list");
const paletteBtn = $<HTMLButtonElement>("btn-palette");
const modeBtn = $<HTMLButtonElement>("mode-btn");
const modeLabel = $<HTMLSpanElement>("mode-label");
const modeMenu = $<HTMLDivElement>("mode-menu");
const modeList = $<HTMLUListElement>("mode-list");
const topbarMini = $<HTMLElement>("topbar-mini");
const miniDot = $<HTMLSpanElement>("mini-dot");
const miniText = $<HTMLSpanElement>("mini-text");
const topbarHideBtn = $<HTMLButtonElement>("btn-topbar-hide");
const topbarShowBtn = $<HTMLButtonElement>("btn-topbar-show");
const paletteEl = $<HTMLElement>("palette");
const paletteInput = $<HTMLInputElement>("palette-input");
const paletteList = $<HTMLUListElement>("palette-list");

interface Tab {
  id: string;
  model: BackendModel;
  tabEl: HTMLElement;
  titleEl: HTMLElement;
  modelEl: HTMLElement;
  /** Máquina (host SSH) desta conversa; fixa desde a criação. */
  host: string;
  dotEl: HTMLElement;
  messagesEl: HTMLElement;
  /** Acompanhar o fim durante a resposta: só enquanto a pessoa estiver perto do fim. Rolou para cima para ler = fica onde está. */
  followBottom: boolean;
  currentAssistant: HTMLElement | null;
  /** Texto acumulado da resposta em andamento (renderizado com throttle). */
  pendingText: string;
  renderTimer: number | null;
  busy: boolean;
  draft: string;
  /** Já tem título automático pela primeira mensagem. */
  titled: boolean;
  /** Nome dado pelo usuário; não é trocado pelo título automático. */
  customTitle: boolean;
  context: ContextEvent | null;
  /** Último turno concluído (status line). */
  lastTurn: { ms: number; completion: number } | null;
}

const tabs = new Map<string, Tab>();
/** Todas as conversas conhecidas (abertas ou não), para a lista lateral e a paleta. */
const index = new Map<string, StoredConversationView>();
let activeId: string | null = null;
let tabCount = 0;
let draggingId: string | null = null;
let settings: SettingsView | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const active = (): Tab | null => (activeId === null ? null : (tabs.get(activeId) ?? null));
/** Rola até o fim. Sem `force`, só se a pessoa já estava acompanhando o fim (não puxa quem rolou para cima para ler). */
const scrollToBottom = (tab: Tab, force = true): void => {
  if (!force && !tab.followBottom) return;
  tab.followBottom = true;
  tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
};
const NEAR_BOTTOM_PX = 48;
const nearBottom = (elm: HTMLElement): boolean => elm.scrollHeight - elm.scrollTop - elm.clientHeight <= NEAR_BOTTOM_PX;

function addNotice(tab: Tab, text: string, kind: "info" | "error" | "warn" = "info"): void {
  const cls = kind === "error" ? "notice notice-error" : kind === "warn" ? "notice notice-warn" : "notice";
  tab.messagesEl.appendChild(el("div", cls, text));
  scrollToBottom(tab, false);
}

/** Resposta do assistente: Markdown sanitizado. Mensagens do usuário continuam texto puro. */
function renderAssistant(target: HTMLElement, text: string): void {
  let body = target.querySelector<HTMLElement>(":scope > .md-body");
  if (body === null) { body = el("div", "md-body"); target.prepend(body); }
  body.replaceChildren(renderMarkdown(text));
}

function flushRender(tab: Tab): void {
  tab.renderTimer = null;
  if (tab.currentAssistant !== null) renderAssistant(tab.currentAssistant, tab.pendingText);
  scrollToBottom(tab, false);
}

function scheduleRender(tab: Tab): void {
  if (tab.renderTimer !== null) return;
  tab.renderTimer = window.setTimeout(() => flushRender(tab), 80);
}

function syncComposer(): void {
  const tab = active();
  const busy = tab?.busy ?? true;
  inputEl.disabled = busy;
  sendBtn.disabled = tab === null;
  sendBtn.textContent = busy ? "Parar" : "Enviar";
  sendBtn.classList.toggle("btn-bad", busy);
  modelSelect.disabled = tab === null;
  applyModelAvailability(modelSelect, tab === null ? null : tab.host);
  if (tab !== null) modelSelect.value = tab.model;
  paintModeButton();
  keyPill.textContent = tab === null ? "backend" : `backend · ${tab.model}`;
  hostPill.textContent = `máquina: ${hostLabel(windowHost)}`;
  paintStatus(windowHost);
  paintContext(tab);
  if (!busy) inputEl.focus();
}

function describeContext(c: ContextEvent): string {
  const base = c.mode === "full" ? `contexto: ${c.total} msgs inteiras`
    : c.mode === "summary" ? `contexto: resumo + ${c.sent} de ${c.total} msgs`
    : `contexto: ${c.sent} de ${c.total} msgs (sem resumo ainda)`;
  return c.summarizing ? `${base} · resumindo…` : base;
}

/** Conta e limites do Claude nesta máquina (GET /v1/meu-bot/status); null = backend sem o endpoint. */
let account: AccountStatus | null = null;
/** Último limiar de sessão já avisado nesta janela (80, 90 ou 95); zera quando a sessão renova. */
let warnedThreshold = 0;

/** Status line no rodapé da conversa, no modelo do statusline.sh da box: modelo | Ctx | conta | Sessão | Semanal. */
function paintContext(tab: Tab | null): void {
  if (tab === null) { ctxLine.hidden = true; return; }
  const ctx = tab.context !== null && tab.context.tokens !== undefined && tab.context.budget !== undefined ? { tokens: tab.context.tokens, budget: tab.context.budget } : null;
  const segs = buildSegments({ model: tab.model, ctx, turn: tab.lastTurn, account });
  ctxLine.hidden = false;
  ctxLine.replaceChildren(...segs.flatMap((s, i) => {
    const span = el("span", `seg seg-${s.kind}`, s.text);
    if (s.title !== undefined) span.title = s.title;
    return i === 0 ? [span] : [el("span", "seg-sep", "|"), span];
  }));
  if (tab.context !== null && tab.context.total > 0) ctxLine.title = describeContext(tab.context);
}

/** Mesma regra do alerta do Hermes no WhatsApp: avisa ao cruzar 80, 90 e 95% da sessão de 5 h. */
function checkSessionThreshold(): void {
  const pct = account?.sessionPct ?? null;
  if (pct !== null && pct < 80) warnedThreshold = 0;
  const t = thresholdToWarn(pct, warnedThreshold);
  if (t === null || account === null) return;
  warnedThreshold = t;
  const tab = active();
  if (tab === null) return;
  const renew = account.sessionResets !== null ? ` Renova em ${timeUntil(account.sessionResets)}.` : "";
  addNotice(tab, `⚠ Sessão do Claude em ${Math.round(pct ?? 0)}% do limite de 5 h.${renew}`, "warn");
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
  if (tab !== undefined) scrollToBottom(tab);
  syncComposer();
  renderSidebar();
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
    const v = index.get(tab.id);
    if (v !== undefined) patchIndex(tab.id, { title: value === "" ? undefined : value, updatedAt: v.updatedAt });
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (ev) => ev.stopPropagation());
}

/** Ordem atual das abas no DOM, salva no processo principal. */
function persistOrder(): void {
  const ids = [...tabsEl.querySelectorAll<HTMLElement>(".tab")]
    .map((node) => [...tabs.values()].find((t) => t.tabEl === node)?.id)
    .filter((id): id is string => id !== undefined);
  void window.meuBot.reorderConversations(ids);
}

function setTabModel(tab: Tab, model: BackendModel): void {
  tab.model = model;
  refreshTabBadges();
  if (tab.id === activeId) syncComposer();
}

/** Badge da aba: o modelo; a máquina é a da janela inteira. */
function refreshTabBadges(): void {
  for (const t of tabs.values()) {
    t.modelEl.textContent = t.model;
    t.tabEl.title = `Máquina: ${hostLabel(t.host)} · modelo: ${t.model}`;
  }
}

/** Modelos anunciados por cada host (preenchido pela sondagem das Configurações). */
const hostModels = new Map<string, string[]>();
/** Desabilita no <select> os modelos que o host não oferece; host nunca sondado deixa tudo liberado. */
function applyModelAvailability(select: HTMLSelectElement, host: string | null): void {
  const avail = host === null ? undefined : hostModels.get(host);
  for (const opt of select.options) {
    const off = avail !== undefined && avail.length > 0 && !avail.includes(opt.value);
    opt.disabled = off;
    opt.textContent = `${opt.textContent?.replace(/ · não existe nesta máquina$/, "") ?? opt.value}${off ? " · não existe nesta máquina" : ""}`;
  }
}

/** Último estado do túnel por host; o pill mostra o da conversa ativa. */
const hostStatus = new Map<string, BackendStatusEvent>();
function paintStatus(host: string | null): void {
  paintMini();
  const st = host === null ? undefined : hostStatus.get(host);
  if (st === undefined) { statusPill.hidden = true; return; }
  statusPill.hidden = false;
  statusPill.textContent = st.state === "degraded" ? `túnel instável: ${st.detail}` : st.detail;
  statusPill.className = `pill ${st.state === "ready" ? "pill-on" : st.state === "error" ? "pill-off" : "pill-neutral"}`;
}

/** Tira a aba da tela; a conversa continua na lista lateral. */
function detachTab(id: string): void {
  const tab = tabs.get(id);
  if (tab === undefined) return;
  tabs.delete(id);
  refreshTabBadges();
  tab.tabEl.remove();
  tab.messagesEl.remove();
}

async function afterTabGone(id: string): Promise<void> {
  if (activeId !== id) { renderSidebar(); return; }
  const last = [...tabs.keys()].at(-1);
  if (last !== undefined) activate(last);
  else await newTab();
}

async function closeTab(id: string): Promise<void> {
  if (!tabs.has(id)) return;
  detachTab(id);
  const cur = index.get(id);
  if (cur !== undefined && cur.messages.length === 0) {
    index.delete(id);
    void window.meuBot.deleteConversation(id);
  } else {
    patchIndex(id, { openAsTab: false, updatedAt: cur?.updatedAt });
    void window.meuBot.closeConversation(id);
  }
  await afterTabGone(id);
}

async function deleteConversation(id: string): Promise<void> {
  const cur = index.get(id);
  const name = cur !== undefined ? titleOf(cur) : "esta conversa";
  if (!window.confirm(`Excluir "${name}"? Isso apaga o histórico de vez.`)) return;
  detachTab(id);
  index.delete(id);
  renderSidebar();
  void window.meuBot.deleteConversation(id);
  await afterTabGone(id);
}

async function archive(id: string, archived: boolean): Promise<void> {
  const cur = index.get(id);
  if (archived) detachTab(id);
  patchIndex(id, { archived, openAsTab: archived ? false : (cur?.openAsTab ?? false), updatedAt: cur?.updatedAt });
  await window.meuBot.archiveConversation(id, archived);
  if (archived) await afterTabGone(id);
}

/** Abre (ou foca) a aba de uma conversa da lista. */
async function openFromIndex(id: string): Promise<void> {
  if (tabs.has(id)) { activate(id); return; }
  const view = await window.meuBot.openConversation(id);
  if (view === null) return;
  upsertIndex(view);
  buildTab(view.id, view.model, view.host, view);
  activate(view.id);
}

async function duplicate(id: string): Promise<void> {
  const view = await window.meuBot.duplicateConversation(id);
  if (view === null) return;
  upsertIndex(view);
  const tab = buildTab(view.id, view.model, view.host, view);
  const origin = tabs.get(id)?.tabEl;
  if (origin !== undefined) origin.after(tab.tabEl);
  persistOrder();
  activate(view.id);
}

async function branchFrom(id: string, messageIndex: number): Promise<void> {
  const view = await window.meuBot.branchConversation(id, messageIndex);
  if (view === null) { const t = tabs.get(id); if (t !== undefined) addNotice(t, "Não dá pra ramificar agora (resposta em andamento?).", "warn"); return; }
  upsertIndex(view);
  buildTab(view.id, view.model, view.host, view);
  activate(view.id);
}

async function exportConversation(id: string, format: ExportFormat): Promise<void> {
  const result = await window.meuBot.exportConversation(id, format);
  const tab = active();
  if (tab !== null) addNotice(tab, result === null ? "Exportação cancelada." : `Exportado em ${result.path}`);
}

async function showTabMenu(tab: Tab): Promise<void> {
  const cur = index.get(tab.id);
  const action: TabMenuAction | null = await window.meuBot.showTabMenu(tab.id, { busy: tab.busy, archived: cur?.archived ?? false });
  await runTabAction(tab.id, action);
}

async function runTabAction(id: string, action: TabMenuAction | null): Promise<void> {
  const tab = tabs.get(id);
  switch (action) {
    case "rename": if (tab !== undefined) startRename(tab); else { const v = index.get(id); if (v !== undefined) { const name = window.prompt("Novo nome:", titleOf(v)); if (name !== null) { patchIndex(id, { title: name.trim() || undefined, updatedAt: v.updatedAt }); void window.meuBot.renameConversation(id, name); } } } break;
    case "duplicate": await duplicate(id); break;
    case "export-md": await exportConversation(id, "md"); break;
    case "export-json": await exportConversation(id, "json"); break;
    case "archive": await archive(id, true); break;
    case "unarchive": await archive(id, false); break;
    case "close": await closeTab(id); break;
    case "delete": await deleteConversation(id); break;
    default: break;
  }
}

function maybeNotify(tab: Tab, body: string): void {
  if (settings?.notifications !== true) return;
  if (document.hasFocus() && tab.id === activeId) return;
  const cur = index.get(tab.id);
  void window.meuBot.notify(tab.id, cur !== undefined ? titleOf(cur) : "meu-bot", body.replace(/\s+/g, " ").trim().slice(0, 140));
}

/* ---------- Lista lateral ---------- */
let sidebarTimer: number | null = null;

function renderSidebar(): void {
  if (sidebarTimer !== null) return;
  sidebarTimer = window.setTimeout(() => { sidebarTimer = null; paintSidebar(); }, 30);
}

function paintSidebar(): void {
  const query = sidebarSearch.value;
  const showArchived = sidebarArchived.checked;
  const rows: (SidebarConversation & { view: StoredConversationView })[] = [...index.values()]
    .filter((c) => c.messages.length > 0 && (showArchived || !c.archived))
    .map((c) => ({ id: c.id, title: titleOf(c), updatedAt: c.updatedAt, archived: c.archived, text: c.messages.map((m) => m.content).join("\n"), view: c }))
    .filter((c) => matches(c, query));
  sidebarList.replaceChildren();
  if (rows.length === 0) { sidebarList.appendChild(el("div", "sidebar-empty", query ? "Nada encontrado." : "Nenhuma conversa ainda.")); return; }
  for (const group of groupByDate(rows)) {
    sidebarList.appendChild(el("div", "sidebar-group", group.label));
    for (const row of group.items) {
      const item = el("div", `sidebar-item${row.id === activeId ? " active" : ""}${row.archived ? " archived" : ""}`);
      item.dataset["id"] = row.id;
      item.appendChild(el("span", "si-title", row.title));
      if (tabs.has(row.id)) item.appendChild(el("span", "si-tab", "aba"));
      item.appendChild(el("span", "si-date", shortDate(row.updatedAt)));
      const menu = el("button", "si-menu", "…");
      menu.type = "button";
      menu.title = "Ações";
      menu.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void window.meuBot.showTabMenu(row.id, { busy: tabs.get(row.id)?.busy ?? false, archived: row.archived }).then((a) => runTabAction(row.id, a));
      });
      item.appendChild(menu);
      item.addEventListener("click", () => { void openFromIndex(row.id); });
      sidebarList.appendChild(item);
    }
  }
}

/** Barra recolhida por padrão; a escolha fica no localStorage da janela. */
function setTopbarHidden(hidden: boolean): void {
  document.body.classList.toggle("topbar-hidden", hidden);
  topbarMini.hidden = !hidden;
  try { localStorage.setItem("topbarShown", hidden ? "0" : "1"); } catch { /* opcional */ }
  paintMini();
}
function paintMini(): void {
  if (topbarMini.hidden) return;
  const st = hostStatus.get(windowHost);
  const tab = active();
  miniDot.className = `mini-dot ${st === undefined ? "" : st.state === "ready" ? "ok" : st.state === "error" ? "bad" : "warn"}`;
  miniText.textContent = `${hostLabel(windowHost)}${tab !== null ? ` · ${tab.model}` : ""}${st !== undefined ? ` · ${st.detail}` : ""}`;
}

/** Botão e menu "Modos do agente", espelhando o <select> escondido (que continua sendo a fonte do valor). */
function paintModeButton(): void {
  const cur = modelSelect.selectedOptions[0];
  const text = cur?.textContent?.replace(/ · não existe nesta máquina$/, "") ?? modelSelect.value;
  modeLabel.textContent = text.split(" · ")[0] ?? text;
  modeBtn.title = `Modo do agente nesta conversa: ${text}`;
  modeBtn.disabled = modelSelect.disabled;
}
function paintModeMenu(): void {
  modeList.replaceChildren();
  for (const opt of modelSelect.options) {
    const label = (opt.textContent ?? opt.value).replace(/ · não existe nesta máquina$/, "");
    const [name, ...rest] = label.split(" · ");
    const li = el("li", `mode-item${opt.disabled ? " off" : ""}${opt.value === modelSelect.value ? " current" : ""}`);
    li.setAttribute("role", "option");
    li.append(el("span", "tick", opt.value === modelSelect.value ? "✓" : ""), el("span", "name", name ?? opt.value), el("span", "desc", rest.join(" · ")));
    if (!opt.disabled) li.addEventListener("click", () => { modelSelect.value = opt.value; modelSelect.dispatchEvent(new Event("change")); modeMenu.hidden = true; paintModeButton(); });
    modeList.appendChild(li);
  }
}
modeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); if (modeMenu.hidden) { paintModeMenu(); modeMenu.hidden = false; } else modeMenu.hidden = true; });
document.addEventListener("click", (ev) => { if (!modeMenu.hidden && !(ev.target as HTMLElement).closest(".mode-wrap")) modeMenu.hidden = true; });

function toggleSidebar(force?: boolean): void {
  const hidden = force === undefined ? !sidebarEl.hidden : !force;
  sidebarEl.hidden = hidden;
  if (!hidden) {
    // Entra deslizando com um brilho curto: quem apertou Cmd+B olhando o teclado percebe que ela apareceu.
    sidebarEl.classList.remove("reveal");
    void sidebarEl.offsetWidth; // reinicia a animação
    sidebarEl.classList.add("reveal");
    window.setTimeout(() => sidebarEl.classList.remove("reveal"), 3700);
    onboardEvent("sidebar");
  }
  try { localStorage.setItem("sidebarShown", hidden ? "0" : "1"); } catch { /* opcional */ }
}

/* ---------- Paleta de comandos ---------- */
let paletteItems: PaletteItem[] = [];
let paletteSelected = 0;
const paletteActions = new Map<string, () => void | Promise<void>>();

function focusSettingsField(id: string): void {
  settingsBtn.click();
  window.setTimeout(() => document.getElementById(id)?.focus(), 50);
}

function buildPaletteItems(): PaletteItem[] {
  paletteActions.clear();
  const items: PaletteItem[] = [];
  const add = (item: PaletteItem, run: () => void | Promise<void>): void => { items.push(item); paletteActions.set(item.id, run); };
  const cur = active();
  add({ id: "a:new", kind: "action", label: "Nova conversa", detail: "Cmd+N" }, async () => { await newTab(); });
  add({ id: "a:settings", kind: "action", label: "Configurações" }, () => settingsBtn.click());
  add({ id: "a:sidebar", kind: "action", label: "Mostrar ou ocultar lista de conversas", detail: "Cmd+B" }, () => toggleSidebar());
  add({ id: "a:topbar", kind: "action", label: "Recolher ou mostrar a barra superior", detail: "Cmd+Shift+B" }, () => setTopbarHidden(!document.body.classList.contains("topbar-hidden")));
  add({ id: "a:claude-login", kind: "action", label: "Entrar no Claude Code nesta máquina", detail: "claude auth login por SSH: link no navegador + código", keywords: ["login", "claude", "deslogado", "entrar"] }, () => { openClaudeLogin(); void runClaudeLogin(); });
  add({ id: "a:whatsapp", kind: "action", label: "WhatsApp: estado e pareamento por QR", detail: waStatus?.present ? (waStatus.connected ? `conectado · ${fmtPhone(waStatus.number)}` : "desconectado") : "só em máquinas com Hermes ou OpenClaw", keywords: ["whatsapp", "qr", "parear", "hermes", "openclaw"] }, async () => { await refreshWhatsapp(); if (waStatus?.present) openWhatsapp(); else { const tab = active(); if (tab !== null) addNotice(tab, "Esta máquina não tem agente com WhatsApp (Hermes ou OpenClaw).", "warn"); } });
  add({ id: "a:tailscale-off", kind: "action", label: "Tailscale: desligar verificação do SSH", detail: "edita a política do tailnet: check → accept", keywords: ["tailscale", "ssh", "check", "verificação"] }, async () => {
    const r = await window.meuBot.disableTailscaleCheck();
    const tab = active();
    if (tab !== null) addNotice(tab, r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`, r.ok ? "info" : "error");
  });
  add({ id: "a:tailscale-restore", kind: "action", label: "Tailscale: restaurar política do último backup", detail: "desfaz a última edição", keywords: ["tailscale", "backup", "restaurar"] }, async () => {
    const r = await window.meuBot.restoreTailscalePolicy();
    const tab = active();
    if (tab !== null) addNotice(tab, r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`, r.ok ? "info" : "error");
  });
  add({ id: "a:onboard", kind: "action", label: "Rever onboarding", detail: "começa agora nesta janela" }, async () => {
    try { applySettings(await window.meuBot.setSettings({ onboarding: "pending" })); } catch { /* segue mesmo assim */ }
    startOnboarding();
  });
  add({ id: "a:quick", kind: "action", label: "Entrada rápida: mostrar", detail: settings?.quickEntryShortcut ?? "" }, () => window.meuBot.toggleQuickEntry());
  if (cur !== null) {
    add({ id: "a:rename", kind: "action", label: "Renomear conversa atual" }, () => startRename(cur));
    add({ id: "a:export-md", kind: "action", label: "Exportar conversa atual em Markdown" }, () => exportConversation(cur.id, "md"));
    add({ id: "a:export-json", kind: "action", label: "Exportar conversa atual em JSON" }, () => exportConversation(cur.id, "json"));
    add({ id: "a:archive", kind: "action", label: "Arquivar conversa atual" }, () => archive(cur.id, true));
    add({ id: "a:close", kind: "action", label: "Fechar aba atual", detail: "Cmd+W" }, () => closeTab(cur.id));
    for (const m of ["claudecode", "agente", "rene-dm", "rene", "grok-4"] as const) {
      add({ id: `a:model:${m}`, kind: "action", label: `Usar modelo ${m} nesta conversa` }, () => { setTabModel(cur, m); void window.meuBot.setConversationModel(cur.id, m); });
    }
  }
  for (const c of index.values()) {
    if (c.messages.length === 0) continue;
    add({
      id: `c:${c.id}`, kind: "conversation", label: titleOf(c),
      detail: `${c.model}${c.archived ? " · arquivada" : ""} · ${shortDate(c.updatedAt)}`,
      keywords: c.messages.filter((m) => m.role === "user").map((m) => m.content.slice(0, 500)),
      recency: new Date(c.updatedAt).getTime(),
    }, () => openFromIndex(c.id));
  }
  add({ id: "a:new-window", kind: "action", label: "Nova janela em outra máquina", detail: "Cmd+Shift+N", keywords: ["janela", "máquina", "host", "ssh", "trocar"] }, () => { void window.meuBot.openPicker(); });
  const settingsFields: [string, string][] = [["backend-model", "Modelo padrão nesta máquina"], ["backend-port", "Porta do backend"], ["font-size", "Tamanho da fonte"], ["theme", "Tema"], ["notifications", "Notificações"]];
  for (const [id, label] of settingsFields) add({ id: `s:${id}`, kind: "setting", label, detail: "Configurações" }, () => focusSettingsField(id));
  return items;
}

/**
 * Marca o item selecionado sem reconstruir a lista. Reconstruir (replaceChildren) zera a rolagem: era o
 * "pulo para cima" ao mover o mouse sobre a lista rolada. `scroll` só no teclado; com o mouse o item já
 * está à vista.
 */
function selectPalette(i: number, scroll: boolean): void {
  const lis = paletteList.querySelectorAll<HTMLElement>("li[role=option]");
  if (lis.length === 0) { paletteSelected = 0; return; }
  paletteSelected = Math.max(0, Math.min(i, lis.length - 1));
  lis.forEach((li, k) => li.setAttribute("aria-selected", k === paletteSelected ? "true" : "false"));
  if (scroll) lis[paletteSelected]?.scrollIntoView({ block: "nearest" });
}

/** Reconstrói a lista (ao abrir e ao digitar). */
function paintPalette(): void {
  const ranked = rankPalette(paletteItems, paletteInput.value);
  paletteList.replaceChildren();
  if (ranked.length === 0) { paletteList.appendChild(el("li", "palette-empty", "Nada encontrado.")); return; }
  ranked.forEach((item, i) => {
    const li = el("li");
    li.setAttribute("role", "option");
    li.dataset["id"] = item.id;
    li.appendChild(el("span", "pk", item.kind === "action" ? "ação" : item.kind === "conversation" ? "conversa" : "config"));
    li.appendChild(el("span", "pl", item.label));
    if (item.detail !== undefined) li.appendChild(el("span", "pd", item.detail));
    li.addEventListener("click", () => { void runPalette(item.id); });
    li.addEventListener("mousemove", () => { if (paletteSelected !== i) selectPalette(i, false); });
    paletteList.appendChild(li);
  });
  selectPalette(paletteSelected, true);
}

async function runPalette(id: string): Promise<void> {
  const run = paletteActions.get(id);
  closePalette();
  if (run !== undefined) await run();
}

function openPalette(): void {
  paletteItems = buildPaletteItems();
  paletteSelected = 0;
  paletteInput.value = "";
  paletteEl.hidden = false;
  paintPalette();
  paletteInput.focus();
  onboardEvent("palette-open");
}

function closePalette(): void {
  paletteEl.hidden = true;
  if (!inputEl.disabled) inputEl.focus();
  onboardEvent("palette-close");
}

const titleOf = (c: StoredConversationView): string =>
  (c.title ?? c.messages.find((m) => m.role === "user")?.content ?? "Nova conversa").replace(/\s+/g, " ").trim().slice(0, 60) || "Nova conversa";

function addNote(tab: Tab, text: string): void {
  tab.messagesEl.appendChild(el("div", "branch-note", text));
}

/** Ícone SVG inline (traço, 16px) construído via DOM, compatível com a CSP sem img-src. */
function svgIcon(d: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path"); path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

const ICON_COPY = "M9 11a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1";
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_BRANCH = "M6 3v12M18 9a9 9 0 0 1-9 9M21 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0";

/** Botão só com ícone: tooltip e rótulo acessível carregam o texto. */
function iconButton(action: string, label: string, iconPath: string): HTMLButtonElement {
  const btn = el("button", "icon-btn");
  btn.type = "button"; btn.dataset["action"] = action;
  btn.title = label; btn.setAttribute("aria-label", label);
  btn.appendChild(svgIcon(iconPath));
  return btn;
}

/** Mensagem com índice no histórico e ações no hover (Copiar, Ramificar daqui). */
function appendMessage(tab: Tab, role: "user" | "assistant", content: string, indexInHistory: number): HTMLElement {
  const node = el("div", role === "user" ? "msg msg-user" : "msg msg-assistant");
  node.dataset["index"] = String(indexInHistory);
  if (role === "user") node.textContent = content;
  else renderAssistant(node, content);
  const actions = el("div", "msg-actions");
  const copy = iconButton("copy", "Copiar", ICON_COPY);
  const branch = iconButton("branch", "Ramificar daqui", ICON_BRANCH);
  actions.append(copy, branch);
  node.appendChild(actions);
  tab.messagesEl.appendChild(node);
  return node;
}

function upsertIndex(view: StoredConversationView): void {
  index.set(view.id, view);
  renderSidebar();
}

type IndexPatch = { [K in keyof StoredConversationView]?: StoredConversationView[K] | undefined };

/** Atualiza o índice local sem ir ao processo principal. `title: undefined` remove o nome. */
function patchIndex(id: string, patch: IndexPatch): void {
  const cur = index.get(id);
  if (cur === undefined) return;
  const next: StoredConversationView = { ...cur, updatedAt: patch.updatedAt ?? new Date().toISOString() };
  if (patch.messages !== undefined) next.messages = patch.messages;
  if (patch.archived !== undefined) next.archived = patch.archived;
  if (patch.openAsTab !== undefined) next.openAsTab = patch.openAsTab;
  if (patch.model !== undefined) next.model = patch.model;
  if ("title" in patch) { if (patch.title === undefined) delete next.title; else next.title = patch.title; }
  index.set(id, next);
  renderSidebar();
}

/** Cria a aba de uma conversa já existente (nova ou restaurada do disco). */
function buildTab(conversationId: string, model: BackendModel, host: string, restored?: StoredConversationView): Tab {
  tabCount += 1;
  const tabEl = el("div", "tab");
  const dotEl = el("span", "tab-dot");
  dotEl.hidden = true;
  const titleEl = el("span", "tab-title", `Conversa ${tabCount}`);
  const modelEl = el("span", "tab-model", model);
  const closeBtn = el("button", "tab-close", "×");
  closeBtn.type = "button";
  closeBtn.title = "Fechar aba";
  tabEl.append(dotEl, titleEl, modelEl, closeBtn);
  const messagesEl = el("div", "messages");
  messagesEl.setAttribute("aria-live", "polite");
  // Rolagem da pessoa decide se a resposta em andamento continua puxando para o fim.
  messagesEl.addEventListener("scroll", () => { tab.followBottom = nearBottom(messagesEl); }, { passive: true });
  const tab: Tab = {
    id: conversationId, model, host, tabEl, titleEl, modelEl, dotEl, messagesEl, followBottom: true, currentAssistant: null,
    pendingText: "", renderTimer: null, busy: false, draft: "", titled: false, customTitle: false, context: null, lastTurn: null,
  };
  tabs.set(conversationId, tab);
  tabsEl.appendChild(tabEl);
  refreshTabBadges();
  panelsEl.appendChild(messagesEl);
  tabEl.addEventListener("click", () => activate(conversationId));
  tabEl.addEventListener("dblclick", (ev) => { ev.preventDefault(); startRename(tab); });
  closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void closeTab(conversationId); });
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
  tabEl.addEventListener("contextmenu", (ev) => { ev.preventDefault(); void showTabMenu(tab); });
  if (restored !== undefined && restored.messages.length > 0) {
    if (restored.branchedFrom !== undefined) {
      const origin = index.get(restored.branchedFrom.id);
      addNote(tab, `Ramificada de "${origin !== undefined ? titleOf(origin) : "outra conversa"}" (mensagem ${restored.branchedFrom.index + 1})`);
    }
    restored.messages.forEach((m, i) => appendMessage(tab, m.role, m.content, i));
    const first = restored.messages.find((m) => m.role === "user");
    if (first !== undefined) setTitle(tab, first.content);
  } else {
    addNotice(tab, host === "local" ? "Nova conversa neste Mac. Suas mensagens vão pro backend local, que roda o Claude Code daqui por baixo." : `Nova conversa na máquina ${host}. Suas mensagens vão pro backend dela, que roda o Claude Code por baixo.`);
  }
  if (restored?.title !== undefined && restored.title !== "") applyCustomTitle(tab, restored.title);
  return tab;
}

async function newTab(): Promise<Tab> {
  const { conversationId } = await window.meuBot.newConversation();
  const model = settings?.backendModelForHost ?? "agente";
  const host = windowHost;
  const now = new Date().toISOString();
  index.set(conversationId, { id: conversationId, model, host, messages: [], createdAt: now, updatedAt: now, order: index.size, archived: false, openAsTab: true });
  const tab = buildTab(conversationId, model, host);
  activate(conversationId);
  onboardEvent("new-tab");
  return tab;
}

/** Reabre as abas salvas; sem nenhuma, cria a primeira. */
async function restoreTabs(): Promise<void> {
  const saved = await window.meuBot.listConversations();
  // Conversas vazias não voltam; são apagadas de vez.
  for (const c of saved) if (c.messages.length === 0) void window.meuBot.deleteConversation(c.id);
  for (const c of saved) if (c.messages.length > 0) index.set(c.id, c);
  const asTabs = saved.filter((c) => c.messages.length > 0 && c.openAsTab && !c.archived);
  // Onboarding pendente (primeira vez, ou caixinha "onboarding feito" desmarcada no seletor): começa
  // sempre, com ou sem conversas; o passo "Novo" cria a conversa, então não se cria a automática.
  const pending = settings?.onboarding === "pending";
  if (pending) startOnboarding();
  if (asTabs.length === 0) {
    if (!pending) await newTab();
    return;
  }
  for (const c of asTabs) buildTab(c.id, c.model, c.host, c);
  const latest = [...asTabs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  activate(latest?.id ?? asTabs[asTabs.length - 1]!.id);
}

function applySettings(view: SettingsView): void {
  settings = view;
  lastHostEl.textContent = view.lastHost === null ? "" : `Última máquina aberta pelo seletor: ${hostLabel(view.lastHost)}.`;
  backendModelSelect.value = view.backendModelForHost;
  backendPortInput.value = String(view.backendPort);
  fontSizeInput.value = String(view.fontSize);
  themeSelect.value = view.theme;
  notificationsInput.checked = view.notifications;
  contextBudgetInput.value = String(view.contextBudgetTokens);
  memoryEveryInput.value = String(view.memoryEveryTurns);
  quickEnabled.checked = view.quickEntryEnabled;
  quickShortcut.value = view.quickEntryShortcut;
  quickStatus.textContent = view.quickEntryStatus === "registered" ? "ativo" : view.quickEntryStatus === "taken" ? "em uso por outro app" : view.quickEntryStatus === "invalid" ? "inválido" : "desligado";
  document.documentElement.style.setProperty("--chat-font", `${view.fontSize}px`);
  document.documentElement.dataset["theme"] = view.theme;
  syncComposer();
}

// ---- Entrar no Claude Code: modal que roda `claude auth login` na máquina, abre o link e recebe o código.
const clDialog = $<HTMLDialogElement>("cl-dialog");
const clStatus = $<HTMLParagraphElement>("cl-status");
const clOpen = $<HTMLButtonElement>("cl-open");
const clCodeRow = $<HTMLDivElement>("cl-code-row");
const clCode = $<HTMLInputElement>("cl-code");
const clSend = $<HTMLButtonElement>("cl-send");
const clLog = $<HTMLPreElement>("cl-log");
const clStart = $<HTMLButtonElement>("cl-start");
const clClose = $<HTMLButtonElement>("cl-close");
let clRunning = false;
let clUrl: string | null = null;

function openClaudeLogin(): void {
  clLog.hidden = true; clLog.textContent = ""; clCodeRow.hidden = true; clOpen.hidden = true; clCode.value = "";
  clStatus.textContent = `Máquina: ${hostLabel(windowHost)}. Abre o link de autorização no navegador; você entra na conta e cola aqui o código que aparece.`;
  clStart.hidden = clRunning; clStart.textContent = "Começar"; clClose.textContent = clRunning ? "Cancelar" : "Fechar";
  if (!clDialog.open) clDialog.showModal();
}

async function runClaudeLogin(): Promise<void> {
  if (clRunning) return;
  clRunning = true; clStart.hidden = true; clClose.textContent = "Cancelar"; clLog.hidden = false; clLog.textContent = "";
  clStatus.textContent = "Iniciando o login na máquina…";
  try { await window.meuBot.claudeLogin(); } catch (err) { clStatus.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`; }
  finally { clRunning = false; clClose.textContent = "Fechar"; clCodeRow.hidden = true; }
}

window.meuBot.on("claude-login:event", (ev: ClaudeLoginEvent) => {
  const appendLog = (t: string): void => { clLog.hidden = false; clLog.textContent = `${clLog.textContent ?? ""}${t}\n`.split("\n").slice(-8).join("\n"); };
  switch (ev.kind) {
    case "url": clUrl = ev.url; clOpen.hidden = false; clStatus.textContent = "Abri o link no navegador. Entre na conta e copie o código que a página mostra."; appendLog("▸ link aberto no navegador"); break;
    case "waiting-code": clCodeRow.hidden = false; clCode.focus(); clStatus.textContent = "Cole o código da página e clique em Enviar código."; break;
    case "log": appendLog(ev.text); break;
    case "done":
      clStatus.textContent = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      appendLog(ev.ok ? "✓ logado" : "não concluiu");
      clStart.hidden = ev.ok; clStart.textContent = "Tentar de novo";
      if (ev.ok) {
        const tab = active();
        if (tab !== null) addNotice(tab, "✓ Claude Code logado nesta máquina. Pode mandar a próxima mensagem.", "info");
        void window.meuBot.getAccountStatus().then((s) => { account = s; paintContext(active()); });
        clAuth = { loggedIn: true, email: clAuth?.email ?? null }; paintClaudeLine();
        void refreshClaudeLine();
        // Deu certo: o modal se fecha sozinho; o aviso fica na conversa.
        setTimeout(() => { if (clDialog.open) clDialog.close(); }, 1200);
      }
      break;
  }
});
clStart.addEventListener("click", () => { void runClaudeLogin(); });
clSend.addEventListener("click", () => {
  const code = clCode.value.trim();
  if (code === "") return;
  clSend.disabled = true;
  void window.meuBot.claudeLoginCode(code).then((ok) => { if (ok) { clStatus.textContent = "Código enviado; conferindo o login…"; clCode.value = ""; } else clStatus.textContent = "✗ não há login em andamento; clique em Começar."; }).finally(() => { clSend.disabled = false; });
});
clCode.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); clSend.click(); } ev.stopPropagation(); });
clOpen.addEventListener("click", () => { if (clUrl !== null) void window.meuBot.openExternal(clUrl); });

/** Erro/aviso que indica Claude Code deslogado: a notice ganha o botão "Entrar no Claude Code". */
const LOGGED_OUT_RE = /not logged in|please run \/?login|deslogad|não está logado/i;
function offerClaudeLogin(tab: Tab, text: string): void {
  if (!LOGGED_OUT_RE.test(text)) return;
  const box = el("div", "notice notice-warn");
  box.append(el("span", "", "O Claude Code desta máquina está deslogado. "));
  const btn = el("button", "btn btn-ghost btn-small", "Entrar no Claude Code");
  btn.type = "button";
  btn.addEventListener("click", () => { openClaudeLogin(); void runClaudeLogin(); });
  box.append(btn);
  tab.messagesEl.appendChild(box);
  scrollToBottom(tab, false);
}
clClose.addEventListener("click", () => { if (clRunning) void window.meuBot.claudeLoginCancel(); clDialog.close(); });
window.meuBot.on("ui:claude-login", () => { openClaudeLogin(); void runClaudeLogin(); });

// ---- Linha "Claude Code" na lista de conversas: conta logada, sair (para entrar com outra) ou entrar.
const clLine = $<HTMLDivElement>("cl-line");
const clLineText = $<HTMLSpanElement>("cl-line-text");
const clLineBtn = $<HTMLButtonElement>("cl-line-btn");
let clAuth: ClaudeAuthInfo | null = null;

function paintClaudeLine(): void {
  if (clAuth === null) { clLine.hidden = true; return; }
  clLine.hidden = false;
  clLine.className = `wa-line cl-line ${clAuth.loggedIn ? "on" : "off"}`;
  clLineText.textContent = clAuth.loggedIn ? `Claude Code · ${clAuth.email ?? "logado"}` : "Claude Code · deslogado";
  clLineBtn.textContent = clAuth.loggedIn ? "sair" : "entrar";
  clLineBtn.title = clAuth.loggedIn ? "Sai da conta do Claude Code nesta máquina e abre o login para entrar com outra" : "Abre o login do Claude Code nesta máquina";
}

async function refreshClaudeLine(): Promise<void> {
  try { clAuth = await window.meuBot.claudeAuth(); } catch { clAuth = null; }
  paintClaudeLine();
}

clLineBtn.addEventListener("click", () => {
  if (clAuth !== null && clAuth.loggedIn) {
    if (!window.confirm(`Sair da conta ${clAuth.email ?? "do Claude Code"} nesta máquina? O agente para de responder pelo Claude até entrar de novo (o grok-4 continua).`)) return;
    clLineBtn.disabled = true;
    void window.meuBot.claudeLogout().then((st) => { clAuth = st; paintClaudeLine(); openClaudeLogin(); void runClaudeLogin(); }).finally(() => { clLineBtn.disabled = false; });
    return;
  }
  openClaudeLogin();
  void runClaudeLogin();
});

// ---- Linha "xAI (Grok)": OAuth da xAI no Hermes da máquina, que o grok-4 usa. Mesmo molde do Claude.
const xaiLine = $<HTMLDivElement>("xai-line");
const xaiLineText = $<HTMLSpanElement>("xai-line-text");
const xaiLineBtn = $<HTMLButtonElement>("xai-line-btn");
const xaiDialog = $<HTMLDialogElement>("xai-dialog");
const xaiStatus = $<HTMLParagraphElement>("xai-status");
const xaiOpen = $<HTMLButtonElement>("xai-open");
const xaiLog = $<HTMLPreElement>("xai-log");
const xaiStart = $<HTMLButtonElement>("xai-start");
const xaiClose = $<HTMLButtonElement>("xai-close");
let xaiAuth: ClaudeAuthInfo | null = null;
let xaiRunning = false;
let xaiUrl: string | null = null;

function paintXaiLine(): void {
  if (xaiAuth === null) { xaiLine.hidden = true; return; }
  xaiLine.hidden = false;
  xaiLine.className = `wa-line cl-line ${xaiAuth.loggedIn ? "on" : "off"}`;
  xaiLineText.textContent = xaiAuth.loggedIn ? `xAI (Grok) · ${xaiAuth.email ?? "logada"}` : "xAI (Grok) · deslogada · o grok-4 não responde";
  xaiLineBtn.textContent = xaiAuth.loggedIn ? "sair" : "entrar";
}
async function refreshXaiLine(): Promise<void> {
  try { xaiAuth = await window.meuBot.xaiAuth(); } catch { xaiAuth = null; }
  paintXaiLine();
}
function openXai(): void {
  xaiLog.hidden = true; xaiLog.textContent = ""; xaiOpen.hidden = true;
  xaiStatus.textContent = `Máquina: ${hostLabel(windowHost)}. Abre o link da xAI no navegador, já com o código do dispositivo. Entre na conta e aprove; aqui não precisa colar nada.`;
  xaiStart.hidden = xaiRunning; xaiStart.textContent = "Começar"; xaiClose.textContent = xaiRunning ? "Cancelar" : "Fechar";
  if (!xaiDialog.open) xaiDialog.showModal();
}
async function runXaiLogin(): Promise<void> {
  if (xaiRunning) return;
  xaiRunning = true; xaiStart.hidden = true; xaiClose.textContent = "Cancelar"; xaiLog.hidden = false; xaiLog.textContent = "";
  xaiStatus.textContent = "Pedindo o login OAuth da xAI à máquina…";
  try { await window.meuBot.xaiLogin(); } catch (err) { xaiStatus.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`; }
  finally { xaiRunning = false; xaiClose.textContent = "Fechar"; }
}
window.meuBot.on("xai-login:event", (ev: ClaudeLoginEvent) => {
  const appendLog = (t: string): void => { xaiLog.hidden = false; xaiLog.textContent = `${xaiLog.textContent ?? ""}${t}\n`.split("\n").slice(-8).join("\n"); };
  switch (ev.kind) {
    case "url": xaiUrl = ev.url; xaiOpen.hidden = false; xaiStatus.textContent = "Abri o link no navegador. Entre na conta da xAI e aprove o dispositivo; esperando a aprovação…"; break;
    case "waiting-code": break;
    case "log": appendLog(ev.text); break;
    case "done":
      xaiStatus.textContent = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      xaiStart.hidden = ev.ok; xaiStart.textContent = "Tentar de novo";
      if (ev.ok) {
        // Verde na hora, com o rótulo que veio no texto; a consulta de confirmação roda em segundo plano.
        xaiAuth = { loggedIn: true, email: /\(([^)]+)\)/.exec(ev.text)?.[1] ?? xaiAuth?.email ?? null };
        paintXaiLine();
        const tab = active(); if (tab !== null) addNotice(tab, "✓ xAI logada no Hermes desta máquina; o grok-4 já usa a conta nova.", "info");
        void refreshXaiLine();
        setTimeout(() => { if (xaiDialog.open) xaiDialog.close(); }, 1200);
      }
      break;
  }
});
xaiStart.addEventListener("click", () => { void runXaiLogin(); });
xaiOpen.addEventListener("click", () => { if (xaiUrl !== null) void window.meuBot.openExternal(xaiUrl); });
xaiClose.addEventListener("click", () => { if (xaiRunning) void window.meuBot.xaiLoginCancel(); xaiDialog.close(); });
xaiLineBtn.addEventListener("click", () => {
  if (xaiAuth !== null && xaiAuth.loggedIn) {
    if (!window.confirm("Sair da conta da xAI no Hermes desta máquina? O grok-4 para de responder até entrar de novo.")) return;
    xaiLineBtn.disabled = true;
    void window.meuBot.xaiLogout().then((st) => { xaiAuth = st; paintXaiLine(); openXai(); void runXaiLogin(); }).finally(() => { xaiLineBtn.disabled = false; });
    return;
  }
  openXai();
  void runXaiLogin();
});

// ---- WhatsApp do agente da máquina (Hermes ou OpenClaw): linha no topo da lista de conversas e modal de pareamento por QR.
const waLine = $<HTMLButtonElement>("wa-line");
const waDialog = $<HTMLDialogElement>("wa-dialog");
const waStatusEl = $<HTMLParagraphElement>("wa-status");
const waQr = $<HTMLImageElement>("wa-qr");
const waHow = $<HTMLParagraphElement>("wa-how");
const waLog = $<HTMLPreElement>("wa-log");
const waPairBtn = $<HTMLButtonElement>("wa-pair");
const waResetBtn = $<HTMLButtonElement>("wa-reset");
const waCloseBtn = $<HTMLButtonElement>("wa-close");
let waStatus: WhatsappStatus | null = null;
let waPairing = false;

/** "5516992294486" → "+55 (16) 99229-4486"; outros formatos ficam com o + na frente. */
function fmtPhone(digits: string | null): string {
  if (digits === null) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m === null ? `+${digits}` : `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

function paintWhatsapp(): void {
  const st = waStatus;
  if (st === null || !st.present) { waLine.hidden = true; return; }
  waLine.hidden = false;
  waLine.className = `wa-line ${st.connected ? "on" : "off"}`;
  const who = st.number !== null ? fmtPhone(st.number) : "sem número";
  const via = st.gateway === "openclaw" ? "WhatsApp (OpenClaw)" : st.gateway === "hermes" ? "WhatsApp (Hermes)" : "WhatsApp";
  waLine.replaceChildren(el("span", "dot"), el("span", "", st.connected ? `${via} · ${who} · conectado` : `${via} · ${who} · ${st.loggedOut || st.number === null ? "desconectado · clique para parear" : st.detail}`));
  waStatusEl.textContent = st.connected ? `Conectado como ${who}.` : `${st.detail}.${st.number !== null ? ` Última sessão: ${who}.` : ""}`;
  waPairBtn.hidden = st.connected || waPairing;
  waPairBtn.textContent = st.number === null ? "Gerar QR" : "Tentar reconectar e gerar QR";
  waResetBtn.hidden = waPairing || st.number === null;
  waCloseBtn.textContent = waPairing ? "Cancelar" : "Fechar";
}

async function refreshWhatsapp(): Promise<void> {
  try { waStatus = await window.meuBot.whatsappStatus(); } catch { waStatus = null; }
  paintWhatsapp();
}

function openWhatsapp(): void {
  waQr.hidden = true; waHow.hidden = true; waLog.hidden = true; waLog.textContent = "";
  paintWhatsapp();
  if (!waDialog.open) waDialog.showModal();
}

async function pairWhatsapp(reset: boolean): Promise<void> {
  if (waPairing) return;
  waPairing = true;
  waLog.hidden = false; waLog.textContent = "";
  waStatusEl.textContent = reset ? "Apagando a sessão antiga e gerando um QR novo…" : "Gerando o QR…";
  paintWhatsapp();
  try {
    await window.meuBot.whatsappPair(reset);
  } catch (err) {
    waLog.textContent += `✗ ${err instanceof Error ? err.message : String(err)}\n`;
  } finally {
    waPairing = false;
    waQr.hidden = true; waHow.hidden = true;
    // O gateway acabou de voltar; dá alguns segundos para o bridge abrir a sessão antes de consultar.
    setTimeout(() => { void refreshWhatsapp(); }, 6000);
    paintWhatsapp();
  }
}

window.meuBot.on("whatsapp:event", (ev: WhatsappEvent) => {
  const appendLog = (t: string): void => { waLog.hidden = false; waLog.textContent = `${waLog.textContent ?? ""}${t}\n`.split("\n").slice(-8).join("\n"); waLog.scrollTop = waLog.scrollHeight; };
  switch (ev.kind) {
    case "step": appendLog(`▸ ${ev.text}`); break;
    case "log": appendLog(ev.text); break;
    case "qr": waQr.src = ev.dataUrl; waQr.hidden = false; waHow.hidden = false; waStatusEl.textContent = "Leia o QR com o WhatsApp do número do agente."; break;
    case "connected": waQr.hidden = true; waHow.hidden = true; waStatusEl.textContent = `✓ Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}. Subindo o gateway…`; appendLog("✓ conectado"); break;
    case "error": waStatusEl.textContent = `✗ ${ev.text}`; appendLog(`✗ ${ev.text}`); break;
    case "done":
      appendLog(ev.ok ? "✓ pronto" : "terminou sem conectar");
      if (ev.ok) { const tab = active(); if (tab !== null) addNotice(tab, "✓ WhatsApp pareado; o gateway está voltando.", "info"); setTimeout(() => { if (waDialog.open) waDialog.close(); }, 1500); }
      break;
  }
});
waLine.addEventListener("click", () => openWhatsapp());
waPairBtn.addEventListener("click", () => { void pairWhatsapp(false); });
waResetBtn.addEventListener("click", () => { void pairWhatsapp(true); });
waCloseBtn.addEventListener("click", () => { if (waPairing) void window.meuBot.whatsappCancel(); waDialog.close(); });

// ---- Abertura (opcional, caixinha "abrir direto" do seletor): o topo se materializa em etapas e o túnel acende como clímax.
const introEl = $<HTMLElement>("intro");
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function playIntro(): Promise<void> {
  // Caixinha "abrir direto" do seletor (padrão marcada): sem abertura. Desmarcada: toda vez.
  if (settings?.openDirect !== false || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { introEl.remove(); return; }
  const brand = $<HTMLElement>("intro-brand");
  const host = $<HTMLElement>("intro-host");
  const key = $<HTMLElement>("intro-key");
  const tunnel = $<HTMLElement>("intro-tunnel");
  host.textContent = `máquina: ${hostLabel(windowHost)}`;
  key.textContent = `backend · ${settings?.backendModelForHost ?? "agente"}`;
  tunnel.textContent = "túnel";
  introEl.hidden = false;
  await wait(30); brand.classList.add("in");            // meu-bot no centro, discreto
  await wait(300); host.classList.add("in");            // a máquina se materializa abaixo
  await wait(350); key.classList.add("in");             // backend e túnel, lado a lado, mais rápido
  await wait(120); tunnel.classList.add("in");
  // Clímax: espera o túnel real ficar pronto, mas por pouco tempo; espera longa vira tédio.
  const t0 = Date.now();
  while (hostStatus.get(windowHost)?.state !== "ready" && Date.now() - t0 < 500) await wait(40);
  const st = hostStatus.get(windowHost);
  const ready = st?.state === "ready";
  tunnel.textContent = ready ? "túnel ativo" : (st?.detail ?? "conectando…");
  tunnel.className = `pill intro-item in ${ready ? "lit" : "pill-neutral"}`;
  await wait(ready ? 450 : 300);
  introEl.classList.add("out");
  await wait(220);
  introEl.remove();
}

// ---- Onboarding guiado (primeira vez, sem conversas): a pessoa faz cada ação, o app só orienta.
const onboardEl = $<HTMLElement>("onboard");
const obCount = $<HTMLSpanElement>("ob-count");
const obLead = $<HTMLParagraphElement>("ob-lead");
const obFeedback = $<HTMLParagraphElement>("ob-feedback");
const obTitle = $<HTMLHeadingElement>("ob-title");
const obText = $<HTMLParagraphElement>("ob-text");
const obSkip = $<HTMLButtonElement>("ob-skip");
let onboard: OnboardState | null = null;
let lastFeedback: Feedback | undefined;
let feedbackTimer: number | null = null;

function paintOnboard(feedback?: Feedback): void {
  const step = onboard === null ? undefined : ONBOARD_STEPS[onboard.step];
  // O botão do passo atual pulsa em azul (e pode ser clicado); os outros ficam normais.
  const targets: Record<string, HTMLButtonElement> = { sidebar: sidebarBtn, palette: paletteBtn, settings: settingsBtn, new: newBtn };
  for (const [id, btn] of Object.entries(targets)) btn.classList.toggle("attention", step?.id === id);
  if (onboard === null || step === undefined) { onboardEl.hidden = true; return; }
  onboardEl.hidden = false;
  // Número do passo em negrito e azul, para a mudança de passo ser percebida.
  obCount.replaceChildren(el("strong", "n", String(onboard.step + 1)), document.createTextNode(` de ${ONBOARD_STEPS.length}`));
  obLead.hidden = onboard.step !== 0; // o aviso de "leia e siga" só no primeiro passo
  obTitle.textContent = step.title;
  obText.textContent = step.text;
  if (feedbackTimer !== null) { clearTimeout(feedbackTimer); feedbackTimer = null; }
  if (feedback === undefined || feedback.kind === "none") { obFeedback.hidden = true; return; }
  obFeedback.hidden = false;
  obFeedback.className = `onboard-feedback ${feedback.kind}`;
  obFeedback.textContent = feedback.text;
  feedbackTimer = window.setTimeout(() => { obFeedback.hidden = true; feedbackTimer = null; }, 2200);
}

function startOnboarding(): void {
  onboard = initialOnboardState();
  lastFeedback = undefined;
  paintOnboard();
}

async function finishOnboarding(how: "done" | "skipped"): Promise<void> {
  onboard = null;
  paintOnboard(); // tira o pulso dos botões
  // Transição final (concluído ou pulado): o cartão fica mais alguns segundos deixando claro que acabou.
  const msg = how === "done" ? FINAL_MESSAGE : SKIPPED_MESSAGE;
  onboardEl.hidden = false;
  obCount.textContent = how === "done" ? "pronto" : "ignorado";
  obLead.hidden = true;
  obSkip.hidden = true;
  obFeedback.hidden = true;
  obTitle.textContent = msg.title;
  obText.textContent = msg.text;
  window.setTimeout(() => { if (onboard === null) { onboardEl.hidden = true; obSkip.hidden = false; } }, how === "done" ? 3200 : 4500);
  try { applySettings(await window.meuBot.setSettings({ onboarding: how })); } catch { /* fica pendente; volta na próxima vez */ }
  if (how === "skipped" && tabs.size === 0) await newTab();
}

/** O renderer avisa o que aconteceu; só o evento do passo atual avança. */
function onboardEvent(ev: OnboardEvent): void {
  if (onboard === null) return;
  const r = advanceOnboard(onboard, ev);
  onboard = r.state;
  if (r.finished) {
    // Último passo concluído: a primeira mensagem vai sozinha e o cartão vira a transição final.
    const tab = active();
    if (tab !== null && !tab.busy) void sendText(tab, EXAMPLE_MESSAGE);
    void finishOnboarding("done");
    return;
  }
  if (!r.advanced) return;
  const fb = pickFeedback(Math.random, lastFeedback);
  lastFeedback = fb;
  paintOnboard(fb);
}

obSkip.addEventListener("click", () => { void finishOnboarding("skipped"); });

/** Rótulo amigável da máquina (o seletor usa o mesmo, em lib/probe-text). */
const hostLabel = (h: string): string => (h === "local" ? "este Mac (sem SSH)" : h);

async function sendText(tab: Tab, raw: string): Promise<void> {
  const text = raw.trim();
  if (text === "" || tab.busy) return;
  const cur = index.get(tab.id);
  const userIndex = cur?.messages.length ?? 0;
  appendMessage(tab, "user", text, userIndex);
  if (!tab.titled) setTitle(tab, text);
  patchIndex(tab.id, { messages: [...(cur?.messages ?? []), { role: "user", content: text }], openAsTab: true });
  scrollToBottom(tab);
  setBusy(tab, true);
  tab.currentAssistant = null;
  tab.pendingText = "";
  try {
    await window.meuBot.send(tab.id, text);
  } catch (err) {
    addNotice(tab, err instanceof Error ? err.message : String(err), "error");
  } finally {
    if (tabs.has(tab.id)) setBusy(tab, false);
  }
}

async function sendMessage(): Promise<void> {
  const tab = active();
  if (tab === null) return;
  const text = inputEl.value;
  if (text.trim() === "" || tab.busy) return;
  inputEl.value = "";
  tab.draft = "";
  await sendText(tab, text);
}

const markUnread = (tab: Tab): void => { if (tab.id !== activeId) tab.dotEl.hidden = false; };

window.meuBot.on("chat:assistant-start", ({ conversationId }) => {
  const tab = tabs.get(conversationId);
  if (tab === undefined) return;
  tab.pendingText = "";
  tab.currentAssistant = appendMessage(tab, "assistant", "", index.get(conversationId)?.messages.length ?? 0);
  scrollToBottom(tab, false);
});
window.meuBot.on("chat:delta", ({ conversationId, text }) => {
  const tab = tabs.get(conversationId);
  if (tab === undefined) return;
  if (tab.currentAssistant === null) {
    tab.currentAssistant = appendMessage(tab, "assistant", "", index.get(conversationId)?.messages.length ?? 0);
  }
  tab.pendingText += text;
  scheduleRender(tab);
  markUnread(tab);
});
window.meuBot.on("chat:done", (done: DoneEvent) => {
  const tab = tabs.get(done.conversationId);
  if (tab === undefined) return;
  if (done.ms !== undefined) { tab.lastTurn = { ms: done.ms, completion: done.usage?.completion ?? 0 }; if (tab.id === activeId) paintContext(tab); }
  if (tab.renderTimer !== null) { clearTimeout(tab.renderTimer); flushRender(tab); }
  if (tab.currentAssistant !== null && tab.pendingText === "") tab.currentAssistant.remove();
  if (done.stopReason === "cancelled") addNotice(tab, "Resposta interrompida.", "warn");
  if (done.refusal !== undefined) {
    const cat = done.refusal.category ?? "não informada";
    addNotice(tab, `A resposta foi recusada pelo modelo (categoria: ${cat}). ${done.refusal.explanation}`.trim(), "warn");
  }
  if (tab.pendingText !== "") {
    const cur = index.get(tab.id);
    patchIndex(tab.id, { messages: [...(cur?.messages ?? []), { role: "assistant", content: tab.pendingText }] });
  }
  markUnread(tab);
  maybeNotify(tab, tab.pendingText);
});
window.meuBot.on("chat:error", (e: ErrorEvent) => {
  const tab = tabs.get(e.conversationId);
  if (tab === undefined) return;
  if (tab.renderTimer !== null) { clearTimeout(tab.renderTimer); flushRender(tab); }
  if (tab.currentAssistant !== null && tab.pendingText === "") tab.currentAssistant.remove();
  addNotice(tab, e.message, "error");
  offerClaudeLogin(tab, e.message);
  markUnread(tab);
  maybeNotify(tab, e.message);
});
window.meuBot.on("backend:status", (st: BackendStatusEvent) => {
  hostStatus.set(st.host, st);
  const tab = active();
  if (tab !== null && tab.host === st.host) paintStatus(st.host);
});
window.meuBot.on("settings:changed", (view: SettingsView) => {
  // Outra janela salvou: fonte/tema/notificações valem para todas; o modelo padrão vem resolvido pela máquina.
  applySettings({ ...view, backendModelForHost: settings?.backendModelForHost ?? view.backendModelForHost });
});

// Cliques dentro das respostas: botão Copiar dos blocos de código e links externos.
panelsEl.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target === null) return;
  const copy = target.closest<HTMLButtonElement>(".btn-copy");
  if (copy !== null) {
    const code = copy.closest(".code-block")?.querySelector("pre")?.textContent ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      copy.textContent = "Copiado";
      window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500);
    });
    return;
  }
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link !== null) {
    ev.preventDefault();
    void window.meuBot.openExternal(link.href);
    return;
  }
  const actionBtn = target.closest<HTMLButtonElement>(".msg-actions button");
  if (actionBtn !== null) {
    const msg = actionBtn.closest<HTMLElement>(".msg");
    const tab = active();
    if (msg === null || tab === null) return;
    const i = Number(msg.dataset["index"]);
    if (actionBtn.dataset["action"] === "copy") {
      const content = index.get(tab.id)?.messages[i]?.content ?? msg.textContent ?? "";
      void navigator.clipboard.writeText(content).then(() => {
        actionBtn.replaceChildren(svgIcon(ICON_CHECK)); actionBtn.title = "Copiado"; actionBtn.classList.add("done");
        window.setTimeout(() => { actionBtn.replaceChildren(svgIcon(ICON_COPY)); actionBtn.title = "Copiar"; actionBtn.classList.remove("done"); }, 1500);
      });
    } else if (actionBtn.dataset["action"] === "branch") {
      void branchFrom(tab.id, i);
    }
  }
});

sidebarBtn.addEventListener("click", () => toggleSidebar());
sidebarSearch.addEventListener("input", () => renderSidebar());
sidebarArchived.addEventListener("change", () => renderSidebar());
// Seções das Configurações: todas recolhidas sempre que o painel abre; abrir uma recolhe as outras. Nada é lembrado.
const settingsGroups = [...document.querySelectorAll<HTMLDetailsElement>("details.group")];
for (const g of settingsGroups) {
  g.addEventListener("toggle", () => { if (g.open) for (const other of settingsGroups) if (other !== g) other.open = false; });
}
paletteBtn.addEventListener("click", () => openPalette());
topbarHideBtn.addEventListener("click", () => setTopbarHidden(true));
topbarShowBtn.addEventListener("click", () => setTopbarHidden(false));
paletteInput.addEventListener("input", () => { paletteSelected = 0; paintPalette(); });
paletteInput.addEventListener("keydown", (ev) => {
  const count = paletteList.querySelectorAll("li[role=option]").length;
  if (ev.key === "ArrowDown") { ev.preventDefault(); selectPalette(count === 0 ? 0 : (paletteSelected + 1) % count, true); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); selectPalette(count === 0 ? 0 : (paletteSelected - 1 + count) % count, true); }
  else if (ev.key === "Enter") { ev.preventDefault(); const sel = paletteList.querySelector<HTMLElement>("li[aria-selected=true]"); if (sel?.dataset["id"] !== undefined) void runPalette(sel.dataset["id"]); }
  else if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
  // Cmd+K de novo fecha. O handler global não recebe a tecla: o stopPropagation abaixo é para as setas/Enter não vazarem.
  else if ((ev.metaKey || ev.ctrlKey) && ev.key === "k") { ev.preventDefault(); closePalette(); }
  ev.stopPropagation();
});
paletteEl.addEventListener("click", (ev) => { if (ev.target === paletteEl) closePalette(); });
const pendingFocus: string[] = [];
window.meuBot.on("ui:focus-conversation", ({ conversationId }) => {
  if (!tabsReady) { pendingFocus.push(conversationId); return; }
  void openFromIndex(conversationId);
});
window.meuBot.on("chat:context", (c: ContextEvent) => {
  const tab = tabs.get(c.conversationId);
  if (tab === undefined) return;
  // "sent: 0" vem dos avisos de resumo; preserva a contagem do último envio.
  tab.context = { ...c, sent: c.sent === 0 && tab.context !== null ? tab.context.sent : c.sent };
  if (tab.id === activeId) paintContext(tab);
});
window.meuBot.on("memory:changed", (m: MemoryView) => {
  applyMemory(m);
  const tab = active();
  if (tab !== null) addNotice(tab, "Memória atualizada automaticamente (veja em Configurações > Memória).");
});

function applyMemory(m: MemoryView): void {
  memoryPerfil.value = m.perfil;
  memoryNotas.value = m.notas;
  memoryPerfil.maxLength = m.limits.perfil;
  memoryNotas.maxLength = m.limits.notas;
  updateCounts(m.limits);
}

let memoryLimits = { notas: 2200, perfil: 1375 };
function updateCounts(limits = memoryLimits): void {
  memoryLimits = limits;
  perfilCount.textContent = `${memoryPerfil.value.length}/${limits.perfil}`;
  notasCount.textContent = `${memoryNotas.value.length}/${limits.notas}`;
}
// Gravador de atalho: a combinação pressionada vira o texto do campo.
quickShortcut.addEventListener("keydown", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "Backspace") { quickShortcut.value = ""; return; }
  if (["Meta", "Control", "Alt", "Shift"].includes(ev.key)) return;
  const mods = [ev.metaKey || ev.ctrlKey ? "CommandOrControl" : null, ev.altKey ? "Alt" : null, ev.shiftKey ? "Shift" : null].filter((m): m is string => m !== null);
  if (mods.length === 0) return;
  const key = ev.key === " " ? "Space" : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  quickShortcut.value = [...mods, key].join("+");
});

/** Texto vindo da entrada rápida: vai pra aba ativa (ou nova se ocupada) e confirma pro main. */
const pendingQuick: { correlationId: string; text: string }[] = [];
let tabsReady = false;
async function handleQuickSubmit(correlationId: string, text: string): Promise<void> {
  try {
    let tab = active();
    if (tab === null || tab.busy) tab = await newTab();
    window.meuBot.quickAck(correlationId, true);
    await sendText(tab, text);
  } catch (err) {
    window.meuBot.quickAck(correlationId, false, err instanceof Error ? err.message : String(err));
  }
}
window.meuBot.on("ui:quick-submit", ({ correlationId, text }) => {
  if (!tabsReady) { pendingQuick.push({ correlationId, text }); return; }
  void handleQuickSubmit(correlationId, text);
});

memoryPerfil.addEventListener("input", () => updateCounts());
memoryNotas.addEventListener("input", () => updateCounts());

tabsEl.addEventListener("dragover", (ev) => {
  if (draggingId === null) return;
  ev.preventDefault();
  const dragged = tabs.get(draggingId)?.tabEl;
  const last = tabsEl.lastElementChild;
  if (dragged !== undefined && last !== null && last !== dragged && ev.clientX > last.getBoundingClientRect().right) tabsEl.appendChild(dragged);
});
tabsEl.addEventListener("drop", (ev) => ev.preventDefault());

modelSelect.addEventListener("change", () => {
  const tab = active();
  if (tab === null) return;
  const model = modelSelect.value as BackendModel;
  setTabModel(tab, model);
  void window.meuBot.setConversationModel(tab.id, model);
});
sendBtn.addEventListener("click", () => {
  const tab = active();
  if (tab !== null && tab.busy) { void window.meuBot.cancel(tab.id); return; }
  void sendMessage();
});
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void sendMessage();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !modeMenu.hidden) { modeMenu.hidden = true; return; }
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key === "k") { ev.preventDefault(); if (paletteEl.hidden) openPalette(); else closePalette(); return; }
  if (!paletteEl.hidden) return;
  if (mod && ev.key === "n" && !ev.shiftKey) { ev.preventDefault(); void newTab(); } // Cmd+Shift+N é a janela nova (menu)
  if (mod && ev.shiftKey && (ev.key === "b" || ev.key === "B")) { ev.preventDefault(); setTopbarHidden(!document.body.classList.contains("topbar-hidden")); return; }
  if (mod && ev.key === "b") { ev.preventDefault(); toggleSidebar(); }
  if (mod && ev.key === "w" && activeId !== null) { ev.preventDefault(); void closeTab(activeId); }
});
newBtn.addEventListener("click", () => { void newTab(); });
// ---- Seção Fallback: o primário é o modelo padrão da máquina; a reserva vem da corrente do backend.
const primarySelect = $<HTMLSelectElement>("primary-provider");
const fallbackOrderEl = $<HTMLParagraphElement>("fallback-order");
const PRIMARY_OF: Record<string, BackendModel> = { claude: "agente", xai: "grok-4" };
function syncPrimaryFromModel(): void {
  const m = backendModelSelect.value;
  primarySelect.value = m === "grok-4" ? "xai" : m === "agente" ? "claude" : "other";
}
function paintFallbackOrder(): void {
  const primary = backendModelSelect.value;
  const chain = account?.providers ?? [];
  const reserve = chain.filter((p) => p.available && p.name !== primary).map((p) => p.name);
  const known = chain.some((p) => p.name === primary);
  fallbackOrderEl.textContent = chain.length === 0
    ? "O backend desta máquina ainda não informa a corrente de provedores."
    : !known
      ? `${primary} fica fora da corrente: sem reserva. Com agente ou grok-4 como primário a reserva é automática.`
      : reserve.length === 0 ? `Primário: ${primary}. Sem reserva disponível nesta máquina.` : `Primário: ${primary}. Reserva: ${reserve.join(" → ")}, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.`;
}
primarySelect.addEventListener("change", () => { const m = PRIMARY_OF[primarySelect.value]; if (m !== undefined) backendModelSelect.value = m; paintFallbackOrder(); });
backendModelSelect.addEventListener("change", () => { syncPrimaryFromModel(); paintFallbackOrder(); });

/** Abre as Configurações (botão ou Cmd+,): sempre com as seções recolhidas e a memória recém-lida. */
function openSettings(): void {
  if (dialog.open) return;
  syncPrimaryFromModel();
  paintFallbackOrder();
  settingsError.hidden = true;
  for (const g of settingsGroups) g.open = false;
  void window.meuBot.getMemory().then(applyMemory);
  dialog.showModal();
}
settingsBtn.addEventListener("click", () => openSettings());
window.meuBot.on("ui:toggle-settings", () => { if (dialog.open) dialog.close(); else openSettings(); });
window.meuBot.on("chat:notice", ({ conversationId, text }) => { const tab = tabs.get(conversationId); if (tab !== undefined) { addNotice(tab, text, "warn"); offerClaudeLogin(tab, text); } });
window.meuBot.on("chat:account", ({ host, status }) => {
  if (host !== windowHost) return;
  account = status;
  paintContext(active());
  paintFallbackOrder();
  checkSessionThreshold();
});
cancelBtn.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => onboardEvent("settings-closed"));
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  settingsError.hidden = true;
  const port = Number.parseInt(backendPortInput.value, 10);
  const fontSize = Number.parseInt(fontSizeInput.value, 10);
  const budget = Number.parseInt(contextBudgetInput.value, 10);
  const every = Number.parseInt(memoryEveryInput.value, 10);
  void window.meuBot.setMemory({ notas: memoryNotas.value, perfil: memoryPerfil.value }).then(applyMemory);
  const update = {
    backendModelForHost: backendModelSelect.value as BackendModel,
    theme: themeSelect.value as Theme,
    notifications: notificationsInput.checked,
    ...(Number.isInteger(port) ? { backendPort: port } : {}),
    ...(Number.isInteger(fontSize) ? { fontSize } : {}),
    ...(Number.isInteger(budget) ? { contextBudgetTokens: budget } : {}),
    ...(Number.isInteger(every) ? { memoryEveryTurns: every } : {}),
    quickEntryEnabled: quickEnabled.checked,
    ...(quickShortcut.value.trim() === "" ? {} : { quickEntryShortcut: quickShortcut.value.trim() }),
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
  // Lista de conversas oculta por padrão (Cmd+B ou ☰ mostra); só fica visível se a pessoa a abriu antes.
  try { sidebarEl.hidden = localStorage.getItem("sidebarShown") !== "1"; } catch { sidebarEl.hidden = true; }
  // Barra recolhida por padrão (como a lista): só fica aberta se a pessoa a mostrou da última vez.
  try { setTopbarHidden(localStorage.getItem("topbarShown") !== "1"); } catch { setTopbarHidden(true); }
  const info = await window.meuBot.getWindowInfo();
  if (info === null) throw new Error("janela sem máquina registrada");
  windowHost = info.host;
  document.title = `meu-bot · ${hostLabel(windowHost)}`;
  document.documentElement.style.setProperty("--host-accent", hostAccent(windowHost));
  if (info.models.length > 0) hostModels.set(windowHost, info.models);
  applySettings(await window.meuBot.getSettings());
  void window.meuBot.getAccountStatus().then((s) => { account = s; paintContext(active()); paintFallbackOrder(); checkSessionThreshold(); });
  void refreshWhatsapp();
  void refreshClaudeLine();
  void refreshXaiLine();
  const intro = playIntro(); // cobre a janela enquanto as abas voltam; some sozinha
  await restoreTabs();
  renderSidebar();
  tabsReady = true;
  for (const q of pendingQuick.splice(0)) void handleQuickSubmit(q.correlationId, q.text);
  for (const id of pendingFocus.splice(0)) void openFromIndex(id);
  await intro;
})();
