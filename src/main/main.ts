/**
 * Arranque do app: instância única, argumentos (atalhos da mesa), menu, seletor, entrada rápida, túneis e
 * energia. Os handlers IPC moram em ipc/ (comuns e do meu-bot normal) e admin/ (meu-bot-admin); aqui só se
 * compõe: registerIpc, initPicker e o que depende da variante (caps()).
 */
import { app, BrowserWindow, dialog, nativeTheme, powerMonitor } from "electron";
import { onVersaoMinima } from "./maquina/backend";
import { LOCAL_HOST } from "./maquina/localBackend";
import { closeTunnel, ensureTunnel, log, markSuspect, onTunnelState, revalidate } from "./maquina/tunnel";
import { loadConversations } from "./conversa/conversation";
import { getFontSize, getLastHost, getQuickEntry, getTheme, loadSettings, setLastHost, setQuickEntryStatusProvider } from "./app/settings";
import { applyQuickEntryShortcut, disposeQuickEntry, initQuickEntry, quickEntryStatus } from "./app/quickEntry";
import { loadMemory } from "./conversa/memory";
import { appVariant, caps, produto, userDataName } from "./app/variant";
import { personInfo } from "./admin/support-admin";
import { adminPickerSource } from "./admin/picker-source";
import { migrateAdminPessoas } from "./admin/user-data";
import { herdarDe, useVariantUserData, fundirDe, relatorioFusao } from "./app/user-data";
import { registerIpc } from "./ipc/index";
import { applyStagedOnQuit, checkIfStale as checkUpdateIfStale, checkNow as checkUpdateNow, disposeUpdater, initUpdater, lastUpdateErrorWasNetwork, noteVersaoMinima } from "./atualizacao/updater";
import { checkNow as checkNetNow, disposeNet, initNet, onBackOnline } from "./app/net";
import { installBrowserHooks } from "./navegador/browser";
import { startTermApi } from "./terminal/term-api";
import { getBackendPort } from "./app/settings";
import { installAppMenu } from "./app/menu";
import { changeWindowZoom } from "./app/zoom";
import { clientPickerSource, initPicker, showPicker } from "./maquina/picker";
import { hostFromArgv, reliefHostFromArgv } from "./app/shortcuts";
import { initRelief, showRelief } from "./app/relief";
import { listSshHosts } from "./maquina/sshConfig";
import { allMainWindows, disposeWindows, getLastFocusedHost, hostOfWindow, lastFocusedWindow, openMainWindow, sendToHost } from "./app/windows";

// Cada produto além do meu-bot tem userData próprio (senão dividiria pasta e trava de instância). Antes de tudo.
// O admin traz o pessoas.json antigo; um produto da pessoa (meu-bot-finance-staging…) nasce como cópia do meu-bot dela.
{ const ud = userDataName(); const de = produto().herdaDe; if (ud !== null) useVariantUserData(ud, caps().supportAdmin ? migrateAdminPessoas : de !== null ? herdarDe(de) : undefined); }
// O meu-bot adota a pasta do antigo meu-bot-crm (uma vez; a origem fica como backup). Depois de herdar, antes de ler qualquer coisa.
{ const fd = produto().fundeDe; if (fd !== null && !app.commandLine.hasSwitch("user-data-dir")) fundirDe(fd)(app.getPath("userData"), app.getPath("appData")); }

// Staging (recompilado várias vezes por dia): o Chromium não guarda a chave dos cookies no Keychain. Com assinatura
// própria (sem Team ID da Apple) cada build é "outro app" para o macOS e o pedido de senha voltava a cada rebuild,
// mesmo com "Permitir Sempre". Produção segue no Keychain até haver certificado Apple. Custo em staging, uma vez na
// troca: os logins do Navegador e o que o safeStorage guardou (Google, Tailscale) precisam ser refeitos.
if (appVariant().endsWith("-staging")) app.commandLine.appendSwitch("use-mock-keychain");

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
  // Aviso único depois de adotar a pasta do antigo meu-bot-crm: o que veio e o que precisa ser refeito.
  if (relatorioFusao !== null) {
    const r = relatorioFusao;
    void dialog.showMessageBox({ type: "info", title: "meu-bot", message: `Trouxe o que você tinha no ${r.origem}.`, detail: `${r.conversas} ${r.conversas === 1 ? "conversa veio" : "conversas vieram"} junto, com favoritos, memória e preferências. O CRM no Gmail abre com o seu plano. Só o login do Google (tutorial 10) e os logins do Navegador precisam ser refeitos uma vez. A pasta do ${r.origem} ficou intacta, como cópia de segurança.`, buttons: ["Entendi"] });
  }
  installAppMenu({
    openPicker: () => showPicker(),
    toggleSettings: () => {
      // Só as janelas de máquina têm Configurações; seletor e alívio ignoram.
      const win = BrowserWindow.getFocusedWindow() ?? lastFocusedWindow();
      if (win !== null && !win.isDestroyed() && hostOfWindow(win) !== undefined) win.webContents.send("ui:toggle-settings", {});
    },
    zoom: (action) => { changeWindowZoom(action); },
  });
  initPicker(caps().supportAdmin ? adminPickerSource : clientPickerSource);
  initRelief();
  initUpdater();
  // O backend de cada máquina diz no hello a versão mínima do app que atende: abaixo dela, a janela bloqueia até atualizar.
  onVersaoMinima(noteVersaoMinima);
  // Internet deste Mac (faixa OFFLINE). Quando volta: revalida os túneis, reabre o das janelas abertas que
  // caíram e refaz a checagem de atualização se ela falhou por rede.
  initNet();
  installBrowserHooks();
  void startTermApi().catch((e: unknown) => { log(`[terminal] controle local não subiu: ${e instanceof Error ? e.message : String(e)}`); });
  onBackOnline(() => {
    markSuspect(); void revalidate();
    const hosts = new Set(allMainWindows().map((w) => hostOfWindow(w)).filter((h): h is string => h !== undefined && h !== LOCAL_HOST));
    for (const h of hosts) void ensureTunnel(h, getBackendPort(h)).catch(() => { /* a próxima mensagem tenta de novo */ });
    if (lastUpdateErrorWasNetwork()) void checkUpdateNow("rede-voltou");
  });
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
  powerMonitor.on("resume", () => { scheduleRevalidate(); void checkNetNow(true); checkUpdateIfStale("acordou"); });
  powerMonitor.on("unlock-screen", () => { scheduleRevalidate(); void checkNetNow(true); checkUpdateIfStale("acordou"); });
});

app.on("window-all-closed", () => {
  // No macOS o app fica no Dock; clicar nele reabre o seletor. Os túneis caem pela carência.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { disposeNet(); disposeUpdater(); disposeQuickEntry(); disposeWindows(); closeTunnel(); applyStagedOnQuit(); });
