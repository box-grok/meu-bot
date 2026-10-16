/**
 * Handlers IPC comuns ao meu-bot e ao meu-bot-admin: leituras da máquina (WhatsApp, logins) e o que é só
 * deste Mac (configurações, memória, abrir o seletor). Nada aqui escreve na máquina da pessoa.
 */
import { app, dialog, Menu, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SettingsUpdate, WhatsappMenuAction } from "../../shared/ipc";
import { slugify } from "../export";
import { whatsappChats, whatsappExportBody, whatsappStatus, whatsappThread } from "../whatsapp";
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
import { EXTERNAL_URL, hostFromEvent, waNumber } from "./context";
import { handleShared } from "./registry";

export interface SharedIpcDeps {
  /** No meu-bot-admin: nome da pessoa dona da máquina (vem de admin/support-admin.ts; aqui só se injeta). */
  personName: (host: string) => string | null;
}

export function registerSharedIpc(deps: SharedIpcDeps): void {
  handleShared("window:info", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return null;
    const c = caps();
    return { host: ctx.host, models: knownModels(ctx.host), caps: c, person: c.supportAdmin ? deps.personName(ctx.host) : null };
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

  // Configurações e memória: deste Mac, valem para os dois apps.
  handleShared("settings:get", (event) => settingsView(hostFromEvent(event)?.host));
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
    return view;
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
