/**
 * Normalização pura do settings.json: cada campo validado, defaults para arquivos antigos e a
 * migração `sshHost` (v2, host padrão global) → `lastHost` (v3, só pré-seleção do seletor).
 * Sem Electron: testável com node --test.
 */
import type { BackendModel, Theme } from "../shared/ipc";
import { parseAccelerator } from "./accelerator";

export const BACKEND_MODELS: readonly BackendModel[] = ["claudecode", "agente", "rene-dm", "rene"];
export const isBackendModel = (v: unknown): v is BackendModel =>
  typeof v === "string" && (BACKEND_MODELS as readonly string[]).includes(v);

const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

export interface WindowBounds { x: number; y: number; width: number; height: number }

export interface SettingsFile {
  version: 1;
  /** Última máquina aberta; pré-selecionada no seletor. */
  lastHost: string | null;
  /** Modelo padrão global para conversas novas. */
  backendModel: BackendModel;
  /** Modelo padrão por máquina; vence o global. */
  defaultModelByHost: Record<string, BackendModel>;
  backendPort: number;
  fontSize: number;
  theme: Theme;
  notifications: boolean;
  contextBudgetTokens: number;
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  quickEntryShortcut: string;
  /** Posição/tamanho da janela de cada máquina. */
  windowBounds: Record<string, WindowBounds>;
  /** Máquinas que a sondagem reconheceu como computador do Grok Bot; vale mesmo quando inacessíveis. */
  podHosts: string[];
}

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_MODEL: BackendModel = "agente";
export const DEFAULT_PORT = 8080;
export const FONT_MIN = 12;
export const FONT_MAX = 20;
export const DEFAULT_FONT = 14;
export const DEFAULT_BUDGET = 24000;
export const DEFAULT_MEMORY_EVERY = 10;

export const isPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
export const isFont = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= FONT_MIN && v <= FONT_MAX;
export const isBudget = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 4000 && v <= 200000;
export const isEvery = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isValidHost = (host: string): boolean => HOST_RE.test(host) && host.length <= 253;
const validHost = (v: unknown): string | null => (typeof v === "string" && isValidHost(v) ? v : null);

const isBounds = (v: unknown): v is WindowBounds => {
  const b = v as Partial<WindowBounds> | null;
  return b !== null && typeof b === "object" && [b.x, b.y, b.width, b.height].every((n) => typeof n === "number" && Number.isFinite(n))
    && (b.width as number) >= 320 && (b.height as number) >= 240;
};

export const defaultSettings = (): SettingsFile => ({
  version: 1, lastHost: null, backendModel: DEFAULT_MODEL, defaultModelByHost: {}, backendPort: DEFAULT_PORT, fontSize: DEFAULT_FONT,
  theme: "system", notifications: true, contextBudgetTokens: DEFAULT_BUDGET, memoryEveryTurns: DEFAULT_MEMORY_EVERY,
  quickEntryEnabled: true, quickEntryShortcut: DEFAULT_SHORTCUT, windowBounds: {}, podHosts: [],
});

/** Aceita qualquer JSON (inclusive o formato v2 com `sshHost`) e devolve um SettingsFile válido. */
export function normalizeSettings(input: unknown): SettingsFile {
  const p = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const byHost: Record<string, BackendModel> = {};
  const rawByHost = p["defaultModelByHost"];
  if (rawByHost !== null && typeof rawByHost === "object") {
    for (const [h, m] of Object.entries(rawByHost as Record<string, unknown>)) if (isValidHost(h) && isBackendModel(m)) byHost[h] = m;
  }
  const bounds: Record<string, WindowBounds> = {};
  const rawBounds = p["windowBounds"];
  if (rawBounds !== null && typeof rawBounds === "object") {
    for (const [h, b] of Object.entries(rawBounds as Record<string, unknown>)) if (isValidHost(h) && isBounds(b)) bounds[h] = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return {
    version: 1,
    // v2 guardava o host padrão em sshHost; vira só a pré-seleção do seletor.
    lastHost: validHost(p["lastHost"]) ?? validHost(p["sshHost"]),
    backendModel: isBackendModel(p["backendModel"]) ? p["backendModel"] : DEFAULT_MODEL,
    defaultModelByHost: byHost,
    backendPort: isPort(p["backendPort"]) ? p["backendPort"] : DEFAULT_PORT,
    fontSize: isFont(p["fontSize"]) ? p["fontSize"] : DEFAULT_FONT,
    theme: isTheme(p["theme"]) ? p["theme"] : "system",
    notifications: typeof p["notifications"] === "boolean" ? p["notifications"] : true,
    contextBudgetTokens: isBudget(p["contextBudgetTokens"]) ? p["contextBudgetTokens"] : DEFAULT_BUDGET,
    memoryEveryTurns: isEvery(p["memoryEveryTurns"]) ? p["memoryEveryTurns"] : DEFAULT_MEMORY_EVERY,
    quickEntryEnabled: typeof p["quickEntryEnabled"] === "boolean" ? p["quickEntryEnabled"] : true,
    quickEntryShortcut: typeof p["quickEntryShortcut"] === "string" && parseAccelerator(p["quickEntryShortcut"]) !== null ? p["quickEntryShortcut"] : DEFAULT_SHORTCUT,
    windowBounds: bounds,
    podHosts: Array.isArray(p["podHosts"]) ? [...new Set((p["podHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
  };
}
