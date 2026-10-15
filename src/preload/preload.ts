import { contextBridge, ipcRenderer } from "electron";
import type { BackendModel, ConversationRef, ExportFormat, MainEventChannel, MainEvents, MemoryView, MeuBotApi, SettingsUpdate, SettingsView, StoredConversationView, TabMenuAction, WindowInfo } from "../shared/ipc";

// Preload roda em sandbox: não pode importar módulos do app, por isso a lista fica aqui.
const MAIN_EVENT_CHANNELS: readonly MainEventChannel[] = [
  "chat:assistant-start",
  "chat:delta",
  "chat:done",
  "chat:error",
  "backend:status",
  "settings:changed",
  "ui:focus-conversation",
  "chat:context",
  "memory:changed",
  "ui:quick-submit",
  "ui:toggle-settings",
  "chat:notice",
  "chat:account",
];

const api: MeuBotApi = {
  send: (conversationId: string, text: string) => ipcRenderer.invoke("chat:send", { conversationId, text }),
  cancel: (conversationId: string) => ipcRenderer.invoke("chat:cancel", { conversationId }),
  newConversation: (): Promise<ConversationRef> => ipcRenderer.invoke("chat:new", {}),
  closeConversation: (conversationId: string) => ipcRenderer.invoke("chat:close", { conversationId }),
  listConversations: (): Promise<StoredConversationView[]> => ipcRenderer.invoke("chat:list", {}),
  renameConversation: (conversationId: string, title: string) => ipcRenderer.invoke("chat:rename", { conversationId, title }),
  reorderConversations: (conversationIds: string[]) => ipcRenderer.invoke("chat:reorder", { conversationIds }),
  setConversationModel: (conversationId: string, model: BackendModel) => ipcRenderer.invoke("chat:set-model", { conversationId, model }),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", { url }),
  openConversation: (conversationId: string): Promise<StoredConversationView | null> => ipcRenderer.invoke("chat:open", { conversationId }),
  deleteConversation: (conversationId: string) => ipcRenderer.invoke("chat:delete", { conversationId }),
  archiveConversation: (conversationId: string, archived: boolean) => ipcRenderer.invoke("chat:archive", { conversationId, archived }),
  duplicateConversation: (conversationId: string): Promise<StoredConversationView | null> => ipcRenderer.invoke("chat:duplicate", { conversationId }),
  branchConversation: (conversationId: string, index: number): Promise<StoredConversationView | null> => ipcRenderer.invoke("chat:branch", { conversationId, index }),
  exportConversation: (conversationId: string, format: ExportFormat): Promise<{ path: string } | null> => ipcRenderer.invoke("chat:export", { conversationId, format }),
  showTabMenu: (conversationId: string, state: { busy: boolean; archived: boolean }): Promise<TabMenuAction | null> => ipcRenderer.invoke("ui:tab-menu", { conversationId, state }),
  notify: (conversationId: string, title: string, body: string) => ipcRenderer.invoke("ui:notify", { conversationId, title, body }),
  getMemory: (): Promise<MemoryView> => ipcRenderer.invoke("memory:get", {}),
  toggleQuickEntry: () => ipcRenderer.invoke("ui:quick-toggle", {}),
  quickAck: (correlationId: string, ok: boolean, message?: string): void => ipcRenderer.send("quick:ack", { correlationId, ok, ...(message === undefined ? {} : { message }) }),
  setMemory: (update: { notas?: string; perfil?: string }): Promise<MemoryView> => ipcRenderer.invoke("memory:set", update),
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke("settings:get", {}),
  getWindowInfo: (): Promise<WindowInfo | null> => ipcRenderer.invoke("window:info", {}),
  openPicker: () => ipcRenderer.invoke("ui:open-picker", {}),
  getAccountStatus: () => ipcRenderer.invoke("backend:account", {}),
  setSettings: (update: SettingsUpdate): Promise<SettingsView> => ipcRenderer.invoke("settings:set", update),
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void {
    if (!MAIN_EVENT_CHANNELS.includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: MainEvents[K]): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("meuBot", api);
