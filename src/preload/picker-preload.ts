import { contextBridge, ipcRenderer } from "electron";
import type { HostProbe, InstallBackendResult, PickerApi, PickerAdminApi, PickerClientApi, PickerSharedApi, PickerInit, SshSyncResult, TailscaleCredentialState, TailscaleSshResult } from "../shared/ipc";

const EVENTS = ["picker:init", "picker:install-progress"] as const;

/** Os dois apps. */
const sharedApi: PickerSharedApi = {
  list: (): Promise<PickerInit> => ipcRenderer.invoke("picker:list", {}),
  plans: (): Promise<Record<string, "free" | "pro">> => ipcRenderer.invoke("picker:plans", {}),
  probe: (host: string): Promise<HostProbe> => ipcRenderer.invoke("picker:probe", { host }),
  choose: (host: string): Promise<void> => ipcRenderer.invoke("picker:choose", { host }),
  setShortcut: (host: string, create: boolean): Promise<{ has: boolean; emoji: string | null }> => ipcRenderer.invoke("picker:shortcut", { host, create }),
  relieve: (host: string): Promise<void> => ipcRenderer.invoke("picker:relieve", { host }),
  setReliefShortcut: (host: string, create: boolean): Promise<{ has: boolean }> => ipcRenderer.invoke("picker:relief-shortcut", { host, create }),
  openGrokbotReset: (): Promise<boolean> => ipcRenderer.invoke("picker:open-grokbot-reset", {}),
  tailscaleCredential: (): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential", {}),
  openKnownUrl: (which: "tailscale-keys"): Promise<void> => ipcRenderer.invoke("picker:open-url", { which }),
  cancel: (): void => ipcRenderer.send("picker:cancel"),
  on: (channel, callback) => {
    if (!(EVENTS as readonly string[]).includes(channel)) throw new Error(`Canal não permitido: ${String(channel)}`);
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

/** Só o meu-bot normal (no admin, o main recusa). */
const clientApi: PickerClientApi = {
  install: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install", { host }),
  installStatusLine: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install-statusline", { host }),
  installTranscription: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install-transcricao", { host }),
  installClaude: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install-claude", { host }),
  installGuarda: (host: string): Promise<InstallBackendResult> => ipcRenderer.invoke("picker:install-guarda", { host }),
  removeHost: (host: string) => ipcRenderer.invoke("picker:remove-host", { host }),
  renameHost: (host: string, name: string): Promise<void> => ipcRenderer.invoke("picker:rename-host", { host, name }),
  syncSsh: (): Promise<SshSyncResult> => ipcRenderer.invoke("picker:sync-ssh", {}),
  setOpenDirect: (value: boolean): Promise<void> => ipcRenderer.invoke("picker:open-direct", { value }),
  setOnboardingDone: (value: boolean): Promise<void> => ipcRenderer.invoke("picker:onboarding-done", { value }),
  approveTailscale: (host: string): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke("picker:approve-tailscale", { host }),
  saveTailscaleCredential: (clientId: string, clientSecret: string): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential-save", { clientId, clientSecret }),
  forgetTailscaleCredential: (): Promise<TailscaleCredentialState> => ipcRenderer.invoke("picker:tailscale-credential-forget", {}),
  disableTailscaleCheck: (host: string): Promise<TailscaleSshResult> => ipcRenderer.invoke("picker:tailscale-disable-check", { host }),
  claudeLogin: (host: string): Promise<void> => ipcRenderer.invoke("picker:claude-login", { host }),
};

/** Só o meu-bot-admin. */
const adminApi: PickerAdminApi = {
  supportRefresh: () => ipcRenderer.invoke("picker:support-refresh", {}),
  supportAdd: (code: string) => ipcRenderer.invoke("picker:support-add", { code }),
  supportArchive: (alias: string, archived: boolean) => ipcRenderer.invoke("picker:support-archive", { alias, archived }),
  supportRename: (alias: string, name: string) => ipcRenderer.invoke("picker:support-rename", { alias, name }),
  supportRemove: (alias: string, force: boolean) => ipcRenderer.invoke("picker:support-remove", { alias, force }),
};

const api: PickerApi = { ...sharedApi, ...clientApi, ...adminApi };

contextBridge.exposeInMainWorld("picker", api);
