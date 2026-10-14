import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ExportFormat, SettingsUpdate, TabMenuAction } from "../shared/ipc";
import { LOCAL_HOST } from "./localBackend";
import { conversationToMarkdown, conversationTitle, slugify } from "./export";
import { runBackendTurn } from "./backend";
import { closeTunnel, markSuspect, onTunnelState, revalidate } from "./tunnel";
import {
  anyConversationBusy, archiveConversation, branchConversation, closeTab, createConversation, dropConversation,
  duplicateConversation, getConversation, getStoredConversation, listConversationsForHost, loadConversations, openConversation,
  renameConversation, reorderConversations, setConversationModel,
} from "./conversation";
import { getBackendPort, getFontSize, getLastHost, getQuickEntry, getTheme, isBackendModel, loadSettings, setLastHost, setQuickEntryStatusProvider, settingsView, updateSettings } from "./settings";
import { applyQuickEntryShortcut, disposeQuickEntry, initQuickEntry, quickEntryStatus, toggleQuickEntry } from "./quickEntry";
import { getMemory, loadMemory, NOTAS_MAX, PERFIL_MAX, setMemory } from "./memory";
import { installAppMenu } from "./menu";
import { initPicker, knownModels, showPicker } from "./picker";
import { hostFromArgv, reliefHostFromArgv } from "./shortcuts";
import { initRelief, showRelief } from "./relief";
import { listSshHosts } from "./sshConfig";
import { broadcast, disposeWindows, getLastFocusedHost, hostOfWindow, lastFocusedWindow, openMainWindow, sendToHost, sendWhenLoaded } from "./windows";

// Uma instância só: abrir o app de novo (Dock, Finder, `open -a`) mostra o seletor de máquinas.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => openFromArgs(argv));
}

/** `--host=<x>` abre a janela da máquina direto (atalho da mesa); qualquer outra coisa abre o seletor. */
function openFromArgs(argv: readonly string[]): void {
  const relief = reliefHostFromArgv(argv);
  if (relief !== null) { showRelief(relief); return; }
  const host = hostFromArgv(argv);
  if (host === null) { showPicker(); return; }
  if (host !== LOCAL_HOST && !listSshHosts().includes(host)) { showPicker({ error: `A máquina "${host}" do atalho não está no ~/.ssh/config.`, preselect: host }); return; }
  setLastHost(host);
  openMainWindow(host, "shortcut");
}

const windowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender);

/** Janela registrada + máquina dela; null para remetentes que não são uma janela principal. */
const hostFromEvent = (event: Electron.IpcMainInvokeEvent): { win: BrowserWindow; host: string } | null => {
  const win = windowFromEvent(event);
  const host = win === null ? undefined : hostOfWindow(win);
  return win === null || host === undefined ? null : { win, host };
};

const EXTERNAL_URL = /^https?:\/\/[^\s]{1,2048}$/;

/** Conversa do payload, só se for da máquina da janela que pediu. */
const ownedConversation = (event: Electron.IpcMainInvokeEvent, payload: unknown) => {
  const ctx = hostFromEvent(event);
  const id = (payload as { conversationId?: unknown })?.conversationId;
  if (ctx === null || typeof id !== "string") return null;
  const conv = getConversation(id);
  return conv !== undefined && conv.host === ctx.host ? { win: ctx.win, host: ctx.host, conv } : null;
};

function registerIpc(): void {
  ipcMain.handle("window:info", (event) => {
    const ctx = hostFromEvent(event);
    return ctx === null ? null : { host: ctx.host, models: knownModels(ctx.host) };
  });
  ipcMain.handle("ui:open-picker", () => showPicker());
  ipcMain.handle("settings:get", (event) => settingsView(hostFromEvent(event)?.host));

  ipcMain.handle("settings:set", (event, update: unknown) => {
    const host = hostFromEvent(event)?.host;
    const u = (update ?? {}) as SettingsUpdate;
    const clean: SettingsUpdate = {
      ...(typeof u.backendModel === "string" ? { backendModel: u.backendModel } : {}),
      ...(typeof u.backendModelForHost === "string" ? { backendModelForHost: u.backendModelForHost } : {}),
      ...(typeof u.backendPort === "number" ? { backendPort: u.backendPort } : {}),
      ...(typeof u.fontSize === "number" ? { fontSize: u.fontSize } : {}),
      ...(typeof u.theme === "string" ? { theme: u.theme } : {}),
      ...(typeof u.notifications === "boolean" ? { notifications: u.notifications } : {}),
      ...(typeof u.contextBudgetTokens === "number" ? { contextBudgetTokens: u.contextBudgetTokens } : {}),
      ...(typeof u.memoryEveryTurns === "number" ? { memoryEveryTurns: u.memoryEveryTurns } : {}),
      ...(typeof u.quickEntryEnabled === "boolean" ? { quickEntryEnabled: u.quickEntryEnabled } : {}),
      ...(typeof u.quickEntryShortcut === "string" ? { quickEntryShortcut: u.quickEntryShortcut } : {}),
    };
    // Porta nova atinge todos os túneis, o que cortaria uma resposta em andamento; recusa até ficar ocioso.
    const portChanges = clean.backendPort !== undefined && clean.backendPort !== getBackendPort();
    if (portChanges && anyConversationBusy()) {
      throw new Error("Há uma resposta em andamento. Espere terminar antes de trocar a porta.");
    }
    const view = updateSettings(clean, host);
    const qe = getQuickEntry();
    applyQuickEntryShortcut(qe.enabled, qe.shortcut);
    nativeTheme.themeSource = view.theme;
    if (portChanges) closeTunnel();
    // Outras janelas (fonte, tema, notificações…): cada uma recebe a visão com o modelo da sua máquina.
    broadcast("settings:changed", settingsView());
    return view;
  });

  const memoryView = () => ({ ...getMemory(), limits: { notas: NOTAS_MAX, perfil: PERFIL_MAX } });
  ipcMain.handle("memory:get", () => memoryView());
  ipcMain.handle("memory:set", (_event, payload: unknown) => {
    const p = (payload ?? {}) as { notas?: unknown; perfil?: unknown };
    setMemory({
      ...(typeof p.notas === "string" ? { notas: p.notas } : {}),
      ...(typeof p.perfil === "string" ? { perfil: p.perfil } : {}),
    });
    const view = memoryView();
    broadcast("memory:changed", view);
    return view;
  });

  ipcMain.handle("ui:quick-toggle", () => toggleQuickEntry());

  ipcMain.handle("shell:open-external", (_event, payload: unknown) => {
    const url = (payload as { url?: unknown })?.url;
    if (typeof url === "string" && EXTERNAL_URL.test(url)) void shell.openExternal(url);
  });

  ipcMain.handle("chat:send", async (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const p = payload as { conversationId?: unknown; text?: unknown };
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    const conv = typeof p?.conversationId === "string" ? getConversation(p.conversationId) : undefined;
    if (ctx === null || text === "" || conv === undefined || conv.host !== ctx.host) return;
    if (conv.busy) {
      ctx.win.webContents.send("chat:error", { conversationId: conv.id, kind: "unknown", message: "Espere a resposta atual terminar." });
      return;
    }
    conv.busy = true;
    try {
      await runBackendTurn(conv, text);
    } finally {
      conv.busy = false;
    }
  });

  ipcMain.handle("chat:cancel", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    owned?.conv.abort?.abort();
  });

  ipcMain.handle("chat:new", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return { conversationId: "" };
    return { conversationId: createConversation(ctx.host).id };
  });

  ipcMain.handle("chat:list", (event) => {
    const ctx = hostFromEvent(event);
    return ctx === null ? [] : listConversationsForHost(ctx.host);
  });

  ipcMain.handle("chat:rename", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; title?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && typeof p?.title === "string") renameConversation(owned.conv.id, p.title);
  });

  ipcMain.handle("chat:set-model", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; model?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && isBackendModel(p?.model)) setConversationModel(owned.conv.id, p.model);
  });

  ipcMain.handle("chat:reorder", (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (ctx === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids, ctx.host);
  });

  // Fechar a aba mantém a conversa na lista lateral; excluir é explícito.
  ipcMain.handle("chat:close", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) closeTab(owned.conv.id);
  });
  ipcMain.handle("chat:delete", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) dropConversation(owned.conv.id);
  });
  ipcMain.handle("chat:open", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (openConversation(owned.conv.id) ?? null);
  });
  ipcMain.handle("chat:archive", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const archived = (payload as { archived?: unknown })?.archived === true;
    if (owned !== null) archiveConversation(owned.conv.id, archived);
  });
  ipcMain.handle("chat:duplicate", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (duplicateConversation(owned.conv.id) ?? null);
  });
  ipcMain.handle("chat:branch", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const index = (payload as { index?: unknown })?.index;
    return owned === null || typeof index !== "number" ? null : (branchConversation(owned.conv.id, index) ?? null);
  });

  ipcMain.handle("chat:export", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const format = (payload as { format?: unknown })?.format;
    if (owned === null || (format !== "md" && format !== "json")) return null;
    const stored = getStoredConversation(owned.conv.id);
    if (stored === undefined) return null;
    const ext: ExportFormat = format;
    const result = await dialog.showSaveDialog(owned.win, {
      title: "Exportar conversa",
      defaultPath: path.join(app.getPath("documents"), `${slugify(conversationTitle(stored))}.${ext}`),
      filters: ext === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    const body = ext === "md" ? conversationToMarkdown(stored) : `${JSON.stringify(stored, null, 2)}\n`;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });

  ipcMain.handle("ui:tab-menu", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return null;
    const state = (payload as { state?: { busy?: unknown; archived?: unknown } })?.state ?? {};
    const busy = state.busy === true;
    const archived = state.archived === true;
    return new Promise<TabMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: TabMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const item = (label: string, action: TabMenuAction, enabled = true): Electron.MenuItemConstructorOptions =>
        ({ label, enabled, click: () => pick(action) });
      const menu = Menu.buildFromTemplate([
        item("Renomear", "rename"),
        item("Duplicar", "duplicate", !busy),
        { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] },
        archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive", !busy),
        { type: "separator" },
        item("Fechar aba", "close"),
        item("Excluir conversa…", "delete", !busy),
      ]);
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: owned.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });

  const liveNotifications = new Set<Notification>();
  ipcMain.handle("ui:notify", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const p = payload as { title?: unknown; body?: unknown };
    if (owned === null || !Notification.isSupported()) return;
    const { host, conv } = owned;
    const n = new Notification({
      title: typeof p.title === "string" ? p.title.slice(0, 80) : "meu-bot",
      body: typeof p.body === "string" ? p.body.slice(0, 200) : "",
      silent: false,
    });
    liveNotifications.add(n);
    const done = (): void => { liveNotifications.delete(n); };
    n.on("click", () => {
      done();
      // A janela dona pode ter sido fechada: reabre a da máquina e foca a conversa quando ela carregar.
      const win = openMainWindow(host, "notify");
      app.focus({ steal: true });
      sendWhenLoaded(win, "ui:focus-conversation", { conversationId: conv.id });
    });
    n.on("close", done);
    n.show();
  });
}

app.whenReady().then(() => {
  loadSettings();
  nativeTheme.themeSource = getTheme();
  loadMemory();
  loadConversations();
  registerIpc();
  installAppMenu({ openPicker: () => showPicker() });
  initPicker();
  initRelief();
  setQuickEntryStatusProvider(quickEntryStatus);
  initQuickEntry({
    mainWindow: () => lastFocusedWindow() ?? openMainWindow(getLastFocusedHost() ?? getLastHost() ?? LOCAL_HOST, "quick"),
    fontSize: getFontSize,
    hostLabel: (win) => { const h = hostOfWindow(win) ?? "?"; return h === LOCAL_HOST ? "este Mac" : h; },
  });
  const qe = getQuickEntry();
  applyQuickEntryShortcut(qe.enabled, qe.shortcut);
  // Abertura: pelo seletor (Enter reabre a última máquina), ou direto na máquina de um atalho.
  openFromArgs(process.argv);
  // Clicar no app (Dock, Finder) abre sempre o seletor; para ir direto a uma máquina existe o atalho dela.
  app.on("activate", () => showPicker());

  // Estado do túnel de cada máquina vai para a janela dela.
  onTunnelState((host, state, detail) => {
    const mapped = state === "ready" ? "ready" : state === "error" ? "error" : state === "degraded" ? "degraded" : state === "connecting" ? "connecting" : "idle";
    sendToHost(host, "backend:status", { host, state: mapped, detail: state === "ready" ? "túnel ativo" : detail });
  });

  // O Mac dormiu/acordou: revalida os túneis antes de confiar neles.
  let resumeTimer: NodeJS.Timeout | null = null;
  const scheduleRevalidate = (): void => {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { resumeTimer = null; void revalidate(); }, 2000);
  };
  powerMonitor.on("suspend", () => markSuspect());
  powerMonitor.on("resume", scheduleRevalidate);
  powerMonitor.on("unlock-screen", scheduleRevalidate);
});

app.on("window-all-closed", () => {
  // No macOS o app fica no Dock; clicar nele reabre o seletor. Os túneis caem pela carência.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { disposeQuickEntry(); disposeWindows(); closeTunnel(); });
