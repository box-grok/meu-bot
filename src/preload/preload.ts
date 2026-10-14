import { contextBridge, ipcRenderer } from "electron";
import type { ConversationRef, MainEventChannel, MainEvents, MeuBotApi, SettingsUpdate, SettingsView, StoredConversationView } from "../shared/ipc";

// Preload roda em sandbox: não pode importar módulos do app, por isso a lista fica aqui.
const MAIN_EVENT_CHANNELS: readonly MainEventChannel[] = [
  "chat:assistant-start",
  "chat:delta",
  "chat:done",
  "chat:error",
  "backend:status",
];

const api: MeuBotApi = {
  send: (conversationId: string, text: string) => ipcRenderer.invoke("chat:send", { conversationId, text }),
  newConversation: (): Promise<ConversationRef> => ipcRenderer.invoke("chat:new", {}),
  closeConversation: (conversationId: string) => ipcRenderer.invoke("chat:close", { conversationId }),
  listConversations: (): Promise<StoredConversationView[]> => ipcRenderer.invoke("chat:list", {}),
  renameConversation: (conversationId: string, title: string) => ipcRenderer.invoke("chat:rename", { conversationId, title }),
  reorderConversations: (conversationIds: string[]) => ipcRenderer.invoke("chat:reorder", { conversationIds }),
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke("settings:get", {}),
  listSshHosts: (): Promise<string[]> => ipcRenderer.invoke("settings:ssh-hosts", {}),
  setSettings: (update: SettingsUpdate): Promise<SettingsView> => ipcRenderer.invoke("settings:set", update),
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void {
    if (!MAIN_EVENT_CHANNELS.includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: MainEvents[K]): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("meuBot", api);
