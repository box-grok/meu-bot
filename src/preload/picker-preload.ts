import { contextBridge, ipcRenderer } from "electron";
import type { HostProbe, InstallBackendResult, PickerApi, PickerInit, SshSyncResult, TailscaleCredentialState, TailscaleSshResult } from "../shared/ipc";

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
  setOnboardingDone: (value: boolean): Promise<void> => ipcRenderer.invoke("picker:onboarding-done", { value }),
  openGrokbotReset: (): Promise<boolean> => ipcRenderer.invoke("picker:open-grokbot-reset", {}),
  approveTailscale: (host: string): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke("picker:approve-tailscale", { host }),
  tailscaleCredential: (): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential", {}),
  saveTailscaleCredential: (clientId: string, clientSecret: string): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential-save", { clientId, clientSecret }),
  forgetTailscaleCredential: (): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential-forget", {}),
  disableTailscaleCheck: (host: string): Promise<TailscaleSshResult> => ipcRenderer.invoke("picker:tailscale-disable-check", { host }),
  openKnownUrl: (which: "tailscale-keys"): Promise<void> => ipcRenderer.invoke("picker:open-url", { which }),
  claudeLogin: (host: string): Promise<void> => ipcRenderer.invoke("picker:claude-login", { host }),
  cancel: (): void => ipcRenderer.send("picker:cancel"),
  on: (channel, callback) => {
    if (!(EVENTS as readonly string[]).includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("picker", api);
