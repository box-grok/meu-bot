/**
 * Aba "Navegador" (módulo Pro), feita como no Rambox: cada aba interna é um `<webview>` no DOM da janela
 * (nada de view nativa por cima: modais, paleta e lateral cobrem e empurram como qualquer elemento), todas na
 * mesma sessão da máquina (`persist:navegador-<host>`: cookies e extensões separados do app e de outras máquinas).
 * Aqui no main fica o que o DOM não faz: preparar a sessão (permissões fechadas, User-Agent sem a assinatura do
 * Electron, Chrome Web Store ligada pelo electron-chrome-web-store, como no Rambox), listar/remover extensões, e
 * tratar os webviews dessa sessão quando nascem (`web-contents-created`): janelas novas viram abas internas,
 * Cmd+… volta para o app. Os webviews não têm preload do app: o conteúdo web não fala IPC com o meu-bot.
 */
import { BrowserWindow, app, session, shell, type Session, type WebContents } from "electron";
import path from "node:path";
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store";
import { log, onReverseState, reversePort, setReverseWanted } from "./tunnel";
import { navSocketPath, startNavApi, stopNavApi } from "./nav-api";
import type { BrowserAgentState } from "../shared/ipc";
import type { BrowserExtensionInfo, BrowserOpenInfo } from "../shared/ipc";

const PART_PREFIX = "persist:navegador-";
const sanit = (host: string): string => host.replace(/[^A-Za-z0-9_-]/g, "_");
export const partitionOf = (host: string): string => `${PART_PREFIX}${sanit(host)}`;
const extensionsDir = (host: string): string => path.join(app.getPath("userData"), "Navegador", sanit(host), "Extensions");
const hostOfPartition = (part: string): string | null => (part.startsWith(PART_PREFIX) ? part.slice(PART_PREFIX.length) : null);

const readySessions = new Map<string, Promise<void>>();
/** Sessão da máquina pronta (uma vez por sessão): permissões, UA e Web Store. */
function prepareSession(host: string): { ses: Session; ready: Promise<void> } {
  const part = partitionOf(host);
  const ses = session.fromPartition(part);
  let ready = readySessions.get(part);
  if (ready === undefined) {
    const allowed = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    ses.on("will-download", (_e, item) => { log(`[navegador ${host}] download: ${item.getFilename()}`); });
    // Sem a assinatura do Electron no User-Agent: o login do Google e outros tratam app embutido como inseguro.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ meu-bot[^ ]*\/\S+/, ""));
    ready = installChromeWebStore({
      session: ses,
      extensionsPath: extensionsDir(host),
      autoUpdate: true,
      minimumManifestVersion: 3,
      beforeInstall: async (d) => { log(`[navegador ${host}] instalando extensão ${d.localizedName} (${d.id})`); return { action: "allow" }; },
    }).then(() => { log(`[navegador ${host}] sessão pronta (${ses.getAllExtensions().length} extensões)`); })
      .catch((e: unknown) => { log(`[navegador ${host}] web store não ligou: ${e instanceof Error ? e.message : String(e)}`); });
    readySessions.set(part, ready);
    ses.on("extension-loaded", () => publishExtensions(host));
    ses.on("extension-unloaded", () => publishExtensions(host));
  }
  return { ses, ready };
}

const extensionsOf = (ses: Session): BrowserExtensionInfo[] => ses.getAllExtensions().map((e) => ({ id: e.id, name: e.name, version: e.version }));
/** Janelas desta máquina recebem a lista nova de extensões (instalou pela Web Store, removeu…). */
function publishExtensions(host: string): void {
  const list = extensionsOf(session.fromPartition(partitionOf(host)));
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:extensions", list);
}
/** Host de cada janela que abriu o navegador (para os eventos dos webviews voltarem à janela certa). */
const windowHosts = new Map<number, string>();

/** Prepara a sessão e devolve o que o renderer precisa para criar os `<webview>`. */
export async function browserOpen(win: BrowserWindow, host: string): Promise<BrowserOpenInfo> {
  const { ses, ready } = prepareSession(host);
  await ready;
  windowHosts.set(win.id, host);
  log(`[navegador ${host}] aberto na janela ${win.id}`);
  return { partition: partitionOf(host), extensions: extensionsOf(ses), agent: browserAgentInfo(host) };
}
export const browserExtensions = (host: string): BrowserExtensionInfo[] => extensionsOf(session.fromPartition(partitionOf(host)));
export async function browserRemoveExtension(host: string, extId: string): Promise<BrowserExtensionInfo[]> {
  const ses = session.fromPartition(partitionOf(host));
  await uninstallExtension(extId, { session: ses, extensionsPath: extensionsDir(host) });
  log(`[navegador ${host}] extensão removida: ${extId}`);
  return extensionsOf(ses);
}
export function browserForget(winId: number): void {
  const host = windowHosts.get(winId);
  windowHosts.delete(winId);
  // Última janela do host fechou: o agente perde o navegador (socket e -R caem).
  if (host !== undefined && ![...windowHosts.values()].includes(host)) browserAgent(host, false);
}

// ---- "Agente pode usar": o serviço de ações sobe num socket 0700 e o túnel reverso o leva à máquina. O backend
// recebe a porta no cabeçalho de cada turno (X-Meu-Bot-Browser-Port) enquanto estiver ligado e de pé.
const agentOn = new Set<string>();
const agentState = new Map<string, BrowserAgentState>();
const tellAgent = (host: string, st: BrowserAgentState): void => {
  agentState.set(host, st);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:agent", st);
};
onReverseState((host, state, port) => { if (agentOn.has(host)) tellAgent(host, { on: true, state, port }); });
export function browserAgent(host: string, on: boolean): void {
  if (on) {
    agentOn.add(host);
    tellAgent(host, { on: true, state: "connecting", port: null });
    void startNavApi(host).then((sock) => setReverseWanted(host, sock)).catch((e: unknown) => { log(`[navegador ${host}] serviço do agente não subiu: ${e instanceof Error ? e.message : String(e)}`); tellAgent(host, { on: true, state: "down", port: null }); });
  } else {
    if (!agentOn.has(host)) return;
    agentOn.delete(host);
    setReverseWanted(host, null);
    stopNavApi(host);
    tellAgent(host, { on: false, state: "down", port: null });
  }
}
export const browserAgentInfo = (host: string): BrowserAgentState => agentState.get(host) ?? { on: false, state: "down", port: null };
/** Porta remota a mandar ao backend neste turno (só com o agente ligado e o -R de pé). */
export const browserAgentPort = (host: string): number | null => (agentOn.has(host) ? reversePort(host) : null);
export const browserSocketPath = navSocketPath;

/** Aba ativa de cada host (o renderer avisa): as ações do agente sem `aba` caem nela. */
const activeByHost = new Map<string, number>();
export const browserSetActive = (host: string, wcId: number): void => { activeByHost.set(host, wcId); };
export const browserActiveWcId = (host: string): number | null => activeByHost.get(host) ?? null;
/** Os webContents vivos dos webviews do navegador, por host (as ações do agente só alcançam estes). */
const views = new Map<number, { wc: WebContents; host: string; winId: number }>();
export const browserWebContents = (host: string): WebContents[] => [...views.values()].filter((v) => v.host === host && !v.wc.isDestroyed()).map((v) => v.wc);
/** Pede ao renderer da janela do host uma ação de aba (o DOM é dele): nova aba, ativar ou fechar pelo id do webContents. */
export function browserAsk(host: string, msg: { kind: "new-tab"; url: string } | { kind: "activate" | "close"; wcId: number }): boolean {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) { win.webContents.send("browser:ask", msg); return true; }
  return false;
}

// Cada <webview> anexado a uma janela que abriu o navegador: popups viram aba interna; Cmd+… volta ao app.
// Registrado pelo main.ts no boot (não no import: os testes puros carregam módulos do main sem Electron).
export function installBrowserHooks(): void { app.on("browser-window-created", onWindowCreated); }
function onWindowCreated(_e: Electron.Event, win: BrowserWindow): void {
  win.webContents.on("did-attach-webview", (_ev, wc) => {
    const host = windowHosts.get(win.id);
    if (host === undefined) return;
    views.set(wc.id, { wc, host, winId: win.id });
    wc.on("destroyed", () => { views.delete(wc.id); });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) { if (!win.isDestroyed()) win.webContents.send("browser:open-url", { url }); }
      else if (/^(mailto|tel):/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.meta) return;
      const k = input.key.toLowerCase();
      if (["k", "j", "n", "b", "w", "t", "l", "[", "]"].includes(k) || (input.shift && (k === "b" || k === "n"))) {
        event.preventDefault();
        if (!win.isDestroyed()) { win.webContents.focus(); win.webContents.send("browser:key", { key: k, shift: input.shift }); }
      }
    });
  });
}
