import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import type { SettingsUpdate } from "../shared/ipc";
import { runBackendTurn } from "./backend";
import { closeTunnel } from "./tunnel";
import { anyConversationBusy, createConversation, dropConversation, getConversation, listConversationsFor, loadConversations, releaseWindow, renameConversation, reorderConversations } from "./conversation";
import { getBackendPort, getSshHost, loadSettings, settingsView, updateSettings } from "./settings";
import { listSshHosts } from "./sshConfig";

const windowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "meu-bot",
    titleBarStyle: "hiddenInset",
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
  win.on("closed", () => releaseWindow(win.id));
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settingsView());
  ipcMain.handle("settings:ssh-hosts", () => listSshHosts());

  ipcMain.handle("settings:set", (_event, update: unknown) => {
    const u = (update ?? {}) as SettingsUpdate;
    const clean: SettingsUpdate = {
      ...(typeof u.sshHost === "string" ? { sshHost: u.sshHost } : {}),
      ...(typeof u.backendModel === "string" ? { backendModel: u.backendModel } : {}),
      ...(typeof u.backendPort === "number" ? { backendPort: u.backendPort } : {}),
    };
    // Trocar o modelo não mexe no túnel. Host ou porta novos exigem reabrir o túnel,
    // o que cortaria uma resposta em andamento; nesse caso recusa até ficar ocioso.
    const hostChanges = clean.sshHost !== undefined && clean.sshHost.trim() !== getSshHost();
    const portChanges = clean.backendPort !== undefined && clean.backendPort !== getBackendPort();
    if ((hostChanges || portChanges) && anyConversationBusy()) {
      throw new Error("Há uma resposta em andamento. Espere terminar antes de trocar o host ou a porta.");
    }
    const view = updateSettings(clean);
    if (hostChanges || portChanges) closeTunnel();
    return view;
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

  ipcMain.handle("chat:reorder", (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (win === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids.filter((id) => getConversation(id)?.windowId === win.id));
  });

  ipcMain.handle("chat:close", (event, payload: unknown) => {
    const win = windowFromEvent(event);
    const id = (payload as { conversationId?: unknown })?.conversationId;
    if (win === null || typeof id !== "string") return;
    const conv = getConversation(id);
    if (conv !== undefined && conv.windowId === win.id) dropConversation(id);
  });
}

app.whenReady().then(() => {
  loadSettings();
  loadConversations();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => closeTunnel());
