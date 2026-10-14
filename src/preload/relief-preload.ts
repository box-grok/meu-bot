import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("relief", {
  close: (): void => ipcRenderer.send("relief:close"),
  on: (channel: "relief:event", callback: (payload: unknown) => void): (() => void) => {
    if (channel !== "relief:event") throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
