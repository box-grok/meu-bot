/**
 * Seletor de máquinas: a janela que abre o app ("abrir o meu-bot em…"). Lista `local` + hosts do
 * ~/.ssh/config, sonda todos em paralelo (com cache curto para reabrir instantâneo), instala o
 * backend quando falta e abre a janela principal da máquina escolhida. Também sincroniza o
 * ~/.ssh/config com o modelo versionado e, para computadores do Grok Bot, dispara o alívio.
 */
import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { HostProbe, PickerInit } from "../shared/ipc";
import { installBackend, probeHost } from "./hostProbe";
import { LOCAL_HOST } from "./localBackend";
import { showRelief } from "./relief";
import { getBackendPort, getLastHost, getOpenDirect, isPodHost, isValidHost, setLastHost, setOpenDirect, setPodHost } from "./settings";
import { listSshHosts } from "./sshConfig";
import { syncSshConfig } from "./sshSync";
import {
  createReliefShortcut, createShortcut, hasReliefShortcut, hasShortcut, removeReliefShortcut, removeShortcut, shortcutEmoji,
} from "./shortcuts";
import { backgroundColor, openMainWindow, windowForHost } from "./windows";

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

const hostsList = (): string[] => [LOCAL_HOST, ...listSshHosts()];

function initPayload(): PickerInit {
  const hosts = hostsList();
  const wanted = preselectOverride ?? getLastHost() ?? LOCAL_HOST;
  return {
    hosts,
    preselect: hosts.includes(wanted) ? wanted : LOCAL_HOST,
    open: hosts.filter((h) => windowForHost(h) !== undefined),
    shortcuts: hosts.filter(hasShortcut).map((h) => ({ host: h, emoji: shortcutEmoji(h) })),
    pods: hosts.filter(isPodHost),
    reliefShortcuts: hosts.filter(hasReliefShortcut),
    openDirect: getOpenDirect(),
    error: lastError,
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
  ipcMain.handle("picker:install", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const r = await installBackend(host, getBackendPort(), (line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); });
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
    title: "meu-bot · escolher máquina",
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
