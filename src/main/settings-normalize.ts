/**
 * Normalização pura do settings.json: cada campo validado, defaults para arquivos antigos e a
 * migração `sshHost` (v2, host padrão global) → `lastHost` (v3, só pré-seleção do seletor).
 * Sem Electron: testável com node --test.
 */
import type { BackendModel, NavNotifyPref, NavService, NavWorkspace, NavWorkspaces, Theme } from "../shared/ipc";
import { parseAccelerator } from "./accelerator";
import { isZoomLevel } from "./zoom-core";

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
  /** Porta padrão do backend nas máquinas. */
  backendPort: number;
  /** Porta por máquina; vence a padrão (duas contas na mesma máquina não cabem na mesma porta). */
  backendPortByHost: Record<string, number>;
  fontSize: number;
  /** Zoom da interface inteira (nível do Chromium, -8..8; 0 = 100%). Um só para todas as janelas. */
  zoomLevel: number;
  theme: Theme;
  notifications: boolean;
  contextBudgetTokens: number;
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  /** Cópia diária do CRM e do financeiro das máquinas no Drive do dono. Só acontece com o Google conectado com Drive. */
  dadosNoDrive: boolean;
  quickEntryShortcut: string;
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
  /** Notificações das páginas do Navegador → conversas (instrução, sites, modo). */
  navNotify: NavNotifyPref;
  /** Espaços de trabalho do Navegador, por máquina (tipo, ativo e a lista com os sites fixos). */
  navEspacos: Record<string, NavWorkspaces>;
  /** Reiniciar sozinho na versão nova com o Mac ocioso (como o Grok Bot; ligado por padrão). */
  atualizarOcioso: boolean;
}
export const MAX_ESPACOS = 20;
export const MAX_SERVICOS = 30;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const emptyWorkspaces = (): NavWorkspaces => ({ ativo: null, lista: [] });
const cleanName = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Um estado de espaços válido: ids únicos, nomes 1..40, urls http(s), ícone http(s)/data ou null, ativo existente. */
export function normalizeNavWorkspaces(v: unknown): NavWorkspaces {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return emptyWorkspaces();
  const p = v as Record<string, unknown>;
  const ids = new Set<string>(); const lista: NavWorkspace[] = [];
  for (const raw of Array.isArray(p["lista"]) ? (p["lista"] as unknown[]) : []) {
    if (raw === null || typeof raw !== "object") continue;
    const w = raw as Record<string, unknown>;
    const id = typeof w["id"] === "string" && ID_RE.test(w["id"]) && !ids.has(w["id"]) ? w["id"] : null;
    const nome = cleanName(w["nome"], 40);
    if (id === null || nome === "") continue;
    const sids = new Set<string>(); const servicos: NavService[] = [];
    for (const sr of Array.isArray(w["servicos"]) ? (w["servicos"] as unknown[]) : []) {
      if (sr === null || typeof sr !== "object") continue;
      const s = sr as Record<string, unknown>;
      const sid = typeof s["id"] === "string" && ID_RE.test(s["id"]) && !sids.has(s["id"]) ? s["id"] : null;
      const url = typeof s["url"] === "string" && /^https?:\/\/\S+$/i.test(s["url"]) && s["url"].length <= 2048 ? s["url"] : null;
      if (sid === null || url === null) continue;
      let snome = cleanName(s["nome"], 40); if (snome === "") { try { snome = new URL(url).hostname; } catch { snome = url.slice(0, 40); } }
      const icone = typeof s["icone"] === "string" && /^(https?:|data:image\/)/i.test(s["icone"]) && s["icone"].length <= 2048 ? s["icone"] : null;
      servicos.push({ id: sid, nome: snome, url, icone }); sids.add(sid);
      if (servicos.length >= MAX_SERVICOS) break;
    }
    lista.push({ id, nome, servicos, ...(w["oculto"] === true ? { oculto: true as const } : {}) }); ids.add(id);
    if (lista.length >= MAX_ESPACOS) break;
  }
  // O ativo nunca é um oculto: cai no primeiro visível (ou nenhum).
  const visivel = (id: string): boolean => lista.some((w) => w.id === id && w.oculto !== true);
  const ativo = typeof p["ativo"] === "string" && visivel(p["ativo"]) ? p["ativo"] : (lista.find((w) => w.oculto !== true)?.id ?? null);
  return { ativo, lista };
}
function normalizeNavEspacos(v: unknown): Record<string, NavWorkspaces> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, NavWorkspaces> = {};
  for (const [host, w] of Object.entries(v as Record<string, unknown>)) { if (!isValidHost(host)) continue; const n = normalizeNavWorkspaces(w); if (n.lista.length > 0) out[host] = n; }
  return out;
}
export const NAV_NOTIFY_DEFAULT_INSTRUCTION = "Chegou uma notificação de um site que acompanho. Traduza para português, se estiver em outra língua, e explique em termos simples, para quem não é técnico, o que ela significa e se preciso fazer alguma coisa. Seja breve: no máximo cinco linhas.";
export const defaultNavNotify = (): NavNotifyPref => ({ enabled: false, instruction: NAV_NOTIFY_DEFAULT_INSTRUCTION, hosts: [], mode: "site", avisar: "tratado" });
const HOST_ITEM_RE = /^[a-z0-9.-]+$/;
/** Aceita um objeto parcial (arquivo antigo, patch das Configurações) e devolve a preferência completa. */
export function normalizeNavNotify(v: unknown, base: NavNotifyPref = defaultNavNotify()): NavNotifyPref {
  const p = (v !== null && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const hosts = Array.isArray(p["hosts"]) ? [...new Set((p["hosts"] as unknown[]).map((h) => (typeof h === "string" ? h.trim().toLowerCase() : "")).filter((h) => h !== "" && HOST_ITEM_RE.test(h)))] : base.hosts;
  const instruction = typeof p["instruction"] === "string" ? p["instruction"].trim().slice(0, 2000) : base.instruction;
  return {
    enabled: typeof p["enabled"] === "boolean" ? p["enabled"] : base.enabled,
    instruction: instruction === "" ? NAV_NOTIFY_DEFAULT_INSTRUCTION : instruction,
    hosts,
    mode: p["mode"] === "each" || p["mode"] === "site" ? p["mode"] : base.mode,
    avisar: p["avisar"] === "tratado" || p["avisar"] === "chegada" || p["avisar"] === "nunca" ? p["avisar"] : base.avisar,
  };
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
  version: 1, lastHost: null, backendModel: DEFAULT_MODEL, defaultModelByHost: {}, backendPort: DEFAULT_PORT, backendPortByHost: {}, fontSize: DEFAULT_FONT, zoomLevel: 0,
  theme: "system", notifications: true, contextBudgetTokens: DEFAULT_BUDGET, memoryEveryTurns: DEFAULT_MEMORY_EVERY,
  quickEntryEnabled: true, dadosNoDrive: true, quickEntryShortcut: DEFAULT_SHORTCUT, windowBounds: {}, podHosts: [], navAgentHosts: [], navFavoritos: {}, onboarding: "pending", openDirect: true, hostNames: {}, navNotify: defaultNavNotify(), navEspacos: {}, atualizarOcioso: true,
});

/** Aceita qualquer JSON (inclusive o formato v2 com `sshHost`) e devolve um SettingsFile válido. */
export function normalizeSettings(input: unknown): SettingsFile {
  const p = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const byHost: Record<string, BackendModel> = {};
  const rawByHost = p["defaultModelByHost"];
  if (rawByHost !== null && typeof rawByHost === "object") {
    for (const [h, m] of Object.entries(rawByHost as Record<string, unknown>)) if (isValidHost(h) && isBackendModel(m)) byHost[h] = m;
  }
  const portByHost: Record<string, number> = {};
  const rawPortByHost = p["backendPortByHost"];
  if (rawPortByHost !== null && typeof rawPortByHost === "object") {
    for (const [h, n] of Object.entries(rawPortByHost as Record<string, unknown>)) if (isValidHost(h) && isPort(n)) portByHost[h] = n;
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
    backendPortByHost: portByHost,
    fontSize: isFont(p["fontSize"]) ? p["fontSize"] : DEFAULT_FONT,
    zoomLevel: isZoomLevel(p["zoomLevel"]) ? p["zoomLevel"] : 0,
    theme: isTheme(p["theme"]) ? p["theme"] : "system",
    notifications: typeof p["notifications"] === "boolean" ? p["notifications"] : true,
    contextBudgetTokens: isBudget(p["contextBudgetTokens"]) ? p["contextBudgetTokens"] : DEFAULT_BUDGET,
    memoryEveryTurns: isEvery(p["memoryEveryTurns"]) ? p["memoryEveryTurns"] : DEFAULT_MEMORY_EVERY,
    quickEntryEnabled: typeof p["quickEntryEnabled"] === "boolean" ? p["quickEntryEnabled"] : true,
    dadosNoDrive: typeof p["dadosNoDrive"] === "boolean" ? p["dadosNoDrive"] : true,
    quickEntryShortcut: typeof p["quickEntryShortcut"] === "string" && parseAccelerator(p["quickEntryShortcut"]) !== null ? p["quickEntryShortcut"] : DEFAULT_SHORTCUT,
    windowBounds: bounds,
    onboarding: isOnboarding(p["onboarding"]) ? p["onboarding"] : "pending",
    openDirect: typeof p["openDirect"] === "boolean" ? p["openDirect"] : true,
    podHosts: Array.isArray(p["podHosts"]) ? [...new Set((p["podHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    navAgentHosts: Array.isArray(p["navAgentHosts"]) ? [...new Set((p["navAgentHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    hostNames: normalizeHostNames(p["hostNames"]),
    navFavoritos: normalizeNavFavoritos(p["navFavoritos"]),
    navNotify: normalizeNavNotify(p["navNotify"]),
    navEspacos: normalizeNavEspacos(p["navEspacos"]),
    atualizarOcioso: typeof p["atualizarOcioso"] === "boolean" ? p["atualizarOcioso"] : true,
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
