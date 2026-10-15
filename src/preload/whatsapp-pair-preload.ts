import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("wapair", {
  close: (): void => ipcRenderer.send("wapair:close"),
  retry: (host: string, force: boolean): void => ipcRenderer.send("wapair:retry", { host, force }),
  on: (channel: "wapair:event", callback: (payload: unknown) => void): (() => void) => {
    if (channel !== "wapair:event") throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
