/**
 * Seletor de máquinas: a janela que abre o app ("abrir o meu-bot em…"). Lista `local` + hosts do
 * ~/.ssh/config, sonda todos em paralelo (com cache curto para reabrir instantâneo), instala o
 * backend quando falta e abre a janela principal da máquina escolhida. Também sincroniza o
 * ~/.ssh/config com o modelo versionado e, para computadores do Grok Bot, dispara o alívio.
 */
import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { HostProbe, PickerInit } from "../shared/ipc";
import { approveTailscaleCheck, installAudio, installBackend, installStatusLine, probeHost } from "./hostProbe";
import { isAdmin } from "./variant";
import { addSupportCode, adminKeyExists, isSupportAlias, knownPeople, supportPeople } from "./support-admin";
import { LOCAL_HOST } from "./localBackend";
import { showRelief } from "./relief";
import { openGrokbotReset } from "./grokbot";
import { clearTailscaleCredential, saveTailscaleCredential, tailscaleCredentialState } from "./secrets";
import { disableSshCheck } from "./tailscale";
import { shell } from "electron";

/** URLs que o seletor pode pedir para abrir: lista fechada, nunca URL livre do renderer. */
const KNOWN_URLS: Record<string, string> = { "tailscale-keys": "https://login.tailscale.com/admin/settings/keys" };
import { getBackendPort, getLastHost, getOpenDirect, isOnboardingDone, isPodHost, isValidHost, setLastHost, setOnboardingDone, setOpenDirect, setPodHost } from "./settings";
import { listSshHosts } from "./sshConfig";
import { removeHostFromSshConfig, syncSshConfig } from "./sshSync";
import {
  createReliefShortcut, createShortcut, hasReliefShortcut, hasShortcut, removeReliefShortcut, removeShortcut, shortcutEmoji,
} from "./shortcuts";
import { backgroundColor, openMainWindow, sendWhenLoaded, windowForHost } from "./windows";

let pickerWin: BrowserWindow | null = null;
let lastError: string | null = null;
let preselectOverride: string | null = null;

/** Última sondagem por host; serve `window:info` (modelos) e reabre o seletor sem esperar o ssh. */
const probes = new Map<string, { probe: HostProbe; at: number }>();
const PROBE_TTL_MS = 60_000;
const inflight = new Map<string, Promise<HostProbe>>();

export const knownModels = (host: string): string[] => probes.get(host)?.probe.models ?? [];

function probeCached(host: string): Promise<HostProbe> {
  const hit = probes.get(host);
  if (hit !== undefined && Date.now() - hit.at < PROBE_TTL_MS) return Promise.resolve(hit.probe);
  const running = inflight.get(host);
  if (running !== undefined) return running;
  const p = probeHost(host, getBackendPort()).then((probe) => {
    probes.set(host, { probe, at: Date.now() });
    // Só uma sondagem que entrou sabe dizer; inacessível não apaga o que já se sabia.
    if (probe.reachable) setPodHost(host, probe.grokPod);
    return probe;
  }).finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

// No meu-bot-admin a lista são as pessoas com suporte ligado (os aliases do ~/.ssh/meu-bot-suporte.conf).
// No meu-bot normal, os aliases `suporte-*` (do meu-bot-admin, via Include no ~/.ssh/config) ficam de fora:
// são as máquinas das pessoas que o admin atende, não máquinas desta pessoa.
const hostsList = (): string[] => (isAdmin() ? knownPeople().filter((p) => p.on).map((p) => p.alias) : [LOCAL_HOST, ...listSshHosts().filter((h) => !isSupportAlias(h))]);

/** A chegada animada do seletor toca uma vez por sessão do app; depois a lista aparece seca. */
let arrivalShown = false;

function initPayload(): PickerInit {
  const arrival = !arrivalShown; arrivalShown = true;
  const hosts = hostsList();
  const wanted = preselectOverride ?? getLastHost() ?? LOCAL_HOST;
  return {
    hosts,
    support: isAdmin() ? { people: knownPeople(), adminKey: adminKeyExists() } : null,
    preselect: hosts.includes(wanted) ? wanted : (hosts[0] ?? LOCAL_HOST),
    open: hosts.filter((h) => windowForHost(h) !== undefined),
    shortcuts: hosts.filter(hasShortcut).map((h) => ({ host: h, emoji: shortcutEmoji(h) })),
    pods: hosts.filter(isPodHost),
    reliefShortcuts: hosts.filter(hasReliefShortcut),
    openDirect: getOpenDirect(),
    onboardingDone: isOnboardingDone(),
    error: lastError,
    arrival,
  };
}

const fromPicker = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean =>
  pickerWin !== null && !pickerWin.isDestroyed() && event.sender === pickerWin.webContents;

const hostArg = (payload: unknown): string => {
  const host = String((payload as { host?: unknown } | null)?.host ?? "").trim();
  if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
  return host;
};

export function initPicker(): void {
  ipcMain.handle("picker:list", (event) => { if (!fromPicker(event)) throw new Error("origem inválida"); return initPayload(); });
  ipcMain.handle("picker:probe", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return probeCached(hostArg(payload));
  });
  ipcMain.handle("picker:support-refresh", async (event) => {
    if (!fromPicker(event) || !isAdmin()) throw new Error("origem inválida");
    return supportPeople();
  });
  ipcMain.handle("picker:support-add", (event, payload: unknown) => {
    if (!fromPicker(event) || !isAdmin()) throw new Error("origem inválida");
    return addSupportCode(String((payload as { code?: unknown } | null)?.code ?? ""));
  });
  ipcMain.handle("picker:install", async (event, payload: unknown) => {
    if (!fromPicker(event) || isAdmin()) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await installBackend(host, getBackendPort(), (line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); });
    probes.delete(host);
    return r;
  });
  ipcMain.handle("picker:install-statusline", async (event, payload: unknown) => {
    if (!fromPicker(event) || isAdmin()) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await installStatusLine(host, (line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); });
    probes.delete(host);
    return r;
  });
  ipcMain.handle("picker:install-transcricao", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await installAudio(host, { kind: "in" }, (line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); });
    probes.delete(host);
    return r;
  });
  ipcMain.handle("picker:choose", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    setLastHost(host);
    lastError = null;
    preselectOverride = null;
    openMainWindow(host, "picker");
    // Abrir antes de fechar: fora do macOS, fechar a última janela encerraria o app.
    pickerWin?.close();
  });
  ipcMain.handle("picker:shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createShortcut(host); else removeShortcut(host);
    return { has: hasShortcut(host), emoji: shortcutEmoji(host) };
  });
  ipcMain.handle("picker:sync-ssh", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return syncSshConfig();
  });
  ipcMain.handle("picker:relieve", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    if (!isPodHost(host)) throw new Error(`${host} não foi reconhecida como computador do Grok Bot.`);
    showRelief(host);
    pickerWin?.close();
  });
  // "Remover do seletor": sai do ~/.ssh/config (com backup) e os atalhos da mesa dela vão junto.
  ipcMain.handle("picker:remove-host", (event, payload: unknown) => {
    if (!fromPicker(event) || isAdmin()) throw new Error("origem inválida");
    const host = hostArg(payload);
    if (host === LOCAL_HOST) throw new Error("este Mac não sai da lista");
    if (windowForHost(host) !== undefined) throw new Error(`feche a janela de ${host} antes de remover`);
    const r = removeHostFromSshConfig(host);
    if (hasShortcut(host)) removeShortcut(host);
    if (hasReliefShortcut(host)) removeReliefShortcut(host);
    probes.delete(host);
    if (getLastHost() === host) setLastHost(LOCAL_HOST);
    return { backup: r.backup };
  });
  ipcMain.handle("picker:relief-shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createReliefShortcut(host); else removeReliefShortcut(host);
    return { has: hasReliefShortcut(host) };
  });
  ipcMain.handle("picker:open-direct", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    setOpenDirect((payload as { value?: unknown } | null)?.value === true);
  });
  ipcMain.handle("picker:onboarding-done", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    setOnboardingDone((payload as { value?: unknown } | null)?.value === true);
  });
  ipcMain.handle("picker:approve-tailscale", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await approveTailscaleCheck(host);
    probes.delete(host); // a próxima sondagem precisa ser nova
    return r;
  });
  ipcMain.handle("picker:tailscale-credential", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return tailscaleCredentialState();
  });
  ipcMain.handle("picker:tailscale-credential-save", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const p = payload as { clientId?: unknown; clientSecret?: unknown } | null;
    return saveTailscaleCredential(String(p?.clientId ?? ""), String(p?.clientSecret ?? ""));
  });
  ipcMain.handle("picker:tailscale-credential-forget", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return clearTailscaleCredential();
  });
  ipcMain.handle("picker:tailscale-disable-check", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await disableSshCheck();
    probes.delete(host); // a próxima sondagem precisa ser nova
    return r;
  });
  ipcMain.handle("picker:open-url", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const which = String((payload as { which?: unknown } | null)?.which ?? "");
    const url = KNOWN_URLS[which];
    if (url === undefined) throw new Error("página desconhecida");
    await shell.openExternal(url);
  });
  ipcMain.handle("picker:claude-login", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const raw = String((payload as { host?: unknown } | null)?.host ?? "").trim();
    const host = raw === LOCAL_HOST ? LOCAL_HOST : hostArg(payload);
    setLastHost(host);
    const win = openMainWindow(host, "picker");
    sendWhenLoaded(win, "ui:claude-login", {});
    probes.delete(host);
    pickerWin?.close();
  });
  ipcMain.handle("picker:open-grokbot-reset", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return openGrokbotReset();
  });
  ipcMain.on("picker:cancel", (event) => { if (fromPicker(event)) pickerWin?.close(); });
}

/** Mostra o seletor (foca se já existe). `error` aparece no topo; `preselect` vence a última máquina. */
export function showPicker(opts: { error?: string; preselect?: string } = {}): void {
  if (opts.error !== undefined) lastError = opts.error;
  if (opts.preselect !== undefined) preselectOverride = opts.preselect;
  if (pickerWin !== null && !pickerWin.isDestroyed()) {
    pickerWin.show();
    pickerWin.focus();
    if (!pickerWin.webContents.isLoading()) pickerWin.webContents.send("picker:init", initPayload());
    return;
  }
  const win = new BrowserWindow({
    width: 540, height: 600, minWidth: 460, minHeight: 420, resizable: true,
    title: isAdmin() ? "meu-bot-admin · escolher pessoa" : "meu-bot · escolher máquina",
    titleBarStyle: "hiddenInset",
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "picker-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  pickerWin = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) win.webContents.send("picker:init", initPayload()); });
  win.on("closed", () => { if (pickerWin === win) pickerWin = null; });
  void win.loadFile(path.join(__dirname, "..", "renderer", "picker.html"));
}

export const isPickerOpen = (): boolean => pickerWin !== null && !pickerWin.isDestroyed();
