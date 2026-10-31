import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BackendModel, NavWorkspaces, QuickEntryStatus, SettingsUpdate, SettingsView, Theme } from "../../shared/ipc";
import { parseAccelerator } from "./accelerator";
import { clampZoom } from "./zoom-core";
import {
  defaultSettings, emptyWorkspaces, isAbaFixa, isBackendModel, isBudget, isEvery, isOnboarding, isPort, isTheme, isValidHost, normalizeNavWorkspaces, normalizeSettings,
  type SettingsFile,
 normalizeFavoritos, type NavFavoritoItem } from "./settings-normalize";

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
/** Porta do backend: a da máquina, se definida; senão a padrão. */
export const getBackendPort = (host?: string): number => (host !== undefined ? file.backendPortByHost[host] : undefined) ?? file.backendPort;
/** Porta só desta máquina ("Usar porta N" no seletor, instalação em porta livre); igual à padrão tira a exceção. */
export function setBackendPortForHost(host: string, port: number): void {
  if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
  if (!isPort(port)) throw new Error("Porta do backend inválida (1 a 65535).");
  const next = { ...file.backendPortByHost };
  if (port === file.backendPort) delete next[host]; else next[host] = port;
  file.backendPortByHost = next;
  persist();
}
export const getTheme = (): Theme => file.theme;
export const getContextBudget = (): number => file.contextBudgetTokens;
export const getMemoryEveryTurns = (): number => file.memoryEveryTurns;
/** Zoom da interface (nível -8..8, 0 = 100%); quem aplica nas janelas é zoom.ts. */
export const getZoomLevel = (): number => file.zoomLevel;
export function setZoomLevel(level: number): void {
  const next = clampZoom(level);
  if (next === file.zoomLevel) return;
  file.zoomLevel = next;
  try { persist(); } catch { /* cortesia: o zoom vale até fechar */ }
}
/** A entrada rápida é sempre ativa: o interruptor saiu das configurações, e um "false" gravado por versões antigas é ignorado. */
export const getQuickEntry = (): { enabled: boolean; shortcut: string } => ({ enabled: true, shortcut: file.quickEntryShortcut });
/** Cópia diária do CRM e do financeiro no Drive do dono; desligada aqui, para quem não quer nada fora da máquina. */
export const getDadosNoDrive = (): boolean => file.dadosNoDrive;
export function setDadosNoDrive(ligado: boolean): void { if (file.dadosNoDrive === ligado) return; file.dadosNoDrive = ligado; persist(); }


export const isOnboardingDone = (): boolean => file.onboarding !== "pending";
/** Caixinha do seletor: marcada = feito (respeita), desmarcada = pendente (força na próxima janela). */
export function setOnboardingDone(done: boolean): void {
  const next = done ? "done" : "pending";
  if (file.onboarding === next || (done && file.onboarding === "skipped")) return;
  file.onboarding = next;
  persist();
}

export const getOpenDirect = (): boolean => file.openDirect;
export function setOpenDirect(value: boolean): void {
  if (file.openDirect === value) return;
  file.openDirect = value;
  persist();
}

/**
 * Apelidos gravados nas próprias máquinas (o admin os dá na aba Usuários), vistos na última sondagem. Só em memória:
 * a máquina é a fonte; cada sondagem atualiza. O "Renomear" deste Mac (hostNames) vence quando existe.
 */
const apelidosMaquina: Record<string, string> = {};
/** Devolve se o nome mostrado mudou (quem sonda avisa as janelas com settings:changed). */
export function setApelidoMaquina(host: string, apelido: string | null): boolean {
  const clean = (apelido ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const antes = getHostNames()[host];
  if (clean === "") delete apelidosMaquina[host]; else apelidosMaquina[host] = clean;
  return getHostNames()[host] !== antes;
}
export const getHostNames = (): Record<string, string> => ({ ...apelidosMaquina, ...file.hostNames });
/** "Renomear" no seletor: apelido da máquina no app (vazio tira). A chave SSH continua a mesma. */
export function setHostName(host: string, name: string): void {
  if (!isValidHost(host)) return;
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  const next = { ...file.hostNames };
  // O campo vem preenchido com o apelido da máquina: salvar sem mudar nada não vira um nome local, senão o apelido
  // que o admin trocar depois nunca mais aparecia neste Mac.
  if (clean === "" || clean === apelidosMaquina[host]) delete next[host]; else next[host] = clean;
  file.hostNames = next;
  persist();
}

export const isPodHost = (host: string): boolean => file.podHosts.includes(host);
/** "🤖 agente pode usar" o Navegador: lembrado por máquina, para sobreviver a reinícios do app. */
export const isNavAgentHost = (host: string): boolean => file.navAgentHosts.includes(host);
export function setNavAgentHost(host: string, on: boolean): void {
  if (!isValidHost(host)) return;
  const next = file.navAgentHosts.filter((h) => h !== host);
  if (on) next.push(host);
  file.navAgentHosts = next;
  persist();
}
/** "O agente pode usar o Gmail": lembrado por máquina (religa sozinho com a conta conectada). */
export const isGmailAgentHost = (host: string): boolean => file.gmailAgentHosts.includes(host);
export function setGmailAgentHost(host: string, on: boolean): void {
  if (!isValidHost(host)) return;
  const next = file.gmailAgentHosts.filter((h) => h !== host);
  if (on) next.push(host);
  file.gmailAgentHosts = next;
  persist();
}
/** Favoritos do Navegador da máquina (cópia). */
export const navFavoritos = (host: string): NavFavoritoItem[] => (file.navFavoritos[host] ?? []).map((f) => ({ ...f }));
/** Adiciona (ou, com a mesma url, só atualiza o título se vier um) e devolve a lista; limite MAX_FAVORITOS. */
export function addNavFavorito(host: string, f: { titulo: string; url: string }): NavFavoritoItem[] {
  if (!isValidHost(host)) return [];
  const cur = navFavoritos(host);
  const i = cur.findIndex((x) => x.url === f.url);
  const titulo = f.titulo.replace(/\s+/g, " ").trim().slice(0, 60);
  if (i >= 0) { if (titulo !== "") cur[i] = { ...cur[i]!, titulo }; }
  else cur.push({ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, titulo, url: f.url });
  const next = normalizeFavoritos(cur);
  file.navFavoritos = { ...file.navFavoritos, [host]: next };
  persist();
  return next.map((x) => ({ ...x }));
}
/** Remove por id ou por url; devolve a lista. */
export function removeNavFavorito(host: string, idOrUrl: string): NavFavoritoItem[] {
  if (!isValidHost(host)) return [];
  const next = navFavoritos(host).filter((x) => x.id !== idOrUrl && x.url !== idOrUrl);
  const all = { ...file.navFavoritos }; if (next.length === 0) delete all[host]; else all[host] = next;
  file.navFavoritos = all;
  persist();
  return next;
}
/** Espaços de trabalho do Navegador da máquina (cópia). */
export const navEspacos = (host: string): NavWorkspaces => normalizeNavWorkspaces(file.navEspacos[host] ?? emptyWorkspaces());
/** Grava o estado inteiro (validado); devolve o que ficou. */
export function setNavEspacos(host: string, w: unknown): NavWorkspaces {
  if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
  const n = normalizeNavWorkspaces(w);
  const all = { ...file.navEspacos }; if (n.lista.length === 0) delete all[host]; else all[host] = n;
  file.navEspacos = all;
  persist();
  return navEspacos(host);
}
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
  backendPortForHost: getBackendPort(host),
  zoomLevel: file.zoomLevel,
  theme: file.theme,
  notifications: file.notifications,
  contextBudgetTokens: file.contextBudgetTokens,
  memoryEveryTurns: file.memoryEveryTurns,
  quickEntryEnabled: file.quickEntryEnabled,
  quickEntryShortcut: file.quickEntryShortcut,
  quickEntryStatus: quickEntryStatusProvider(),
  onboarding: file.onboarding,
  openDirect: file.openDirect,
  // Preenchidos pelo handler settings:get/set (dependem do app empacotado e do sistema).
  openAtLogin: false, openAtLoginAvailable: false,
  hostNames: getHostNames(),
  navEspacos: host === undefined ? emptyWorkspaces() : navEspacos(host),
  atualizarOcioso: true, // sempre ligado por enquanto (o interruptor está travado nas Configurações)
  abaFixa: file.abaFixa,
});
/** "Atualizar sozinho quando o Mac estiver ocioso" (o updater consulta a cada minuto com uma versão pronta). */
/** Sempre ligado por enquanto: o interruptor fica travado nas Configurações; um "false" gravado antes é ignorado. */
export const getAtualizarOcioso = (): boolean => true;

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
  if (update.backendPortForHost !== undefined && host !== undefined) {
    if (!isPort(update.backendPortForHost)) throw new Error("Porta do backend inválida (1 a 65535).");
    const next = { ...file.backendPortByHost };
    if (update.backendPortForHost === file.backendPort) delete next[host]; else next[host] = update.backendPortForHost;
    file.backendPortByHost = next;
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
  if (update.atualizarOcioso !== undefined) file.atualizarOcioso = update.atualizarOcioso === true;
  if (update.abaFixa !== undefined) {
    if (!isAbaFixa(update.abaFixa)) throw new Error("Aba fixada inválida.");
    file.abaFixa = update.abaFixa;
  }
  persist();
  return settingsView(host);
}
