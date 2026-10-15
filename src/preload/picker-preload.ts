import { contextBridge, ipcRenderer } from "electron";
import type { HostProbe, InstallBackendResult, PickerApi, PickerInit, SshSyncResult } from "../shared/ipc";

const EVENTS = ["picker:init", "picker:install-progress"] as const;

const api: PickerApi = {
  list: (): Promise<PickerInit> => ipcRenderer.invoke("picker:list", {}),
  probe: (host: string): Promise<HostProbe> => ipcRenderer.invoke("picker:probe", { host }),
  install: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install", { host }),
  choose: (host: string): Promise<void> => ipcRenderer.invoke("picker:choose", { host }),
  setShortcut: (host: string, create: boolean): Promise<{ has: boolean; emoji: string | null }> => ipcRenderer.invoke("picker:shortcut", { host, create }),
  syncSsh: (): Promise<SshSyncResult> => ipcRenderer.invoke("picker:sync-ssh", {}),
  relieve: (host: string): Promise<void> => ipcRenderer.invoke("picker:relieve", { host }),
  setReliefShortcut: (host: string, create: boolean): Promise<{ has: boolean }> => ipcRenderer.invoke("picker:relief-shortcut", { host, create }),
  setOpenDirect: (value: boolean): Promise<void> => ipcRenderer.invoke("picker:open-direct", { value }),
  cancel: (): void => ipcRenderer.send("picker:cancel"),
  on: (channel, callback) => {
    if (!(EVENTS as readonly string[]).includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("picker", api);
