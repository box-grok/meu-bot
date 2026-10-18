import type { NetState, UpdateState, AccountStatus, ClaudeAuthInfo, ClaudeLoginEvent, ObjectiveChoice, ObjectiveInfo, WaMarkPatch, WhatsappChat, WhatsappEvent, WhatsappStatus, WhatsappThreadMessage, WhatsappMenuAction, WhatsappOrigin, AudioSetup, VoiceReplyMode, SupportInfo, SupportShare, Capabilities, XaiKeyStatus, ToolEvent, BackendModel, BackendStatusEvent, ContextEvent, DoneEvent, ErrorEvent, ExportFormat, MemoryView, SettingsView, StoredConversationView, TabMenuAction, Theme, StatusLineSegments } from "../shared/ipc";
import { hostAccent } from "./lib/host-color.js";
import { el } from "./lib/dom.js";
import { deviceLine, licenseSummary } from "./lib/admin-view.js";
import type { PageTab } from "./lib/pages-types.js";
import { mountSuportePage } from "./admin/suporte-page.js";
import { mountBotMirror, type BotMirror } from "./admin/bot-mirror.js";
import { loginView, type LoginProvider, type LoginView } from "./lib/login-steps.js";
import { ipcErrorText } from "./lib/ipc-error.js";
import { planMascots } from "./lib/intro-mascots.js";
import { mountSnake } from "./snake.js";
import { ACERVO_SKILLS, installPrompt } from "./lib/acervo.js";
import { hostLabel, setHostNicknames } from "./lib/probe-text.js";
import { shellBlockToPaste, xtermTheme } from "./lib/terminal.js";
import { FALLBACK_PRIMARIES, GUIDE_ACTION_LABEL, LEVEL_OPTIONS, OBJECTIVE_OPTIONS, REPLY_NOTE, REPLY_OPTIONS, TUTORIAIS, emptyFlags, fallbackOrderText, guideTabTitle, guideView, replyChoiceOf, sidebarBadge, tutorialBadge, visibleTutorials, type GuideContext, type GuideFlagName, type GuideFlags, type GuideTarget, type Tutorial } from "./lib/tutoriais.js";
import { renderMarkdown } from "./lib/markdown.js";
import { groupByDate, matches, normalize, shortDate, type SidebarConversation } from "./lib/sidebar.js";
import { dropCache, readCache, writeCache, type CacheStore, type Cached } from "./lib/cache.js";
import { conversationReferenceText, waReferenceText } from "./lib/reference.js";
import { providerLabel } from "./lib/provider-label.js";
import { updateStateText } from "./lib/update-text.js";
import { offlineBarText } from "./lib/offline-text.js";
import { rankPalette, type PaletteItem } from "./lib/palette-rank.js";
import { buildSegments, previewLine, SL_TEST_COMMAND, thresholdToWarn, timeUntil } from "./lib/status-line.js";
import { advanceOnboard, FINAL_MESSAGE, SKIPPED_MESSAGE, TOUR_CARD, TOUR_INVITE, initialOnboardState, ONBOARD_STEPS, pickFeedback, welcomeMessage, type Feedback, type OnboardEvent, type OnboardState } from "./lib/onboarding.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} não existe`);
  return el as T;
};

const tabsEl = $<HTMLElement>("tabs");
const panelsEl = $<HTMLElement>("panels");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("btn-send");
/** Contagem "Enviando em 3…" em andamento (startAutoSend); null fora dela. */
let autoSend: { timer: number; tab: Tab } | null = null;
/** Fase do botão Enviar por conversa: ausente = parado. "sending" até a resposta começar, "streaming" enquanto chega, "done" por 900 ms. */
const sendPhase = new Map<string, "sending" | "streaming" | "done">();
function setSendPhase(tab: Tab, phase: "sending" | "streaming" | "done" | null): void {
  if (phase === null) sendPhase.delete(tab.id); else sendPhase.set(tab.id, phase);
  if (tab.id === activeId) syncComposer();
}
const newBtn = $<HTMLButtonElement>("btn-new");
const settingsBtn = $<HTMLButtonElement>("btn-settings");
const keyPill = $<HTMLSpanElement>("key-pill");
const hostPill = $<HTMLSpanElement>("host-pill");
const statusPill = $<HTMLSpanElement>("status-pill");
const sidebarStatus = $<HTMLElement>("sidebar-status");
const modelSelect = $<HTMLSelectElement>("model-select");
const dialog = $<HTMLDialogElement>("settings-dialog");
const form = $<HTMLFormElement>("settings-form");
/** Máquina desta janela; vem do main em window:info e não muda. */
let windowHost = "";
/** Janela do meu-bot-admin (suporte): espelho só leitura + ações de suporte. */
/** O que esta variante pode fazer (vem do main em window:info); até lá, o padrão do meu-bot normal. */
/** meu-bot-admin: espelho das conversas dela com o meu-bot (admin/bot-mirror.ts); null no meu-bot normal. */
let adminBotMirror: BotMirror | null = null;
/** Versão deste app (de window:info) e quando esta sessão abriu: vão no progresso para o admin ver se ela está atualizada e ativa. */
let appVersion = "";
const sessionOpenedAt = new Date().toISOString();
let caps: Capabilities = { variant: "client", chat: true, pair: true, login: true, manageWa: true, tunnel: true, install: true, supportClient: true, supportAdmin: false };
const lastHostEl = $<HTMLParagraphElement>("last-host");
const backendModelSelect = $<HTMLSelectElement>("backend-model");
const backendPortInput = $<HTMLInputElement>("backend-port");
const fontSizeInput = $<HTMLInputElement>("font-size");
const themeSelect = $<HTMLSelectElement>("theme");
const settingsError = $<HTMLParagraphElement>("settings-error");
const cancelBtn = $<HTMLButtonElement>("btn-cancel");
const notificationsInput = $<HTMLInputElement>("notifications");
const openAtLoginInput = $<HTMLInputElement>("open-at-login");
const openAtLoginHint = $<HTMLElement>("open-at-login-hint");
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
  // Enviar (shot "cred-button-loading-to-tick"): clique → ponto pulsando até a resposta começar; aí Parar; ao terminar, ✓.
  const phase = tab === null ? "idle" : (sendPhase.get(tab.id) ?? (busy ? "streaming" : "idle"));
  sendBtn.disabled = tab === null;
  if (autoSend !== null && phase === "idle") return; // contagem "Enviando em 3…" no botão; sai com cancelAutoSend
  sendBtn.textContent = phase === "streaming" ? "Parar" : "Enviar";
  sendBtn.classList.toggle("btn-bad", phase === "streaming");
  sendBtn.classList.toggle("is-sending", phase === "sending");
  sendBtn.classList.toggle("is-done", phase === "done");
  sendBtn.classList.toggle("shine", tab !== null && phase === "idle" && inputEl.value.trim().length >= 2);
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
  const segs = buildSegments({ model: tab.model, ctx, turn: tab.lastTurn, account, segments: statusLineSegs ?? account?.segments ?? null });
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
  deactivatePage();
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
  syncRest();
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
  // Sem internet, a pill diz isso e nada mais: o estado do túnel não explica o que a pessoa está vendo.
  if (net.online === false) { statusPill.hidden = false; statusPill.textContent = "sem internet"; statusPill.className = "pill pill-off"; sidebarStatus.hidden = false; return; }
  const st = host === null ? undefined : hostStatus.get(host);
  if (st === undefined) { statusPill.hidden = true; sidebarStatus.hidden = true; return; }
  statusPill.hidden = false;
  statusPill.textContent = st.state === "degraded" ? `túnel instável: ${st.detail}` : st.detail;
  statusPill.className = `pill ${st.state === "ready" ? "pill-on" : st.state === "error" ? "pill-off" : "pill-neutral"}`;
  // Verde não precisa aparecer: o bloco na base da lista só abre quando há algo a resolver.
  sidebarStatus.hidden = !(st.state === "error" || st.state === "degraded");
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

/** Depois de fechar/arquivar/excluir: ativa a aba vizinha. Sem nenhuma, a tela fica vazia (sem aba
 *  automática): Novo, Cmd+N ou a lista lateral abrem a próxima. */
function afterTabGone(id: string): void {
  if (activeId !== id) { renderSidebar(); return; }
  const last = [...tabs.keys()].at(-1);
  if (last !== undefined) { activate(last); return; }
  activeId = null;
  inputEl.value = "";
  syncComposer();
  renderSidebar();
  syncRest();
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
  afterTabGone(id);
}

async function deleteConversation(id: string): Promise<void> {
  const cur = index.get(id);
  const name = cur !== undefined ? titleOf(cur) : "esta conversa";
  if (!window.confirm(`Excluir "${name}"? Isso apaga o histórico de vez.`)) return;
  detachTab(id);
  index.delete(id);
  renderSidebar();
  void window.meuBot.deleteConversation(id);
  afterTabGone(id);
}

async function archive(id: string, archived: boolean): Promise<void> {
  const cur = index.get(id);
  if (archived) detachTab(id);
  patchIndex(id, { archived, openAsTab: archived ? false : (cur?.openAsTab ?? false), updatedAt: cur?.updatedAt });
  await window.meuBot.archiveConversation(id, archived);
  if (archived) afterTabGone(id);
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

/** Linha discreta no topo da lateral por 1,5 s ("✓ ID copiado"). */
function sidebarNotice(text: string): void {
  const n = el("div", "sidebar-empty sidebar-notice", text);
  sidebarList.prepend(n);
  window.setTimeout(() => n.remove(), 1500);
}
/** Copia e avisa; em erro de clipboard, avisa também (sem caixa). */
function copyReference(text: string): void {
  void navigator.clipboard.writeText(text).then(() => sidebarNotice("✓ ID copiado"), () => sidebarNotice("✗ Não deu para copiar"));
}

async function runTabAction(id: string, action: TabMenuAction | null): Promise<void> {
  const tab = tabs.get(id);
  switch (action) {
    case "rename": if (tab !== undefined) startRename(tab); else { const v = index.get(id); if (v !== undefined) { const name = window.prompt("Novo nome:", titleOf(v)); if (name !== null) { patchIndex(id, { title: name.trim() || undefined, updatedAt: v.updatedAt }); void window.meuBot.renameConversation(id, name); } } } break;
    case "duplicate": await duplicate(id); break;
    case "export-md": await exportConversation(id, "md"); break;
    case "export-json": await exportConversation(id, "json"); break;
    case "copy-ref": {
      // A sessão do Claude Code (o .jsonl) vem guardada ou do backend; sem ela, plano B com o id do app.
      let claude = null;
      try { claude = (await window.meuBot.conversationReference(id)).claude; } catch { /* plano B */ }
      copyReference(conversationReferenceText(id, hostLabel(windowHost), claude, index.get(id)?.model ?? ""));
      break;
    }
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
  if (getListMode() === "whatsapp") { paintWaSidebar(query); return; }
  // meu-bot-admin: no modo "meu-bot" a lista são as conversas dela, lidas da máquina (não há conversas locais).
  if (adminBotMirror !== null) { adminBotMirror.paintList(sidebarList, query); return; }
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
  const off = net.online === false;
  miniDot.className = `mini-dot ${off ? "bad" : st === undefined ? "" : st.state === "ready" ? "ok" : st.state === "error" ? "bad" : "warn"}`;
  miniText.textContent = `${hostLabel(windowHost)}${tab !== null ? ` · ${tab.model}` : ""}${off ? " · sem internet" : st !== undefined ? ` · ${st.detail}` : ""}`;
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

const modeToast = $<HTMLElement>("mode-toast");
let modeToastTimer: ReturnType<typeof setTimeout> | null = null;
const MODE_HUE: Record<string, number> = { agente: 145, claudecode: 220, "grok-4": 40, "rene-dm": 330, rene: 270 };
/** Toast de modo (shot "telegram-copy-link-toast"): sobe acima da caixa com mola, o mascote-ícone nasce girando na cor do modo e pisca, e sai descendo 2 s depois. */
function showModeToast(model: string): void {
  const opt = [...modelSelect.options].find((o) => o.value === model);
  const label = (opt?.textContent ?? model).replace(/ · não existe nesta máquina$/, "");
  const [name, ...rest] = label.split(" · ");
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const icon = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
  icon.removeAttribute("class"); icon.style.setProperty("--hue", String(MODE_HUE[model] ?? 220));
  modeToast.querySelector(".mt-icon")?.replaceChildren(icon);
  const nameEl = modeToast.querySelector(".mt-name"); if (nameEl !== null) nameEl.textContent = `modo ${name ?? model}`;
  const descEl = modeToast.querySelector(".mt-desc"); if (descEl !== null) descEl.textContent = rest.join(" · ");
  if (modeToastTimer !== null) clearTimeout(modeToastTimer);
  modeToast.classList.remove("in"); modeToast.hidden = false; void modeToast.offsetWidth;
  modeToast.classList.add("in");
  modeToastTimer = setTimeout(() => { modeToast.classList.remove("in"); modeToastTimer = setTimeout(() => { modeToast.hidden = true; modeToastTimer = null; }, 240); }, 2000);
}

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
  add({ id: "a:acervo", kind: "action", label: "Acervo: biblioteca de skills", detail: ACERVO_SKILLS.length === 0 ? "vazio por enquanto" : `${ACERVO_SKILLS.length} skills; instalar é pedir ao agente`, keywords: ["acervo", "skills", "biblioteca", "instalar"] }, () => openPage(acervoPage));
  add({ id: "a:atividade", kind: "action", label: "Atividade do agente", detail: "o que o modo agente roda nesta máquina, ao vivo", keywords: ["atividade", "agente", "ferramentas", "comandos", "log"] }, () => { openPage(activityPage(), true); });
  add({ id: "a:terminal", kind: "action", label: `Terminal em ${hostLabel(windowHost)}`, detail: "abre um shell nesta máquina (Cmd+J)", keywords: ["terminal", "shell", "ssh", "console"] }, () => { void openTerminalTab(); });
  for (const t of visibleNow()) if (t.comingSoon !== true) add({ id: `a:tut:${t.id}`, kind: "action", label: `Tutorial ${t.number}: ${t.title}`, detail: tutorialBadge(t, false), keywords: ["tutorial", String(t.number), t.short.toLowerCase(), ...t.title.toLowerCase().split(/\s+/)] }, () => { tutNext = false; openGuide(t); });
  add({ id: "a:tutoriais", kind: "action", label: "Tutoriais: passo a passo do meu-bot", detail: ((c) => c.todo === 0 ? "tudo feito" : `${c.todo} para fazer`)(tutCounts()), keywords: ["tutorial", "tutoriais", "ajuda", "como"] }, () => openPage(tutoriaisPage));
  add({ id: "a:sidebar", kind: "action", label: "Mostrar ou ocultar lista de conversas", detail: "Cmd+B" }, () => toggleSidebar());
  add({ id: "a:topbar", kind: "action", label: "Recolher ou mostrar a barra superior", detail: "Cmd+Shift+B" }, () => setTopbarHidden(!document.body.classList.contains("topbar-hidden")));
  add({ id: "a:claude-login", kind: "action", label: "Entrar no Claude Code nesta máquina", detail: "tutorial 1: link no navegador + código", keywords: ["login", "claude", "deslogado", "entrar"] }, () => enterClaude());
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
  add({ id: "a:onboard", kind: "action", label: "Tour do meu-bot (rever onboarding)", detail: "começa agora nesta janela", keywords: ["tour", "onboarding", "ajuda"] }, () => restartTour());
  add({ id: "a:quick", kind: "action", label: "Entrada rápida: mostrar", detail: settings?.quickEntryShortcut ?? "" }, () => window.meuBot.toggleQuickEntry());
  if (cur !== null) {
    add({ id: "a:rename", kind: "action", label: "Renomear conversa atual" }, () => startRename(cur));
    add({ id: "a:export-md", kind: "action", label: "Exportar conversa atual em Markdown" }, () => exportConversation(cur.id, "md"));
    add({ id: "a:export-json", kind: "action", label: "Exportar conversa atual em JSON" }, () => exportConversation(cur.id, "json"));
    add({ id: "a:archive", kind: "action", label: "Arquivar conversa atual" }, () => archive(cur.id, true));
    add({ id: "a:close", kind: "action", label: "Fechar aba atual", detail: "Cmd+W" }, () => closeTab(cur.id));
    for (const m of ["claudecode", "agente", "rene-dm", "rene", "grok-4"] as const) {
      add({ id: `a:model:${m}`, kind: "action", label: `Usar modelo ${m} nesta conversa` }, () => { if (cur.model !== m && !prefersReducedMotion) showModeToast(m); setTabModel(cur, m); void window.meuBot.setConversationModel(cur.id, m); });
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
/** Rótulo "quem respondeu" no pé da bolha do assistente (grok-4; ou "respondeu grok-4 (fallback de agente)", em aviso). */
function paintProviderLabel(node: HTMLElement, model: string, provider: string | undefined, fallback: string | undefined): void {
  node.querySelector(":scope > .msg-provider")?.remove();
  const text = providerLabel(model, provider, fallback);
  if (text === "") return;
  const tag = el("span", `msg-provider${provider !== undefined && provider !== model ? " fallback" : ""}`, text);
  if (fallback !== undefined) tag.title = fallback;
  node.appendChild(tag);
}
function appendMessage(tab: Tab, role: "user" | "assistant", content: string, indexInHistory: number, meta?: { provider?: string | undefined; fallback?: string | undefined }): HTMLElement {
  const node = el("div", role === "user" ? "msg msg-user" : "msg msg-assistant");
  node.dataset["index"] = String(indexInHistory);
  if (role === "user") node.textContent = content;
  else { renderAssistant(node, content); if (meta !== undefined) paintProviderLabel(node, tab.model, meta.provider, meta.fallback); }
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
  if (restored?.fromWhatsapp !== undefined) {
    const w = restored.fromWhatsapp;
    if (w.messages !== undefined && w.messages.length > 0) renderWaQuote(tab, w, restored.pendingNote !== undefined);
    else {
      // Conversas trazidas antes de a aba guardar as mensagens: só a nota.
      const until = new Date(w.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      addNote(tab, `Trazida do WhatsApp: ${w.name} · ${w.count} ${w.count === 1 ? "mensagem" : "mensagens"} até ${until}`);
    }
  }
  if (restored !== undefined && restored.messages.length > 0) {
    if (restored.branchedFrom !== undefined) {
      const origin = index.get(restored.branchedFrom.id);
      addNote(tab, `Ramificada de "${origin !== undefined ? titleOf(origin) : "outra conversa"}" (mensagem ${restored.branchedFrom.index + 1})`);
    }
    restored.messages.forEach((m, i) => appendMessage(tab, m.role, m.content, i, { provider: m.provider, fallback: m.fallback }));
    const first = restored.messages.find((m) => m.role === "user");
    if (first !== undefined) setTitle(tab, first.content);
  } else if (restored?.fromWhatsapp === undefined) {
    addNotice(tab, host === "local" ? "Nova conversa neste Mac. Suas mensagens vão pro backend local, que roda o Claude Code daqui por baixo." : `Nova conversa na máquina ${hostLabel(host)}. Suas mensagens vão pro backend dela, que roda o Claude Code por baixo.`);
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
  // Onboarding pendente (primeira vez, ou interruptor "Onboarding" ligado no seletor): começa
  // sempre, com ou sem conversas; o passo "Novo" cria a conversa, então não se cria a automática.
  const pending = settings?.onboarding === "pending";
  if (pending) showTourWelcome(); // convite; o tour só começa se a pessoa aceitar
  if (asTabs.length === 0) {
    if (!pending) await newTab();
    else syncRest();
    return;
  }
  for (const c of asTabs) buildTab(c.id, c.model, c.host, c);
  const latest = [...asTabs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  activate(latest?.id ?? asTabs[asTabs.length - 1]!.id);
}

function applySettings(view: SettingsView): void {
  settings = view;
  setHostNicknames(view.hostNames);
  rethemeTerminals();
  if (windowHost !== "" && caps.chat) document.title = `meu-bot · ${hostLabel(windowHost)}`;
  if (tutorialsReady) paintTutCount(); // o tour concluído sai da contagem de ativos
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
  openAtLoginInput.checked = view.openAtLogin;
  openAtLoginInput.disabled = !view.openAtLoginAvailable;
  openAtLoginHint.textContent = view.openAtLoginAvailable ? "O seletor de máquinas abre sozinho; as conversas e o WhatsApp continuam na máquina." : "Só no app instalado (em desenvolvimento não dá para registrar o item de início).";
  quickStatus.textContent = view.quickEntryStatus === "registered" ? "ativo" : view.quickEntryStatus === "taken" ? "em uso por outro app" : view.quickEntryStatus === "invalid" ? "inválido" : "desligado";
  document.documentElement.style.setProperty("--chat-font", `${view.fontSize}px`);
  document.documentElement.dataset["theme"] = view.theme;
  syncComposer();
}

// ---- Entrar no Claude Code: roda `claude auth login` na máquina, abre o link e recebe o código. Um estado só
// (clState) pintado em dois conjuntos de controles: o passo 1 do tutorial "Entrar no Claude Code" (dentro da
// aba, criado uma vez e reanexado a cada repintura, para o campo do código não perder o que foi digitado) e o
// modal #cl-dialog, que fica para quem já concluiu o tutorial e quer trocar de conta.
const clDialog = $<HTMLDialogElement>("cl-dialog");
const clClose = $<HTMLButtonElement>("cl-close");
interface LoginControls { box: HTMLElement; status: HTMLElement; open: HTMLButtonElement; codeRow: HTMLElement; code: HTMLInputElement; send: HTMLButtonElement; log: HTMLElement; start: HTMLButtonElement; cancel: HTMLButtonElement | null }
const clState = { running: false, url: null as string | null, needCode: false, status: "", log: [] as string[], result: null as "ok" | "fail" | null };
const clModal: LoginControls = { box: clDialog, status: $<HTMLElement>("cl-status"), open: $<HTMLButtonElement>("cl-open"), codeRow: $<HTMLElement>("cl-code-row"), code: $<HTMLInputElement>("cl-code"), send: $<HTMLButtonElement>("cl-send"), log: $<HTMLElement>("cl-log"), start: $<HTMLButtonElement>("cl-start"), cancel: null };
function buildLoginControls(): LoginControls {
  const box = el("div", "guide-login");
  const status = el("p", "hint");
  const start = el("button", "btn btn-primary btn-small", "Entrar"); start.type = "button";
  const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button";
  const open = el("button", "btn btn-ghost btn-small", "abrir o link de novo"); open.type = "button";
  const actions = el("div", "actions"); actions.append(start, cancel, open);
  const codeRow = el("div", "row"); codeRow.hidden = true;
  const code = el("input") as HTMLInputElement; code.type = "text"; code.autocomplete = "off"; code.spellcheck = false; code.placeholder = "cole o código aqui";
  const send = el("button", "btn btn-primary btn-small", "Enviar código"); send.type = "button";
  const label = el("label", "grow", "Código de autorização"); label.append(code);
  codeRow.append(label, send);
  const log = el("pre", "log"); log.hidden = true;
  box.append(status, actions, codeRow, log);
  return { box, status, start, cancel, open, codeRow, code, send, log };
}
const clGuide: LoginControls = buildLoginControls();
const CL_INTRO = (): string => `Máquina: ${hostLabel(windowHost)}. Abre o link de autorização no navegador; você entra na conta e cola aqui o código que aparece.`;

/** Pinta um conjunto de controles a partir do clState; só textos, hidden e classes (nunca cria nós). */
function paintLoginControls(c: LoginControls, variant: "modal" | "guide"): void {
  c.status.textContent = clState.status === "" ? CL_INTRO() : clState.status;
  c.open.hidden = clState.url === null || clState.result === "ok";
  c.codeRow.hidden = !clState.needCode;
  c.log.hidden = clState.log.length === 0; c.log.textContent = clState.log.join("\n");
  c.start.hidden = clState.running || clState.result === "ok";
  c.start.textContent = clState.result === "fail" ? "Tentar de novo" : variant === "guide" ? "Entrar" : "Começar";
  c.start.classList.toggle("pulse", variant === "guide" && !c.start.hidden);
  if (c.cancel !== null) c.cancel.hidden = !clState.running;
  if (variant === "modal") clClose.textContent = clState.running ? "Cancelar" : "Fechar";
}
function paintClaudeLogin(): void { paintLoginControls(clModal, "modal"); paintLoginControls(clGuide, "guide"); }

async function runClaudeLogin(): Promise<void> {
  if (clState.running) return;
  clState.running = true; clState.result = null; clState.url = null; clState.needCode = false; clState.log = []; clState.status = "Iniciando o login na máquina…";
  paintClaudeLogin();
  try { await window.meuBot.claudeLogin(); } catch (err) { clState.status = `✗ ${ipcErrorText(err)}`; clState.result = "fail"; }
  finally { clState.running = false; clState.needCode = false; paintClaudeLogin(); }
}
function submitClaudeCode(c: LoginControls): void {
  const code = c.code.value.trim();
  if (code === "") return;
  c.send.disabled = true;
  void window.meuBot.claudeLoginCode(code).then((ok) => {
    if (ok) { clState.status = "Código enviado; conferindo o login…"; clModal.code.value = ""; clGuide.code.value = ""; }
    else clState.status = "✗ não há login em andamento; clique em Entrar.";
  }).finally(() => { c.send.disabled = false; paintClaudeLogin(); });
}
function wireLogin(c: LoginControls): void {
  c.start.addEventListener("click", () => { void runClaudeLogin(); });
  c.send.addEventListener("click", () => submitClaudeCode(c));
  // Enter manda o código; stopPropagation para os atalhos globais (Cmd+K, Esc…) não dispararem enquanto digita.
  c.code.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submitClaudeCode(c); } ev.stopPropagation(); });
  c.open.addEventListener("click", () => { if (clState.url !== null) void window.meuBot.openExternal(clState.url); });
  if (c.cancel !== null) c.cancel.addEventListener("click", () => { if (clState.running) void window.meuBot.claudeLoginCancel(); });
}
wireLogin(clModal); wireLogin(clGuide);

/** Modal do login (trocar de conta quando o tutorial 1 já foi concluído). */
function openClaudeLogin(): void {
  if (!clState.running) { clState.status = ""; clState.log = []; clState.url = null; clState.needCode = false; clState.result = null; clModal.code.value = ""; }
  paintClaudeLogin();
  if (!clDialog.open) clDialog.showModal();
}
const CLAUDE_TUTORIAL = TUTORIAIS.find((t) => t.id === "claude-login") as Tutorial;
/**
 * Porta única para "Entrar no Claude Code": enquanto o tutorial 1 não foi concluído, abre o guia (o botão
 * Entrar pulsa no passo 1; nada roda sozinho); concluído, é trocar de conta: o modal, que já começa o login.
 */
function enterClaude(): void {
  if (caps.install && !tutorialDone(CLAUDE_TUTORIAL)) { tutNext = false; openGuide(CLAUDE_TUTORIAL); return; }
  openClaudeLogin(); void runClaudeLogin();
}

window.meuBot.on("claude-login:event", (ev: ClaudeLoginEvent) => {
  const appendLog = (t: string): void => { clState.log = [...clState.log, t].slice(-8); };
  switch (ev.kind) {
    case "url": clState.url = ev.url; clState.status = "Abri o link no navegador. Entre na conta e copie o código que a página mostra."; appendLog("▸ link aberto no navegador"); break;
    case "waiting-code": {
      clState.needCode = true; clState.status = "Cole o código da página e clique em Enviar código.";
      paintClaudeLogin();
      // Foco no campo que está à vista: o do guia (aba do tutorial 1 aberta) ou o do modal.
      const guideOpen = pageActive !== null && pageActive.id === `tut-${CLAUDE_TUTORIAL.id}`;
      if (guideOpen) clGuide.code.focus(); else if (clDialog.open) clModal.code.focus();
      break;
    }
    case "log": appendLog(ev.text); break;
    case "done":
      clState.result = ev.ok ? "ok" : "fail"; clState.needCode = false;
      clState.status = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      appendLog(ev.ok ? "✓ logado" : "não concluiu");
      if (ev.ok) {
        const tab = active();
        if (tab !== null) addNotice(tab, "✓ Claude Code logado nesta máquina. Pode mandar a próxima mensagem.", "info");
        void window.meuBot.getAccountStatus().then((s) => { account = s; paintContext(active()); paintGuide(); });
        clAuth = { loggedIn: true, email: clAuth?.email ?? null }; paintClaudeLine(); paintGuide(); // otimista: o ✓ do passo 1 não espera o SSH
        void refreshClaudeLine();
        // Deu certo: o modal se fecha sozinho; o aviso fica na conversa.
        setTimeout(() => { if (clDialog.open) clDialog.close(); }, 1200);
      }
      break;
  }
  paintClaudeLogin();
});

/** Erro/aviso que indica Claude Code deslogado: a notice ganha o botão "Entrar no Claude Code". */
const LOGGED_OUT_RE = /not logged in|please run \/?login|deslogad|não está logado/i;
function offerClaudeLogin(tab: Tab, text: string): void {
  if (!LOGGED_OUT_RE.test(text)) return;
  const box = el("div", "notice notice-warn");
  box.append(el("span", "", "O Claude Code desta máquina está deslogado. "));
  const btn = el("button", "btn btn-ghost btn-small", "Entrar no Claude Code");
  btn.type = "button";
  btn.addEventListener("click", () => enterClaude());
  box.append(btn);
  tab.messagesEl.appendChild(box);
  scrollToBottom(tab, false);
}
clClose.addEventListener("click", () => { if (clState.running) void window.meuBot.claudeLoginCancel(); clDialog.close(); });
window.meuBot.on("ui:claude-login", () => enterClaude());

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

/** Consulta a conta na máquina; o tutorial 1 e a lateral seguem o resultado (é aqui que o e-mail chega). */
async function refreshClaudeLine(): Promise<void> {
  try { clAuth = await window.meuBot.claudeAuth(); } catch { clAuth = null; }
  paintClaudeLine();
  if (tutorialsReady) paintGuide();
}

/** Sai da conta do Claude Code nesta máquina; com `relogin`, já leva ao login (tutorial 1 ou modal). */
async function logoutClaude(relogin: boolean): Promise<void> {
  clLineBtn.disabled = true;
  try { clAuth = await window.meuBot.claudeLogout(); paintClaudeLine(); paintGuide(); if (relogin) enterClaude(); }
  finally { clLineBtn.disabled = false; }
}

clLineBtn.addEventListener("click", () => {
  if (clAuth !== null && clAuth.loggedIn) {
    if (!window.confirm(`Sair da conta ${clAuth.email ?? "do Claude Code"} nesta máquina? O agente para de responder pelo Claude até entrar de novo (o grok-4 continua).`)) return;
    void logoutClaude(true);
    return;
  }
  enterClaude();
});

// ---- Linha "xAI (Grok)": OAuth da xAI no Hermes da máquina, que o grok-4 usa. Mesmo molde do Claude: um
// estado (xaiState) pintado nos controles do passo 2 do tutorial 4 (xaiGuide, criados uma vez) e no modal
// #xai-dialog (trocar de conta depois de concluído). O passo 1 (preparar: Hermes + proxy) tem seu bloco.
const xaiLine = $<HTMLDivElement>("xai-line");
const xaiLineText = $<HTMLSpanElement>("xai-line-text");
const xaiLineBtn = $<HTMLButtonElement>("xai-line-btn");
/** Desenha um LoginView (lib/login-steps.ts): passos com estado, código do dispositivo em destaque, detalhes técnicos recolhidos. */
function paintLoginSteps(box: HTMLElement, view: LoginView, show: boolean): void {
  box.hidden = !show;
  box.replaceChildren();
  if (!show) return;
  const ol = el("ol", "login-steps");
  for (const st of view.steps) {
    const li = el("li", `login-step ${st.state}`);
    li.append(el("span", "ls-dot"), el("span", "ls-title", st.title));
    if (st.detail !== null) li.append(el("span", "ls-detail", st.detail));
    ol.append(li);
  }
  box.append(ol);
  if (view.code !== null) {
    const chip = el("div", "login-code");
    const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
    copy.addEventListener("click", () => { void navigator.clipboard.writeText(view.code ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
    chip.append(el("span", "lc-label", "Código do dispositivo"), el("span", "lc-value", view.code), copy);
    box.append(chip);
  }
  if (view.details.length > 0) {
    const d = el("details", "login-details"); d.append(el("summary", "", "detalhes técnicos"), el("pre", "", view.details.slice(-12).join("\n")));
    box.append(d);
  }
}
const loginViewOf = (provider: LoginProvider, events: readonly ClaudeLoginEvent[], running: boolean): LoginView => loginView(provider, events, { machine: hostLabel(windowHost), running });

const xaiDialog = $<HTMLDialogElement>("xai-dialog");
const xaiClose = $<HTMLButtonElement>("xai-close");
let xaiAuth: ClaudeAuthInfo | null = null;
let xaiKey: XaiKeyStatus | null = null;
const xaiState = { running: false, preparing: false, url: null as string | null, status: "", log: [] as string[], events: [] as ClaudeLoginEvent[], result: null as "ok" | "fail" | null };
const xaiModal: LoginControls = { box: xaiDialog, status: $<HTMLElement>("xai-status"), open: $<HTMLButtonElement>("xai-open"), codeRow: el("div"), code: el("input") as HTMLInputElement, send: el("button") as HTMLButtonElement, log: $<HTMLElement>("xai-steps"), start: $<HTMLButtonElement>("xai-start"), cancel: null };
const xaiGuide: LoginControls = buildLoginControls();
// No guia, o log cru vira a caixa de passos (lib/login-steps.ts), como no modal.
{ const steps = el("div", "login-steps-box"); steps.hidden = true; xaiGuide.log.replaceWith(steps); xaiGuide.log = steps; }
const XAI_INTRO = (): string => `Máquina: ${hostLabel(windowHost)}. Abre o link da xAI no navegador, já com o código do dispositivo. Entre na conta e aprove; aqui não precisa colar nada.`;
/** Passo 1 do tutorial 4: preparar (Hermes + proxy). Status, botão e o mesmo log do estado. */
const xaiPrep = (() => {
  const box = el("div", "guide-login");
  const status = el("p", "hint");
  const start = el("button", "btn btn-primary btn-small", "Preparar"); start.type = "button";
  const actions = el("div", "actions"); actions.append(start);
  const log = el("pre", "log"); log.hidden = true;
  box.append(status, actions, log);
  start.addEventListener("click", () => { void prepareXai(); });
  return { box, status, start, log };
})();

function paintXaiControls(c: LoginControls, variant: "modal" | "guide"): void {
  c.status.textContent = xaiState.status === "" ? XAI_INTRO() : xaiState.status;
  c.open.hidden = xaiState.url === null || xaiState.result === "ok";
  c.codeRow.hidden = true;
  paintLoginSteps(c.log, loginViewOf("xai", xaiState.events, xaiState.running), xaiState.events.length > 0 || xaiState.running);
  c.start.hidden = xaiState.running || xaiState.preparing || xaiState.result === "ok";
  c.start.textContent = xaiState.result === "fail" ? "Tentar de novo" : variant === "guide" ? "Entrar" : "Começar";
  c.start.classList.toggle("pulse", variant === "guide" && !c.start.hidden);
  if (c.cancel !== null) c.cancel.hidden = !xaiState.running;
  if (variant === "modal") xaiClose.textContent = xaiState.running || xaiState.preparing ? "Cancelar" : "Fechar";
}
function paintXaiLogin(): void {
  paintXaiControls(xaiModal, "modal"); paintXaiControls(xaiGuide, "guide");
  xaiPrep.status.textContent = xaiState.preparing ? xaiState.status : xaiAuth !== null ? "Hermes e proxy prontos nesta máquina." : xaiState.result === "fail" ? xaiState.status : "Instala o Hermes e o proxy da xAI nesta máquina; o backend reinicia no fim.";
  xaiPrep.start.hidden = xaiState.preparing || xaiAuth !== null;
  xaiPrep.start.textContent = xaiState.result === "fail" ? "Tentar de novo" : "Preparar";
  xaiPrep.start.classList.toggle("pulse", !xaiPrep.start.hidden);
  xaiPrep.log.hidden = !xaiState.preparing && xaiState.log.length === 0; xaiPrep.log.textContent = xaiState.log.join("\n");
}

function paintXaiLine(): void {
  if (xaiAuth === null) {
    // Sem Hermes ainda: a linha aparece quando há backend; "entrar" leva ao tutorial 4 (preparar + login).
    if (xaiKey === null || !xaiKey.backend) { xaiLine.hidden = true; return; }
    xaiLine.hidden = false;
    xaiLine.className = "wa-line cl-line off";
    xaiLineText.textContent = "xAI (Grok) · deslogada · o grok-4 não responde";
    xaiLineBtn.textContent = "entrar";
    return;
  }
  xaiLine.hidden = false;
  xaiLine.className = `wa-line cl-line ${xaiAuth.loggedIn ? "on" : "off"}`;
  xaiLineText.textContent = xaiAuth.loggedIn ? `xAI (Grok) · ${xaiAuth.email ?? "logada"}` : "xAI (Grok) · deslogada · o grok-4 não responde";
  xaiLineBtn.textContent = xaiAuth.loggedIn ? "sair" : "entrar";
}
/** Consulta a conta da xAI (e, sem Hermes, se há backend); o tutorial 4 e a lateral seguem o resultado. */
async function refreshXaiLine(): Promise<void> {
  try { xaiAuth = await window.meuBot.xaiAuth(); } catch { xaiAuth = null; }
  if (xaiAuth === null && caps.login && windowHost !== "local") { try { xaiKey = await window.meuBot.xaiKeyStatus(); } catch { xaiKey = null; } }
  paintXaiLine();
  if (tutorialsReady) { paintXaiLogin(); paintGuide(); }
}
/** Modal do login da xAI (trocar de conta quando o tutorial 4 já foi concluído). */
function openXai(): void {
  if (!xaiState.running && !xaiState.preparing) { xaiState.status = ""; xaiState.log = []; xaiState.events = []; xaiState.url = null; xaiState.result = null; }
  paintXaiLogin();
  if (!xaiDialog.open) xaiDialog.showModal();
}
/** Máquina sem Hermes: instala Hermes + proxy da xAI (install-grok-oauth.sh). O passo 1 do tutorial 4. */
async function prepareXai(): Promise<void> {
  if (xaiState.running || xaiState.preparing) return;
  xaiState.preparing = true; xaiState.result = null; xaiState.log = [];
  xaiState.status = `Preparando o Grok em ${hostLabel(windowHost)} (Hermes + proxy local; na primeira vez baixa o Hermes)…`;
  paintXaiLogin();
  try {
    const r = await window.meuBot.xaiPrepare();
    if (!r.ok) { xaiState.status = `✗ ${r.log.at(-1) ?? "não deu para preparar"}`; xaiState.result = "fail"; return; }
    xaiState.preparing = false;
    await refreshXaiLine();
    if (xaiAuth === null) { xaiState.status = "✗ o Hermes foi instalado mas o app ainda não o enxerga; feche e abra a janela desta máquina."; xaiState.result = "fail"; return; }
    xaiState.status = xaiAuth.loggedIn ? "✓ xAI já logada nesta máquina; o grok-4 responde pelo proxy." : "✓ Hermes e proxy prontos. Agora é entrar na conta da xAI.";
  } catch (err) { xaiState.status = `✗ ${ipcErrorText(err)}`; xaiState.result = "fail"; }
  finally { xaiState.preparing = false; paintXaiLogin(); paintGuide(); }
}
async function runXaiLogin(): Promise<void> {
  if (xaiState.running || xaiState.preparing) return;
  xaiState.running = true; xaiState.result = null; xaiState.url = null; xaiState.log = []; xaiState.events = []; xaiState.status = "";
  paintXaiLogin();
  try { await window.meuBot.xaiLogin(); } catch (err) { xaiState.status = `✗ ${ipcErrorText(err)}`; xaiState.result = "fail"; }
  finally { xaiState.running = false; paintXaiLogin(); }
}
const XAI_TUTORIAL = TUTORIAIS.find((t) => t.id === "xai-login") as Tutorial;
const FALLBACK_TUTORIAL = TUTORIAIS.find((t) => t.id === "fallback-contas") as Tutorial;
/**
 * Porta única para "Entrar na xAI": enquanto o tutorial 4 não foi concluído (e o Grok é possível aqui), abre o
 * guia (Preparar ou Entrar pulsando; nada roda sozinho); concluído, é trocar de conta: o modal já com o login.
 */
function enterXai(): void {
  if (caps.install && !tutorialDone(XAI_TUTORIAL)) { tutNext = false; openGuide(XAI_TUTORIAL); return; }
  openXai(); void runXaiLogin();
}
/** Sai da conta da xAI no Hermes desta máquina; com `relogin`, já leva ao login (tutorial 4 ou modal). */
async function logoutXai(relogin: boolean): Promise<void> {
  xaiLineBtn.disabled = true;
  try { xaiAuth = await window.meuBot.xaiLogout(); paintXaiLine(); paintGuide(); if (relogin) enterXai(); }
  finally { xaiLineBtn.disabled = false; }
}
window.meuBot.on("xai-login:event", (ev: ClaudeLoginEvent) => {
  const appendLog = (t: string): void => { xaiState.log = [...xaiState.log, t].slice(-8); };
  // Preparando (Hermes + proxy), as linhas são do instalador e vão para o log do passo 1; no login viram passos.
  if (!xaiState.preparing) { xaiState.events = [...xaiState.events, ev].slice(-60); if (ev.kind !== "done") xaiState.status = loginViewOf("xai", xaiState.events, true).headline; }
  switch (ev.kind) {
    case "url": xaiState.url = ev.url; break;
    case "waiting-code": break;
    case "log": if (xaiState.preparing) appendLog(ev.text); break;
    case "done":
      // O prepare também manda `log`; `done` é só do login.
      xaiState.result = ev.ok ? "ok" : "fail";
      xaiState.status = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      if (ev.ok) {
        // Verde na hora, com o rótulo que veio no texto; a consulta de confirmação roda em segundo plano.
        xaiAuth = { loggedIn: true, email: /\(([^)]+)\)/.exec(ev.text)?.[1] ?? xaiAuth?.email ?? null };
        paintXaiLine(); paintGuide();
        const tab = active(); if (tab !== null) addNotice(tab, "✓ xAI logada no Hermes desta máquina; o grok-4 já usa a conta nova.", "info");
        void refreshXaiLine();
        setTimeout(() => { if (xaiDialog.open) xaiDialog.close(); }, 1200);
      }
      break;
  }
  paintXaiLogin();
});
for (const c of [xaiModal, xaiGuide]) {
  c.start.addEventListener("click", () => { void runXaiLogin(); });
  c.open.addEventListener("click", () => { if (xaiState.url !== null) void window.meuBot.openExternal(xaiState.url); });
  if (c.cancel !== null) c.cancel.addEventListener("click", () => { if (xaiState.running) void window.meuBot.xaiLoginCancel(); });
}
xaiClose.addEventListener("click", () => { if (xaiState.running) void window.meuBot.xaiLoginCancel(); xaiDialog.close(); });
xaiLineBtn.addEventListener("click", () => {
  if (xaiAuth !== null && xaiAuth.loggedIn) {
    if (!window.confirm("Sair da conta da xAI no Hermes desta máquina? O grok-4 para de responder até entrar de novo.")) return;
    void logoutXai(true);
    return;
  }
  enterXai();
});

// ---- WhatsApp do agente da máquina (Hermes ou OpenClaw): linha no topo da lista de conversas e modal de pareamento por QR.
// ---- Páginas em aba própria (Acervo, Tutoriais…): não são conversas. Uma de cada vez na frente; o compositor
// desliga; qualquer conversa ativada manda a página para trás; fechar volta à conversa de antes.
const pages = new Map<string, PageTab>();
let pageActive: PageTab | null = null;
/** Conversa que estava ativa quando a página tomou a frente; volta a ela ao fechar. */
let pagePrev: string | null = null;

function definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab {
  const page: PageTab = { id, title, panel, render, tabEl: null };
  pages.set(id, page);
  return page;
}

function activatePage(page: PageTab): void {
  if (pageActive === page) return;
  if (pageActive === null) {
    const prev = active();
    if (prev !== null) prev.draft = inputEl.value;
    pagePrev = activeId;
  } else { pageActive.panel.hidden = true; pageActive.tabEl?.classList.remove("active"); }
  activeId = null;
  pageActive = page;
  for (const t of tabs.values()) { t.tabEl.classList.remove("active"); t.messagesEl.hidden = true; }
  page.tabEl?.classList.add("active");
  page.render();
  page.panel.hidden = false;
  inputEl.value = "";
  syncComposer();
  renderSidebar();
  syncRest();
  paintGuideTargets();
}

/** Uma conversa tomou a frente: a página vai para trás (a aba continua aberta). */
function deactivatePage(): void {
  if (pageActive === null) return;
  pageActive.panel.hidden = true;
  pageActive.tabEl?.classList.remove("active");
  pageActive = null;
  paintGuideTargets();
}

function openPage(page: PageTab, activateIt = true): void {
  if (page.tabEl === null) {
    const tabEl = el("div", `tab tab-page tab-${page.id}`);
    const titleEl = el("span", "tab-title", page.title);
    const closeBtn = el("button", "tab-close", "×");
    closeBtn.type = "button"; closeBtn.title = "Fechar aba";
    tabEl.append(titleEl, closeBtn);
    tabEl.addEventListener("click", () => activatePage(page));
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // Terminal com shell vivo: dois cliques (fechar mata o shell).
      if (page.id.startsWith("term-") && termAlive(page.id)) { armConfirm(closeBtn, "fechar?", () => closePage(page)); return; }
      closePage(page);
    });
    tabsEl.appendChild(tabEl);
    page.tabEl = tabEl;
  }
  if (activateIt) activatePage(page);
}

function closePage(page: PageTab): void {
  if (page.tabEl === null) return;
  if (page.id.startsWith("tut-")) setTimeout(paintGuideTargets, 0); // a aba do guia saiu: nada mais pulsa
  if (page.id.startsWith("term-")) disposeTerminal(page.id);
  const wasActive = pageActive === page;
  if (wasActive) deactivatePage();
  page.tabEl.remove();
  page.tabEl = null;
  if (!wasActive) return;
  const back = pagePrev !== null && tabs.has(pagePrev) ? pagePrev : [...tabs.keys()].at(-1);
  pagePrev = null;
  if (back !== undefined) { activate(back); return; }
  activeId = null;
  syncComposer();
  renderSidebar();
  syncRest();
}

// ---- Tutorial 7 · objetivo do WhatsApp: tudo mora na máquina (objetivo.json, skill no workspace do OpenClaw).
let objectiveState: ObjectiveInfo | null = null;
let objectiveBusy = false;
/** Último recado do tutorial 7 (erro ou "skill salva"). */
let objectiveMsg: { text: string; bad: boolean } | null = null;
/** Rascunho do passo 1 antes de "Salvar objetivo" (cartão marcado e frase digitada). */
let objectiveDraft: { id: string; text: string } | null = null;
async function refreshObjective(): Promise<void> {
  if (windowHost === "" || windowHost === "local" || !caps.install) return;
  try { objectiveState = await window.meuBot.objectiveInfo(); } catch { /* sem resposta: fica o que havia */ }
  paintAcervoCount(); paintGuide();
  if (pageActive === acervoPage) acervoPage.render();
}
async function objectiveDo(run: () => Promise<ObjectiveInfo>, okText: string | null): Promise<void> {
  if (objectiveBusy) return;
  objectiveBusy = true; objectiveMsg = null; paintGuide();
  try { objectiveState = await run(); objectiveMsg = okText === null ? null : { text: okText, bad: false }; }
  catch (err) { objectiveMsg = { text: ipcErrorText(err), bad: true }; }
  finally { objectiveBusy = false; paintAcervoCount(); paintGuide(); if (pageActive === acervoPage) acervoPage.render(); }
}
function paintAcervoCount(): void {
  const n = ACERVO_SKILLS.length + (objectiveState?.skills.length ?? 0);
  $<HTMLElement>("acervo-count").textContent = n === 1 ? "1 skill" : `${n} skills`;
}

// ---- Acervo: biblioteca de skills (lib/acervo.ts) + as skills do workspace do agente nesta máquina (tutorial 7).
const acervoList = $<HTMLElement>("acervo-list");
paintAcervoCount();
const acervoPage = definePage("acervo", "Acervo", $<HTMLElement>("acervo-panel"), () => {
  acervoList.replaceChildren();
  const machine = objectiveState?.skills ?? [];
  if (objectiveState?.available === true) {
    acervoList.append(el("div", "tut-group", `Skills do agente em ${hostLabel(windowHost)}`));
    if (machine.length === 0) acervoList.append(el("div", "acervo-empty", "O agente desta máquina ainda não tem skills no workspace. O tutorial 7 cria a primeira: o objetivo dele no WhatsApp."));
    for (const sk of machine) {
      const info = el("div", "grow");
      info.append(el("strong", "", sk.objective ? `${sk.name} · objetivo do WhatsApp` : sk.name), el("span", "", sk.description !== "" ? sk.description : "sem descrição"));
      const item = el("div", `acervo-item${sk.objective ? " on" : ""}`);
      item.append(info);
      if (sk.objective) {
        const go = el("button", "btn btn-ghost btn-small", "Ajustar no tutorial 7"); go.type = "button";
        go.addEventListener("click", () => { const t = TUTORIAIS.find((x) => x.id === "whatsapp-objetivo"); if (t !== undefined) openGuide(t); });
        item.append(go);
      }
      acervoList.append(item);
    }
    if (ACERVO_SKILLS.length > 0) acervoList.append(el("div", "tut-group", "Biblioteca do meu-bot"));
  }
  if (ACERVO_SKILLS.length === 0 && machine.length === 0 && objectiveState?.available !== true) {
    acervoList.append(el("div", "acervo-empty", "Nenhuma skill no acervo ainda. As mais usadas vão entrar aqui, cada uma com instalação pelo agente da máquina."));
  }
  for (const skill of ACERVO_SKILLS) {
    const info = el("div", "grow");
    info.append(el("strong", "", skill.name), el("span", "", skill.summary));
    const btn = el("button", "btn btn-primary btn-small", "Pedir ao agente para instalar");
    btn.type = "button";
    btn.addEventListener("click", () => {
      void (async () => {
        const tab = await newTab();
        await sendText(tab, installPrompt(skill, hostLabel(windowHost)));
      })();
    });
    const item = el("div", "acervo-item");
    item.append(info, btn);
    acervoList.append(item);
  }
});
$<HTMLButtonElement>("acervo-line").addEventListener("click", () => openPage(acervoPage));

// ---- Tutoriais (lib/tutoriais.ts): passo a passo em aba própria.
const tutList = $<HTMLElement>("tutoriais-list");
// Concluídos (o tour feito, um guia terminado) vão para "arquivados"; a contagem da lateral mostra só os ativos.
const tutArchivedEl = $<HTMLInputElement>("tut-archived");
var tutorialsReady = true; // applySettings pode rodar antes deste trecho; var evita a zona morta do let
try { tutArchivedEl.checked = localStorage.getItem("tutArchived") === "1"; } catch { /* opcional */ }
const tourDone = (): boolean => settings?.onboarding === "done";
const tutorialDone = (t: Tutorial): boolean => t.comingSoon !== true && guideView(t, waStatus, loadGuideFlags(t), guideCtx()).finished;
/** Os tutoriais desta janela agora (pacote de suporte e trilha: o 3 e o 4 só depois do 1 concluído). */
const visibleNow = (): Tutorial[] => visibleTutorials(guideCtx(), tutorialDone);
/**
 * Tutoriais já vistos nesta máquina (ids), só cresce: a pessoa "vê" ao abrir Tutoriais. Novidade = visível,
 * pendente e nunca visto (novo numa atualização, ou recém-destravado na trilha). Um que some e volta
 * (Refazer do 1 esconde 3/4; relogar mostra de novo) continua visto: reaparecer não é novidade.
 */
const tutSeenKey = (): string => `tutVisto:${windowHost}`;
function loadTutSeen(): Set<string> {
  try { const raw = localStorage.getItem(tutSeenKey()); if (raw !== null) return new Set((JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string")); } catch { /* opcional */ }
  return new Set();
}
function markTutSeen(ids: string[]): void {
  const seen = loadTutSeen(); for (const id of ids) seen.add(id);
  try { localStorage.setItem(tutSeenKey(), JSON.stringify([...seen])); } catch { /* opcional */ }
}
/** Ids que eram novidade quando Tutoriais abriu desta vez: ganham "Novo" no cartão enquanto a página está à vista. */
let tutNovoLabels = new Set<string>();
/** Contagem dos tutoriais: para fazer (inclui o tour), arquivados (concluídos), "em breve", total, novidades e o próximo. */
function tutCounts(): { todo: number; archived: number; soon: number; total: number; novos: number; next: Tutorial | null } {
  const all = visibleNow();
  const seen = loadTutSeen();
  const soon = all.filter((t) => t.comingSoon === true).length;
  const done = all.filter((t) => tutorialDone(t)).length;
  const pending = all.filter((t) => t.comingSoon !== true && !tutorialDone(t));
  const todo = (tourDone() ? 0 : 1) + pending.length;
  const archived = (tourDone() ? 1 : 0) + done;
  return { todo, archived, soon, total: todo + archived, novos: pending.filter((t) => !seen.has(t.id)).length, next: pending[0] ?? null };
}
/** Aviso na lateral (número ao lado de "Tutoriais"): a pessoa desliga em Tutoriais › "avisar na lateral"; a novidade pulsa mesmo assim. */
const tutBadgeEl = $<HTMLInputElement>("tut-badge");
try { tutBadgeEl.checked = localStorage.getItem("tutBadge") !== "0"; } catch { /* opcional */ }
function paintTutCount(): void {
  const c = tutCounts();
  const b = sidebarBadge({ todo: c.todo, novos: c.novos, avisar: tutBadgeEl.checked });
  const n = $<HTMLElement>("tutoriais-count");
  n.textContent = b?.text ?? "";
  n.classList.toggle("tut-badge-n", b !== null);
  n.classList.toggle("pulse", b?.pulse === true);
  n.title = b === null ? "" : b.pulse ? `${c.novos === 1 ? "1 tutorial novo" : `${c.novos} tutoriais novos`} · ${c.todo} para fazer` : (c.todo === 1 ? "1 tutorial para fazer" : `${c.todo} tutoriais para fazer`);
  if (pageActive !== tutoriaisPage) tutNovoLabels = new Set();
}
const TUT_ICONS = {
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  tour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 17c4-1 3-7 7-8s3-1 3-1" stroke-dasharray="2 3"/></svg>',
} as const;

// ---- Guia ao vivo (estilo onboarding), um por aba: "Começar" abre a aba do tutorial ("WhatsApp 2/4"); o passo
// atual tem o botão que leva ao lugar certo, os botões do modal pulsam, e os passos concluídos ganham ✓ pelo
// estado real do WhatsApp. O que o app não vê (a mensagem de teste) a pessoa marca. Uma aba por tutorial.
const guidePages = new Map<string, { page: PageTab; tutorial: Tutorial }>();
const guideFlagsKey = (t: Tutorial): string => `guia:${t.id}:${windowHost}`;
function loadGuideFlags(t: Tutorial): GuideFlags {
  try { const raw = localStorage.getItem(guideFlagsKey(t)); if (raw !== null) return { ...emptyFlags(), ...(JSON.parse(raw) as Partial<GuideFlags>) }; } catch { /* opcional */ }
  return emptyFlags();
}
function saveGuideFlag(t: Tutorial, flag: GuideFlagName): void {
  if (flag === "tested") maybeAskNotificationsOnce();
  const f = loadGuideFlags(t); f[flag] = true; f.number = waStatus?.number ?? f.number;
  try { localStorage.setItem(guideFlagsKey(t), JSON.stringify(f)); } catch { /* opcional */ }
}
/** As marcações manuais ("escolhi", "testei") valem para o número pareado na hora. Trocou o número, zeram. */
function reconcileGuideFlags(t: Tutorial): void {
  const num = waStatus?.connected === true ? waStatus.number : null;
  if (num === null) return;
  const f = loadGuideFlags(t);
  if (f.number !== num && (f.policyChosen || f.tested)) {
    try { localStorage.setItem(guideFlagsKey(t), JSON.stringify({ policyChosen: false, tested: false, number: num })); } catch { /* opcional */ }
  } else if (f.number !== num) {
    try { localStorage.setItem(guideFlagsKey(t), JSON.stringify({ ...f, number: num })); } catch { /* opcional */ }
  }
}
/** O guia na frente, se a aba ativa é de um tutorial. */
function activeGuide(): Tutorial | null {
  if (pageActive === null) return null;
  return guidePages.get(pageActive.id)?.tutorial ?? null;
}
const guideTargets = (): Record<Exclude<GuideTarget, "none">, HTMLElement[]> => ({
  "wa-line": [], "wa-agent": [waAgentBtn], "wa-pair": [waPairBtn], "wa-policy": [waPolicyCards], "chat": [],
});
/** Só os botões do modal do passo atual pulsam (nada na lateral). */
function paintGuideTargets(): void {
  const all = new Set(Object.values(guideTargets()).flat());
  const want = new Set<HTMLElement>();
  const t = activeGuide();
  if (t !== null) {
    const v = guideView(t, waStatus, loadGuideFlags(t), guideCtx());
    const step = v.finished ? undefined : t.steps[v.current];
    if (step !== undefined && step.target !== "none") for (const e of guideTargets()[step.target]) want.add(e);
  }
  for (const e of all) e.classList.toggle("attention", want.has(e));
}
/** Guia que está mostrando o pareamento dentro da própria aba (os nós do QR/progresso são movidos para lá). */
let waInlineGuide: Tutorial | null = null;
/** Como o último "Gerar QR" do guia terminou sem conectar; fica no passo (os nós de progresso voltam ao modal). */
let waGuidePairNote: string | null = null;
function runGuideAction(target: GuideTarget, t: Tutorial): void {
  if (target === "none") return;
  if (target === "chat") {
    if (t.id === "xai-login") void goToChatFromGuide("Oi! Qual modelo está respondendo agora? Uma linha.", "A conversa mudou para o grok-4: a resposta vem da xAI e a pill do túnel mostra \"respondeu grok-4\"; aí o tutorial se conclui sozinho.", "grok-4");
    else if (t.id === "claude-login") void goToChatFromGuide("Oi! Você está aí? Me responde em uma linha.", "Quando a resposta chegar, o tutorial se conclui sozinho: é a sua conta do Claude respondendo nesta máquina.");
    else void goToChatFromGuide("Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo.", "Quando a resposta chegar, olhe o rodapé desta conversa: Sessão e Semanal aparecem ali, e o tutorial se conclui sozinho.");
    return;
  }
  if (waStatus === null || !waStatus.present) { void refreshWhatsapp(); const tab = active(); if (tab !== null) addNotice(tab, "Esta máquina não tem agente com WhatsApp (Hermes ou OpenClaw).", "warn"); return; }
  if (target === "wa-agent") { requestAgentPrepare(); return; }
  if (target === "wa-pair") {
    if (waPairing) return;
    if (!waStatus.ready) { waGuidePairNote = "O WhatsApp desta máquina ainda não está pronto; faça o passo anterior."; paintGuide(); return; }
    if (waStatus.connected) { waGuidePairNote = null; void refreshWhatsapp(); return; }
    waInlineGuide = t;
    waGuidePairNote = null;
    void pairWhatsapp(false).finally(() => {
      waInlineGuide = null;
      if (!waConnected) waGuidePairNote = (waProgressText.textContent ?? "").trim() || "O QR não foi lido. Gere outro quando quiser.";
      restorePairNodes(); paintGuide();
    });
    paintGuide();
    return;
  }
  openWhatsapp();
}
/** Devolve ao modal os nós do pareamento (QR, ✓ e linha de progresso) na ordem original. */
function restorePairNodes(): void {
  const box = waDialog.querySelector(".wa-box");
  if (box === null) return;
  box.insertBefore(waQr, waPolicyBox); box.insertBefore(waSuccess, waPolicyBox); box.insertBefore(waProgress, waDialog.querySelector(".dialog-actions"));
}
/** Chamado sempre que o estado do WhatsApp muda: redesenha o guia da frente, os títulos das abas e o catálogo. */
/**
 * Progresso nos tutoriais para o suporte (o main só grava na máquina se o suporte estiver ligado e se algo
 * mudou). Agrupado: o guia repinta muito; manda 3 s depois da última mudança.
 */
let progressTimer: number | null = null;
function reportProgress(): void {
  if (!caps.supportClient || windowHost === "" || windowHost === "local" || settings === null) return;
  if (progressTimer !== null) clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    progressTimer = null;
    const tutorials = visibleNow().map((t) => {
      const v = guideView(t, waStatus, loadGuideFlags(t), guideCtx());
      const done = v.done.filter(Boolean).length;
      return { id: t.id, title: t.title, done, total: t.steps.length, current: v.finished ? null : (t.steps[v.current]?.title ?? null), finished: v.finished && t.comingSoon !== true, comingSoon: t.comingSoon === true };
    });
    const tour = settings?.onboarding === "done" ? "done" : settings?.onboarding === "skipped" ? "skipped" : "pending";
    void window.meuBot.reportProgress({ at: new Date().toISOString(), tour, tutorials, ...(appVersion === "" ? {} : { app: { version: appVersion, openedAt: sessionOpenedAt } }) }).catch(() => undefined);
  }, 3000);
}

function paintGuide(): void {
  reportProgress();
  paintTutCount();
  for (const { tutorial } of guidePages.values()) reconcileGuideFlags(tutorial);
  for (const { page, tutorial } of guidePages.values()) {
    const v = guideView(tutorial, waStatus, loadGuideFlags(tutorial), guideCtx());
    const title = page.tabEl?.querySelector(".tab-title"); if (title !== null && title !== undefined) title.textContent = guideTabTitle(tutorial, v);
    if (pageActive === page) page.render();
  }
  if (pageActive === tutoriaisPage) tutoriaisPage.render();
  paintGuideTargets();
}
function renderGuide(t: Tutorial, panel: HTMLElement): void {
  const flags = loadGuideFlags(t);
  const st = waStatus;
  const view = guideView(t, st, flags, guideCtx());
  panel.replaceChildren();
  // Cabeçalho: ícone, selo "0 de 4 · 4 passos · 3 min", título e resumo (o mesmo cartão do catálogo, sem botão).
  const head = el("div", "guide-head");
  const icon = el("span", `tut-icon${view.finished ? " ok" : ""}`); icon.innerHTML = TUT_ICONS[t.icon ?? "target"];
  const body = el("div", "tut-body");
  const doneN = view.done.filter(Boolean).length;
  body.append(el("span", "tut-badge", `Tutorial ${t.number} · ${view.finished ? "Concluído" : `${doneN} de ${t.steps.length} · ${t.minutes} min`}`), el("h2", "", t.title), el("p", "", t.summary));
  head.append(icon, body);
  panel.append(head);
  // Guia do WhatsApp sem o estado da máquina ainda: não há como saber em que passo a pessoa está; dizer isso,
  // não chutar o passo 1. Os outros tutoriais não dependem do WhatsApp e abrem direto.
  if (st === null && t.steps.some((x) => x.target.startsWith("wa-"))) {
    const wait = el("div", "wa-progress"); wait.append(el("span", "wa-pulse"), el("span", "grow", "Consultando o WhatsApp desta máquina…"));
    panel.append(wait);
    void refreshWhatsapp();
    return;
  }
  // Lista dos passos: concluídos com ✓, o atual aberto (texto, corpo e botões), os futuros recolhidos.
  const steps = el("ol", "tut-steps");
  t.steps.forEach((step, i) => {
    const done = view.done[i] === true;
    const cur = i === view.current;
    const li = el("li", done ? "done" : cur ? "current" : "pending");
    const num = el("span", "tut-num", done ? "✓" : String(i + 1));
    const txt = el("div", "tut-step");
    txt.append(el("strong", "", step.title));
    if (done) txt.append(el("p", "", "concluído"));
    if (cur) {
      txt.append(el("p", "", step.text));
      if (step.body === "reply-choice" && st !== null) {
        const cards = el("div", "reply-cards guide-cards");
        renderReplyCards(cards, replyChoiceOf(st.dmPolicy), waPolicySaving || !st.connected, chooseReply);
        txt.append(cards, el("div", "guide-note", REPLY_NOTE));
        renderChannelEditor(txt);
      } else if (step.body === "audio") {
        renderAudioControls(txt);
      } else if (step.body === "statusline-install") {
        renderStatusLineInstall(txt);
      } else if (step.body === "guarda-install") {
        renderGuardaInstall(txt);
      } else if (step.body === "statusline-segments") {
        renderStatusLineSegments(txt);
      } else if (step.body === "statusline-test") {
        renderStatusLineTest(txt);
      } else if (step.body === "fallback-order") {
        renderFallbackOrder(txt);
      } else if (step.body === "xai-prepare") {
        txt.append(xaiPrep.box); paintXaiLogin();
      } else if (step.body === "xai-login") {
        txt.append(xaiGuide.box); paintXaiLogin();
      } else if (step.body === "claude-login") {
        // Os controles são os mesmos de sempre (reanexados): o código digitado sobrevive à repintura; o foco volta.
        const refocus = document.activeElement === clGuide.code;
        const sel: [number, number] = [clGuide.code.selectionStart ?? 0, clGuide.code.selectionEnd ?? 0];
        txt.append(clGuide.box);
        paintLoginControls(clGuide, "guide");
        if (refocus) { clGuide.code.focus(); clGuide.code.setSelectionRange(sel[0], sel[1]); }
      } else if (step.body === "support-name" || step.body === "support-switch" || step.body === "support-delivery") {
        renderSupportParts(txt, step.body === "support-name" ? ["name"] : ["share", "delivery", "log"]);
      } else if (step.body === "objective-choice") {
        renderObjectiveChoice(txt);
      } else if (step.body === "objective-level") {
        renderObjectiveLevel(txt);
      } else if (step.body === "objective-skill") {
        renderObjectiveSkill(txt);
      } else if (step.target === "wa-pair" && waPairing && waInlineGuide === t) {
        // Pareamento dentro da aba: só o QR (o texto do passo já diz onde ler), linha de progresso e Cancelar embaixo.
        const pair = el("div", "pair-inline");
        const side = el("div", "pair-side");
        side.append(waQr, waSuccess);
        pair.append(side);
        const foot = el("div", "pair-foot");
        const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button";
        cancel.addEventListener("click", () => { if (waPairing && !waConnected) void window.meuBot.whatsappCancel(); });
        foot.append(waProgress, cancel);
        txt.append(pair, foot);
      } else if (step.target !== "none") {
        const b = el("button", "btn btn-primary btn-small", GUIDE_ACTION_LABEL[step.target]); b.type = "button";
        const target = step.target;
        b.addEventListener("click", () => runGuideAction(target, t));
        txt.append(b);
        if (target === "wa-pair" && waGuidePairNote !== null) txt.append(el("p", "hint guide-pair-note", waGuidePairNote));
      }
      if (step.manual !== undefined) {
        const b = el("button", "btn btn-ghost btn-small", step.manual.label); b.type = "button";
        const flag = step.manual.flag;
        b.addEventListener("click", () => { saveGuideFlag(t, flag); paintGuide(); });
        txt.append(b);
      }
    }
    li.append(num, txt);
    steps.append(li);
  });
  panel.append(steps);
  // Concluído: o guia vira painel de gerência (o "editar" do CRUD): o que foi escolhido nos passos continua
  // ajustável aqui, sem refazer nada.
  if (view.finished && caps.install) {
    if (t.id === "statusline") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "O que aparece na status line"));
      renderStatusLineSegments(manage);
      manage.append(el("p", "hint strong-hint", "Conferir no terminal"));
      renderStatusLineTest(manage);
      manage.append(el("p", "hint strong-hint", "Onde aparece"));
      const go = el("button", "btn btn-ghost btn-small", GUIDE_ACTION_LABEL.chat); go.type = "button";
      go.addEventListener("click", () => { void goToChatFromGuide("Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo.", "Quando a resposta chegar, olhe o rodapé desta conversa: Sessão e Semanal aparecem ali."); });
      const where = el("div", "guide-note"); where.append("No rodapé de cada conversa do meu-bot, a cada resposta do agente. ", go);
      manage.append(where);
      panel.append(manage);
    } else if (t.id === "suporte") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Suporte nesta máquina"));
      renderSupportParts(manage, ["name", "share", "delivery", "log"]);
      panel.append(manage);
    } else if (t.id === "xai-login") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Conta da xAI nesta máquina"));
      const row = el("div", "guide-note");
      const swap = el("button", "btn btn-ghost btn-small", "Sair e entrar com outra conta"); swap.type = "button";
      swap.addEventListener("click", () => armConfirm(swap, "Confirmar? o grok-4 para até entrar de novo", () => { void logoutXai(true); }));
      row.append(`xAI (Grok) · ${xaiAuth?.email ?? "logada"}. `, swap);
      manage.append(row, el("p", "hint", "Para o Grok assumir quando o Claude falhar: tutorial 5 · Fallback (em breve)."));
      panel.append(manage);
    } else if (t.id === "claude-login") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Conta do Claude nesta máquina"));
      const row = el("div", "guide-note");
      const swap = el("button", "btn btn-ghost btn-small", "Sair e entrar com outra conta"); swap.type = "button";
      swap.addEventListener("click", () => armConfirm(swap, "Confirmar? o agente para até entrar de novo", () => { void logoutClaude(true); }));
      row.append(`Claude Code · ${clAuth?.email ?? "logado"}. `, swap);
      manage.append(row);
      panel.append(manage);
    }
  }
  // Concluído: o mesmo "Refazer do zero" dos cartões arquivados, aqui no fim do guia (dois cliques).
  if (view.finished && t.reset !== undefined && caps.install) {
    const foot = el("div", "tut-reset guide-reset");
    const btn = el("button", "btn btn-ghost btn-small", tutResetting === t.id ? "Desfazendo…" : "Refazer do zero"); btn.type = "button"; btn.disabled = tutResetting !== null;
    btn.title = `Desfaz: ${t.reset.what}. Depois o tutorial volta ao passo 1.`;
    btn.addEventListener("click", () => armConfirm(btn, "Confirmar? desfaz na máquina", () => { void resetTutorial(t); }));
    foot.append(el("span", "tut-finished-line", "✓ Concluído."), btn, el("span", "hint", t.reset.what));
    if (tutResetMsg?.id === t.id) foot.append(el("span", `hint ${tutResetMsg.bad ? "guide-pair-note" : "audio-ok"}`, tutResetMsg.text));
    panel.append(foot);
  }
  // Conectado: a aba do guia do WhatsApp vira o painel de gerência (quem responde, áudio, atualizar,
  // desconectar) — sem modal. Só nos guias do WhatsApp: o do suporte não tem nada a ver com isso.
  if (st !== null && st.connected && t.steps.some((x) => x.target.startsWith("wa-"))) {
    const manage = el("div", "guide-manage");
    manage.append(el("span", "tut-finished-line", "✓ Conectado. Ajuste aqui quando quiser."));
    manage.append(el("p", "hint strong-hint", "Quem o agente responde no WhatsApp"));
    const cards = el("div", "reply-cards guide-cards");
    renderReplyCards(cards, replyChoiceOf(st.dmPolicy), waPolicySaving, chooseReply);
    manage.append(cards);
    renderChannelEditor(manage);
    manage.append(el("p", "hint strong-hint", "Áudio no WhatsApp"));
    renderAudioControls(manage);
    const acts = el("div", "dialog-actions");
    const refresh = el("button", "btn btn-ghost btn-small", "Atualizar"); refresh.type = "button";
    refresh.addEventListener("click", () => { refresh.disabled = true; void refreshWhatsapp().finally(() => { refresh.disabled = false; }); });
    const disc = el("button", "btn btn-ghost btn-small", "Desconectar"); disc.type = "button";
    disc.addEventListener("click", () => armConfirm(disc, "Confirmar? desconecta o número", () => { void disconnectWhatsapp(disc); }));
    const spacer = el("span", "spacer");
    const close = el("button", "btn btn-ghost btn-small", "Fechar"); close.type = "button";
    close.addEventListener("click", () => { const g = guidePages.get(`tut-${t.id}`); if (g !== undefined) closePage(g.page); });
    acts.append(refresh, disc, spacer, close);
    manage.append(acts);
    panel.append(manage);
  }
}
/** Abre (ou traz para a frente) a aba do guia de um tutorial. */
function openGuide(t: Tutorial): void {
  let g = guidePages.get(`tut-${t.id}`);
  if (g === undefined) {
    const panel = el("section", "acervo-panel guide-panel"); panel.hidden = true;
    panelsEl.append(panel);
    const page = definePage(`tut-${t.id}`, t.short, panel, () => renderGuide(t, panel));
    g = { page, tutorial: t };
    guidePages.set(page.id, g);
  }
  openPage(g.page);
  void refreshWhatsapp(); // o guia depende do estado real; consultar ao abrir, não só no ciclo automático
  if (t.id === "claude-login") void refreshClaudeLine();
  if (t.id === "guarda-whatsapp") void refreshGuarda();
  if (t.id === "xai-login") void refreshXaiLine();
  paintGuide();
}

/** Acabou de concluir o tour: Tutoriais destaca o próximo (o primeiro pendente) até a pessoa começar algum. */
let tutNext = false;
/** "Refazer do zero" em andamento (id do tutorial) e o último recado por tutorial. */
let tutResetting: string | null = null;
let tutResetMsg: { id: string; text: string; bad: boolean } | null = null;
/**
 * Desfaz na máquina o que o tutorial fez (status line: desinstala; suporte: desliga e esquece o nome;
 * WhatsApp: desconecta), esquece as marcações manuais e volta ao passo 1. É o "excluir" do CRUD dos tutoriais.
 */
async function resetTutorial(t: Tutorial): Promise<void> {
  if (tutResetting !== null) return;
  tutResetting = t.id; tutResetMsg = null; tutoriaisPage.render();
  try {
    if (t.id === "statusline") {
      const r = await window.meuBot.uninstallStatusLine();
      if (!r.ok) throw new Error(r.log.at(-1) ?? "não deu para desinstalar");
      statusLineSegs = null;
      await refreshStatusLine();
    } else if (t.id === "guarda-whatsapp") {
      const r = await window.meuBot.uninstallGuarda();
      if (!r.ok) throw new Error(r.log.at(-1) ?? "não deu para tirar a guarda");
      guardaMsg = null;
      await refreshGuarda();
    } else if (t.id === "suporte") {
      supportState = await window.meuBot.resetSupport();
      repaintSupport();
    } else if (t.id === "whatsapp-openclaw") {
      if (waStatus?.connected === true) await window.meuBot.whatsappLogout();
      await refreshWhatsapp();
    } else if (t.id === "claude-login") {
      await logoutClaude(false);
    } else if (t.id === "xai-login") {
      if (xaiAuth?.loggedIn === true) await logoutXai(false);
    } else if (t.id === "whatsapp-objetivo") {
      objectiveState = await window.meuBot.resetObjective(); objectiveDraft = null; objectiveMsg = null; paintAcervoCount();
    }
    try { localStorage.removeItem(guideFlagsKey(t)); } catch { /* opcional */ }
    const g = guidePages.get(`tut-${t.id}`); if (g !== undefined && g.page.tabEl !== null) closePage(g.page);
    tutResetMsg = { id: t.id, text: "Desfeito. O tutorial voltou ao passo 1.", bad: false };
  } catch (err) {
    tutResetMsg = { id: t.id, text: ipcErrorText(err), bad: true };
  } finally { tutResetting = null; paintGuide(); tutoriaisPage.render(); }
}
const tutoriaisPage = definePage("tutoriais", "Tutoriais", $<HTMLElement>("tutoriais-panel"), () => {
  tutList.replaceChildren();
  let nextMarked = false;
  const showArchived = tutArchivedEl.checked;
  // Abrir a página é o "visto": o que está à vista agora deixa de ser novidade (a etiqueta "Novo" fica só nesta visita).
  const vis = visibleNow();
  const seen = loadTutSeen();
  const unseen = vis.filter((t) => !seen.has(t.id)).map((t) => t.id);
  if (unseen.length > 0) { markTutSeen(unseen); for (const id of unseen) tutNovoLabels.add(id); }
  const active: HTMLElement[] = [];
  const archived: HTMLElement[] = [];
  // Primeiro cartão: o tour (onboarding). Começar/Rever fecha Tutoriais e começa o guia sobre a janela.
  {
    const done = tourDone();
    const card = el("article", `tut-card${done ? " finished archived" : ""}`);
    const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS.tour;
    const body = el("div", "tut-body");
    const n = ONBOARD_STEPS.length;
    body.append(el("span", "tut-badge", done ? "Concluído" : `Comece por aqui · ${n} passos · ${TOUR_CARD.minutes} min`), el("h3", "", TOUR_CARD.title), el("p", "", TOUR_CARD.summary));
    const start = el("button", "btn tut-start", done ? "Rever" : "Começar"); start.type = "button";
    start.addEventListener("click", () => { tutNext = false; closePage(tutoriaisPage); void restartTour(); });
    const head = el("div", "tut-head"); head.append(icon, body, start);
    card.append(head);
    (done ? archived : active).push(card);
  }
  for (const t of vis) {
    const view = guideView(t, waStatus, loadGuideFlags(t), guideCtx());
    const started = view.done.some(Boolean);
    const soon = t.comingSoon === true;
    const done = !soon && view.finished;
    const next = tutNext && !nextMarked && !soon && !done && tourDone();
    if (next) nextMarked = true;
    const novo = !done && tutNovoLabels.has(t.id);
    const card = el("article", `tut-card${done ? " finished archived" : ""}${soon ? " soon" : ""}${next ? " next" : ""}`);
    const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS[t.icon ?? "target"];
    const body = el("div", "tut-body");
    // "NOVO · SEU PRÓXIMO PASSO · TUTORIAL 3 · 2 DE 4 · 3 MIN": número sempre; progresso quando começou.
    const badge = done ? `Tutorial ${t.number} · Concluído`
      : [novo ? "Novo" : null, next ? "Seu próximo passo" : null, `Tutorial ${t.number}`, started ? `${view.done.filter(Boolean).length} de ${t.steps.length} · ${t.minutes} min` : tutorialBadge(t, false)].filter((x): x is string => x !== null).join(" · ");
    body.append(el("span", "tut-badge", badge), el("h3", "", t.title), el("p", "", t.summary));
    const start = el("button", soon ? "btn btn-ghost tut-soon" : "btn tut-start", soon ? "Em breve" : done ? "Rever" : started ? "Continuar" : "Começar"); start.type = "button";
    if (soon) start.disabled = true; else start.addEventListener("click", () => { tutNext = false; openGuide(t); });
    const head = el("div", "tut-head"); head.append(icon, body, start);
    card.append(head);
    // Concluído: "Refazer do zero" desfaz na máquina o que o tutorial fez e volta ao passo 1 (dois cliques).
    if (done && t.reset !== undefined && caps.install) {
      const foot = el("div", "tut-reset");
      const btn = el("button", "btn btn-ghost btn-small", tutResetting === t.id ? "Desfazendo…" : "Refazer do zero"); btn.type = "button"; btn.disabled = tutResetting !== null;
      btn.title = `Desfaz: ${t.reset.what}. Depois o tutorial volta ao passo 1.`;
      btn.addEventListener("click", () => armConfirm(btn, "Confirmar? desfaz na máquina", () => { void resetTutorial(t); }));
      foot.append(btn, el("span", "hint", t.reset.what));
      if (tutResetMsg?.id === t.id) foot.append(el("span", `hint ${tutResetMsg.bad ? "guide-pair-note" : "audio-ok"}`, tutResetMsg.text));
      card.append(foot);
    }
    (done ? archived : active).push(card);
  }
  // Resumo: "Você fez 2 de 6 · próximo: 3 · Status line · 1 novo · 2 em breve" (o tour conta; "em breve" não).
  const c = tutCounts();
  $<HTMLElement>("tutoriais-summary").textContent = [
    c.todo === 0 ? `Você fez ${c.total} de ${c.total}: tudo feito` : `Você fez ${c.archived} de ${c.total}`,
    ...(c.next !== null ? [`próximo: ${c.next.number} · ${c.next.short}`] : []),
    ...(c.novos > 0 ? [`${c.novos} ${c.novos === 1 ? "novo" : "novos"}`] : []),
    ...(c.soon > 0 ? [`${c.soon} em breve`] : []),
  ].join(" · ");
  paintTutCount();
  if (active.length === 0) tutList.append(el("div", "acervo-empty", archived.length > 0 && !showArchived ? "Tudo feito por aqui. Ligue \"arquivados\" para rever um tutorial." : "Nenhum tutorial ainda."));
  tutList.append(...active);
  if (showArchived && archived.length > 0) { tutList.append(el("div", "tut-group", "Arquivados"), ...archived); }
});
tutArchivedEl.addEventListener("change", () => {
  try { localStorage.setItem("tutArchived", tutArchivedEl.checked ? "1" : "0"); } catch { /* opcional */ }
  tutoriaisPage.render();
});
tutBadgeEl.addEventListener("change", () => {
  try { localStorage.setItem("tutBadge", tutBadgeEl.checked ? "1" : "0"); } catch { /* opcional */ }
  paintTutCount();
});
$<HTMLButtonElement>("tutoriais-line").addEventListener("click", () => openPage(tutoriaisPage));

const waLine = $<HTMLButtonElement>("wa-line");
const waDialog = $<HTMLDialogElement>("wa-dialog");
const waStatusEl = $<HTMLParagraphElement>("wa-status");
const waQr = $<HTMLImageElement>("wa-qr");
const waHow = $<HTMLParagraphElement>("wa-how");
const waSuccess = $<HTMLElement>("wa-success");
const waSuccessText = $<HTMLElement>("wa-success-text");
const waProgress = $<HTMLElement>("wa-progress");
const waProgressText = $<HTMLElement>("wa-progress-text");
const waProgressMeta = $<HTMLElement>("wa-progress-meta");
/**
 * QR da vez: quantos já vieram, quando chegou o último e quanto os próximos duram. O WhatsApp Web dá ~60 s ao
 * primeiro QR e ~20 s aos seguintes; o ciclo é medido só entre QRs seguintes (medir o 1º→2º, de 60 s, fazia
 * a contagem do 2º trocar de imagem no meio). A previsão nunca é exata: passou do tempo, mostra "renovando…".
 */
const WA_QR_FIRST = 60_000;
let waQrCount = 0; let waQrAt = 0; let waQrEvery = 20_000;
let waTick: ReturnType<typeof setInterval> | null = null;
function setWaProgress(text: string, tone: "run" | "ok" | "bad" = "run"): void {
  waProgress.hidden = false;
  waProgress.className = `wa-progress${tone === "run" ? "" : ` ${tone}`}`;
  waProgressText.textContent = text;
}
function paintWaMeta(): void {
  if (waQrCount === 0 || !waPairing || waConnected) { waProgressMeta.textContent = ""; return; }
  const left = Math.ceil((waQrAt + (waQrCount === 1 ? WA_QR_FIRST : waQrEvery) - Date.now()) / 1000);
  waProgressMeta.textContent = left > 0 ? `QR ${waQrCount} · renova em ${left} s` : `QR ${waQrCount} · renovando…`;
}
function resetWaProgress(): void {
  waQrCount = 0; waQrAt = 0; waQrEvery = 20_000;
  if (waTick !== null) { clearInterval(waTick); waTick = null; }
  waProgressMeta.textContent = "";
}
const waPairBtn = $<HTMLButtonElement>("wa-pair");
const waResetBtn = $<HTMLButtonElement>("wa-reset");
const waCloseBtn = $<HTMLButtonElement>("wa-close");
const waAgentBtn = $<HTMLButtonElement>("wa-agent");
const waRefreshBtn = $<HTMLButtonElement>("wa-refresh");
const waPolicyBox = $<HTMLElement>("wa-policy");
const waPolicyHint = $<HTMLElement>("wa-policy-hint");
const waPolicyCards = $<HTMLElement>("wa-policy-cards");
const waPolicyEditor = $<HTMLElement>("wa-policy-editor");
let waPolicySaving = false;
/** Pedido ao agente da máquina para ajustar o canal do WhatsApp por conversa, em vez do editor técnico de JSON. */
function waChannelPrompt(st: WhatsappStatus): string {
  return [
    "Quero ajustar o WhatsApp (OpenClaw) desta máquina conversando, sem eu editar JSON.",
    st.number !== null ? `Número conectado: ${fmtPhone(st.number)}.` : "",
    "Config atual do canal:",
    "```json\n" + (st.channelConfig ?? "{}") + "\n```",
    "Você pode alterar `channels.whatsapp` com `openclaw config set <caminho> <valor> --strict-json` (valide antes com `--dry-run`; nunca reinicie o gateway na mão, as mudanças valem sozinhas).",
    "Me diga em uma frase o que dá para mudar (quem o agente responde, lista de números permitidos, grupos, limite de mídia) e espere eu pedir. Não mude nada antes de eu confirmar.",
  ].filter((l) => l !== "").join("\n");
}
/** Botão que leva ao chat para ajustar o canal em linguagem natural (reaproveitado no guia e no modal). */
function renderChannelEditor(host: HTMLElement): void {
  const st = waStatus;
  if (st === null || !st.connected) return;
  const row = el("div", "channel-chat");
  const btn = el("button", "btn btn-ghost btn-small", "Ajustar pelo chat"); btn.type = "button";
  btn.title = "Abre uma conversa com o agente desta máquina para mudar a configuração do WhatsApp pedindo em português";
  btn.addEventListener("click", () => {
    void (async () => { const tab = await newTab(); await sendText(tab, waChannelPrompt(st)); })();
  });
  row.append(btn, el("span", "hint", "Peça em português: quem responde, números permitidos, grupos…"));
  host.append(row);
}
/** Os dois cartões de rádio (só você / todo mundo), iguais no modal e no guia; o escolhido fica verde. */
/** Cartão sendo gravado nesta hora (mostra o spinner e a seleção otimista); null = nenhum. */
let waPolicyTarget: "self" | "open" | null = null;
function renderReplyCards(container: HTMLElement, current: "self" | "open" | null, disabled: boolean, onChoose: (c: "self" | "open") => void): void {
  container.replaceChildren();
  const marked = waPolicyTarget ?? current; // otimista: enquanto grava, o cartão clicado já aparece marcado
  for (const o of REPLY_OPTIONS) {
    const saving = waPolicyTarget === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = disabled; card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", "aplicando…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => onChoose(o.id));
    container.append(card);
  }
}
/** Quando o agente responde em áudio (os três cartões). */
const VOICE_OPTIONS: readonly { id: VoiceReplyMode; title: string; text: string; isDefault: boolean }[] = [
  { id: "off", title: "Nunca", text: "Responde sempre em texto.", isDefault: true },
  { id: "inbound", title: "Quando receber áudio", text: "Áudio vira áudio; texto continua texto.", isDefault: false },
  { id: "always", title: "Sempre", text: "Toda resposta vira nota de voz.", isDefault: false },
];
/** O que está sendo aplicado agora ("in" = transcrição; um modo = voz) e o último recado (erro ou aviso). */
let waAudioBusy: "in" | VoiceReplyMode | null = null;
let waAudioMsg: { text: string; bad: boolean } | null = null;
/**
 * Áudio do agente do WhatsApp: ouvir (transcrição local, faster-whisper) e falar (voz local, Piper), com quando
 * responder em áudio. Usado no passo do tutorial e no painel de gerência; os instaladores rodam na máquina.
 */
function renderAudioControls(container: HTMLElement): void {
  const st = waStatus;
  const box = el("div", "audio-controls");
  const hear = el("div", "audio-row");
  hear.append(el("strong", "", "Ouvir áudios"));
  if (st?.audioIn === true) hear.append(el("span", "audio-ok", "✓ ativo: a transcrição roda na própria máquina"));
  else {
    const b = el("button", "btn btn-primary btn-small", waAudioBusy === "in" ? "Ativando… (na primeira vez baixa ~500 MB)" : "Ativar transcrição");
    b.type = "button"; b.disabled = waAudioBusy !== null || st === null || !st.connected;
    b.addEventListener("click", () => { void runAudioSetup({ kind: "in" }); });
    hear.append(b);
  }
  box.append(hear);
  box.append(el("p", "hint strong-hint", "Responder em áudio"));
  const cards = el("div", "reply-cards voice-cards");
  const current = st?.audioOut ?? "off";
  const marked = waAudioBusy !== null && waAudioBusy !== "in" ? waAudioBusy : current;
  for (const o of VOICE_OPTIONS) {
    const saving = waAudioBusy === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAudioBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", o.id === "off" ? "aplicando…" : "instalando a voz…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (o.id !== current) void runAudioSetup({ kind: "out", mode: o.id }); });
    cards.append(card);
  }
  box.append(cards, el("div", "guide-note", "Voz local em português (Piper), sem custo. Na primeira vez baixa ~70 MB."));
  if (waAudioMsg !== null) box.append(el("p", `hint ${waAudioMsg.bad ? "guide-pair-note" : "audio-ok"}`, waAudioMsg.text));
  container.append(box);
}
async function runAudioSetup(setup: AudioSetup): Promise<void> {
  if (waAudioBusy !== null) return;
  waAudioBusy = setup.kind === "in" ? "in" : setup.mode; waAudioMsg = null;
  paintGuide();
  try {
    const r = await window.meuBot.whatsappAudio(setup);
    waAudioMsg = { text: r.log.at(-1) ?? (r.ok ? "pronto" : "não deu certo"), bad: !r.ok };
    await refreshWhatsapp();
  } catch (err) {
    waAudioMsg = { text: ipcErrorText(err), bad: true };
  } finally { waAudioBusy = null; paintGuide(); }
}
function chooseReply(choice: "self" | "open"): void {
  if (waPolicySaving) return;
  for (const t of TUTORIAIS) if (t.steps.some((st) => st.target === "wa-policy")) saveGuideFlag(t, "policyChosen");
  if (replyChoiceOf(waStatus?.dmPolicy ?? null) === choice) { paintWhatsapp(); return; }
  waPolicySaving = true; waPolicyTarget = choice; paintWhatsapp(); // seleção na hora + spinner no cartão
  void window.meuBot.whatsappSetDmPolicy(choice)
    .then((st) => { waStatus = st; })
    .catch((err: unknown) => { waStatusEl.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`; })
    .finally(() => { waPolicySaving = false; waPolicyTarget = null; paintWhatsapp(); });
}
function paintWaPolicy(): void {
  const st = waStatus;
  const show = st !== null && st.gateway === "openclaw" && st.ready && st.connected && st.dmPolicy !== null && !waPairing;
  waPolicyBox.hidden = !show;
  if (!show || st === null) return;
  renderReplyCards(waPolicyCards, replyChoiceOf(st.dmPolicy), waPolicySaving, chooseReply);
  waPolicyEditor.replaceChildren(); renderChannelEditor(waPolicyEditor);
  waPolicyHint.textContent = waPolicySaving ? "Aplicando na máquina…"
    : st.dmPolicy === "pairing" ? "Hoje está no padrão do OpenClaw: quem manda mensagem recebe um código de pareamento e espera aprovação. Escolha uma das opções para mudar."
    : st.dmPolicy === "disabled" ? "Hoje está tudo desligado, inclusive suas próprias mensagens. Escolha uma das opções."
    : "Vale na hora, sem reiniciar nada. Grupos continuam desativados.";
}
waRefreshBtn.addEventListener("click", () => {
  waRefreshBtn.disabled = true; waRefreshBtn.textContent = "Consultando a máquina…";
  void refreshWhatsapp().finally(() => {
    waRefreshBtn.disabled = false; waRefreshBtn.textContent = "Atualizar";
    // Mesmo sem mudança, dizer que consultou: senão o clique parece não fazer nada.
    if (waCheckedAt !== null) waStatusEl.textContent = `${waStatusEl.textContent ?? ""}\nConsultado às ${waCheckedAt.toLocaleTimeString("pt-BR")}.`;
  });
});

/**
 * Pedido pronto ao agente da máquina (Claude Code em bypass): ele configura o OpenClaw e instala o plugin;
 * o pareamento (QR) fica com o app. Idempotente por instrução: pular o que já está feito.
 */
function waAgentPrompt(st: WhatsappStatus): string {
  if (st.gateway === "hermes") {
    return [
      "Prepare o Hermes desta máquina para o WhatsApp, sem parear (o QR eu faço pelo meu-bot).",
      "Falta: " + (st.missing ?? "o bridge do WhatsApp") + ".",
      "Verifique a instalação do hermes-agent em ~/.local/lib/node_modules/hermes-agent e garanta o bridge em runtime/hermes-agent/scripts/whatsapp-bridge/bridge.js (reinstale o pacote se preciso, sem mexer no backend do meu-bot nem reiniciar o gateway à mão).",
      "No fim, resuma o que fez e o que ainda falta. Não pareie o WhatsApp.",
    ].join("\n");
  }
  return [
    "Prepare o OpenClaw desta máquina para o WhatsApp, sem interação e sem parear (o QR eu faço pelo meu-bot).",
    "Encontrado: " + st.agent + ".",
    "Falta:\n" + (st.missing ?? "?").split("\n").map((l) => "- " + l).join("\n"),
    "",
    "Passos (pule o que já estiver feito):",
    "1. Se não houver ~/.openclaw/openclaw.json: `openclaw onboard --non-interactive --accept-risk --auth-choice anthropic-cli --skip-channels --skip-skills --skip-hooks --skip-search --skip-ui --install-daemon --gateway-bind loopback --gateway-auth token --gateway-token \"$(openssl rand -hex 24)\" --json`. Se o anthropic-cli não servir, me diga o que falta em vez de inventar chave.",
    "2. Plugin: `openclaw plugins install clawhub:@openclaw/whatsapp --accept-capabilities`.",
    "3. Confira com `openclaw gateway status` e `openclaw plugins list | grep -i whatsapp`. Se o serviço for systemd de usuário, veja `loginctl show-user $USER -p Linger`; se for `no`, avise (precisa de root para o gateway sobreviver ao logout).",
    "",
    "No fim, resuma o que fez e o que ainda falta. Não rode `openclaw channels login`; não pareie o WhatsApp.",
  ].join("\n");
}
/** Pede ao agente da máquina para preparar (modal ou guia): fecha o modal se aberto, abre uma conversa e manda o pedido. */
/** Confirmação sem caixa sobreposta: o 1º clique arma o botão ("Confirmar?"), o 2º em até 4 s executa. */
function armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void {
  const armed = btn.dataset.armed === "1";
  if (armed) { btn.dataset.armed = ""; btn.textContent = btn.dataset.label ?? btn.textContent; btn.classList.remove("btn-bad"); run(); return; }
  btn.dataset.label = btn.textContent ?? "";
  btn.dataset.armed = "1"; btn.textContent = label; btn.classList.add("btn-bad");
  const reset = (): void => { if (btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = btn.dataset.label ?? ""; btn.classList.remove("btn-bad"); } };
  window.setTimeout(reset, 4000);
}

function requestAgentPrepare(): void {
  const st = waStatus;
  if (st === null) return;
  void (async () => {
    if (waDialog.open) waDialog.close();
    const tab = await newTab();
    await sendText(tab, waAgentPrompt(st));
  })();
}
waAgentBtn.addEventListener("click", () => requestAgentPrepare());
let waStatus: WhatsappStatus | null = null;

// ---- Conversas do WhatsApp (espelho só leitura, OpenClaw). Seletor `[ meu-bot | WhatsApp ]` acima da busca;
// no modo WhatsApp a lista lateral mostra os contatos, e cada conversa abre numa aba própria (página, não
// conversa do meu-bot: o compositor desliga sozinho). Lista a cada 20 s no modo WhatsApp; aberta a cada 8 s.
type ListMode = "bot" | "whatsapp";
const listModeEl = $<HTMLElement>("list-mode");
const sidebarFootEl = document.querySelector<HTMLElement>(".sidebar-foot");
let waChats: WhatsappChat[] = [];
let waChatsErr: string | null = null;
let waChatsInflight: Promise<void> | null = null;
let waChatsTimer: number | null = null;
/** Já tentou pintar a lista pelo cache nesta janela (uma vez; depois a leitura real manda). */
let waChatsFromCache = false;
/** Contatos cujo nome já se tentou descobrir nesta abertura (quem não tem pushname fica com o número, sem insistir). */
const waNamesTried = new Set<string>();
let waNamesInflight: Promise<void> | null = null;
/**
 * Nomes dos contatos sem nome, em segundo plano e uma vez por contato por abertura: o main lê o histórico deles de
 * uma vez e guarda na máquina; aqui só se aplica o resultado. Mais de 20: o resto vai na próxima lista.
 */
function learnMissingWaNames(): Promise<void> {
  if (waNamesInflight !== null) return waNamesInflight;
  const missing = waChats.filter((c) => c.name === null && c.alias === null && !c.isSelf && !c.deleted && !waNamesTried.has(c.number)).map((c) => c.number).slice(0, 20);
  if (missing.length === 0) return Promise.resolve();
  for (const n of missing) waNamesTried.add(n);
  waNamesInflight = (async () => {
    try {
      const names = await window.meuBot.learnWhatsappNames(missing);
      if (Object.keys(names).length === 0) return;
      waChats = waChats.map((c) => (names[c.number] !== undefined && c.name === null ? { ...c, name: names[c.number]! } : c));
      for (const g of waChatPages.values()) { const c = waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; paintWaChatTab(g); if (pageActive === g.page) renderWaChat(g); } }
      cacheWrite("waChats", waChats);
      if (getListMode() === "whatsapp") renderSidebar();
    } catch (err) { console.warn("nomes do WhatsApp:", err); }
    finally { waNamesInflight = null; }
  })();
  return waNamesInflight;
}
const listModeKey = (): string => `listMode:${windowHost}`;
const waMirrorAvailable = (): boolean => waStatus !== null && waStatus.present && waStatus.gateway === "openclaw" && waStatus.ready;
function getListMode(): ListMode {
  if (!waMirrorAvailable()) return "bot";
  try { return localStorage.getItem(listModeKey()) === "whatsapp" ? "whatsapp" : "bot"; } catch { return "bot"; }
}
function paintListMode(): void {
  listModeEl.hidden = !waMirrorAvailable();
  const mode = getListMode();
  for (const b of listModeEl.querySelectorAll<HTMLButtonElement>("button")) { const on = b.dataset["mode"] === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
  // No WhatsApp o interruptor "arquivadas" só aparece quando há alguma conversa arquivada.
  if (sidebarFootEl !== null) sidebarFootEl.hidden = mode === "whatsapp" && !waChats.some((c) => isWaArchived(c) && !isWaDeleted(c));
  const archLabel = sidebarArchived.parentElement?.querySelector(".switch-label");
  if (archLabel !== null && archLabel !== undefined) archLabel.textContent = "arquivadas";
  sidebarSearch.placeholder = mode === "whatsapp" ? "Buscar no WhatsApp…" : "Buscar conversas…";
  if (mode === "whatsapp" && waChatsInflight === null && waChatsTimer === null) void refreshWaChats();
}
function setListMode(mode: ListMode): void {
  try { localStorage.setItem(listModeKey(), mode); } catch { /* opcional */ }
  paintListMode();
  renderSidebar();
}
listModeEl.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  const mode = b?.dataset["mode"];
  if (mode === "bot" || mode === "whatsapp") setListMode(mode);
});
function refreshWaChats(): Promise<void> {
  if (waChatsInflight !== null) return waChatsInflight;
  if (waChatsTimer !== null) { clearTimeout(waChatsTimer); waChatsTimer = null; }
  // Primeira leitura: a lista da última vez aparece na hora (cache desta janela) e a leitura real troca por baixo.
  if (waChats.length === 0 && !waChatsFromCache) { waChatsFromCache = true; const c = cacheRead<WhatsappChat[]>("waChats"); if (c !== null && c.value.length > 0) { waChats = c.value; if (getListMode() === "whatsapp") renderSidebar(); } }
  waChatsInflight = (async () => {
    try { waChats = await window.meuBot.whatsappChats(); waChatsErr = null; await migrateWaMarks(); cacheWrite("waChats", waChats); void learnMissingWaNames(); }
    catch (err) { waChatsErr = err instanceof Error ? err.message : String(err); }
    finally { waChatsInflight = null; }
    for (const g of waChatPages.values()) { const c = waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; paintWaChatTab(g); } }
    if (getListMode() === "whatsapp") { renderSidebar(); waChatsTimer = window.setTimeout(() => { waChatsTimer = null; void refreshWaChats(); }, 20_000); }
  })();
  return waChatsInflight;
}
/**
 * Arquivada/excluída moram na máquina (whatsapp-lista.json, lidas junto com a lista): o meu-bot da pessoa e o
 * meu-bot-admin veem a mesma coisa. Excluída some mesmo com "arquivadas" ligado e volta só se o contato mandar
 * outra mensagem depois da exclusão (o main compara as horas).
 */
const isWaArchived = (c: WhatsappChat): boolean => c.archived;
const isWaDeleted = (c: WhatsappChat): boolean => c.deleted;
/**
 * Cache "stale-while-revalidate" desta janela (lib/cache.ts): pinta o último estado conhecido na hora e a leitura
 * real troca por baixo. Chave por máquina; sem localStorage, segue sem cache.
 */
const cacheStore = (): CacheStore | null => { try { return window.localStorage; } catch { return null; } };
function cacheRead<T>(name: string): Cached<T> | null { const st = cacheStore(); return st === null ? null : readCache<T>(st, windowHost, name); }
function cacheWrite(name: string, value: unknown): void { const st = cacheStore(); if (st !== null) writeCache(st, windowHost, name, value); }
function cacheDrop(name: string): void { const st = cacheStore(); if (st !== null) dropCache(st, windowHost, name); }
/** Marca na máquina e aplica na lista local na hora (otimista); em erro, relê a lista e avisa. */
async function markWa(patch: WaMarkPatch, what: string): Promise<boolean> {
  waChats = waChats.map((c) => (c.number === patch.number ? { ...c, ...(patch.archived !== undefined ? { archived: patch.archived } : {}), ...(patch.deleted !== undefined ? { deleted: patch.deleted } : {}), ...(patch.alias !== undefined ? { alias: patch.alias === "" ? null : patch.alias } : {}) } : c));
  for (const g of waChatPages.values()) { const c = waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; paintWaChatTab(g); if (pageActive === g.page) renderWaChat(g); } }
  paintListMode(); renderSidebar();
  try { await window.meuBot.markWhatsapp([patch]); return true; }
  catch (err) {
    void refreshWaChats();
    sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `${what}: ${ipcErrorText(err)}`));
    return false;
  }
}
/**
 * Migração única: o que este app guardava só no localStorage (waHidden = arquivadas, com a hora de então;
 * waDeleted = excluídas, com a hora da exclusão) vai para a máquina, e as chaves locais somem. Se a gravação
 * falhar, as chaves ficam e a próxima lista tenta de novo: nada se perde.
 */
async function migrateWaMarks(): Promise<void> {
  const read = (key: string): Record<string, string> => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown; return v !== null && typeof v === "object" ? v as Record<string, string> : {}; } catch { return {}; }
  };
  const archKey = `waHidden:${windowHost}`, delKey = `waDeleted:${windowHost}`;
  const patches: WaMarkPatch[] = [];
  const iso = (v: string): string | undefined => (Number.isNaN(Date.parse(v)) ? undefined : v);
  for (const [number, at] of Object.entries(read(archKey))) { const a = iso(at); patches.push({ number, archived: true, ...(a === undefined ? {} : { at: a }) }); }
  for (const [number, at] of Object.entries(read(delKey))) { const a = iso(at); patches.push({ number, deleted: true, ...(a === undefined ? {} : { at: a }) }); }
  if (patches.length === 0) return;
  await window.meuBot.markWhatsapp(patches.slice(0, 200));
  try { localStorage.removeItem(archKey); localStorage.removeItem(delKey); } catch { /* opcional */ }
  waChats = await window.meuBot.whatsappChats();
}

async function waMenuAction(row: WhatsappChat, action: WhatsappMenuAction | null): Promise<void> {
  if (action === null) return;
  const fail = (what: string, err: unknown): void => {
    sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `${what}: ${ipcErrorText(err)}`));
  };
  switch (action) {
    case "talk": {
      // Relê o histórico pela máquina (alguns segundos): o contato pisca até a aba nova abrir.
      const item = [...sidebarList.querySelectorAll<HTMLElement>(".wa-item")].find((x) => x.dataset["number"] === row.number);
      item?.classList.add("wa-busy");
      try { await openWaBranch(row.number); }
      catch (err) { fail("Não deu para levar ao meu-bot", err); }
      finally { item?.classList.remove("wa-busy"); }
      break;
    }
    case "export-md": case "export-json":
      try { await window.meuBot.exportWhatsapp(row.number, action === "export-md" ? "md" : "json"); }
      catch (err) { fail("Não deu para exportar", err); }
      break;
    case "rename":
      waClear = null; waRename = row.number; renderSidebar();
      break;
    case "copy-ref":
      copyReference(waReferenceText(row, hostLabel(windowHost)));
      break;
    case "archive":
      { const g = waChatPages.get(`wa-${row.number}`); if (g !== undefined && g.page.tabEl !== null) closePage(g.page); }
      await markWa({ number: row.number, archived: true }, "Não deu para arquivar");
      break;
    case "unarchive":
      await markWa({ number: row.number, archived: false }, "Não deu para desarquivar");
      break;
    case "pause": case "resume": {
      const item = [...sidebarList.querySelectorAll<HTMLElement>(".wa-item")].find((x) => x.dataset["number"] === row.number);
      item?.classList.add("wa-busy");
      try {
        await window.meuBot.pauseWhatsapp(row.number, action === "pause");
        waChats = waChats.map((c) => (c.number === row.number ? { ...c, paused: action === "pause" } : c));
        for (const g of waChatPages.values()) if (g.chat.number === row.number) { g.chat = { ...g.chat, paused: action === "pause" }; if (pageActive === g.page) renderWaChat(g); }
        renderSidebar();
      } catch (err) { fail(action === "pause" ? "Não deu para pausar" : "Não deu para retomar", err); }
      finally { item?.classList.remove("wa-busy"); }
      break;
    }
    case "clear":
      void startWaClear(row.number, "clear");
      break;
    case "delete":
      void deleteWaChat(row.number);
      break;
  }
}
/**
 * "Limpar histórico" confirmado na própria lista, logo abaixo do contato (nada de caixa por cima).
 * Sobrevive às atualizações da lista porque o estado fica aqui, não no DOM.
 */
type WaClear = { number: string; mode: "clear" | "delete"; phase: "plan" | "confirm" | "run"; shared: boolean; /** Sem histórico na máquina (excluir só tira da lista). */ empty: boolean; err: string | null };
let waClear: WaClear | null = null;
async function startWaClear(number: string, mode: WaClear["mode"]): Promise<void> {
  waClear = { number, mode, phase: "plan", shared: false, empty: false, err: null };
  renderSidebar();
  try {
    const plan = await window.meuBot.whatsappClearPlan(number);
    if (waClear?.number !== number) return;
    waClear = plan.own + plan.shared === 0
      ? { number, mode, phase: "confirm", shared: false, empty: true, err: mode === "clear" ? "Não há histórico desta conversa na máquina." : null }
      : { number, mode, phase: "confirm", shared: plan.shared > 0, empty: false, err: null };
  } catch (err) {
    if (waClear?.number !== number) return;
    waClear = { number, mode, phase: "confirm", shared: false, empty: false, err: ipcErrorText(err) };
  }
  renderSidebar();
}
/** "Excluir conversa": sem confirmação. Lê o plano e já limpa (a sessão principal inclusive) e tira da lista. */
async function deleteWaChat(number: string): Promise<void> {
  waClear = { number, mode: "delete", phase: "run", shared: false, empty: false, err: null };
  renderSidebar();
  try {
    const plan = await window.meuBot.whatsappClearPlan(number);
    if (waClear?.number !== number) return;
    await runWaClear({ number, mode: "delete", phase: "run", shared: plan.shared > 0, empty: plan.own + plan.shared === 0, err: null });
  } catch (err) {
    if (waClear?.number !== number) return;
    waClear = { number, mode: "delete", phase: "confirm", shared: false, empty: false, err: ipcErrorText(err) };
    renderSidebar();
  }
}
async function runWaClear(c: WaClear): Promise<void> {
  waClear = { ...c, phase: "run" };
  renderSidebar();
  try {
    // Excluir uma conversa sem histórico na máquina: só sai da lista.
    if (!(c.mode === "delete" && c.empty)) await window.meuBot.clearWhatsapp(c.number, c.shared);
    // Na máquina: excluída fica marcada (some nos dois apps); limpar desarquiva, se estava arquivada.
    const cur = waChats.find((x) => x.number === c.number);
    if (c.mode === "delete") await window.meuBot.markWhatsapp([{ number: c.number, deleted: true, archived: false }]);
    else if (cur?.archived === true) await window.meuBot.markWhatsapp([{ number: c.number, archived: false }]);
    waClear = null;
    cacheDrop(`waThread:${c.number}`);
    const g = waChatPages.get(`wa-${c.number}`); if (g !== undefined && g.page.tabEl !== null) closePage(g.page);
    void refreshWaChats();
  } catch (err) { waClear = { ...c, phase: "confirm", err: ipcErrorText(err) }; }
  renderSidebar();
}
function waClearBox(c: WaClear): HTMLElement {
  const box = el("div", "wa-clear");
  const del = c.mode === "delete";
  if (c.phase === "plan") { box.append(el("span", "wa-clear-text", "Verificando o histórico na máquina…")); return box; }
  if (c.phase === "run") { box.append(el("span", "wa-clear-text", del ? "Excluindo a conversa…" : "Limpando o histórico…")); return box; }
  const cancel = el("button", "btn", c.err !== null && !c.shared ? "Fechar" : "Cancelar"); cancel.type = "button";
  cancel.addEventListener("click", (ev) => { ev.stopPropagation(); waClear = null; renderSidebar(); });
  if (c.err !== null && !c.shared && /não há histórico/.test(c.err)) { box.append(el("span", "wa-clear-text", c.err), el("div", "wa-clear-actions")); box.lastElementChild!.append(cancel); return box; }
  box.append(el("strong", "", del ? (c.shared ? "Excluir e limpar o histórico de todos?" : "Excluir a conversa?") : c.shared ? "Limpar o histórico de todos?" : "Limpar o histórico?"));
  const tail = del ? " A conversa sai desta lista e volta só se o contato mandar outra mensagem." : "";
  box.append(el("span", "wa-clear-text", c.shared
    ? `Esta conversa está na sessão principal do agente, que mistura os contatos. Limpar zera ela inteira, com os outros contatos e o que você conversou direto com o agente.${tail}`
    : del && c.empty ? "Não há histórico desta conversa na máquina: ela só sai desta lista (volta se o contato mandar outra mensagem)."
    : `O agente esquece o que conversou com este contato e recomeça do zero.${tail}`));
  if (c.err !== null) box.append(el("span", "wa-clear-err", c.err));
  const go = el("button", "btn btn-bad", del ? (c.shared ? "Excluir e limpar tudo" : "Excluir") : c.shared ? "Limpar tudo" : "Limpar"); go.type = "button";
  go.addEventListener("click", (ev) => { ev.stopPropagation(); void runWaClear(c); });
  const actions = el("div", "wa-clear-actions"); actions.append(cancel, go);
  box.append(actions);
  box.addEventListener("click", (ev) => ev.stopPropagation());
  return box;
}
/**
 * "Renomear": apelido guardado na máquina (vale na lista e no título dos dois apps; o nome original fica dentro da
 * conversa). Caixa inline abaixo do contato, como a do limpar; vazio tira o apelido.
 */
let waRename: string | null = null;
function waRenameBox(row: WhatsappChat): HTMLElement {
  const box = el("div", "wa-clear wa-rename");
  box.append(el("strong", "", "Apelido desta conversa"));
  const input = el("input"); input.type = "text"; input.maxLength = 80; input.value = row.alias ?? "";
  input.placeholder = row.name !== null ? `Apelido (vazio volta a "${row.name}")` : "Apelido (vazio volta ao número)";
  const cancel = el("button", "btn", "Cancelar"); cancel.type = "button";
  const save = el("button", "btn btn-primary", "Salvar"); save.type = "button";
  const close = (): void => { waRename = null; renderSidebar(); };
  const commit = (): void => {
    const alias = input.value.replace(/\s+/g, " ").trim();
    if (alias === (row.alias ?? "")) { close(); return; }
    waRename = null;
    void markWa({ number: row.number, alias }, "Não deu para renomear");
  };
  cancel.addEventListener("click", (ev) => { ev.stopPropagation(); close(); });
  save.addEventListener("click", (ev) => { ev.stopPropagation(); commit(); });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  const actions = el("div", "wa-clear-actions"); actions.append(cancel, save);
  box.append(input, actions);
  box.addEventListener("click", (ev) => ev.stopPropagation());
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return box;
}
const waChatTitle = (c: WhatsappChat): string => c.isSelf ? "Você (este número)" : (c.alias ?? c.name ?? fmtPhone(c.number));
function paintWaSidebar(query: string): void {
  sidebarList.replaceChildren();
  const q = normalize(query.trim());
  const showHidden = sidebarArchived.checked;
  const rows = waChats.filter((c) => !isWaDeleted(c) && (showHidden || !isWaArchived(c)) && (q === "" || normalize(`${c.alias ?? ""} ${c.name ?? ""} ${c.number} ${fmtPhone(c.number)}`).includes(q)));
  if (rows.length === 0) {
    const msg = waChatsErr !== null && waChats.length === 0 ? `Não consegui ler as conversas: ${waChatsErr}`
      : waChatsInflight !== null && waChats.length === 0 ? "Carregando conversas do WhatsApp…"
      : q !== "" ? "Nada encontrado." : "Nenhuma conversa do WhatsApp ainda.";
    sidebarList.appendChild(el("div", "sidebar-empty", msg));
    return;
  }
  for (const group of groupByDate(rows)) {
    sidebarList.appendChild(el("div", "sidebar-group", group.label));
    for (const row of group.items) {
      const archived = isWaArchived(row);
      const item = el("div", `sidebar-item wa-item${pageActive?.id === `wa-${row.number}` ? " active" : ""}${archived ? " archived" : ""}`);
      item.dataset["number"] = row.number;
      const menu = el("button", "si-menu", "…");
      menu.type = "button"; menu.title = "Ações";
      menu.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void window.meuBot.showWhatsappMenu(row.number, { archived, paused: row.paused, ownSession: row.ownSession }).then((a) => waMenuAction(row, a));
      });
      item.append(el("span", `wa-item-dot${row.paused ? " paused" : ""}`), el("span", "si-title", waChatTitle(row)));
      if (row.paused) item.append(el("span", "si-tab", "pausado"));
      item.append(el("span", "si-date", shortDate(row.updatedAt)), menu);
      item.title = `${row.isSelf ? "Mensagens que você manda para o próprio número" : fmtPhone(row.number)}${row.paused ? " · pausado: o agente não responde" : ""}`;
      item.addEventListener("click", () => openWaChat(row));
      sidebarList.appendChild(item);
      if (waClear?.number === row.number) sidebarList.appendChild(waClearBox(waClear));
      if (waRename === row.number) sidebarList.appendChild(waRenameBox(row));
    }
  }
}

interface WaChatPage {
  page: PageTab; chat: WhatsappChat; msgs: WhatsappThreadMessage[]; err: string | null; loaded: boolean; inflight: Promise<void> | null; timer: number | null;
  /** Chaves das mensagens já na tela (para só acrescentar as novas). */
  shown?: string[];
  /** O que está na tela veio do cache desta janela; a leitura real ainda não chegou. */
  stale?: boolean;
}
const waChatPages = new Map<string, WaChatPage>();
function paintWaChatTab(g: WaChatPage): void {
  g.page.title = waChatTitle(g.chat);
  const t = g.page.tabEl?.querySelector(".tab-title"); if (t !== null && t !== undefined) t.textContent = g.page.title;
}
function openWaChat(c: WhatsappChat): void {
  const id = `wa-${c.number}`;
  let g = waChatPages.get(id);
  if (g === undefined) {
    const panel = el("section", "wa-chat-panel"); panel.hidden = true;
    panelsEl.append(panel);
    const created: WaChatPage = { page: null as unknown as PageTab, chat: c, msgs: [], err: null, loaded: false, inflight: null, timer: null };
    // A conversa da última vez aparece na hora (cache desta janela, até 200 mensagens); a leitura real troca por baixo.
    const cached = cacheRead<WhatsappThreadMessage[]>(`waThread:${c.number}`);
    if (cached !== null && cached.value.length > 0) { created.msgs = cached.value; created.loaded = true; created.stale = true; }
    created.page = definePage(id, waChatTitle(c), panel, () => renderWaChat(created));
    waChatPages.set(id, created);
    g = created;
  } else { g.chat = c; }
  openPage(g.page);
  paintWaChatTab(g);
  renderSidebar();
}
function refreshWaThread(g: WaChatPage): Promise<void> {
  if (g.inflight !== null) return g.inflight;
  if (g.timer !== null) { clearTimeout(g.timer); g.timer = null; }
  g.inflight = (async () => {
    try { g.msgs = await window.meuBot.whatsappThread(g.chat.number); g.err = null; g.stale = false; cacheWrite(`waThread:${g.chat.number}`, g.msgs.slice(-200)); }
    catch (err) { g.err = err instanceof Error ? err.message : String(err); }
    finally { g.loaded = true; g.inflight = null; }
    if (pageActive === g.page) { g.timer = window.setTimeout(() => { g.timer = null; void refreshWaThread(g); }, waAgentTyping(g) ? 3_000 : 8_000); renderWaChat(g); }
  })();
  return g.inflight;
}
const hhmm = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
/** Bolha do WhatsApp: contato à esquerda, agente à direita (markdown), hora embaixo. */
function waBubble(m: WhatsappThreadMessage): HTMLElement {
  const bubble = el("div", `msg wa-msg ${m.role === "contact" ? "wa-in" : "wa-out"}`);
  const body = el("div", "wa-body");
  if (m.role === "agent") body.append(renderMarkdown(m.text)); else body.textContent = m.text;
  bubble.dataset["waAt"] = m.at;
  bubble.append(body, el("span", "wa-time", `${m.role === "agent" ? "agente · " : ""}${hhmm(m.at)}`));
  return bubble;
}
/** Conversa do WhatsApp trazida, no topo da aba do meu-bot: o mesmo visual do espelho, só para ler. */
function renderWaQuote(tab: Tab, w: WhatsappOrigin, pending: boolean): void {
  const box = el("div", "wa-quote");
  const head = el("div", "wa-quote-head");
  head.append(el("strong", "", `WhatsApp · ${w.name}`), el("span", "", `${w.count} ${w.count === 1 ? "mensagem" : "mensagens"}`));
  box.append(head);
  let lastDay = "";
  for (const m of w.messages ?? []) {
    const day = new Date(m.at).toLocaleDateString("pt-BR");
    if (day !== lastDay) { box.append(el("div", "wa-day", day)); lastDay = day; }
    box.append(waBubble(m));
  }
  box.append(el("div", "wa-quote-foot", pending
    ? "Daqui para baixo é a conversa com o meu-bot: ele recebe o trecho acima junto da sua primeira mensagem. Nada daqui vai para o WhatsApp."
    : "Daqui para baixo, conversa com o meu-bot. Nada daqui vai para o WhatsApp."));
  tab.messagesEl.appendChild(box);
}
const waMsgKey = (m: WhatsappThreadMessage): string => `${m.role}|${m.at}|${m.text}`;
/** Por quanto tempo depois da última mensagem do contato o "digitando…" ainda faz sentido. */
const WA_TYPING_WINDOW = 3 * 60_000;
/**
 * O agente vai responder a última mensagem? Só uma simulação para quem acompanha: a última é do contato,
 * recente, o WhatsApp está conectado, a conversa não está pausada e a política responde essa pessoa
 * ("todo mundo", ou "só eu" na conversa consigo mesmo).
 */
function waAgentTyping(g: WaChatPage): boolean {
  const last = g.msgs.at(-1);
  const st = waStatus;
  if (last === undefined || last.role !== "contact" || g.chat.paused || st === null || !st.connected) return false;
  if (!(st.dmPolicy === "open" || (st.dmPolicy === "allowlist" && g.chat.isSelf))) return false;
  return Date.now() - new Date(last.at).getTime() < WA_TYPING_WINDOW;
}
/** Balão do agente com três pontinhos. */
function waTypingBubble(): HTMLElement {
  const b = el("div", "msg wa-msg wa-out wa-typing wa-enter");
  b.setAttribute("aria-label", "o agente está digitando");
  b.append(el("span", "wa-dot"), el("span", "wa-dot"), el("span", "wa-dot"));
  return b;
}
/** Bolhas "esqueleto" enquanto a conversa carrega (alternando lados, larguras variadas). */
function waSkeleton(): HTMLElement {
  const box = el("div", "wa-skeleton");
  box.setAttribute("aria-label", "Carregando a conversa…");
  for (const [side, w] of [["in", 46], ["out", 62], ["in", 34], ["out", 54], ["in", 58]] as const) {
    const b = el("div", `wa-skel ${side}`); b.style.width = `${w}%`; box.append(b);
  }
  return box;
}
/**
 * Desenha a conversa sem piscar: o cabeçalho é atualizado no lugar e, se as mensagens novas só continuam as
 * que já estão na tela, elas entram no fim com animação (rolagem suave se a pessoa estava no fim). Primeira
 * carga: as últimas bolhas entram em cascata. Qualquer outra mudança (histórico limpo, sessão nova) redesenha.
 */
function renderWaChat(g: WaChatPage): void {
  const panel = g.page.panel;
  const first = panel.dataset["rendered"] !== "1";
  const atEnd = first || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
  let head = panel.querySelector<HTMLElement>(".wa-chat-head");
  let list = panel.querySelector<HTMLElement>(".wa-chat-msgs");
  if (head === null || list === null) {
    head = el("div", "wa-chat-head"); list = el("div", "wa-chat-msgs");
    panel.replaceChildren(head, list);
  }
  // Com apelido, o nome original (pushname) continua visível ao lado do número.
  const sub = g.chat.alias !== null && g.chat.name !== null && !g.chat.isSelf ? `${g.chat.name} · ${fmtPhone(g.chat.number)}` : fmtPhone(g.chat.number);
  head.replaceChildren(el("strong", "", waChatTitle(g.chat)), el("span", "wa-chat-num", sub),
    el("span", "wa-chat-hint", g.stale === true ? "atualizando…" : g.chat.paused ? "pausado: o agente não responde a esta pessoa · somente leitura" : "somente leitura · atualiza sozinho"));
  panel.dataset["rendered"] = "1";
  const keys = g.msgs.map(waMsgKey);
  const shown = g.shown ?? [];
  const appendOnly = g.loaded && shown.length > 0 && shown.length <= keys.length && shown.every((k, i) => keys[i] === k);
  if (!g.loaded || g.msgs.length === 0 || !appendOnly) {
    list.replaceChildren();
    g.shown = [];
    if (!g.loaded) list.append(waSkeleton());
    else if (g.err !== null && g.msgs.length === 0) list.append(el("p", "hint wa-fade", `Não consegui ler a conversa: ${g.err}`));
    else if (g.msgs.length === 0) list.append(el("p", "hint wa-fade", "Sem mensagens ainda."));
  }
  const from = g.shown?.length ?? 0;
  // O "digitando…" fica sempre por último: sai antes de entrar mensagem nova e volta se ainda couber.
  const typingEl = list.querySelector(".wa-typing");
  const typing = g.loaded && waAgentTyping(g);
  if (typingEl !== null && (!typing || from < g.msgs.length)) typingEl.remove();
  if (g.loaded && from < g.msgs.length) {
    const cascade = from === 0; // primeira vez com mensagens: as últimas entram em sequência
    let lastDay = from === 0 ? "" : new Date(g.msgs[from - 1]!.at).toLocaleDateString("pt-BR");
    const total = g.msgs.length - from;
    g.msgs.slice(from).forEach((m, i) => {
      const day = new Date(m.at).toLocaleDateString("pt-BR");
      if (day !== lastDay) { list!.append(el("div", "wa-day", day)); lastDay = day; }
      const bubble = waBubble(m);
      const actions = el("div", "msg-actions");
      actions.append(iconButton("wa-copy", "Copiar", ICON_COPY));
      bubble.append(actions);
      const rank = total - 1 - i; // 0 = a mais nova
      if (!cascade || rank < 10) { bubble.classList.add("wa-enter"); bubble.style.animationDelay = cascade ? `${(9 - Math.min(rank, 9)) * 35}ms` : "0ms"; }
      list!.append(bubble);
    });
    g.shown = keys;
  }
  const typingNow = typing && list.querySelector(".wa-typing") === null;
  if (typingNow) list.append(waTypingBubble());
  if ((g.loaded && from < g.msgs.length) || typingNow) {
    if (atEnd) panel.scrollTo({ top: panel.scrollHeight, behavior: from === 0 ? "auto" : "smooth" });
  }
  // Voltou para a frente sem consulta agendada: retoma o ciclo.
  if (pageActive === g.page && g.inflight === null && g.timer === null) void refreshWaThread(g);
}
/** Copiar o texto de uma bolha do espelho. */
function waCopy(btn: HTMLButtonElement): void {
  const g = [...waChatPages.values()].find((p) => p.page === pageActive);
  if (g === undefined) return;
  const bubble = btn.closest<HTMLElement>(".wa-msg");
  const at = bubble?.dataset["waAt"] ?? null;
  const m = g.msgs.find((x) => x.at === at);
  void navigator.clipboard.writeText(m?.text ?? bubble?.querySelector(".wa-body")?.textContent ?? "").then(() => {
    btn.replaceChildren(svgIcon(ICON_CHECK)); btn.title = "Copiado"; btn.classList.add("done");
    window.setTimeout(() => { btn.replaceChildren(svgIcon(ICON_COPY)); btn.title = "Copiar"; btn.classList.remove("done"); }, 1500);
  });
}
/** Abre a conversa nova do meu-bot com o trecho do WhatsApp: aba na frente, lista no meu-bot, cursor no campo. */
async function openWaBranch(number: string): Promise<void> {
  const view = await window.meuBot.whatsappBranch(number);
  upsertIndex(view);
  buildTab(view.id, view.model, view.host, view);
  activate(view.id);
  if (getListMode() === "whatsapp") setListMode("bot");
  inputEl.focus();
}
let waPairing = false;
/** O pareamento em curso já vinculou: o resto (gateway voltando) é pano de fundo. */
let waConnected = false;

/** "5516992294486" → "+55 (16) 99229-4486"; outros formatos ficam com o + na frente. */
function fmtPhone(digits: string | null): string {
  if (digits === null) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m === null ? `+${digits}` : `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

function paintWhatsapp(): void {
  const st = waStatus;
  paintListMode();
  if (st === null || !st.present) { waLine.hidden = true; return; }
  waLine.hidden = false;
  // Ponto verde conectado; cinza no resto (limpo: vermelho só assusta, e o clique já leva à solução).
  waLine.className = `wa-line ${st.connected ? "on" : ""}`;
  const who = st.number !== null ? fmtPhone(st.number) : "sem número";
  const via = st.gateway === "openclaw" ? "WhatsApp (OpenClaw)" : st.gateway === "hermes" ? "WhatsApp (Hermes)" : "WhatsApp";
  if (!st.ready) {
    waLine.replaceChildren(el("span", "dot"), el("span", "", `${via} · sem configurar`));
    waStatusEl.textContent = `${st.agent}.\nFalta:\n${(st.missing ?? "?").split("\n").map((l) => `• ${l}`).join("\n")}`;
    waPairBtn.hidden = true; waResetBtn.hidden = true; waCloseBtn.textContent = "Fechar";
    waAgentBtn.hidden = waPairing;
    waRefreshBtn.hidden = waPairing;
    waPolicyBox.hidden = true;
    return;
  }
  waAgentBtn.hidden = true;
  paintWaPolicy();
  const responde = st.connected && st.dmPolicy !== null ? ` · responde ${st.dmPolicy === "open" ? "todo mundo" : st.dmPolicy === "allowlist" ? "só você" : st.dmPolicy === "disabled" ? "ninguém" : "com código"}` : "";
  waLine.replaceChildren(el("span", "dot"), el("span", "", st.connected ? `${via} · ${who}${responde}` : `${via} · desconectado`));
  // Conectado: só o número. Desconectado: nada (o QR e a linha de progresso dizem o resto). A ficha técnica fica no title.
  waStatusEl.textContent = st.connected ? `Conectado como ${who}.` : "";
  waStatusEl.title = st.agent;
  waPairBtn.hidden = st.connected || waPairing;
  waPairBtn.textContent = st.number === null ? "Gerar QR" : "Tentar reconectar e gerar QR";
  waResetBtn.hidden = waPairing || st.number === null;
  paintGuide();
  waCloseBtn.textContent = waConnected && !waSuccess.hidden ? "Concluído" : waPairing ? "Cancelar" : "Fechar";
  waCloseBtn.classList.toggle("btn-done", waConnected && !waSuccess.hidden);
  waRefreshBtn.hidden = waPairing;
}

let waTimer: ReturnType<typeof setTimeout> | null = null;
let waRefreshing = false;
/**
 * Consulta o estado e agenda a próxima: 10 s enquanto a máquina tem WhatsApp mas não está conectado
 * (gateway reiniciando, sessão caindo), 60 s quando está bem. Sem isso a linha congelava no estado da
 * abertura da janela — vermelha depois de um alívio, mesmo com o gateway já de volta.
 */
/** Consulta em andamento: quem chama de novo (o botão Atualizar) espera por ela em vez de ser ignorado. */
let waInflight: Promise<void> | null = null;
let waCheckedAt: Date | null = null;
function refreshWhatsapp(): Promise<void> {
  if (waInflight !== null) return waInflight;
  waRefreshing = true;
  if (waTimer !== null) { clearTimeout(waTimer); waTimer = null; }
  waInflight = (async () => {
    try { waStatus = await window.meuBot.whatsappStatus(); waCheckedAt = new Date(); if (waStatus.present) cacheWrite("waStatus", waStatus); else cacheDrop("waStatus"); } catch { waStatus = null; }
    finally { waRefreshing = false; waInflight = null; }
    paintWhatsapp();
    if (waPairing && waStatus?.connected === true) waShowSuccess(waStatus.number);
    const soon = waStatus !== null && waStatus.present && !waStatus.connected;
    waTimer = setTimeout(() => { void refreshWhatsapp(); }, waPairing && !waConnected ? 8_000 : soon ? 10_000 : 60_000);
  })();
  return waInflight;
}
window.addEventListener("focus", () => { if (waStatus?.present) void refreshWhatsapp(); });

function openWhatsapp(): void {
  // No meio de um pareamento o QR e o log continuam: reabrir o modal não pode esconder o QR da vez.
  if (!waPairing) { waQr.hidden = true; waHow.hidden = true; waProgress.hidden = true; waSuccess.hidden = true; resetWaProgress(); }
  paintWhatsapp();
  if (!waDialog.open) waDialog.showModal();
}

/**
 * Só desconecta (antes chamava o pareamento com reset, que já gerava outro QR: a tela ficava em "escaneie"
 * e terminava em "QR expirou", parecendo que não tinha desconectado). Depois o status volta a "desconectado"
 * e o guia volta ao passo de conectar.
 */
async function disconnectWhatsapp(btn: HTMLButtonElement): Promise<void> {
  const label = btn.dataset.label ?? btn.textContent ?? "Desconectar";
  btn.disabled = true; btn.textContent = "Desconectando…";
  try {
    await window.meuBot.whatsappLogout();
    await refreshWhatsapp();
  } catch (err) {
    btn.textContent = `Não desconectou: ${ipcErrorText(err)}`;
    btn.classList.add("btn-bad");
    window.setTimeout(() => { btn.textContent = label; btn.classList.remove("btn-bad"); }, 5000);
    return;
  } finally { btn.disabled = false; }
  btn.textContent = label;
}
async function pairWhatsapp(reset: boolean): Promise<void> {
  if (waPairing) return;
  waPairing = true; waConnected = false;
  resetWaProgress(); waSuccess.hidden = true;
  setWaProgress(reset ? "Apagando a sessão antiga…" : "Conectando à máquina…");
  waTick = setInterval(paintWaMeta, 1000);
  waStatusEl.textContent = reset ? "Apagando a sessão antiga e gerando um QR novo…" : "Gerando o QR…";
  paintWhatsapp();
  try {
    await window.meuBot.whatsappPair(reset);
  } catch (err) {
    setWaProgress(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    waPairing = false;
    if (waTick !== null) { clearInterval(waTick); waTick = null; }
    paintWaMeta();
    if (!waConnected && !waProgress.classList.contains("bad")) setWaProgress("O QR expirou sem leitura. Gere outro quando quiser.", "bad");
    waQr.hidden = true; waHow.hidden = true;
    // O gateway acabou de voltar; dá alguns segundos para o bridge abrir a sessão antes de consultar.
    setTimeout(() => { void refreshWhatsapp(); }, 6000);
    paintWhatsapp();
  }
}


/** Pareou (pelo vigia do script ou pela consulta de estado): ✓ animado no lugar do QR, aviso na aba, modal fecha. */
function waShowSuccess(number: string | null): void {
  if (waConnected) return;
  const ev = { number };
      // Vinculou: a janela fecha sozinha; o gateway volta em segundo plano e o refresh depois do `done` mostra o número.
      waConnected = true;
      setWaProgress(`Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}`, "ok");
      waProgressMeta.textContent = "";
      waQr.hidden = true; waHow.hidden = true;
      waSuccessText.textContent = ev.number !== null ? `Pareado como ${fmtPhone(ev.number)}` : "Pareado";
      waSuccess.hidden = false; waStatusEl.textContent = `✓ Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}. O gateway está voltando…`;       // O único botão vira "Concluído" (verde): cancelar depois de pareado não faz sentido.
      waCloseBtn.textContent = "Concluído"; waCloseBtn.classList.add("btn-done");
      const tab = active(); if (tab !== null) addNotice(tab, "✓ WhatsApp pareado; o gateway está voltando.", "info");
      setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
}

window.meuBot.on("whatsapp:event", (ev: WhatsappEvent) => {
  switch (ev.kind) {
    // Só a linha de progresso: cada passo substitui o anterior; o log cru do CLI não aparece.
    case "step": if (waQrCount === 0 && !waConnected) setWaProgress(ev.text.charAt(0).toUpperCase() + ev.text.slice(1)); break;
    case "log": break;
    case "qr": {
      if (waConnected) break; // já pareou nesta rodada: nenhum QR atrasado volta por cima do ✓
      const now = Date.now();
      if (waQrCount >= 2 && now - waQrAt > 5_000) waQrEvery = now - waQrAt; // mede o ciclo real (do 2º em diante)
      waQrCount += 1; waQrAt = now;
      waQr.src = ev.dataUrl; waQr.hidden = false; waHow.hidden = false;
      waStatusEl.textContent = "Leia o QR com o WhatsApp do número do agente.";
      setWaProgress("Aguardando a leitura no celular"); paintWaMeta();
      break;
    }
    case "connected": { waShowSuccess(ev.number); break; }
    case "error": waStatusEl.textContent = `✗ ${ev.text}`; setWaProgress(ev.text, "bad"); break;
    case "done":
      if (ev.ok && waDialog.open) setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
      break;
  }
});
// A linha sempre leva à aba do guia (tudo na aba, sem modal); só cai no modal se a máquina não é OpenClaw.
waLine.addEventListener("click", () => {
  const guide = TUTORIAIS.find((t) => t.id === "whatsapp-openclaw");
  if (guide !== undefined && waStatus !== null && waStatus.present && waStatus.gateway === "openclaw") { openGuide(guide); return; }
  openWhatsapp();
});
waPairBtn.addEventListener("click", () => { void pairWhatsapp(false); });
waResetBtn.addEventListener("click", () => armConfirm(waResetBtn, "Confirmar? desconecta o número", () => { void disconnectWhatsapp(waResetBtn); }));
const waCancelIfPairing = (): void => { if (waPairing && !waConnected) void window.meuBot.whatsappCancel(); };
waCloseBtn.addEventListener("click", () => { waCancelIfPairing(); waDialog.close(); });
// Esc fecha o <dialog> por conta própria; tem que cancelar o pareamento do mesmo jeito que o botão.
waDialog.addEventListener("cancel", () => { waCancelIfPairing(); });

// ---- Abertura (opcional, interruptor "Intro" do seletor): o topo se materializa em etapas e o túnel acende como clímax.
const introEl = $<HTMLElement>("intro");
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function playIntro(): Promise<void> {
  // Caixinha "abrir direto" do seletor (padrão marcada): sem abertura. Desmarcada: toda vez.
  if (settings?.openDirect !== false || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { introEl.remove(); return; }
  const brand = $<HTMLElement>("intro-brand");
  const host = $<HTMLElement>("intro-host");
  host.textContent = hostLabel(windowHost);
  // Mascotes: a bolha do ícone, 5 cores, em arco sobre o nome; cada um com semente própria para os loops não coincidirem.
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const stage = $<HTMLElement>("intro-mascots");
  const mascots = planMascots(5).map((m) => {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.style.setProperty("--x", `${m.x}px`); el.style.setProperty("--y", `${m.y}px`); el.style.setProperty("--size", `${m.size}px`);
    el.style.setProperty("--hue", String(m.hue)); el.style.setProperty("--seed", m.seed.toFixed(3));
    stage.append(el);
    return { el, m };
  });
  introEl.hidden = false;
  await wait(30); brand.classList.add("in");            // meu-bot no centro, discreto
  for (const { el, m } of mascots) setTimeout(() => el.classList.add("in"), m.delayMs); // pop com overshoot, em cascata
  await wait(300); host.classList.add("in");            // o nome da máquina, embaixo
  // Clímax: espera o túnel real ficar pronto, mas por pouco tempo; espera longa vira tédio. O estado em si fica na barra.
  const t0 = Date.now();
  while (hostStatus.get(windowHost)?.state !== "ready" && Date.now() - t0 < 700) await wait(40);
  const ready = hostStatus.get(windowHost)?.state === "ready";
  if (ready) mascots.forEach(({ el }, i) => setTimeout(() => el.classList.add("cheer"), i * 40)); // pulinho em cascata: o túnel acendeu
  await wait(ready ? 520 : 300);
  // Portal: o nome escala e some, e o app por baixo assenta (scale 1.03 → 1) enquanto a camada se dissolve.
  introEl.classList.add("out");
  document.body.classList.add("app-enter");
  await wait(480);
  introEl.remove();
  document.body.classList.remove("app-enter");
}

// ---- Onboarding guiado (primeira vez, sem conversas): a pessoa faz cada ação, o app só orienta.
const onboardEl = $<HTMLElement>("onboard");
const obCount = $<HTMLSpanElement>("ob-count");
const obLead = $<HTMLParagraphElement>("ob-lead");
const obFeedback = $<HTMLParagraphElement>("ob-feedback");
const obTitle = $<HTMLHeadingElement>("ob-title");
const obText = $<HTMLParagraphElement>("ob-text");
const obSkip = $<HTMLButtonElement>("ob-skip");
const obStage = $<HTMLElement>("ob-mascots");
const obRipple = $<HTMLElement>("ob-ripple");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let obMascots: SVGSVGElement[] = [];

/**
 * Entrada do onboarding (shot "capwords-splash"): o cartão chega com mola, os mascotes (os da abertura) deslizam das
 * bordas e param em volta dele, em idle até o fim, e aviso, título e texto sobem em sequência.
 */
function onboardEnter(): void {
  if (prefersReducedMotion) return;
  onboardEl.classList.remove("enter", "shrink"); void onboardEl.offsetWidth; onboardEl.classList.add("enter");
  setTimeout(() => onboardEl.classList.remove("enter"), 800);
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  obStage.replaceChildren(); obStage.hidden = false; obMascots = [];
  for (const m of planMascots(5, Math.random, 310, 150)) {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.classList.add("from-edge");
    el.style.setProperty("--x", `${m.x}px`); el.style.setProperty("--y", `${m.y}px`); el.style.setProperty("--size", `${m.size + 6}px`);
    el.style.setProperty("--hue", String(m.hue)); el.style.setProperty("--seed", m.seed.toFixed(3));
    el.style.setProperty("--fx", `${Math.round(m.x * 1.6)}px`); el.style.setProperty("--fy", `${Math.round(m.y * 2.2)}px`); // nasce empurrado para a borda
    obStage.append(el); obMascots.push(el);
    setTimeout(() => el.classList.add("in"), 30 + m.delayMs);
  }
}

/** Saída. "done": o cartão se dissolve encolhendo de leve, os mascotes se despedem junto e uma onda verde se abre do centro do cartão e se dissolve. "skipped": só dispensa os mascotes. */
async function onboardLeave(how: "done" | "skipped"): Promise<void> {
  const bye = (): void => { for (const el of obMascots) el.classList.add("bye"); setTimeout(() => { obStage.replaceChildren(); obStage.hidden = true; obMascots = []; }, 400); };
  if (prefersReducedMotion || how === "skipped") { bye(); return; }
  const r = onboardEl.getBoundingClientRect();
  obRipple.style.setProperty("--cx", `${r.left + r.width / 2}px`); obRipple.style.setProperty("--cy", `${r.top + r.height / 2}px`);
  bye();
  onboardEl.classList.add("shrink");
  await wait(280);                         // a onda nasce enquanto o cartão ainda está se dissolvendo
  obRipple.hidden = false; obRipple.classList.add("go");
  await wait(1000);
  obRipple.classList.remove("go"); obRipple.hidden = true; onboardEl.classList.remove("shrink");
}
let onboard: OnboardState | null = null;

// ---- Tela vazia: sem aba e sem onboarding, a cobrinha (snake.ts) ocupa o painel e já sai andando.
const restEl = $<HTMLElement>("rest");
const rest = mountSnake($<HTMLCanvasElement>("rest-canvas"));
const tabPlus = $<HTMLButtonElement>("tab-plus");
tabPlus.addEventListener("click", () => { void newTab(); });
function syncRest(): void {
  tabPlus.hidden = tabs.size > 0; // a aba "+" só existe quando não há aba de conversa
  const show = tabs.size === 0 && onboard === null && pageActive === null && document.getElementById("tour-welcome")?.hidden !== false;
  restEl.hidden = !show;
  newBtn.classList.toggle("shine", show);
  if (show) rest.start(); else rest.stop();
}
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

// ---- Convite do tour (primeira abertura): "Iniciar tour" começa o onboarding; pular ou fechar marca pulado.
const tourWelcomeEl = $<HTMLElement>("tour-welcome");
$<HTMLElement>("tw-title").textContent = TOUR_INVITE.title;
$<HTMLElement>("tw-text").textContent = TOUR_INVITE.text;
function showTourWelcome(): void { tourWelcomeEl.hidden = false; syncRest(); $<HTMLButtonElement>("tw-start").focus(); }
function closeTourWelcome(start: boolean): void {
  tourWelcomeEl.hidden = true;
  if (start) startOnboarding(); else void finishOnboarding("skipped");
  syncRest();
}
$<HTMLButtonElement>("tw-start").addEventListener("click", () => closeTourWelcome(true));
$<HTMLButtonElement>("tw-skip").addEventListener("click", () => closeTourWelcome(false));
$<HTMLButtonElement>("tw-close").addEventListener("click", () => closeTourWelcome(false));
/** Começar/rever o tour a partir de Tutoriais ou da paleta: marca pendente e começa já. */
async function restartTour(): Promise<void> {
  try { applySettings(await window.meuBot.setSettings({ onboarding: "pending" })); } catch { /* segue mesmo assim */ }
  tourWelcomeEl.hidden = true;
  startOnboarding();
  syncRest();
}

function startOnboarding(): void {
  onboard = initialOnboardState();
  lastFeedback = undefined;
  paintOnboard();
  onboardEnter();
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
  window.setTimeout(() => {
    if (onboard !== null) return;
    void onboardLeave(how).then(() => {
      if (onboard !== null) return;
      onboardEl.hidden = true; obSkip.hidden = false;
      // Concluiu: volta aos Tutoriais com o próximo (o WhatsApp, para quem começa do zero) em destaque.
      if (how === "done") { tutNext = true; openPage(tutoriaisPage); }
    });
  }, how === "done" ? 3200 : 4500);
  try { applySettings(await window.meuBot.setSettings({ onboarding: how })); } catch { /* fica pendente; volta na próxima vez */ }
  reportProgress();
  if (how === "skipped" && tabs.size === 0) await newTab();
}

/**
 * Mensagem de boas-vindas (mock, só na tela: não vai ao agente nem fica salva). Confere o login do Claude Code
 * da máquina antes: deslogado, a própria mensagem traz o botão "Entrar no Claude Code".
 */
async function showWelcome(tab: Tab): Promise<void> {
  await refreshClaudeLine();
  const loggedIn = clAuth === null ? null : clAuth.loggedIn;
  const bubble = el("div", "msg msg-assistant msg-welcome");
  renderAssistant(bubble, welcomeMessage(hostLabel(windowHost), loggedIn));
  if (loggedIn === false) {
    const btn = el("button", "btn btn-primary btn-small", "Entrar no Claude Code");
    btn.type = "button";
    btn.addEventListener("click", () => enterClaude());
    bubble.append(btn);
  }
  bubble.append(el("span", "msg-welcome-tag", "boas-vindas do meu-bot · não enviada ao agente"));
  tab.messagesEl.appendChild(bubble);
  scrollToBottom(tab, false);
}

/** O renderer avisa o que aconteceu; só o evento do passo atual avança. */
function onboardEvent(ev: OnboardEvent): void {
  if (onboard === null) return;
  const r = advanceOnboard(onboard, ev);
  onboard = r.state;
  if (r.finished) {
    // Último passo concluído: boas-vindas local na conversa nova (sem chamar o agente) e a transição final.
    const tab = active();
    if (tab !== null) void showWelcome(tab);
    void finishOnboarding("done");
    return;
  }
  if (!r.advanced) return;
  const fb = pickFeedback(Math.random, lastFeedback);
  lastFeedback = fb;
  paintOnboard(fb);
}

obSkip.addEventListener("click", () => { void finishOnboarding("skipped"); });


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
  setSendPhase(tab, "sending");
  try {
    await window.meuBot.send(tab.id, text);
  } catch (err) {
    addNotice(tab, err instanceof Error ? err.message : String(err), "error");
    setSendPhase(tab, null);
  } finally {
    if (tabs.has(tab.id)) { setBusy(tab, false); if (sendPhase.get(tab.id) !== "done") setSendPhase(tab, null); }
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
  if (sendPhase.get(tab.id) === "sending") setSendPhase(tab, "streaming");
  tab.pendingText = "";
  tab.currentAssistant = appendMessage(tab, "assistant", "", index.get(conversationId)?.messages.length ?? 0);
  scrollToBottom(tab, false);
});
window.meuBot.on("chat:delta", ({ conversationId, text }) => {
  const tab = tabs.get(conversationId);
  if (tab === undefined) return;
  if (sendPhase.get(tab.id) === "sending") setSendPhase(tab, "streaming");
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
  if (done.stopReason === "cancelled" || done.refusal !== undefined) setSendPhase(tab, null);
  else { setSendPhase(tab, "done"); setTimeout(() => { if (sendPhase.get(tab.id) === "done") setSendPhase(tab, null); }, 900); }
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
    const had = firstReplyOnHost();
    patchIndex(tab.id, { messages: [...(cur?.messages ?? []), { role: "assistant", content: tab.pendingText, ...(done.provider === undefined ? {} : { provider: done.provider }), ...(done.fallback === undefined ? {} : { fallback: done.fallback }) }] });
    if (tab.currentAssistant !== null) paintProviderLabel(tab.currentAssistant, tab.model, done.provider, done.fallback);
    // Tutorial 4: a prova de que o grok-4 responde é o X-Provider da resposta, não o que o modelo diz de si.
    const grokNow = done.provider === "grok-4" && !loadGuideFlags(XAI_TUTORIAL).grokReplied;
    if (grokNow) saveGuideFlag(XAI_TUTORIAL, "grokReplied");
    // A reserva assumiu de verdade: o passo 3 do tutorial 5 se marca sozinho.
    if (done.fallback !== undefined && !loadGuideFlags(FALLBACK_TUTORIAL).fallbackSeen) { saveGuideFlag(FALLBACK_TUTORIAL, "fallbackSeen"); paintGuide(); }
    if (!had || grokNow) paintGuide(); // primeira resposta nesta máquina (tutorial 1) / primeira do grok-4 (tutorial 4)
  }
  markUnread(tab);
  maybeNotify(tab, tab.pendingText);
});
window.meuBot.on("chat:error", (e: ErrorEvent) => {
  const tab = tabs.get(e.conversationId);
  if (tab === undefined) return;
  setSendPhase(tab, null);
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
  const run = target.closest<HTMLButtonElement>(".btn-run");
  if (run !== null) {
    const block = run.closest<HTMLElement>(".code-block");
    const code = block?.querySelector("pre")?.textContent ?? "";
    void runInTerminal(code, block?.dataset["lang"] ?? "bash");
    return;
  }
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
  const waBtn = target.closest<HTMLButtonElement>(".wa-msg .msg-actions button");
  if (waBtn !== null) { waCopy(waBtn); return; }
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
  if (tab.model !== model && !prefersReducedMotion) showModeToast(model);
  setTabModel(tab, model);
  void window.meuBot.setConversationModel(tab.id, model);
});
sendBtn.addEventListener("click", () => {
  const tab = active();
  if (tab !== null && tab.busy) { void window.meuBot.cancel(tab.id); return; }
  cancelAutoSend();
  void sendMessage();
});
inputEl.addEventListener("input", () => { cancelAutoSend(); const t = active(); sendBtn.classList.toggle("shine", t !== null && !t.busy && (sendPhase.get(t.id) ?? "idle") === "idle" && inputEl.value.trim().length >= 2); });
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && autoSend !== null) { ev.preventDefault(); cancelAutoSend(); return; }
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    cancelAutoSend();
    void sendMessage();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !modeMenu.hidden) { modeMenu.hidden = true; return; }
  // Com o terminal focado, Ctrl+* é do shell (Ctrl+C, Ctrl+W, Ctrl+N…); só Cmd+* continua do app.
  const inTerm = (ev.target as HTMLElement | null)?.closest?.(".term-panel") != null;
  if (inTerm && ev.ctrlKey && !ev.metaKey) return;
  if (ev.metaKey && (ev.key === "j" || ev.key === "J")) { ev.preventDefault(); void openTerminalTab(ev.shiftKey ? "new" : "focus"); return; }
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key === "k") { ev.preventDefault(); if (paletteEl.hidden) openPalette(); else closePalette(); return; }
  if (!paletteEl.hidden) return;
  if (mod && ev.key === "n" && !ev.shiftKey) { ev.preventDefault(); void newTab(); } // Cmd+Shift+N é a janela nova (menu)
  if (mod && ev.shiftKey && (ev.key === "b" || ev.key === "B")) { ev.preventDefault(); setTopbarHidden(!document.body.classList.contains("topbar-hidden")); return; }
  if (mod && ev.key === "b") { ev.preventDefault(); toggleSidebar(); }
  if (mod && ev.key === "w" && pageActive !== null) { ev.preventDefault(); closePage(pageActive); return; }
  if (mod && ev.key === "w" && activeId !== null) { ev.preventDefault(); void closeTab(activeId); }
});
/** Novo (shot "x-campaign grok-bot like button"): afunda e volta com mola; bolhas-mascote saltam em leque enquanto a aba nova aparece. */
function burstNew(): void {
  if (prefersReducedMotion) return;
  newBtn.classList.remove("pressed"); void newBtn.offsetWidth; newBtn.classList.add("pressed");
  setTimeout(() => newBtn.classList.remove("pressed"), 500);
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const hues = [220, 145, 40, 330, 270];
  for (let i = 0; i < 5; i++) {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.setAttribute("class", "burst-m");
    const ang = ((-150 + i * 30 + (Math.random() - 0.5) * 14) * Math.PI) / 180; // leque para cima
    const d = 34 + Math.random() * 22;
    el.style.setProperty("--bx", `${Math.round(Math.cos(ang) * d)}px`); el.style.setProperty("--by", `${Math.round(Math.sin(ang) * d)}px`);
    el.style.setProperty("--hue", String(hues[i])); el.style.setProperty("--d", `${i * 40}ms`);
    newBtn.append(el);
    setTimeout(() => el.remove(), 1000);
  }
}
newBtn.addEventListener("click", () => { burstNew(); void newTab(); });
// ---- Seção Fallback: o primário é o modelo padrão da máquina; a reserva vem da corrente do backend.
const primarySelect = $<HTMLSelectElement>("primary-provider");
const fallbackOrderEl = $<HTMLParagraphElement>("fallback-order");
const PRIMARY_OF: Record<string, BackendModel> = { claude: "agente", xai: "grok-4" };
function syncPrimaryFromModel(): void {
  const m = backendModelSelect.value;
  primarySelect.value = m === "grok-4" ? "xai" : m === "agente" ? "claude" : "other";
}
function paintFallbackOrder(): void {
  fallbackOrderEl.textContent = fallbackOrderText(backendModelSelect.value, account?.providers ?? null);
}
// Escolher o primário nas Configurações também conta como "escolhi" no tutorial 5 (vale ao salvar; o select já reflete).
primarySelect.addEventListener("change", () => { const m = PRIMARY_OF[primarySelect.value]; if (m !== undefined) { backendModelSelect.value = m; saveGuideFlag(FALLBACK_TUTORIAL, "fallbackChosen"); } paintFallbackOrder(); });
backendModelSelect.addEventListener("change", () => { syncPrimaryFromModel(); paintFallbackOrder(); });

/** Abre as Configurações (botão ou Cmd+,): sempre com as seções recolhidas e a memória recém-lida. */
/**
 * Suporte, lado da pessoa: o estado (`supportState`) e as peças da tela, usadas nas Configurações › Suporte e
 * nos passos do tutorial "Ligar o suporte": nome, interruptor, aviso entregue/código (plano B) e o registro do
 * que o suporte fez aqui. Tudo vale na hora; depois de cada ação as duas telas repintam.
 */
let supportState: SupportInfo | null = null;
let supportBusy = false;
const supportGroup = $<HTMLDetailsElement>("support-group");
const supportBody = $<HTMLElement>("support-body");
/** Liga sozinho uma vez por janela (máquina por SSH com o pacote), a não ser que o admin tenha desligado. */
let supportAutoTried = false;
let supportMsg: { text: string; bad: boolean } | null = null;
/** Código de suporte revelado (plano B; some ao fechar as Configurações ou esconder). */
let supportCodeShown: string | null = null;
let supportPoll: number | null = null;
/** Status line do Claude nesta máquina: instalada? (null = ainda não consultado); limites = a conta já tem números. */
let statusLineState: boolean | null = null;
/** Guarda do WhatsApp nesta máquina (tutorial 8): null = não consultado ou sem OpenClaw. */
let guardaState: boolean | null = null;
let guardaBusy = false;
let guardaLog: string[] = [];
let guardaMsg: { text: string; bad: boolean } | null = null;
let statusLineBusy = false;
let statusLineLog: string[] = [];
let statusLineMsg: { text: string; bad: boolean } | null = null;
const accountHasLimits = (): boolean => account !== null && (account.sessionPct !== null || account.weeklyPct !== null);
/** Segmentos escolhidos (arquivo na máquina); null = todos. O rodapé e a barra do terminal seguem a mesma escolha. */
let statusLineSegs: StatusLineSegments | null = null;
let statusLineSegsBusy = false;
let statusLineSegsMsg: string | null = null;
/** Alguma conversa desta máquina já teve resposta do agente (o index só tem conversas do windowHost). */
const firstReplyOnHost = (): boolean => [...index.values()].some((c) => c.messages.some((m) => m.role === "assistant"));
const guideCtx = (): GuideContext => ({
  support: supportState,
  statusLine: { installed: statusLineState, limits: accountHasLimits(), segments: statusLineSegs },
  claude: { loggedIn: clAuth?.loggedIn ?? null, email: clAuth?.email ?? null, firstReply: firstReplyOnHost() },
  xai: {
    possible: !caps.install || windowHost === "local" ? false : xaiAuth !== null ? true : xaiKey === null ? null : xaiKey.backend,
    hermes: xaiAuth !== null ? true : xaiKey === null ? null : false,
    loggedIn: xaiAuth?.loggedIn ?? null, label: xaiAuth?.email ?? null,
  },
  fallback: { primary: backendModelSelect.value === "" ? null : backendModelSelect.value, chain: account?.providers ?? null },
  guarda: { installed: guardaState },
  objective: objectiveState,
});

/** Tutorial 7, passo 1: cartões de objetivo + frase, "Salvar objetivo" grava na máquina. */
function renderObjectiveChoice(container: HTMLElement): void {
  const cur = objectiveState?.objective ?? null;
  const draft = objectiveDraft ?? (cur === null ? null : { id: cur.id, text: cur.text });
  const cards = el("div", "reply-cards guide-cards");
  for (const o of OBJECTIVE_OPTIONS) {
    const on = draft?.id === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.label));
    if (cur?.id === o.id) title.append(el("span", "reply-default", "Salvo"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { objectiveDraft = { id: o.id, text: draft?.id === o.id ? draft.text : (cur?.id === o.id ? cur.text : "") }; paintGuide(); });
    cards.append(card);
  }
  container.append(cards);
  const row = el("div", "support-name");
  const opt = OBJECTIVE_OPTIONS.find((o) => o.id === draft?.id) ?? null;
  const input = el("input"); input.type = "text"; input.maxLength = 300; input.disabled = objectiveBusy || draft === null;
  input.placeholder = opt?.needsText === true ? "Em uma frase: o que o agente deve resolver (obrigatório)" : "Complete em uma frase, se quiser";
  input.value = draft?.text ?? "";
  input.addEventListener("input", () => { if (objectiveDraft !== null) objectiveDraft.text = input.value; else if (draft !== null) objectiveDraft = { id: draft.id, text: input.value }; });
  const save = el("button", "btn btn-primary btn-small", cur === null ? "Salvar objetivo" : "Salvar mudança"); save.type = "button";
  save.disabled = objectiveBusy || draft === null || (opt?.needsText === true && input.value.trim() === "");
  input.addEventListener("input", () => { save.disabled = objectiveBusy || (opt?.needsText === true && input.value.trim() === ""); });
  save.addEventListener("click", () => {
    if (draft === null || opt === null) return;
    const choice: ObjectiveChoice = { id: opt.id, label: opt.label, text: input.value.trim() };
    void objectiveDo(() => window.meuBot.setObjective({ objective: choice }), null).then(() => { objectiveDraft = null; paintGuide(); });
  });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !save.disabled) { ev.preventDefault(); save.click(); } });
  row.append(input, save);
  container.append(row);
  if (objectiveMsg !== null && objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${objectiveMsg.text}`));
}
/** Tutorial 7, passo 2: os três níveis; clicar grava na hora (como "quem o agente responde"). */
function renderObjectiveLevel(container: HTMLElement): void {
  const cur = objectiveState?.level ?? null;
  const cards = el("div", "reply-cards guide-cards");
  for (const o of LEVEL_OPTIONS) {
    const on = cur === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (cur !== o.id) void objectiveDo(() => window.meuBot.setObjective({ level: o.id }), null); });
    cards.append(card);
  }
  container.append(cards);
  if (objectiveMsg !== null && objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${objectiveMsg.text}`));
}
/** Tutorial 7, passo 3: resumo do que vai para a skill e o botão que grava no workspace do agente. */
function renderObjectiveSkill(container: HTMLElement): void {
  const st = objectiveState;
  const box = el("div", "audio-controls");
  if (st?.objective !== null && st?.objective !== undefined && st.level !== null) {
    const lv = LEVEL_OPTIONS.find((l) => l.id === st.level);
    box.append(el("div", "hint", `🎯 ${st.objective.label}${st.objective.text !== "" ? `: ${st.objective.text}` : ""}`), el("div", "hint", `🔒 ${lv?.title ?? st.level}`));
  }
  const save = el("button", "btn btn-primary btn-small", objectiveBusy ? "Salvando…" : st?.savedAt === null || st?.savedAt === undefined ? "Salvar como skill no Acervo" : "Salvar de novo"); save.type = "button";
  save.disabled = objectiveBusy || st?.objective === null || st?.level === null;
  save.addEventListener("click", () => { void objectiveDo(async () => { const r = await window.meuBot.saveObjectiveSkill(); objectiveMsg = { text: r.detail, bad: false }; return r; }, "skill salva"); });
  const row = el("div", "support-name"); row.append(save);
  if (st?.savedAt !== null && st?.savedAt !== undefined) {
    const open = el("button", "btn btn-ghost btn-small", "Abrir o Acervo"); open.type = "button";
    open.addEventListener("click", () => openPage(acervoPage));
    row.append(open);
  }
  box.append(row);
  if (objectiveMsg !== null) box.append(el("p", `hint${objectiveMsg.bad ? " bad" : " ok"}`, `${objectiveMsg.bad ? "✗" : "✓"} ${objectiveMsg.text}`));
  container.append(box);
}
/**
 * Passo "Escolher primário e reserva" (tutorial 5): a mesma escolha de Configurações › Fallback, salva na hora
 * (o modelo padrão desta máquina muda), com a linha da corrente e o estado das duas contas.
 */
function renderFallbackOrder(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const accounts = el("div", "sl-switches");
  const line = (ok: boolean | null, text: string): HTMLElement => el("div", `hint${ok === true ? " ok" : ok === false ? " bad" : ""}`, `${ok === true ? "✓" : ok === false ? "✗" : "•"} ${text}`);
  accounts.append(
    line(clAuth?.loggedIn ?? null, `Claude Code${clAuth?.email ? `: ${clAuth.email}` : ""} → modelo agente`),
    line(xaiAuth?.loggedIn ?? null, `xAI${xaiAuth?.email ? `: ${xaiAuth.email}` : ""} → modelo grok-4`),
  );
  const label = el("label", "", "Primário nesta máquina ");
  const sel = el("select");
  for (const [value, text] of [["claude", "Claude (agente)"], ["xai", "xAI (grok-4)"]] as const) { const o = el("option", "", text); o.value = value; sel.append(o); }
  const cur = backendModelSelect.value;
  if (cur === "grok-4") sel.value = "xai"; else if (cur === "agente") sel.value = "claude"; else { const o = el("option", "", `outro (${cur || "sem modelo"}): fora da corrente`); o.value = "other"; o.disabled = true; sel.append(o); sel.value = "other"; }
  label.append(sel);
  const hint = el("p", "hint", fallbackOrderText(cur, account?.providers ?? null));
  sel.addEventListener("change", () => {
    const m = PRIMARY_OF[sel.value];
    if (m === undefined) return;
    sel.disabled = true;
    void window.meuBot.setSettings({ backendModelForHost: m }).then((view) => {
      applySettings(view); backendModelSelect.value = m; syncPrimaryFromModel(); paintFallbackOrder();
      saveGuideFlag(FALLBACK_TUTORIAL, "fallbackChosen"); paintGuide();
    }).catch((err: unknown) => { hint.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { sel.disabled = false; });
  });
  const keep = el("button", "btn btn-small", "Manter assim"); keep.type = "button";
  keep.title = "A escolha atual já serve: o primário fica como está";
  keep.hidden = !FALLBACK_PRIMARIES.includes(cur) || loadGuideFlags(FALLBACK_TUTORIAL).fallbackChosen;
  keep.addEventListener("click", () => { saveGuideFlag(FALLBACK_TUTORIAL, "fallbackChosen"); paintGuide(); });
  box.append(accounts, label, hint, keep);
  container.append(box);
}
async function refreshGuarda(): Promise<void> {
  if (!caps.install || windowHost === "" || windowHost === "local") return;
  try { guardaState = await window.meuBot.guardaInstalled(); } catch { /* máquina fora: fica o que havia */ }
  paintGuide();
}
window.meuBot.on("guarda:progress", ({ line }) => { guardaLog = [...guardaLog, line].slice(-6); if (guardaBusy) paintGuide(); });
function renderGuardaInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  if (guardaState === true && !guardaBusy) row.append(el("span", "audio-ok", "✓ ativa nesta máquina"));
  const b = el("button", `btn ${guardaState === true ? "btn-ghost" : "btn-primary"} btn-small`, guardaBusy ? "Ativando…" : guardaState === true ? "Reinstalar" : "Ativar");
  b.type = "button"; b.disabled = guardaBusy || guardaState === null;
  b.addEventListener("click", () => {
    guardaBusy = true; guardaLog = []; guardaMsg = null; paintGuide();
    void window.meuBot.installGuarda()
      .then((r) => { guardaMsg = r.ok ? { text: "Guarda ativa.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { guardaMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { guardaBusy = false; void refreshGuarda(); });
  });
  row.append(b);
  box.append(row);
  if (guardaState === null) box.append(el("p", "hint", waStatus?.gateway === "openclaw" || waStatus === null ? "Consultando a máquina…" : "Esta máquina não roda o OpenClaw; a guarda é do agente do WhatsApp dele."));
  if (guardaBusy && guardaLog.length > 0) box.append(el("pre", "admin-logs", guardaLog.join("\n")));
  if (guardaMsg !== null) box.append(el("p", `hint ${guardaMsg.bad ? "guide-pair-note" : "audio-ok"}`, guardaMsg.text));
  container.append(box);
}
async function refreshStatusLine(): Promise<void> {
  if (!caps.install || windowHost === "") return;
  try { statusLineState = await window.meuBot.statusLineInstalled(); } catch { /* máquina fora: fica o que havia */ }
  try { statusLineSegs = await window.meuBot.statusLineSegments(); } catch { /* idem */ }
  paintContext(active());
  paintGuide();
}
const SEGMENT_LABELS: { key: keyof StatusLineSegments; label: string; hint: string }[] = [
  { key: "model", label: "Modelo", hint: "qual modelo está respondendo" },
  { key: "ctx", label: "Contexto", hint: "quanto da janela de contexto já foi usado" },
  { key: "account", label: "Conta", hint: "e-mail e plano (Premium/Padrão)" },
  { key: "session", label: "Sessão", hint: "limite de 5 horas e quando reinicia" },
  { key: "weekly", label: "Semanal", hint: "limite de 7 dias e quando reinicia" },
];
/** Passo "Escolher o que aparece": cinco interruptores, prévia da linha, gravação na máquina a cada troca. */
function renderStatusLineSegments(container: HTMLElement): void {
  const cur: StatusLineSegments = statusLineSegs ?? { model: true, ctx: true, account: true, session: true, weekly: true };
  const box = el("div", "audio-controls");
  box.append(el("code", "sl-preview", previewLine(cur) || "(nada ligado)"));
  const list = el("div", "sl-switches");
  for (const s of SEGMENT_LABELS) {
    const sw = el("label", "switch switch-row"); sw.title = s.hint;
    const inp = el("input"); inp.type = "checkbox"; inp.checked = cur[s.key]; inp.disabled = statusLineSegsBusy || statusLineState !== true;
    sw.append(inp, el("span", "track"), el("span", "switch-label", s.label));
    inp.addEventListener("change", () => {
      const next = { ...cur, [s.key]: inp.checked };
      if (!Object.values(next).some(Boolean)) { inp.checked = true; statusLineSegsMsg = "Deixe pelo menos um ligado."; paintGuide(); return; }
      statusLineSegsBusy = true; statusLineSegsMsg = null; statusLineSegs = next; paintContext(active()); paintGuide();
      void window.meuBot.setStatusLineSegments(next)
        .then((saved) => { statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; paintContext(active()); paintGuide(); });
    });
    list.append(sw);
  }
  box.append(list);
  // Nunca gravou nada (está no padrão): o passo só conclui quando a escolha vai para a máquina. O botão
  // grava a escolha atual, mesmo que seja o padrão; pulsa para dizer "é aqui".
  if (statusLineSegs === null && statusLineState === true) {
    const done = el("button", "btn btn-primary btn-small attention", statusLineSegsBusy ? "Gravando…" : "Concluir com esta escolha"); done.type = "button"; done.disabled = statusLineSegsBusy;
    done.title = "Grava a escolha nesta máquina e conclui o passo";
    done.addEventListener("click", () => {
      statusLineSegsBusy = true; statusLineSegsMsg = null; paintGuide();
      void window.meuBot.setStatusLineSegments(cur)
        .then((saved) => { statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; paintContext(active()); paintGuide(); });
    });
    box.append(done);
  }
  if (statusLineState !== true) box.append(el("p", "hint", "Instale a status line (passo 1) para escolher."));
  if (statusLineSegsBusy) box.append(el("p", "hint", "gravando na máquina…"));
  if (statusLineSegsMsg !== null) box.append(el("p", "hint guide-pair-note", statusLineSegsMsg));
  container.append(box);
}
/** Passo "Conferir no terminal": digita o teste do script num terminal desta máquina; a pessoa dá Enter. */
function renderStatusLineTest(container: HTMLElement): void {
  const b = el("button", "btn btn-primary btn-small", "Testar no terminal"); b.type = "button";
  b.addEventListener("click", () => { void runInTerminal(SL_TEST_COMMAND, "bash", true); });
  container.append(b);
}
window.meuBot.on("statusline:progress", ({ line }) => {
  statusLineLog = [...statusLineLog, line].slice(-6);
  paintGuide();
});
/** Passo "Instalar a status line": Instalar (ou ✓ + Reinstalar), progresso do instalador e erro no próprio passo. */
function renderStatusLineInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  if (statusLineState === true && !statusLineBusy) row.append(el("span", "audio-ok", "✓ instalada nesta máquina"));
  const b = el("button", `btn ${statusLineState === true ? "btn-ghost" : "btn-primary"} btn-small`, statusLineBusy ? "Instalando…" : statusLineState === true ? "Reinstalar" : "Instalar");
  b.type = "button"; b.disabled = statusLineBusy || statusLineState === null;
  b.addEventListener("click", () => {
    statusLineBusy = true; statusLineLog = []; statusLineMsg = null; paintGuide();
    void window.meuBot.installStatusLine()
      .then((r) => { statusLineMsg = r.ok ? { text: "Status line instalada.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { statusLineMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { statusLineBusy = false; void refreshStatusLine(); });
  });
  row.append(b);
  box.append(row);
  if (statusLineState === null) box.append(el("p", "hint", "Consultando a máquina…"));
  if (statusLineBusy && statusLineLog.length > 0) box.append(el("pre", "admin-logs", statusLineLog.join("\n")));
  if (statusLineMsg !== null) box.append(el("p", `hint ${statusLineMsg.bad ? "guide-pair-note" : "audio-ok"}`, statusLineMsg.text));
  container.append(box);
}

async function refreshSupportState(): Promise<void> {
  if (windowHost === "" || windowHost === "local" || !caps.supportClient) return;
  try { supportState = await window.meuBot.supportInfo(); } catch { /* sem resposta: fica o que havia */ }
  repaintSupport();
  const s = supportState;
  if (s !== null && s.available && !s.on && !s.blockedByAdmin && !supportBusy && !supportAutoTried) {
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), "Suporte ligado. Avisando o admin…");
  } else if (s !== null && s.available && s.on && s.staleId && !supportBusy && !supportAutoTried) {
    // Código antigo na máquina (id só pela chave): regrava para esta conta não se misturar com outra na mesma máquina.
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), null);
  }
}
function paintSupport(): void {
  const s = supportState;
  supportGroup.hidden = s === null || !s.available;
  if (s === null || !s.available) return;
  supportBody.replaceChildren();
  supportBody.append(el("p", "hint", s.on
    ? `Ligado: o admin consegue entrar em ${hostLabel(windowHost)} para te ajudar. Tudo o que ele fizer aparece abaixo. Só o admin desliga.`
    : s.blockedByAdmin ? "Desligado pelo admin. Se quiser pedir suporte de novo, clique em Ligar o suporte."
      : "Ligando o suporte…"));
  renderSupportParts(supportBody, ["name", "share", "delivery", "log"]);
}
function repaintSupport(): void {
  if (dialog.open) paintSupport();
  paintGuide();
  // Ligado e o aviso ainda não chegou: confere de novo em 10 s (a máquina entrega sozinha).
  if (supportPoll !== null) { clearTimeout(supportPoll); supportPoll = null; }
  if (supportState?.on === true && supportState.deliveredAt === null) supportPoll = window.setTimeout(() => { supportPoll = null; void refreshSupportState(); }, 10_000);
}
async function supportDo(run: () => Promise<SupportInfo>, ok: string | null): Promise<void> {
  supportBusy = true; supportMsg = null; repaintSupport();
  try { supportState = await run(); supportMsg = ok === null ? null : { text: ok, bad: false }; }
  catch (err) { supportMsg = { text: ipcErrorText(err), bad: true }; }
  finally { supportBusy = false; repaintSupport(); }
}

type SupportPart = "name" | "share" | "delivery" | "log";
const SHOW_SUPPORT_SHARE = false;
function renderSupportParts(container: HTMLElement, parts: readonly SupportPart[]): void {
  const s = supportState;
  if (s === null || !s.available) return;
  if (parts.includes("name")) {
    const row = el("div", "support-name");
    // Vazio, já vem com a sugestão (git/usuário do Mac): salvar liga o suporte com um clique.
    const name = el("input"); name.type = "text"; name.placeholder = "Seu nome"; name.value = s.name !== "" ? s.name : s.suggestedName; name.maxLength = 40;
    name.disabled = supportBusy;
    const save = el("button", `btn ${s.on ? "btn-ghost" : "btn-primary"} btn-small`, s.on ? "Salvar nome" : "Ligar o suporte"); save.type = "button"; save.disabled = supportBusy;
    // Salvar o nome liga o suporte (ligado, só regrava o aviso com o nome novo). Não há interruptor para a pessoa
    // desligar: quem desliga é o admin, pela página Suporte.
    save.addEventListener("click", () => { void supportDo(() => window.meuBot.setSupport(true, name.value), s.on ? null : "Suporte ligado. Avisando o admin…"); });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save.click(); } });
    row.append(name, save);
    container.append(row, el("p", "hint", "É assim que o admin vai te ver (não é o nome da máquina)."));
  }
  // Escolha do que o admin vê: oculta por ora (poluía a tela); tudo segue compartilhado por padrão. SHOW_SUPPORT_SHARE religa.
  if (SHOW_SUPPORT_SHARE && parts.includes("share") && s.on) {
    container.append(el("p", "hint strong-hint", "O que o app do admin pode ver"));
    const SHARE_LABELS: { key: keyof SupportShare; label: string }[] = [
      { key: "progress", label: "Meu progresso nos tutoriais" },
      { key: "whatsapp", label: "O WhatsApp (estado e conversas, só leitura)" },
      { key: "logs", label: "Os registros do gateway e do backend" },
      { key: "chat", label: "Minhas conversas com o meu-bot (só leitura)" },
    ];
    const list = el("div", "support-share");
    for (const o of SHARE_LABELS) {
      const sw = el("label", "switch switch-row");
      const box = el("input"); box.type = "checkbox"; box.checked = s.share[o.key]; box.disabled = supportBusy;
      sw.append(box, el("span", "track"), el("span", "switch-label", o.label));
      box.addEventListener("change", () => { void supportDo(() => window.meuBot.setSupportShare({ ...s.share, [o.key]: box.checked }), null); });
      list.append(sw);
    }
    container.append(list);
  }
  if (parts.includes("delivery") && s.on) {
    const box = el("div", "support-delivery");
    // "Avisar o admin agora": entrega o aviso na hora e o admin sincroniza (a máquina também avisa sozinha a cada 30 min).
    const now = el("button", "btn btn-ghost btn-small", supportBusy ? "Avisando…" : "Avisar o admin agora"); now.type = "button"; now.disabled = supportBusy;
    now.addEventListener("click", () => { void supportDo(() => window.meuBot.supportDeliver(), "Aviso entregue: o admin já vê esta máquina."); });
    if (s.deliveredAt !== null) { const row = el("div", "support-name"); row.append(el("p", "audio-ok", `✓ O admin recebeu o aviso (${new Date(s.deliveredAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}).`), now); box.append(row); }
    else {
      const wait = el("div", "wa-progress"); wait.append(el("span", "wa-pulse"), el("span", "grow", "Avisando o admin…"), now);
      box.append(wait);
    }
    // O código de suporte, para colar no meu-bot-admin ("Adicionar pessoa") quando a entrega automática não serve.
    const more = el("details", "support-more");
    more.open = supportCodeShown !== null;
    more.append(el("summary", "", "Código de suporte (para colar no meu-bot-admin)"));
    if (supportCodeShown === null) {
      const reveal = el("button", "btn btn-ghost btn-small", "Mostrar código"); reveal.type = "button";
      reveal.addEventListener("click", () => {
        reveal.disabled = true; reveal.textContent = "Gerando…";
        void window.meuBot.supportCode().then((code) => { supportCodeShown = code; repaintSupport(); })
          .catch((err: unknown) => { supportMsg = { text: ipcErrorText(err), bad: true }; repaintSupport(); });
      });
      more.append(reveal);
    } else {
      const code = el("textarea"); code.readOnly = true; code.rows = 3; code.value = supportCodeShown;
      code.addEventListener("focus", () => code.select());
      const copy = el("button", "btn btn-primary btn-small", "Copiar"); copy.type = "button";
      copy.addEventListener("click", () => { void navigator.clipboard.writeText(supportCodeShown ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
      more.append(code, copy, el("p", "hint", "Mande para o admin (WhatsApp, e-mail); ele cola em \"Adicionar pessoa\" no meu-bot-admin. Não é senha: diz só como o admin chega nesta máquina."));
    }
    box.append(more);
    container.append(box);
  }
  if (supportMsg !== null) container.append(el("p", `hint ${supportMsg.bad ? "guide-pair-note" : "audio-ok"}`, supportMsg.text));
  if (parts.includes("log") && s.log.length > 0) {
    container.append(el("p", "hint strong-hint", "O que o suporte fez nesta máquina"));
    const ul = el("ul", "support-log");
    for (const e of s.log) ul.append(el("li", "", `${new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${e.who}: ${e.what}`));
    container.append(ul);
  }
}
/* ---------- Terminal: abas com xterm.js; o PTY roda na máquina da janela (pty-broker.py por ssh) ---------- */
type XTermCtor = typeof import("@xterm/xterm").Terminal;
/** A classe Terminal do xterm: o UMD no navegador expõe a classe direto; o tipo cobre também o namespace. */
const xtermClass = (): XTermCtor => (typeof window.Terminal === "function" ? window.Terminal : (window.Terminal as { Terminal: XTermCtor }).Terminal);
interface TermTab {
  page: PageTab;
  term: InstanceType<XTermCtor> | null;
  fit: InstanceType<typeof window.FitAddon.FitAddon> | null;
  search: InstanceType<typeof window.SearchAddon.SearchAddon> | null;
  box: HTMLElement;
  head: HTMLElement;
  bar: HTMLElement;
  id: string | null;          // sessão no main (null = ainda não abriu / encerrada)
  exited: { code: number; detail: string | null } | null;
  opening: boolean;
  n: number;
  resizeTimer: number | null;
}
const terminals = new Map<string, TermTab>();
let termCounter = 0;
const termAlive = (pageId: string): boolean => { const t = terminals.get(pageId); return t !== undefined && t.id !== null && t.exited === null; };
const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = (): boolean => document.documentElement.dataset["theme"] === "dark" || (document.documentElement.dataset["theme"] !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
const themeNow = (): Record<string, string> => xtermTheme({ bg: cssVar("--bg"), fg: cssVar("--fg"), muted: cssVar("--muted"), accent: cssVar("--accent"), dark: isDark() });
function rethemeTerminals(): void { for (const t of terminals.values()) if (t.term !== null) t.term.options.theme = themeNow(); }
function paintTerminalCount(): void {
  const n = [...terminals.values()].filter((t) => t.id !== null && t.exited === null).length;
  $<HTMLElement>("terminal-count").textContent = n === 0 ? "" : n === 1 ? "1 aberto" : `${n} abertos`;
}

/** Abre um terminal novo ("new"), ou foca o último vivo ("focus"; abre um se não há). Devolve a aba. */
async function openTerminalTab(mode: "new" | "focus" = "new"): Promise<TermTab | null> {
  if (mode === "focus") {
    const live = [...terminals.values()].filter((t) => t.exited === null && t.id !== null).at(-1);
    if (live !== undefined) { openPage(live.page); live.term?.focus(); return live; }
  }
  const n = ++termCounter;
  const pageId = `term-${n}`;
  const panel = el("section", "term-panel"); panel.hidden = true;
  const head = el("div", "term-head");
  const box = el("div", "term-box");
  const bar = el("div", "term-selbar"); bar.hidden = true;
  panel.append(head, box, bar);
  panelsEl.append(panel);
  const t: TermTab = { page: null as unknown as PageTab, term: null, fit: null, search: null, box, head, bar, id: null, exited: null, opening: false, n, resizeTimer: null };
  t.page = definePage(pageId, `Terminal ${n} · ${hostLabel(windowHost)}`, panel, () => renderTerminal(t));
  terminals.set(pageId, t);
  openPage(t.page);
  await connectTerminal(t);
  return t;
}

function renderTerminal(t: TermTab): void {
  if (t.term === null) {
    const Term = xtermClass();
    const term = new Term({ fontFamily: cssVar("--mono") || "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10_000, allowProposedApi: true, theme: themeNow(), macOptionIsMeta: false });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11";
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon((_ev: MouseEvent, uri: string) => { void window.meuBot.openExternal(uri); }));
    const search = new window.SearchAddon.SearchAddon(); term.loadAddon(search);
    term.open(t.box);
    try { const gl = new window.WebglAddon.WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl); } catch { /* fica no renderer DOM */ }
    // Cmd+K/N/B/W/J/F são do app; o resto (inclusive Ctrl+*) é do shell. Cmd+C sem seleção vira ^C.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.metaKey && ["k", "n", "b", "w", "j", "f"].includes(ev.key.toLowerCase())) { if (ev.key.toLowerCase() === "f" && ev.type === "keydown") { ev.preventDefault(); termSearch(t); } return false; }
      return true;
    });
    term.onData((d) => { if (t.id !== null) window.meuBot.termInput(t.id, d); });
    term.onBinary((d) => { if (t.id !== null) window.meuBot.termInput(t.id, Uint8Array.from(d, (c) => c.charCodeAt(0))); });
    term.onResize(({ cols, rows }) => { if (t.id !== null) window.meuBot.termResize(t.id, cols, rows); });
    term.onSelectionChange(() => { const sel = term.getSelection(); t.bar.hidden = sel.trim() === ""; });
    t.term = term; t.fit = fit; t.search = search;
    new ResizeObserver(() => {
      if (t.resizeTimer !== null) clearTimeout(t.resizeTimer);
      t.resizeTimer = window.setTimeout(() => { t.resizeTimer = null; if (!t.page.panel.hidden) t.fit?.fit(); }, 60);
    }).observe(t.box);
    // Barra de seleção: Copiar / Perguntar ao agente (pré-preenche o compositor; nada é enviado sozinho).
    const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
    copy.addEventListener("click", () => { void navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); term.focus(); });
    const ask = el("button", "btn btn-primary btn-small", "Perguntar ao agente"); ask.type = "button";
    ask.addEventListener("click", () => { void askAgentAbout(term.getSelection()); term.clearSelection(); });
    t.bar.append(copy, ask);
  }
  paintTermHead(t);
  requestAnimationFrame(() => { t.fit?.fit(); t.term?.focus(); });
}

function paintTermHead(t: TermTab): void {
  t.head.replaceChildren();
  t.head.append(el("span", "term-where", `${hostLabel(windowHost)}${windowHost === "local" ? " · shell deste Mac" : " · shell por SSH"}`));
  if (t.opening) t.head.append(el("span", "hint", "conectando…"));
  if (t.exited !== null) {
    t.head.append(el("span", "term-exit", `sessão encerrada (código ${t.exited.code})${t.exited.detail !== null ? ` · ${t.exited.detail}` : ""}`));
    const again = el("button", "btn btn-primary btn-small", "Reconectar"); again.type = "button";
    again.addEventListener("click", () => { t.term?.reset(); void connectTerminal(t); });
    t.head.append(again);
  }
  const spacer = el("span", "spacer"); t.head.append(spacer);
  const find = el("button", "btn btn-ghost btn-small", "Buscar"); find.type = "button"; find.title = "Buscar no terminal (Cmd+F)";
  find.addEventListener("click", () => termSearch(t));
  const toChat = el("button", "btn btn-ghost btn-small", "Últimas linhas → conversa"); toChat.type = "button"; toChat.title = "Leva as últimas 50 linhas do terminal para o compositor da conversa";
  toChat.addEventListener("click", () => { void askAgentAbout(lastTermLines(t, 50)); });
  t.head.append(find, toChat);
}

async function connectTerminal(t: TermTab): Promise<void> {
  if (t.opening) return;
  t.opening = true; t.exited = null; t.id = null; paintTermHead(t);
  try {
    t.fit?.fit();
    const { id } = await window.meuBot.termOpen(t.term?.cols ?? 80, t.term?.rows ?? 24);
    t.id = id;
  } catch (err) {
    t.exited = { code: -1, detail: ipcErrorText(err) };
  } finally { t.opening = false; paintTermHead(t); paintTerminalCount(); t.term?.focus(); }
}

function disposeTerminal(pageId: string): void {
  const t = terminals.get(pageId);
  if (t === undefined) return;
  if (t.id !== null && t.exited === null) void window.meuBot.termClose(t.id);
  t.term?.dispose();
  t.page.panel.remove();
  terminals.delete(pageId);
  paintTerminalCount();
}

function termSearch(t: TermTab): void {
  const q = window.prompt("Buscar no terminal:", "");
  if (q === null || q === "" || t.search === null) return;
  t.search.findNext(q, { caseSensitive: false, incremental: false });
}

/** Últimas `n` linhas não vazias do buffer do terminal, como texto. */
function lastTermLines(t: TermTab, n: number): string {
  const term = t.term; if (term === null) return "";
  const buf = term.buffer.active; const lines: string[] = [];
  for (let i = buf.length - 1; i >= 0 && lines.length < n; i--) { const l = buf.getLine(i)?.translateToString(true) ?? ""; if (l.trim() !== "" || lines.length > 0) lines.unshift(l); }
  return lines.join("\n").trim();
}

/** Integração A: o trecho vai para o compositor da conversa (atual ou nova) em bloco de código; a pessoa escreve a pergunta e envia. */
/** Volta à conversa: a que estava aberta antes da página, senão a última aba; sem nenhuma, cria uma. */
async function backToChat(): Promise<Tab | null> {
  const cur = active();
  if (cur !== null) return cur;
  const back = pagePrev !== null && tabs.has(pagePrev) ? pagePrev : [...tabs.keys()].at(-1);
  if (back !== undefined) { activate(back); return active(); }
  return newTab();
}

/**
 * Passo "Ver os limites na conversa" do tutorial da status line: leva à conversa com uma mensagem pronta no
 * compositor (nada é enviado sozinho) e diz onde olhar. O passo se conclui sozinho quando a conta traz os limites.
 */
async function goToChatFromGuide(message: string, hint: string, model?: BackendModel): Promise<void> {
  const tab = await backToChat();
  if (tab === null) return;
  // Tutorial 4: a conversa passa a usar o grok-4 (o backend recebe a nota de troca de modelo, como pela paleta).
  if (model !== undefined && tab.model !== model) { if (!prefersReducedMotion) showModeToast(model); setTabModel(tab, model); void window.meuBot.setConversationModel(tab.id, model); }
  if (inputEl.value.trim() === "") inputEl.value = message;
  addNotice(tab, `Vou enviar em 3, 2, 1 para você ver acontecendo (digitar ou Esc cancela; Enviar manda já). ${hint}`);
  inputEl.focus(); inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  syncComposer();
  if (!tab.busy) startAutoSend(tab);
}

/**
 * Contagem regressiva no botão Enviar ("Enviando em 3 → 2 → 1") e envio sozinho, para a pessoa ver o fluxo
 * acontecer. Qualquer gesto dela manda: digitar ou Esc cancela, clicar em Enviar manda na hora; trocar de
 * aba ou esvaziar o compositor também cancela.
 */
function startAutoSend(tab: Tab): void {
  cancelAutoSend();
  let n = 3;
  const paint = (): void => { sendBtn.textContent = `Enviando em ${n}`; sendBtn.classList.add("countdown"); sendBtn.classList.remove("shine"); };
  paint();
  const timer = window.setInterval(() => {
    if (active() !== tab || tab.busy || inputEl.value.trim() === "") { cancelAutoSend(); return; }
    n -= 1;
    if (n > 0) { paint(); return; }
    cancelAutoSend();
    void sendMessage();
  }, 1000);
  autoSend = { timer, tab };
}
function cancelAutoSend(): void {
  if (autoSend === null) return;
  window.clearInterval(autoSend.timer);
  autoSend = null;
  sendBtn.classList.remove("countdown");
  syncComposer();
}

async function askAgentAbout(text: string): Promise<void> {
  const trecho = text.replace(/\s+$/, "");
  if (trecho === "") return;
  const tab = await backToChat();
  if (tab === null) return;
  const cur = inputEl.value.trim();
  const fence = "```";
  inputEl.value = `${cur === "" ? "" : `${cur}\n\n`}Sobre esta saída do terminal:\n\n${fence}\n${trecho}\n${fence}\n\n`;
  inputEl.focus(); inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  syncComposer();
}

/**
 * Integração B: "Rodar no terminal" digita o comando (bracketed paste) num terminal desta máquina. Por
 * padrão sem Enter (a pessoa confirma); `enter` só para comandos do próprio app, inofensivos e conhecidos.
 */
async function runInTerminal(code: string, lang: string, enter = false): Promise<void> {
  const t = await openTerminalTab("focus");
  if (t === null || t.id === null) return;
  window.meuBot.termInput(t.id, shellBlockToPaste(code, lang));
  if (enter) window.meuBot.termInput(t.id, "\r");
  t.term?.focus();
}

window.meuBot.on("term:data", ({ id, data }) => {
  for (const t of terminals.values()) if (t.id === id) { t.term?.write(data); return; }
});
window.meuBot.on("term:exit", ({ id, code, detail }) => {
  for (const t of terminals.values()) if (t.id === id) { t.exited = { code, detail }; paintTermHead(t); paintTerminalCount(); return; }
});
$<HTMLButtonElement>("terminal-line").addEventListener("click", () => { void openTerminalTab("focus"); });

/* ---------- Atividade do agente: o que o modo agente roda (chat:tool), na conversa e numa aba só leitura ---------- */
let activity: { page: PageTab; term: InstanceType<XTermCtor> | null; fit: InstanceType<typeof window.FitAddon.FitAddon> | null; box: HTMLElement; pending: string[] } | null = null;
function activityPage(): PageTab {
  if (activity !== null) return activity.page;
  const panel = el("section", "term-panel"); panel.hidden = true;
  const head = el("div", "term-head");
  head.append(el("span", "term-where", `${hostLabel(windowHost)} · atividade do agente`), el("span", "hint", "só leitura: cada ferramenta que o modo agente usa aparece aqui ao vivo"));
  const box = el("div", "term-box");
  panel.append(head, box);
  panelsEl.append(panel);
  const a = { page: null as unknown as PageTab, term: null as InstanceType<XTermCtor> | null, fit: null as InstanceType<typeof window.FitAddon.FitAddon> | null, box, pending: [] as string[] };
  a.page = definePage("atividade", `Agente · atividade`, panel, () => {
    if (a.term === null) {
      const Term = xtermClass();
      const term = new Term({ fontFamily: cssVar("--mono") || "ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.2, scrollback: 20_000, disableStdin: true, cursorBlink: false, cursorStyle: "underline", theme: themeNow(), allowProposedApi: true });
      const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit);
      term.loadAddon(new window.WebLinksAddon.WebLinksAddon((_ev: MouseEvent, uri: string) => { void window.meuBot.openExternal(uri); }));
      term.open(box);
      a.term = term; a.fit = fit;
      new ResizeObserver(() => { if (!panel.hidden) fit.fit(); }).observe(box);
      for (const line of a.pending.splice(0)) term.write(line);
    }
    requestAnimationFrame(() => a.fit?.fit());
  });
  activity = a;
  return a.page;
}
function activityWrite(text: string): void {
  const page = activityPage();
  if (page.tabEl === null) openPage(page, false); // a aba nasce atrás da conversa; a pessoa abre quando quiser
  if (activity!.term === null) activity!.pending.push(text); else activity!.term.write(text);
}
const ANSI = { dim: "\u001b[2m", bold: "\u001b[1m", yellow: "\u001b[33m", cyan: "\u001b[36m", red: "\u001b[31m", green: "\u001b[32m", reset: "\u001b[0m" };
/** Linha recolhível na conversa + eco na aba de atividade. */
function showTool(tab: Tab, tool: ToolEvent): void {
  const host = tab.currentAssistant ?? tab.messagesEl;
  if (tool.kind === "use") {
    const d = el("details", "tool-line");
    const s = el("summary"); s.append(el("span", "tool-name", tool.name === "Bash" ? "rodou" : tool.name), el("code", "", tool.summary || "(sem detalhes)"));
    d.append(s);
    d.dataset["tool"] = tool.name;
    (tab.currentAssistant === null ? tab.messagesEl : host).insertAdjacentElement(tab.currentAssistant === null ? "beforeend" : "beforebegin", d);
    const when = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    activityWrite(`\r\n${ANSI.dim}${when}${ANSI.reset} ${tool.name === "Bash" ? `${ANSI.bold}${ANSI.yellow}$ ${tool.summary}` : `${ANSI.cyan}• ${tool.name} ${tool.summary}`}${ANSI.reset}\r\n`);
  } else {
    const lines = [...tab.messagesEl.querySelectorAll<HTMLDetailsElement>(".tool-line")];
    const target = [...lines].reverse().find((d) => !d.classList.contains("done") && (tool.name === null || d.dataset["tool"] === tool.name));
    if (target !== undefined) {
      target.classList.add("done", tool.ok ? "ok" : "bad");
      if (tool.text.trim() !== "") target.append(el("pre", "tool-result", tool.text));
    }
    if (tool.text.trim() !== "") activityWrite(`${tool.ok ? "" : ANSI.red}${tool.text.replace(/\n/g, "\r\n")}${ANSI.reset}\r\n`);
  }
  scrollToBottom(tab, false);
}
window.meuBot.on("chat:tool", ({ conversationId, tool }) => { const tab = tabs.get(conversationId); if (tab !== undefined) showTool(tab, tool); });

function openSettings(): void {
  if (dialog.open) return;
  paintSupport(); void refreshSupportState(); void loadAlertPrefs();
  void window.meuBot.updateState().then(paintUpdateState).catch(() => undefined);
  syncPrimaryFromModel();
  paintFallbackOrder();
  settingsError.hidden = true;
  for (const g of settingsGroups) g.open = false;
  void window.meuBot.getMemory().then(applyMemory);
  dialog.showModal();
}
settingsBtn.addEventListener("click", () => openSettings());
window.meuBot.on("ui:toggle-settings", () => { if (dialog.open) dialog.close(); else openSettings(); });

/* ---------- Internet deste Mac: faixa OFFLINE (como no Rambox), para a pessoa saber que o problema é na conexão dela ---------- */
const offlineBar = $<HTMLElement>("offline-bar");
const offlineText = $<HTMLElement>("offline-text");
const offlineCheck = $<HTMLButtonElement>("offline-check");
let net: NetState = { online: null, checking: false, since: null, checkedAt: null };
/** A máquina desta janela é este próprio Mac (colima): sem internet o túnel segue, só o Claude não responde. */
let hostLocalAddr = false;
/** Última vez que a pessoa clicou em "Verificar agora" (a faixa diz "ainda sem internet (verificado agora)"). */
let netManualAt: number | null = null;
let netTick: ReturnType<typeof setInterval> | null = null;
function paintNet(): void {
  const off = net.online === false;
  offlineBar.hidden = !off;
  if (off) {
    offlineText.textContent = offlineBarText({ localAddr: hostLocalAddr, checking: net.checking, since: net.since, checkedAt: net.checkedAt, manual: netManualAt !== null && net.checkedAt !== null && net.checkedAt >= netManualAt, now: Date.now() });
    offlineCheck.disabled = net.checking;
    offlineCheck.textContent = net.checking ? "verificando…" : "Verificar agora";
  }
  // "há N min" precisa andar enquanto a faixa está à vista; online, nenhum timer.
  if (off && netTick === null) netTick = setInterval(paintNet, 30_000);
  if (!off && netTick !== null) { clearInterval(netTick); netTick = null; }
  const tab = active();
  paintStatus(tab !== null ? tab.host : null);
}
function setNet(st: NetState): void {
  const was = net.online;
  net = st;
  paintNet();
  if (was === false && st.online === true) {
    netManualAt = null;
    const tab = active();
    if (tab !== null) addNotice(tab, hostLocalAddr ? "✓ internet de volta; o Claude já responde de novo." : "✓ internet de volta; reabrindo o túnel da máquina…", "info");
  }
}
window.meuBot.on("net:state", setNet);
// A interface de rede caiu/voltou (Wi-Fi desligado): reação imediata; a sondagem do main confirma.
window.addEventListener("offline", () => { void window.meuBot.netCheck(true).then(setNet).catch(() => { /* a sondagem periódica cobre */ }); });
window.addEventListener("online", () => { void window.meuBot.netCheck(true).then(setNet).catch(() => { /* idem */ }); });
offlineCheck.addEventListener("click", () => {
  netManualAt = Date.now(); offlineCheck.disabled = true; offlineCheck.textContent = "verificando…";
  void window.meuBot.netCheck(true).then(setNet).catch(() => { offlineCheck.disabled = false; offlineCheck.textContent = "Verificar agora"; });
});

/* ---------- Atualização automática: a faixa só aparece com a versão nova já pronta ---------- */
const updateBar = $<HTMLElement>("update-bar");
const updateText = $<HTMLElement>("update-text");
const updateApply = $<HTMLButtonElement>("update-apply");
function showUpdateReady(version: string): void {
  updateText.textContent = `${caps.variant === "admin" ? "meu-bot-admin" : "meu-bot"} ${version} pronto para instalar (você está na ${appVersion}).`;
  updateBar.hidden = false;
}
/* ---------- Verificação visível (REA do Rambox): ponto na barra ao abrir + "Sobre e atualização" nas Configurações ---------- */
const updateCheckDot = $<HTMLElement>("update-check-dot");
const aboutVersion = $<HTMLElement>("about-version");
const aboutSum = $<HTMLElement>("about-sum");
const updateLine = $<HTMLElement>("update-line");
const updateCheckBtn = $<HTMLButtonElement>("update-check-btn");
const updateNotesBtn = $<HTMLButtonElement>("update-notes-btn");
const updateApply2 = $<HTMLButtonElement>("update-apply-2");
function paintUpdateState(u: UpdateState): void {
  const name = caps.variant === "admin" ? "meu-bot-admin" : "meu-bot";
  const t = updateStateText(u, name);
  updateCheckDot.hidden = u.phase !== "checking";
  aboutVersion.textContent = `${name} ${u.current} · Apple Silicon`;
  aboutSum.textContent = `versão ${u.current}`;
  updateLine.textContent = t.text;
  updateLine.className = `update-line ${t.kind === "muted" ? "" : t.kind}`.trim();
  updateCheckBtn.disabled = u.phase === "checking" || u.phase === "idle";
  updateApply2.hidden = !t.showApply;
  if (u.phase === "ready" && u.ready !== null) showUpdateReady(u.ready);
}
updateCheckBtn.addEventListener("click", () => { updateCheckBtn.disabled = true; void window.meuBot.checkUpdate().then(paintUpdateState).catch(() => { updateCheckBtn.disabled = false; }); });
updateNotesBtn.addEventListener("click", () => { void window.meuBot.openExternal("https://github.com/diegofornalha/meu-bot/releases"); });
updateApply2.addEventListener("click", () => { updateApply2.disabled = true; void window.meuBot.applyUpdate().catch((err: unknown) => { updateApply2.disabled = false; updateLine.textContent = `Não consegui atualizar: ${ipcErrorText(err)}`; updateLine.className = "update-line bad"; }); });
window.meuBot.on("update:state", paintUpdateState);

/* ---------- Notificação de teste (REA do Rambox) e pedido no momento certo ---------- */
const notifyTestBtn = $<HTMLButtonElement>("notify-test-btn");
const notifyTestQ = $<HTMLElement>("notify-test-q");
function sendTestNotification(): void {
  notifyTestQ.hidden = true;
  void window.meuBot.notifyTest().then(() => { notifyTestQ.hidden = false; }).catch((err: unknown) => { settingsError.textContent = ipcErrorText(err); settingsError.hidden = false; });
}
notifyTestBtn.addEventListener("click", sendTestNotification);
$<HTMLButtonElement>("notify-yes").addEventListener("click", () => { notifyTestQ.hidden = true; try { localStorage.setItem("notif:ok", "1"); } catch { /* opcional */ } });
$<HTMLButtonElement>("notify-no").addEventListener("click", () => { void window.meuBot.openExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension"); });
/** Primeira notificação desta instalação no momento certo (WhatsApp pareado e testado): o macOS pede a permissão junto. */
function maybeAskNotificationsOnce(): void {
  if (!caps.chat || settings?.notifications !== true) return;
  try { if (localStorage.getItem("notif:asked") === "1") return; localStorage.setItem("notif:asked", "1"); } catch { return; }
  void window.meuBot.notifyTest().catch(() => undefined);
}

/* ---------- Segurança (REA do Rambox): aviso quando um Mac novo usar o meu-bot desta máquina ---------- */
const alertsGroup = $<HTMLElement>("alerts-group");
const alertWa = $<HTMLInputElement>("alert-wa");
const alertEmail = $<HTMLInputElement>("alert-email");
const alertsHint = $<HTMLElement>("alerts-hint");
let alertPrefsLoaded: { whatsapp: boolean; email: string } | null = null;
/**
 * Painel "Conta" (lado da pessoa): plano, status, membro desde, ciclo e os devices da conta, só leitura, como as
 * telas de billing do Rambox. Quem muda isso é o admin (pela página Suporte). Montado dinâmico antes dos avisos.
 */
async function loadLicensePanel(): Promise<void> {
  if (!caps.chat || windowHost === "local") return;
  let box = document.getElementById("license-panel");
  if (box === null) { box = el("div", "settings-group"); box.id = "license-panel"; alertsGroup.parentElement?.insertBefore(box, alertsGroup); }
  box.replaceChildren(el("p", "hint strong-hint", "Sua conta"));
  let view: Awaited<ReturnType<typeof window.meuBot.getLicense>> = null;
  try { view = await window.meuBot.getLicense(); } catch { /* backend antigo/fora do ar */ }
  if (view === null) { box.append(el("p", "hint", "A máquina ainda não tem o backend novo: reinstale o backend para ver o plano e os devices.")); return; }
  const ul = el("ul", "admin-health");
  for (const l of licenseSummary(view)) ul.append(el("li", l.ok === null ? "" : l.ok ? "ok" : "bad", l.text));
  box.append(ul);
  box.append(el("p", "hint strong-hint", "Seus devices"));
  const devs = el("ul", "admin-health");
  for (const d of view.devices) { const dl = deviceLine(d); devs.append(el("li", d.status === "pending" ? "bad" : "ok", d.status === "pending" ? `${dl.text} · pedido enviado ao admin` : dl.text)); }
  if (view.devices.length === 0) devs.append(el("li", "", "Nenhum device ainda."));
  box.append(devs);
}
async function loadAlertPrefs(): Promise<void> {
  void loadLicensePanel();
  if (!caps.chat || windowHost === "local") { alertsGroup.hidden = true; return; }
  alertsGroup.hidden = false;
  try {
    alertPrefsLoaded = await window.meuBot.alertPrefs();
    if (alertPrefsLoaded === null) { alertsHint.textContent = "A máquina ainda não tem o backend novo: reinstale o backend para ligar os avisos."; alertWa.disabled = true; alertEmail.disabled = true; return; }
    alertWa.disabled = false; alertEmail.disabled = false;
    alertWa.checked = alertPrefsLoaded.whatsapp; alertEmail.value = alertPrefsLoaded.email;
    alertsHint.textContent = "O e-mail precisa de RESEND_API_KEY no .env do backend da máquina; o WhatsApp usa o seu próprio número já pareado.";
  } catch (err) { alertsHint.textContent = `Não consegui ler: ${ipcErrorText(err)}`; }
}
async function saveAlertPrefs(): Promise<void> {
  if (alertsGroup.hidden || alertPrefsLoaded === null || alertWa.disabled) return;
  const next = { whatsapp: alertWa.checked, email: alertEmail.value.trim() };
  if (next.whatsapp === alertPrefsLoaded.whatsapp && next.email === alertPrefsLoaded.email) return;
  try { await window.meuBot.setAlertPrefs(next); alertPrefsLoaded = next; }
  catch (err) { const tab = active(); if (tab !== null) addNotice(tab, `Avisos de segurança: ${ipcErrorText(err)}`, "warn"); }
}
updateApply.addEventListener("click", () => {
  updateApply.disabled = true; updateApply.textContent = "Reiniciando…";
  void window.meuBot.applyUpdate().catch((err: unknown) => { updateApply.disabled = false; updateApply.textContent = "Reiniciar e atualizar"; updateText.textContent = `Não consegui atualizar: ${ipcErrorText(err)}`; });
});
window.meuBot.on("update:ready", ({ version }) => showUpdateReady(version));
void window.meuBot.updateState().then(paintUpdateState).catch(() => undefined);
window.meuBot.on("chat:notice", ({ conversationId, text }) => { const tab = tabs.get(conversationId); if (tab !== undefined) { addNotice(tab, text, "warn"); offerClaudeLogin(tab, text); } });
window.meuBot.on("chat:account", ({ host, status }) => {
  if (host !== windowHost) return;
  account = status;
  paintContext(active());
  paintFallbackOrder();
  checkSessionThreshold();
  paintGuide(); // o passo "Ver os limites no rodapé" se marca quando a conta traz números
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
    ...(openAtLoginInput.disabled ? {} : { openAtLogin: openAtLoginInput.checked }),
  };
  void saveAlertPrefs();
  window.meuBot.setSettings(update).then(
    (view) => {
      applySettings(view);
      dialog.close();
      const tab = active();
      if (tab !== null) addNotice(tab, "Configurações salvas.");
    },
    (err: unknown) => {
      settingsError.textContent = ipcErrorText(err);
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
  caps = info.caps;
  appVersion = info.version;
  // Faixa OFFLINE nos dois apps: estado atual da internet e se a máquina desta janela é este próprio Mac.
  void window.meuBot.netCheck().then(setNet).catch(() => { /* a próxima sondagem avisa */ });
  void window.meuBot.hostLocalAddr().then((v) => { hostLocalAddr = v; paintNet(); }).catch(() => { /* fica como remota */ });
  if (caps.supportAdmin) {
    // meu-bot-admin: espelho da máquina da pessoa (saúde, WhatsApp, registros) + ações de suporte. Sem compositor,
    // sem conversas com o agente, sem logins nem pareamento (o main nem registra esses canais no admin).
    document.body.classList.add("admin-mode");
    document.title = `${info.person ?? windowHost} · suporte`;
    document.documentElement.style.setProperty("--host-accent", hostAccent(windowHost));
    applySettings(await window.meuBot.getSettings());
    // O WhatsApp só entra se a pessoa compartilha: a saúde diz, e aí começa o ciclo normal de consulta.
    mountSuportePage({
      who: { host: windowHost, person: info.person, machine: info.machine }, adminVersion: info.version, panelsEl, definePage, openPage, armConfirm, fmtPhone, api: window.meuBot, cache: { read: cacheRead, write: cacheWrite },
      onWhatsapp: (st) => {
        if (st === null) { if (waTimer !== null) { clearTimeout(waTimer); waTimer = null; } waStatus = null; }
        else { waStatus = st; if (waTimer === null) void refreshWhatsapp(); }
        paintWhatsapp(); renderSidebar();
      },
    }).open();
    adminBotMirror = mountBotMirror({ panelsEl, definePage, openPage, closePage, armConfirm, activePage: () => pageActive, api: window.meuBot, onListChanged: () => renderSidebar(), machine: () => hostLabel(windowHost), copyReference, cache: { read: cacheRead, write: cacheWrite, drop: cacheDrop } });
    renderSidebar();
    tabsReady = true;
    return;
  }
  document.title = `meu-bot · ${hostLabel(windowHost)}`;
  document.documentElement.style.setProperty("--host-accent", hostAccent(windowHost));
  // Estado do WhatsApp da última vez: o modo WhatsApp e a lista em cache aparecem antes do SSH responder.
  { const c = cacheRead<WhatsappStatus>("waStatus"); if (c !== null && waStatus === null) { waStatus = c.value; paintListMode(); } }
  if (info.models.length > 0) hostModels.set(windowHost, info.models);
  applySettings(await window.meuBot.getSettings());
  void window.meuBot.getAccountStatus().then((s) => { account = s; paintContext(active()); paintFallbackOrder(); checkSessionThreshold(); paintGuide(); });
  void refreshStatusLine();
  void refreshWhatsapp();
  void refreshSupportState();
  void refreshObjective();
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
