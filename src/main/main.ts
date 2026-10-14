import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ExportFormat, SettingsUpdate, TabMenuAction } from "../shared/ipc";
import { installBackend, probeHost } from "./hostProbe";
import { LOCAL_HOST } from "./localBackend";
import { conversationToMarkdown, conversationTitle, slugify } from "./export";
import { runBackendTurn } from "./backend";
import { closeTunnel, markSuspect, onTunnelState, revalidate } from "./tunnel";
import {
  anyConversationBusy, archiveConversation, branchConversation, closeTab, createConversation, dropConversation,
  duplicateConversation, getConversation, listConversationsFor, loadConversations, openConversation, releaseWindow,
  renameConversation, reorderConversations, setConversationModel,
} from "./conversation";
import { getBackendPort, getFontSize, getQuickEntry, getTheme, isBackendModel, isValidHost, loadSettings, setQuickEntryStatusProvider, settingsView, updateSettings } from "./settings";
import { applyQuickEntryShortcut, disposeQuickEntry, initQuickEntry, quickEntryStatus, toggleQuickEntry } from "./quickEntry";
import { listSshHosts } from "./sshConfig";
import { getMemory, loadMemory, NOTAS_MAX, PERFIL_MAX, setMemory } from "./memory";

let mainWin: BrowserWindow | null = null;

const windowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender);

/** Cor de fundo igual ao --bg do CSS, para não piscar branco antes do primeiro paint. */
const backgroundColor = (): string => (nativeTheme.shouldUseDarkColors ? "#111317" : "#f5f6f8");

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "meu-bot",
    titleBarStyle: "hiddenInset",
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("closed", () => {
    releaseWindow(win.id);
    if (mainWin === win) mainWin = null;
  });
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWin = win;
  return win;
}

/** Janela principal viva, recriada se foi fechada (macOS mantém o app rodando). */
export function ensureMainWindow(): BrowserWindow {
  if (mainWin !== null && !mainWin.isDestroyed()) return mainWin;
  return createWindow();
}

const EXTERNAL_URL = /^https?:\/\/[^\s]{1,2048}$/;

/** Conversa do payload, só se pertencer à janela que pediu. */
const ownedConversation = (event: Electron.IpcMainInvokeEvent, payload: unknown) => {
  const win = windowFromEvent(event);
  const id = (payload as { conversationId?: unknown })?.conversationId;
  if (win === null || typeof id !== "string") return null;
  const conv = getConversation(id);
  return conv !== undefined && conv.windowId === win.id ? { win, conv } : null;
};

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settingsView());
  ipcMain.handle("settings:ssh-hosts", () => [LOCAL_HOST, ...listSshHosts()]);
  ipcMain.handle("settings:probe-host", (_event, payload: unknown) => {
    const host = String((payload as { host?: unknown } | null)?.host ?? "").trim();
    if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
    return probeHost(host, getBackendPort());
  });
  ipcMain.handle("settings:install-backend", (event, payload: unknown) => {
    const host = String((payload as { host?: unknown } | null)?.host ?? "").trim();
    if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
    const sender = event.sender;
    return installBackend(host, getBackendPort(), (line) => { if (!sender.isDestroyed()) sender.send("backend:install-progress", { host, line }); });
  });

  ipcMain.handle("settings:set", (_event, update: unknown) => {
    const u = (update ?? {}) as SettingsUpdate;
    const clean: SettingsUpdate = {
      ...(typeof u.sshHost === "string" ? { sshHost: u.sshHost } : {}),
      ...(typeof u.backendModel === "string" ? { backendModel: u.backendModel } : {}),
      ...(typeof u.backendPort === "number" ? { backendPort: u.backendPort } : {}),
      ...(typeof u.fontSize === "number" ? { fontSize: u.fontSize } : {}),
      ...(typeof u.theme === "string" ? { theme: u.theme } : {}),
      ...(typeof u.notifications === "boolean" ? { notifications: u.notifications } : {}),
      ...(typeof u.contextBudgetTokens === "number" ? { contextBudgetTokens: u.contextBudgetTokens } : {}),
      ...(typeof u.memoryEveryTurns === "number" ? { memoryEveryTurns: u.memoryEveryTurns } : {}),
      ...(typeof u.quickEntryEnabled === "boolean" ? { quickEntryEnabled: u.quickEntryEnabled } : {}),
      ...(typeof u.quickEntryShortcut === "string" ? { quickEntryShortcut: u.quickEntryShortcut } : {}),
    };
    // O host padrão só vale para conversas novas: cada conversa guarda o seu e os túneis são por host.
    // Porta nova atinge todos os túneis, o que cortaria uma resposta em andamento; recusa até ficar ocioso.
    const portChanges = clean.backendPort !== undefined && clean.backendPort !== getBackendPort();
    if (portChanges && anyConversationBusy()) {
      throw new Error("Há uma resposta em andamento. Espere terminar antes de trocar a porta.");
    }
    updateSettings(clean);
    const qe = getQuickEntry();
    applyQuickEntryShortcut(qe.enabled, qe.shortcut);
    const view = settingsView();
    nativeTheme.themeSource = view.theme;
    if (portChanges) closeTunnel();
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
    return memoryView();
  });

  ipcMain.handle("ui:quick-toggle", () => toggleQuickEntry());

  ipcMain.handle("shell:open-external", (_event, payload: unknown) => {
    const url = (payload as { url?: unknown })?.url;
    if (typeof url === "string" && EXTERNAL_URL.test(url)) void shell.openExternal(url);
  });

  ipcMain.handle("chat:send", async (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const p = payload as { conversationId?: unknown; text?: unknown };
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    const conv = typeof p?.conversationId === "string" ? getConversation(p.conversationId) : undefined;
    if (win === null || text === "" || conv === undefined || conv.windowId !== win.id) return;
    if (conv.busy) {
      win.webContents.send("chat:error", { conversationId: conv.id, kind: "unknown", message: "Espere a resposta atual terminar." });
      return;
    }
    conv.busy = true;
    try {
      await runBackendTurn(win, conv, text);
    } finally {
      conv.busy = false;
    }
  });

  ipcMain.handle("chat:cancel", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    owned?.conv.abort?.abort();
  });

  ipcMain.handle("chat:new", (event) => {
    const win = windowFromEvent(event);
    if (win === null) return { conversationId: "" };
    return { conversationId: createConversation(win.id).id };
  });

  ipcMain.handle("chat:list", (event) => {
    const win = windowFromEvent(event);
    return win === null ? [] : listConversationsFor(win.id);
  });

  ipcMain.handle("chat:rename", (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const p = payload as { conversationId?: unknown; title?: unknown };
    if (win === null || typeof p?.conversationId !== "string" || typeof p?.title !== "string") return;
    const conv = getConversation(p.conversationId);
    if (conv !== undefined && conv.windowId === win.id) renameConversation(p.conversationId, p.title);
  });

  ipcMain.handle("chat:set-model", (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const p = payload as { conversationId?: unknown; model?: unknown };
    if (win === null || typeof p?.conversationId !== "string" || !isBackendModel(p?.model)) return;
    const conv = getConversation(p.conversationId);
    if (conv !== undefined && conv.windowId === win.id) setConversationModel(p.conversationId, p.model);
  });

  ipcMain.handle("chat:reorder", (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (win === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids.filter((id) => getConversation(id)?.windowId === win.id));
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
    const stored = listConversationsFor(owned.win.id).find((c) => c.id === owned.conv.id);
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
    const n = new Notification({
      title: typeof p.title === "string" ? p.title.slice(0, 80) : "meu-bot",
      body: typeof p.body === "string" ? p.body.slice(0, 200) : "",
      silent: false,
    });
    liveNotifications.add(n);
    const done = (): void => { liveNotifications.delete(n); };
    n.on("click", () => {
      done();
      const win = ensureMainWindow();
      win.show();
      win.focus();
      app.focus({ steal: true });
      win.webContents.send("ui:focus-conversation", { conversationId: owned.conv.id });
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
  createWindow();
  setQuickEntryStatusProvider(quickEntryStatus);
  initQuickEntry({ mainWindow: ensureMainWindow, fontSize: getFontSize });
  const qe = getQuickEntry();
  applyQuickEntryShortcut(qe.enabled, qe.shortcut);
  app.on("activate", () => ensureMainWindow());

  // Estado do túnel na interface (degradado, reconstruindo…).
  onTunnelState((host, state, detail) => {
    if (mainWin === null || mainWin.isDestroyed()) return;
    const mapped = state === "ready" ? "ready" : state === "error" ? "error" : state === "degraded" ? "degraded" : state === "connecting" ? "connecting" : "idle";
    mainWin.webContents.send("backend:status", { host, state: mapped, detail: state === "ready" ? "túnel ativo" : detail });
  });

  // O Mac dormiu/acordou: revalida o túnel antes de confiar nele.
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
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { disposeQuickEntry(); closeTunnel(); });
