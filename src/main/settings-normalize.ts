/**
 * Normalização pura do settings.json: cada campo validado, defaults para arquivos antigos e a
 * migração `sshHost` (v2, host padrão global) → `lastHost` (v3, só pré-seleção do seletor).
 * Sem Electron: testável com node --test.
 */
import type { BackendModel, Theme } from "../shared/ipc";
import { parseAccelerator } from "./accelerator";

export const BACKEND_MODELS: readonly BackendModel[] = ["claudecode", "agente", "rene-dm", "rene", "grok-4"];
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
  /** URL que o clique no ícone de uma extensão (sem popup) abre no Navegador; "" = desligado. */
  navShortcutUrl: string;
  /** Posição/tamanho da janela de cada máquina. */
  windowBounds: Record<string, WindowBounds>;
  /** Máquinas que a sondagem reconheceu como computador do Grok Bot; vale mesmo quando inacessíveis. */
  podHosts: string[];
  /** Máquinas em que "🤖 agente pode usar" o Navegador ficou ligado (religa sozinho ao abrir a aba). */
  navAgentHosts: string[];
  /** Barra de favoritos do Navegador, por máquina (a pessoa ou o agente adicionam). */
  navFavoritos: Record<string, NavFavoritoItem[]>;
  /** Onboarding guiado da primeira vez: pendente até a pessoa concluir ou pular. */
  onboarding: Onboarding;
  /** Abrir a janela direto (padrão) ou com a abertura animada toda vez; caixinha no seletor. */
  openDirect: boolean;
  /** Apelido de cada máquina no app ("Renomear" no seletor); a chave SSH não muda. */
  hostNames: Record<string, string>;
}

export type Onboarding = "pending" | "done" | "skipped";
export interface NavFavoritoItem { id: string; titulo: string; url: string }
export const MAX_FAVORITOS = 50;
/** Favoritos válidos de uma máquina: url http(s), título curto, ids únicos, url repetida fica com a primeira. */
function normalizeNavFavoritos(v: unknown): Record<string, NavFavoritoItem[]> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, NavFavoritoItem[]> = {};
  for (const [host, list] of Object.entries(v as Record<string, unknown>)) { if (!isValidHost(host)) continue; const n = normalizeFavoritos(list); if (n.length > 0) out[host] = n; }
  return out;
}
export function normalizeFavoritos(v: unknown): NavFavoritoItem[] {
  if (!Array.isArray(v)) return [];
  const out: NavFavoritoItem[] = []; const urls = new Set<string>(); const ids = new Set<string>();
  for (const it of v as unknown[]) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o["url"] !== "string" || !/^https?:\/\/\S+$/i.test(o["url"]) || o["url"].length > 2048) continue;
    const url = o["url"]; if (urls.has(url)) continue;
    const id = typeof o["id"] === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(o["id"]) && !ids.has(o["id"]) ? o["id"] : `f${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const titulo = (typeof o["titulo"] === "string" ? o["titulo"] : "").replace(/\s+/g, " ").trim().slice(0, 60);
    out.push({ id, titulo, url }); urls.add(url); ids.add(id);
    if (out.length >= MAX_FAVORITOS) break;
  }
  return out;
}
const ONBOARDINGS: readonly Onboarding[] = ["pending", "done", "skipped"];
export const isOnboarding = (v: unknown): v is Onboarding => typeof v === "string" && (ONBOARDINGS as readonly string[]).includes(v);

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
  quickEntryEnabled: true, quickEntryShortcut: DEFAULT_SHORTCUT, navShortcutUrl: "", windowBounds: {}, podHosts: [], navAgentHosts: [], navFavoritos: {}, onboarding: "pending", openDirect: true, hostNames: {},
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
    navShortcutUrl: typeof p["navShortcutUrl"] === "string" && /^https?:\/\//i.test(p["navShortcutUrl"]) ? p["navShortcutUrl"] : "",
    windowBounds: bounds,
    onboarding: isOnboarding(p["onboarding"]) ? p["onboarding"] : "pending",
    openDirect: typeof p["openDirect"] === "boolean" ? p["openDirect"] : true,
    podHosts: Array.isArray(p["podHosts"]) ? [...new Set((p["podHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    navAgentHosts: Array.isArray(p["navAgentHosts"]) ? [...new Set((p["navAgentHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    hostNames: normalizeHostNames(p["hostNames"]),
    navFavoritos: normalizeNavFavoritos(p["navFavoritos"]),
  };
}

/** Apelidos válidos: chave = host SSH válido; valor = texto de 1 a 40 caracteres, sem quebras. */
export function normalizeHostNames(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [host, name] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidHost(host) || typeof name !== "string") continue;
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean !== "") out[host] = clean;
  }
  return out;
}
