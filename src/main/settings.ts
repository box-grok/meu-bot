import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BackendModel, QuickEntryStatus, SettingsUpdate, SettingsView, Theme } from "../shared/ipc";
import { parseAccelerator } from "./accelerator";

/** Modelos expostos pelo backend OpenAI-compatível da VM. */
export const BACKEND_MODELS: readonly BackendModel[] = ["claudecode", "agente", "rene-dm", "rene"];
export const isBackendModel = (v: unknown): v is BackendModel =>
  typeof v === "string" && (BACKEND_MODELS as readonly string[]).includes(v);

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

interface SettingsFile {
  version: 1;
  sshHost: string;
  backendModel: BackendModel;
  backendPort: number;
  fontSize: number;
  theme: Theme;
  notifications: boolean;
  contextBudgetTokens: number;
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  quickEntryShortcut: string;
}

const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
let quickEntryStatusProvider: () => QuickEntryStatus = () => "disabled";
export const setQuickEntryStatusProvider = (fn: () => QuickEntryStatus): void => { quickEntryStatusProvider = fn; };

const DEFAULT_HOST = "colima";
const DEFAULT_MODEL: BackendModel = "claudecode";
const DEFAULT_PORT = 8080;
const FONT_MIN = 12;
const FONT_MAX = 20;
const DEFAULT_FONT = 14;
const isPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
const isFont = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= FONT_MIN && v <= FONT_MAX;
const DEFAULT_BUDGET = 24000;
const isBudget = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 4000 && v <= 200000;
const DEFAULT_MEMORY_EVERY = 10;
const isEvery = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
const defaults = (): SettingsFile => ({
  version: 1, sshHost: DEFAULT_HOST, backendModel: DEFAULT_MODEL, backendPort: DEFAULT_PORT, fontSize: DEFAULT_FONT, theme: "system", notifications: true,
  contextBudgetTokens: DEFAULT_BUDGET, memoryEveryTurns: DEFAULT_MEMORY_EVERY,
  quickEntryEnabled: true, quickEntryShortcut: DEFAULT_SHORTCUT,
});
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

let file: SettingsFile = defaults();

const settingsPath = (): string => path.join(app.getPath("userData"), "settings.json");

export const isValidHost = (host: string): boolean => HOST_RE.test(host) && host.length <= 253;

export function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    file = {
      version: 1,
      sshHost: typeof parsed.sshHost === "string" && isValidHost(parsed.sshHost) ? parsed.sshHost : DEFAULT_HOST,
      backendModel: isBackendModel(parsed.backendModel) ? parsed.backendModel : DEFAULT_MODEL,
      backendPort: isPort(parsed.backendPort) ? parsed.backendPort : DEFAULT_PORT,
      fontSize: isFont(parsed.fontSize) ? parsed.fontSize : DEFAULT_FONT,
      theme: isTheme(parsed.theme) ? parsed.theme : "system",
      notifications: typeof parsed.notifications === "boolean" ? parsed.notifications : true,
      contextBudgetTokens: isBudget(parsed.contextBudgetTokens) ? parsed.contextBudgetTokens : DEFAULT_BUDGET,
      memoryEveryTurns: isEvery(parsed.memoryEveryTurns) ? parsed.memoryEveryTurns : DEFAULT_MEMORY_EVERY,
      quickEntryEnabled: typeof parsed.quickEntryEnabled === "boolean" ? parsed.quickEntryEnabled : true,
      quickEntryShortcut: typeof parsed.quickEntryShortcut === "string" && parseAccelerator(parsed.quickEntryShortcut) !== null ? parsed.quickEntryShortcut : DEFAULT_SHORTCUT,
    };
  } catch {
    file = defaults();
  }
}

function persist(): void {
  const target = settingsPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export const getSshHost = (): string => file.sshHost;
export const getBackendModel = (): BackendModel => file.backendModel;
export const getBackendPort = (): number => file.backendPort;
export const getTheme = (): Theme => file.theme;
export const getContextBudget = (): number => file.contextBudgetTokens;
export const getMemoryEveryTurns = (): number => file.memoryEveryTurns;
export const getFontSize = (): number => file.fontSize;
export const getQuickEntry = (): { enabled: boolean; shortcut: string } => ({ enabled: file.quickEntryEnabled, shortcut: file.quickEntryShortcut });

export const settingsView = (): SettingsView => ({
  sshHost: file.sshHost,
  backendModel: file.backendModel,
  backendPort: file.backendPort,
  fontSize: file.fontSize,
  theme: file.theme,
  notifications: file.notifications,
  contextBudgetTokens: file.contextBudgetTokens,
  memoryEveryTurns: file.memoryEveryTurns,
  quickEntryEnabled: file.quickEntryEnabled,
  quickEntryShortcut: file.quickEntryShortcut,
  quickEntryStatus: quickEntryStatusProvider(),
});

export function updateSettings(update: SettingsUpdate): SettingsView {
  if (update.backendModel !== undefined) {
    if (!isBackendModel(update.backendModel)) throw new Error("Modelo do backend inválido.");
    file.backendModel = update.backendModel;
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
  if (update.sshHost !== undefined) {
    const host = update.sshHost.trim();
    if (!isValidHost(host)) throw new Error("Host SSH inválido. Use só letras, números, ponto, hífen e sublinhado.");
    file.sshHost = host;
  }
  persist();
  return settingsView();
}
