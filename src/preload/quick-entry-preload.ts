import { contextBridge, ipcRenderer } from "electron";

const EVENTS = ["quick:shown", "quick:appearance"] as const;
type QuickEvent = (typeof EVENTS)[number];

contextBridge.exposeInMainWorld("quickEntry", {
  submit: (text: string): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("quick:submit", { text }),
  hide: (): void => ipcRenderer.send("quick:hide"),
  on: (channel: QuickEvent, callback: (payload: unknown) => void): (() => void) => {
    if (!EVENTS.includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
