import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BackendModel, QuickEntryStatus, SettingsUpdate, SettingsView, Theme } from "../shared/ipc";
import { parseAccelerator } from "./accelerator";
import {
  defaultSettings, FONT_MAX, FONT_MIN, isBackendModel, isBudget, isEvery, isFont, isOnboarding, isPort, isTheme, isValidHost, normalizeSettings,
  type SettingsFile, type WindowBounds,
} from "./settings-normalize";

export { BACKEND_MODELS, isBackendModel, isValidHost } from "./settings-normalize";

let quickEntryStatusProvider: () => QuickEntryStatus = () => "disabled";
export const setQuickEntryStatusProvider = (fn: () => QuickEntryStatus): void => { quickEntryStatusProvider = fn; };

let file: SettingsFile = defaultSettings();

const settingsPath = (): string => path.join(app.getPath("userData"), "settings.json");

export function loadSettings(): void {
  try {
    file = normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), "utf8")));
  } catch {
    file = defaultSettings();
  }
}

function persist(): void {
  const target = settingsPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export const getLastHost = (): string | null => file.lastHost;
export function setLastHost(host: string): void {
  if (!isValidHost(host) || file.lastHost === host) return;
  file.lastHost = host;
  persist();
}

/** Modelo padrão para conversas novas: o da máquina, se definido; senão o global. */
export const getBackendModel = (host?: string): BackendModel => (host !== undefined ? file.defaultModelByHost[host] : undefined) ?? file.backendModel;
export const getBackendPort = (): number => file.backendPort;
export const getTheme = (): Theme => file.theme;
export const getContextBudget = (): number => file.contextBudgetTokens;
export const getMemoryEveryTurns = (): number => file.memoryEveryTurns;
export const getFontSize = (): number => file.fontSize;
export const getQuickEntry = (): { enabled: boolean; shortcut: string } => ({ enabled: file.quickEntryEnabled, shortcut: file.quickEntryShortcut });

export const getWindowBounds = (host: string): WindowBounds | undefined => file.windowBounds[host];
export function setWindowBounds(host: string, bounds: WindowBounds): void {
  if (!isValidHost(host)) return;
  file.windowBounds[host] = bounds;
  try { persist(); } catch { /* cortesia */ }
}

export const isPodHost = (host: string): boolean => file.podHosts.includes(host);
/** Lembra se a máquina é um computador do Grok Bot (a sondagem decide); persiste só quando muda. */
export function setPodHost(host: string, isPod: boolean): void {
  if (!isValidHost(host) || isPodHost(host) === isPod) return;
  file.podHosts = isPod ? [...file.podHosts, host] : file.podHosts.filter((h) => h !== host);
  try { persist(); } catch { /* cortesia */ }
}

/** Visão das configurações para uma janela: o modelo padrão já resolvido para a máquina dela. */
export const settingsView = (host?: string): SettingsView => ({
  lastHost: file.lastHost,
  backendModel: file.backendModel,
  backendModelForHost: getBackendModel(host),
  backendPort: file.backendPort,
  fontSize: file.fontSize,
  theme: file.theme,
  notifications: file.notifications,
  contextBudgetTokens: file.contextBudgetTokens,
  memoryEveryTurns: file.memoryEveryTurns,
  quickEntryEnabled: file.quickEntryEnabled,
  quickEntryShortcut: file.quickEntryShortcut,
  quickEntryStatus: quickEntryStatusProvider(),
  onboarding: file.onboarding,
});

/** Aplica uma atualização vinda da janela da máquina `host` (o modelo por máquina grava nela). */
export function updateSettings(update: SettingsUpdate, host?: string): SettingsView {
  if (update.backendModel !== undefined) {
    if (!isBackendModel(update.backendModel)) throw new Error("Modelo do backend inválido.");
    file.backendModel = update.backendModel;
  }
  if (update.backendModelForHost !== undefined && host !== undefined) {
    if (!isBackendModel(update.backendModelForHost)) throw new Error("Modelo do backend inválido.");
    file.defaultModelByHost[host] = update.backendModelForHost;
  }
  if (update.backendPort !== undefined) {
    if (!isPort(update.backendPort)) throw new Error("Porta do backend inválida (1 a 65535).");
    file.backendPort = update.backendPort;
  }
  if (update.fontSize !== undefined) {
    if (!isFont(update.fontSize)) throw new Error(`Tamanho de fonte inválido (${FONT_MIN} a ${FONT_MAX}).`);
    file.fontSize = update.fontSize;
  }
  if (update.theme !== undefined) {
    if (!isTheme(update.theme)) throw new Error("Tema inválido.");
    file.theme = update.theme;
  }
  if (update.notifications !== undefined) file.notifications = update.notifications === true;
  if (update.contextBudgetTokens !== undefined) {
    if (!isBudget(update.contextBudgetTokens)) throw new Error("Orçamento de contexto inválido (4000 a 200000 tokens).");
    file.contextBudgetTokens = update.contextBudgetTokens;
  }
  if (update.memoryEveryTurns !== undefined) {
    if (!isEvery(update.memoryEveryTurns)) throw new Error("Intervalo de memória inválido (0 a 100 turnos).");
    file.memoryEveryTurns = update.memoryEveryTurns;
  }
  if (update.quickEntryEnabled !== undefined) file.quickEntryEnabled = update.quickEntryEnabled === true;
  if (update.quickEntryShortcut !== undefined) {
    const acc = parseAccelerator(update.quickEntryShortcut);
    if (acc === null) throw new Error("Atalho inválido: use pelo menos um modificador (Cmd, Ctrl, Alt, Shift) e uma tecla.");
    file.quickEntryShortcut = acc;
  }
  if (update.onboarding !== undefined) {
    if (!isOnboarding(update.onboarding)) throw new Error("Estado de onboarding inválido.");
    file.onboarding = update.onboarding;
  }
  persist();
  return settingsView(host);
}
