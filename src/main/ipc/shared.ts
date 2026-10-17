/**
 * Handlers IPC comuns ao meu-bot e ao meu-bot-admin: leituras da máquina (WhatsApp, logins) e o que é só
 * deste Mac (configurações, memória, abrir o seletor). Nada aqui escreve na máquina da pessoa.
 */
import { app, dialog, Menu, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SettingsUpdate, SettingsView, WhatsappMenuAction } from "../../shared/ipc";
import { slugify } from "../export";
import { runSsh, whatsappChats, whatsappClearPlan, whatsappClearSessions, whatsappExportBody, whatsappLearnNames, whatsappPause, whatsappSetMarks, whatsappStatus, whatsappThread } from "../whatsapp";
import { parseWaMarkPatches, waMarkLogText } from "../whatsapp-marks";
import { closeTerminal, openTerminal, ownedTerminal, replayTerminal, resizeTerminal, writeTerminal } from "../terminal";
import { isSupportAlias, supportLogSh } from "../support-code";
import { applyUpdate, checkNow, updateState } from "../updater";
import { checkNow as netCheckNow, hostIsLocalAddr } from "../net";
import { claudeAuthInfo } from "../claudeLogin";
import { xaiAuthInfo } from "../xaiLogin";
import { xaiKeyStatus } from "../xaiKey";
import { closeTunnel } from "../tunnel";
import { anyConversationBusy } from "../conversation";
import { getBackendPort, getQuickEntry, settingsView, updateSettings } from "../settings";
import { applyQuickEntryShortcut } from "../quickEntry";
import { getMemory, NOTAS_MAX, PERFIL_MAX, setMemory } from "../memory";
import { knownModels, showPicker } from "../picker";
import { broadcast } from "../windows";
import { caps } from "../variant";
import { waMenuState, waMenuTemplate, type WaMenuEntry } from "../wa-menu";
import { EXTERNAL_URL, hostFromEvent, waNumber, windowFromEvent } from "./context";
import { handleShared, onShared } from "./registry";

export interface SharedIpcDeps {
  /** No meu-bot-admin: a pessoa dona da máquina e o apelido dela para ela (vem de admin/support-admin.ts; aqui só se injeta). */
  person: (host: string) => { name: string; machine: string | null } | null;
}

export function registerSharedIpc(deps: SharedIpcDeps): void {
  handleShared("window:info", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return null;
    const c = caps();
    const p = c.supportAdmin ? deps.person(ctx.host) : null;
    return { host: ctx.host, models: knownModels(ctx.host), caps: c, person: p?.name ?? null, machine: p?.machine ?? null, version: app.getVersion() };
  });
  handleShared("ui:open-picker", () => showPicker());
  handleShared("shell:open-external", (_event, payload: unknown) => {
    const url = (payload as { url?: unknown })?.url;
    if (typeof url === "string" && EXTERNAL_URL.test(url)) void shell.openExternal(url);
  });

  // Leituras da máquina desta janela.
  handleShared("whatsapp:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappStatus(h.host);
  });
  handleShared("whatsapp:chats", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappChats(h.host);
  });
  handleShared("whatsapp:thread", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const number = (payload as { number?: unknown } | null)?.number;
    if (typeof number !== "string") throw new Error("número inválido");
    return whatsappThread(h.host, number);
  });
  handleShared("claude-login:auth", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return claudeAuthInfo(h.host);
  });
  handleShared("xai-login:auth", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return xaiAuthInfo(h.host); });
  handleShared("xai-key:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return xaiKeyStatus(h.host);
  });

  // Menu "…" da conversa do WhatsApp: os itens vêm de wa-menu.ts (puro); aqui só o Menu do Electron.
  handleShared("ui:wa-menu", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return null;
    const entries = waMenuTemplate(waMenuState(payload), caps());
    return new Promise<WhatsappMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: WhatsappMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const toItem = (e: WaMenuEntry): Electron.MenuItemConstructorOptions =>
        "separator" in e ? { type: "separator" }
          : "submenu" in e ? { label: e.label, submenu: e.submenu.map(toItem) }
            : { label: e.label, enabled: e.enabled, ...(e.action === null ? {} : { click: () => pick(e.action) }) };
      const menu = Menu.buildFromTemplate(entries.map(toItem));
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: h.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });
  handleShared("whatsapp:export", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const number = waNumber(payload);
    const format = (payload as { format?: unknown }).format;
    if (format !== "md" && format !== "json") throw new Error("formato inválido");
    const { name, body } = await whatsappExportBody(h.host, number, format);
    const result = await dialog.showSaveDialog(h.win, {
      title: "Exportar conversa do WhatsApp",
      defaultPath: path.join(app.getPath("documents"), `whatsapp-${slugify(name)}.${format}`),
      filters: format === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });

  // Limpar o histórico de um contato (a confirmação é da tela, inline na lista).
  handleShared("whatsapp:clear-plan", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const { own, shared } = await whatsappClearPlan(h.host, waNumber(payload));
    return { own: own.length, shared: shared.length };
  });
  // A confirmação é da tela (inline na lista). Zerar a principal só com `includeShared`: se ela apareceu
  // depois que a pessoa confirmou só a sessão do contato, recusa em vez de zerar sem aviso.
  handleShared("whatsapp:clear", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const includeShared = (payload as { includeShared?: unknown }).includeShared === true;
    const { own, shared } = await whatsappClearPlan(h.host, waNumber(payload));
    if (shared.length > 0 && !includeShared) throw new Error("a conversa mudou; abra Limpar histórico de novo");
    if (own.length + shared.length === 0) throw new Error("não há histórico desta conversa na máquina");
    await whatsappClearSessions(h.host, [...own, ...shared]);
    // No meu-bot-admin, a pessoa vê no registro dela que o suporte limpou o histórico.
    if (caps().supportAdmin && isSupportAlias(h.host)) void runSsh(h.host, `${supportLogSh("admin", `limpou o histórico do WhatsApp de ${waNumber(payload)}`)}\n`, 15_000);
  });

  // Pausar/retomar o agente para um contato.
  handleShared("whatsapp:pause", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const paused = (payload as { paused?: unknown }).paused === true;
    await whatsappPause(h.host, waNumber(payload), paused, caps().supportAdmin ? "admin" : "dono");
    // No meu-bot-admin, a pessoa vê no registro dela que o suporte pausou/retomou o agente para o contato.
    if (caps().supportAdmin && isSupportAlias(h.host)) void runSsh(h.host, `${supportLogSh("admin", `${paused ? "pausou" : "retomou"} o agente do WhatsApp para ${waNumber(payload)}`)}\n`, 15_000);
  });

  // Arquivar/desarquivar/excluir conversas: a marcação mora na máquina (whatsapp-lista.json), então o meu-bot da
  // pessoa e o meu-bot-admin veem a mesma lista. No admin, a pessoa vê no registro dela (a migração não registra).
  handleShared("whatsapp:mark", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const patches = parseWaMarkPatches(payload);
    await whatsappSetMarks(h.host, patches);
    const what = waMarkLogText(patches);
    if (what !== null && caps().supportAdmin && isSupportAlias(h.host)) void runSsh(h.host, `${supportLogSh("admin", what)}\n`, 15_000);
  });

  // Nomes dos contatos sem nome: lê o histórico deles de uma vez e guarda na máquina (cache; não é ação de suporte).
  handleShared("whatsapp:names", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const list = (payload as { numbers?: unknown } | null)?.numbers;
    if (!Array.isArray(list) || list.length === 0 || list.length > 20 || !list.every((n) => typeof n === "string")) throw new Error("números inválidos");
    return whatsappLearnNames(h.host, list as string[]);
  });

  // Terminal: sessões presas à janela que as abriu. Entrada e resize sem resposta (uma por tecla). Os dois
  // apps: no meu-bot-admin a pessoa vê no registro dela que o suporte abriu um terminal.
  handleShared("term:open", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { cols?: unknown; rows?: unknown } | null;
    const id = await openTerminal(h.win, h.host, typeof p?.cols === "number" ? p.cols : 80, typeof p?.rows === "number" ? p.rows : 24);
    if (caps().supportAdmin && isSupportAlias(h.host)) void runSsh(h.host, `${supportLogSh("admin", "abriu um terminal")}\n`, 15_000);
    return { id };
  });
  const termOf = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, payload: unknown) => {
    const win = windowFromEvent(event);
    const id = (payload as { id?: unknown } | null)?.id;
    return win === null || typeof id !== "string" ? null : ownedTerminal(id, win.id);
  };
  onShared("term:input", (event, payload: unknown) => {
    const s = termOf(event, payload);
    const data = (payload as { data?: unknown }).data;
    if (s !== null && (typeof data === "string" || data instanceof Uint8Array)) writeTerminal(s, data);
  });
  onShared("term:resize", (event, payload: unknown) => {
    const s = termOf(event, payload);
    const p = payload as { cols?: unknown; rows?: unknown };
    if (s !== null && typeof p.cols === "number" && typeof p.rows === "number") resizeTerminal(s, p.cols, p.rows);
  });
  handleShared("term:close", (event, payload: unknown) => { const s = termOf(event, payload); if (s !== null) closeTerminal(s); });
  handleShared("term:replay", (event, payload: unknown) => { const s = termOf(event, payload); return s === null ? new Uint8Array() : replayTerminal(s); });

  // Atualização automática do próprio app.
  handleShared("update:state", () => updateState());
  handleShared("update:check", () => checkNow());
  handleShared("net:check", (_event, payload: unknown) => netCheckNow((payload as { force?: unknown } | null)?.force === true));
  handleShared("host:local-addr", (event) => { const h = hostFromEvent(event)?.host; return h === undefined ? false : hostIsLocalAddr(h); });
  handleShared("update:apply", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); applyUpdate(); });

  // Configurações e memória: deste Mac, valem para os dois apps.
  // Abrir ao entrar no Mac: o sistema é a fonte da verdade (a pessoa pode mudar nos Ajustes); só o app empacotado se registra.
  const withLogin = (v: SettingsView): SettingsView => ({ ...v, openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin, openAtLoginAvailable: app.isPackaged });
  handleShared("settings:get", (event) => withLogin(settingsView(hostFromEvent(event)?.host)));
  handleShared("settings:set", (event, update: unknown) => {
    const host = hostFromEvent(event)?.host;
    const u = (update ?? {}) as SettingsUpdate;
    const clean: SettingsUpdate = {
      ...(typeof u.backendModel === "string" ? { backendModel: u.backendModel } : {}),
      ...(typeof u.backendModelForHost === "string" ? { backendModelForHost: u.backendModelForHost } : {}),
      ...(typeof u.backendPort === "number" ? { backendPort: u.backendPort } : {}),
      ...(typeof u.fontSize === "number" ? { fontSize: u.fontSize } : {}),
      ...(typeof u.theme === "string" ? { theme: u.theme } : {}),
      ...(typeof u.notifications === "boolean" ? { notifications: u.notifications } : {}),
      ...(typeof u.openAtLogin === "boolean" ? { openAtLogin: u.openAtLogin } : {}),
      ...(typeof u.contextBudgetTokens === "number" ? { contextBudgetTokens: u.contextBudgetTokens } : {}),
      ...(typeof u.memoryEveryTurns === "number" ? { memoryEveryTurns: u.memoryEveryTurns } : {}),
      ...(typeof u.quickEntryEnabled === "boolean" ? { quickEntryEnabled: u.quickEntryEnabled } : {}),
      ...(typeof u.quickEntryShortcut === "string" ? { quickEntryShortcut: u.quickEntryShortcut } : {}),
      ...(u.onboarding === "done" || u.onboarding === "skipped" || u.onboarding === "pending" ? { onboarding: u.onboarding } : {}),
    };
    // Porta nova atinge todos os túneis, o que cortaria uma resposta em andamento; recusa até ficar ocioso.
    const portChanges = clean.backendPort !== undefined && clean.backendPort !== getBackendPort();
    if (portChanges && anyConversationBusy()) {
      throw new Error("Há uma resposta em andamento. Espere terminar antes de trocar a porta.");
    }
    const view = updateSettings(clean, host);
    // A entrada rápida é do chat: o meu-bot-admin não registra o atalho global.
    if (caps().chat) { const qe = getQuickEntry(); applyQuickEntryShortcut(qe.enabled, qe.shortcut); }
    nativeTheme.themeSource = view.theme;
    if (portChanges) closeTunnel();
    // Outras janelas (fonte, tema, notificações…): cada uma recebe a visão com o modelo da sua máquina.
    broadcast("settings:changed", settingsView());
    if (clean.openAtLogin !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: clean.openAtLogin });
    return withLogin(view);
  });

  const memoryView = () => ({ ...getMemory(), limits: { notas: NOTAS_MAX, perfil: PERFIL_MAX } });
  handleShared("memory:get", () => memoryView());
  handleShared("memory:set", (_event, payload: unknown) => {
    const p = (payload ?? {}) as { notas?: unknown; perfil?: unknown };
    setMemory({
      ...(typeof p.notas === "string" ? { notas: p.notas } : {}),
      ...(typeof p.perfil === "string" ? { perfil: p.perfil } : {}),
    });
    const view = memoryView();
    broadcast("memory:changed", view);
    return view;
  });
}
