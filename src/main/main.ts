/**
 * Arranque do app: instância única, argumentos (atalhos da mesa), menu, seletor, entrada rápida, túneis e
 * energia. Os handlers IPC moram em ipc/ (comuns e do meu-bot normal) e admin/ (meu-bot-admin); aqui só se
 * compõe: registerIpc, initPicker e o que depende da variante (caps()).
 */
import { app, BrowserWindow, nativeTheme, powerMonitor } from "electron";
import { LOCAL_HOST } from "./localBackend";
import { closeTunnel, markSuspect, onTunnelState, revalidate } from "./tunnel";
import { loadConversations } from "./conversation";
import { getFontSize, getLastHost, getQuickEntry, getTheme, loadSettings, setLastHost, setQuickEntryStatusProvider } from "./settings";
import { applyQuickEntryShortcut, disposeQuickEntry, initQuickEntry, quickEntryStatus } from "./quickEntry";
import { loadMemory } from "./memory";
import { caps } from "./variant";
import { personInfo } from "./admin/support-admin";
import { adminPickerSource } from "./admin/picker-source";
import { useAdminUserData } from "./admin/user-data";
import { registerIpc } from "./ipc";
import { applyStagedOnQuit, disposeUpdater, initUpdater } from "./updater";
import { installAppMenu } from "./menu";
import { clientPickerSource, initPicker, showPicker } from "./picker";
import { hostFromArgv, reliefHostFromArgv } from "./shortcuts";
import { initRelief, showRelief } from "./relief";
import { listSshHosts } from "./sshConfig";
import { disposeWindows, getLastFocusedHost, hostOfWindow, lastFocusedWindow, openMainWindow, sendToHost } from "./windows";

// O meu-bot-admin tem userData próprio (senão dividiria pasta e trava de instância com o meu-bot normal). Antes de tudo.
if (caps().supportAdmin) useAdminUserData();

// Uma instância só: abrir o app de novo (Dock, Finder, `open -a`) mostra o seletor de máquinas.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => openFromArgs(argv));
}

/** `--host=<x>` abre a janela da máquina direto (atalho da mesa); qualquer outra coisa abre o seletor. */
function openFromArgs(argv: readonly string[]): void {
  const relief = reliefHostFromArgv(argv);
  if (relief !== null) { showRelief(relief); return; }
  const host = hostFromArgv(argv);
  if (host === null) { showPicker(); return; }
  if (host !== LOCAL_HOST && !listSshHosts().includes(host)) { showPicker({ error: `A máquina "${host}" do atalho não está no ~/.ssh/config.`, preselect: host }); return; }
  setLastHost(host);
  openMainWindow(host, "shortcut");
}

app.whenReady().then(() => {
  loadSettings();
  nativeTheme.themeSource = getTheme();
  loadMemory();
  loadConversations();
  registerIpc({ person: personInfo });
  installAppMenu({
    openPicker: () => showPicker(),
    toggleSettings: () => {
      // Só as janelas de máquina têm Configurações; seletor e alívio ignoram.
      const win = BrowserWindow.getFocusedWindow() ?? lastFocusedWindow();
      if (win !== null && !win.isDestroyed() && hostOfWindow(win) !== undefined) win.webContents.send("ui:toggle-settings", {});
    },
  });
  initPicker(caps().supportAdmin ? adminPickerSource : clientPickerSource);
  initRelief();
  initUpdater();
  // A entrada rápida é do chat: o meu-bot-admin não a sobe nem registra o atalho global.
  if (caps().chat) {
    setQuickEntryStatusProvider(quickEntryStatus);
    initQuickEntry({
      mainWindow: () => lastFocusedWindow() ?? openMainWindow(getLastFocusedHost() ?? getLastHost() ?? LOCAL_HOST, "quick"),
      fontSize: getFontSize,
      hostLabel: (win) => { const h = hostOfWindow(win) ?? "?"; return h === LOCAL_HOST ? "este Mac" : h; },
    });
    const qe = getQuickEntry();
    applyQuickEntryShortcut(qe.enabled, qe.shortcut);
  }
  // Abertura: pelo seletor (Enter reabre a última máquina), ou direto na máquina de um atalho.
  openFromArgs(process.argv);
  // Clicar no app (Dock, Finder) abre sempre o seletor; para ir direto a uma máquina existe o atalho dela.
  app.on("activate", () => showPicker());

  // Estado do túnel de cada máquina vai para a janela dela.
  onTunnelState((host, state, detail) => {
    const mapped = state === "ready" ? "ready" : state === "error" ? "error" : state === "degraded" ? "degraded" : state === "connecting" ? "connecting" : "idle";
    sendToHost(host, "backend:status", { host, state: mapped, detail: state === "ready" ? "túnel ativo" : detail });
  });

  // O Mac dormiu/acordou: revalida os túneis antes de confiar neles.
  let resumeTimer: NodeJS.Timeout | null = null;
  const scheduleRevalidate = (): void => {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { resumeTimer = null; void revalidate(); }, 2000);
  };
  powerMonitor.on("suspend", () => markSuspect());
  powerMonitor.on("resume", scheduleRevalidate);
  powerMonitor.on("unlock-screen", scheduleRevalidate);
});

app.on("window-all-closed", () => {
  // No macOS o app fica no Dock; clicar nele reabre o seletor. Os túneis caem pela carência.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { disposeUpdater(); disposeQuickEntry(); disposeWindows(); closeTunnel(); applyStagedOnQuit(); });
