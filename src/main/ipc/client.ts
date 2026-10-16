/**
 * Variante: cliente. Handlers IPC só do meu-bot normal: conversar com o agente, parear e mexer no WhatsApp,
 * logins, instalar coisas na máquina, suporte do lado da pessoa. No meu-bot-admin cada canal daqui vira um
 * stub que recusa (ipc/registry.ts): o admin só lê e usa as ações de suporte.
 */
import { app, dialog, Menu, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AudioSetup, ExportFormat, TabMenuAction } from "../../shared/ipc";
import { conversationToMarkdown, conversationTitle, slugify } from "../export";
import { fetchAccountStatus, runBackendTurn } from "../backend";
import { disableSshCheck, restoreLastPolicy } from "../tailscale";
import { cancelPairing, setDmPolicy, startPairing, whatsappBranch, whatsappLogout, whatsappClearPlan, whatsappClearSessions, whatsappPause } from "../whatsapp";
import { cancelClaudeLogin, claudeLogout, startClaudeLogin, submitClaudeLoginCode } from "../claudeLogin";
import { cancelXaiLogin, startXaiLogin, xaiLogout } from "../xaiLogin";
import {
  archiveConversation, branchConversation, closeTab, createConversation, dropConversation, duplicateConversation, getConversation,
  getStoredConversation, listConversationsForHost, openConversation, renameConversation, reorderConversations, setConversationModel,
} from "../conversation";
import { isBackendModel } from "../settings";
import { toggleQuickEntry } from "../quickEntry";
import { installAudio, installStatusLine, prepareGrokOauth, statusLineInstalled } from "../hostProbe";
import { setXaiKey } from "../xaiKey";
import { deliverNow, reportSupportProgress, setSupport, setSupportNameOnly, supportCodeText, supportInfo } from "../support";
import { openMainWindow, sendWhenLoaded } from "../windows";
import { hostFromEvent, ownedConversation, waNumber } from "./context";
import { handleClient } from "./registry";

export function registerClientIpc(): void {
  // Suporte, lado da pessoa (só com o pacote de suporte no .dmg).
  handleClient("support:info", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportInfo(h.host);
  });
  handleClient("support:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { on?: unknown; name?: unknown } | null;
    return setSupport(h.host, p?.on === true, typeof p?.name === "string" ? p.name : "");
  });
  handleClient("support:progress", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return;
    await reportSupportProgress(h.host, payload).catch(() => undefined);
  });
  handleClient("support:name", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportNameOnly(h.host, String((payload as { name?: unknown } | null)?.name ?? ""));
  });
  handleClient("support:deliver", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return deliverNow(h.host);
  });
  handleClient("support:code", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportCodeText(h.host);
  });

  // Grok por chave de API (máquinas sem Hermes). A chave só passa pelo IPC e pelo stdin do ssh; nunca em log.
  handleClient("xai-login:prepare", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return prepareGrokOauth(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", { kind: "log", text: line }); });
  });
  handleClient("xai-key:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const k = (payload as { key?: unknown } | null)?.key;
    return setXaiKey(h.host, k === null ? null : typeof k === "string" ? k.trim() : "");
  });
  // Status line do Claude (tutorial): checar e instalar na máquina desta janela.
  handleClient("statusline:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return statusLineInstalled(h.host);
  });
  handleClient("statusline:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return installStatusLine(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("statusline:progress", { line }); });
  });
  handleClient("tailscale:disable-check", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return disableSshCheck();
  });
  handleClient("tailscale:restore", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return restoreLastPolicy();
  });

  // WhatsApp: parear, áudio, política, pausar, limpar.
  handleClient("whatsapp:pair", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const reset = (payload as { reset?: unknown } | null)?.reset === true;
    return startPairing(h.host, reset, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("whatsapp:event", ev); });
  });
  handleClient("whatsapp:audio", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { kind?: unknown; mode?: unknown } | null;
    const setup: AudioSetup | null = p?.kind === "in" ? { kind: "in" }
      : p?.kind === "out" && (p.mode === "off" || p.mode === "inbound" || p.mode === "always") ? { kind: "out", mode: p.mode } : null;
    if (setup === null) throw new Error("pedido inválido");
    return installAudio(h.host, setup);
  });
  handleClient("whatsapp:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappLogout(h.host);
  });
  handleClient("whatsapp:dm-policy", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const policy = (payload as { policy?: unknown } | null)?.policy;
    if (policy !== "open" && policy !== "self") throw new Error("política inválida");
    return setDmPolicy(h.host, policy);
  });
  handleClient("whatsapp:branch", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappBranch(h.host, waNumber(payload));
  });
  handleClient("whatsapp:pause", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    await whatsappPause(h.host, waNumber(payload), (payload as { paused?: unknown }).paused === true);
  });
  handleClient("whatsapp:clear-plan", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const { own, shared } = await whatsappClearPlan(h.host, waNumber(payload));
    return { own: own.length, shared: shared.length };
  });
  // A confirmação é da tela (inline na lista). Zerar a principal só com `includeShared`: se ela apareceu
  // depois que a pessoa confirmou só a sessão do contato, recusa em vez de zerar sem aviso.
  handleClient("whatsapp:clear", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const includeShared = (payload as { includeShared?: unknown }).includeShared === true;
    const { own, shared } = await whatsappClearPlan(h.host, waNumber(payload));
    if (shared.length > 0 && !includeShared) throw new Error("a conversa mudou; abra Limpar histórico de novo");
    if (own.length + shared.length === 0) throw new Error("não há histórico desta conversa na máquina");
    await whatsappClearSessions(h.host, [...own, ...shared]);
  });
  handleClient("whatsapp:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelPairing();
  });

  // Logins Claude e xAI.
  handleClient("claude-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startClaudeLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("claude-login:event", ev); });
  });
  handleClient("claude-login:code", (event, payload: unknown) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return submitClaudeLoginCode(String((payload as { code?: unknown } | null)?.code ?? ""));
  });
  handleClient("claude-login:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return claudeLogout(h.host);
  });
  handleClient("claude-login:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelClaudeLogin();
  });
  handleClient("xai-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startXaiLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", ev); });
  });
  handleClient("xai-login:cancel", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); cancelXaiLogin(); });
  handleClient("xai-login:logout", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return xaiLogout(h.host); });

  handleClient("backend:account", async (event) => {
    const host = hostFromEvent(event)?.host;
    return host === undefined ? null : fetchAccountStatus(host);
  });
  handleClient("ui:quick-toggle", () => toggleQuickEntry());

  // Conversas com o agente.
  handleClient("chat:send", async (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const p = payload as { conversationId?: unknown; text?: unknown };
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    const conv = typeof p?.conversationId === "string" ? getConversation(p.conversationId) : undefined;
    if (ctx === null || text === "" || conv === undefined || conv.host !== ctx.host) return;
    if (conv.busy) {
      ctx.win.webContents.send("chat:error", { conversationId: conv.id, kind: "unknown", message: "Espere a resposta atual terminar." });
      return;
    }
    conv.busy = true;
    try {
      await runBackendTurn(conv, text);
    } finally {
      conv.busy = false;
    }
  });
  handleClient("chat:cancel", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    owned?.conv.abort?.abort();
  });
  handleClient("chat:new", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return { conversationId: "" };
    return { conversationId: createConversation(ctx.host).id };
  });
  handleClient("chat:list", (event) => {
    const ctx = hostFromEvent(event);
    return ctx === null ? [] : listConversationsForHost(ctx.host);
  });
  handleClient("chat:rename", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; title?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && typeof p?.title === "string") renameConversation(owned.conv.id, p.title);
  });
  handleClient("chat:set-model", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; model?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && isBackendModel(p?.model)) setConversationModel(owned.conv.id, p.model);
  });
  handleClient("chat:reorder", (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (ctx === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids, ctx.host);
  });
  // Fechar a aba mantém a conversa na lista lateral; excluir é explícito.
  handleClient("chat:close", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) closeTab(owned.conv.id);
  });
  handleClient("chat:delete", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) dropConversation(owned.conv.id);
  });
  handleClient("chat:open", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (openConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:archive", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const archived = (payload as { archived?: unknown })?.archived === true;
    if (owned !== null) archiveConversation(owned.conv.id, archived);
  });
  handleClient("chat:duplicate", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (duplicateConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:branch", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const index = (payload as { index?: unknown })?.index;
    return owned === null || typeof index !== "number" ? null : (branchConversation(owned.conv.id, index) ?? null);
  });
  handleClient("chat:export", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const format = (payload as { format?: unknown })?.format;
    if (owned === null || (format !== "md" && format !== "json")) return null;
    const stored = getStoredConversation(owned.conv.id);
    if (stored === undefined) return null;
    const ext: ExportFormat = format;
    const result = await dialog.showSaveDialog(owned.win, {
      title: "Exportar conversa",
      defaultPath: path.join(app.getPath("documents"), `${slugify(conversationTitle(stored))}.${ext}`),
      filters: ext === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    const body = ext === "md" ? conversationToMarkdown(stored) : `${JSON.stringify(stored, null, 2)}\n`;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });
  handleClient("ui:tab-menu", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return null;
    const state = (payload as { state?: { busy?: unknown; archived?: unknown } })?.state ?? {};
    const busy = state.busy === true;
    const archived = state.archived === true;
    return new Promise<TabMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: TabMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const item = (label: string, action: TabMenuAction, enabled = true): Electron.MenuItemConstructorOptions =>
        ({ label, enabled, click: () => pick(action) });
      const menu = Menu.buildFromTemplate([
        item("Renomear", "rename"),
        item("Duplicar", "duplicate", !busy),
        { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] },
        archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive", !busy),
        { type: "separator" },
        item("Fechar aba", "close"),
        item("Excluir conversa…", "delete", !busy),
      ]);
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: owned.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });

  const liveNotifications = new Set<Notification>();
  handleClient("ui:notify", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const p = payload as { title?: unknown; body?: unknown };
    if (owned === null || !Notification.isSupported()) return;
    const { host, conv } = owned;
    const n = new Notification({
      title: typeof p.title === "string" ? p.title.slice(0, 80) : "meu-bot",
      body: typeof p.body === "string" ? p.body.slice(0, 200) : "",
      silent: false,
    });
    liveNotifications.add(n);
    const done = (): void => { liveNotifications.delete(n); };
    n.on("click", () => {
      done();
      // A janela dona pode ter sido fechada: reabre a da máquina e foca a conversa quando ela carregar.
      const win = openMainWindow(host, "notify");
      app.focus({ steal: true });
      sendWhenLoaded(win, "ui:focus-conversation", { conversationId: conv.id });
    });
    n.on("close", done);
    n.show();
  });
}
