/**
 * Variante: cliente. Handlers IPC só do meu-bot normal: conversar com o agente, parear e mexer no WhatsApp,
 * logins, instalar coisas na máquina, suporte do lado da pessoa. No meu-bot-admin cada canal daqui vira um
 * stub que recusa (ipc/registry.ts): o admin só lê e usa as ações de suporte.
 */
import { app, dialog, Menu, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AudioSetup, ExportFormat, TabMenuAction, WhatsappEvent } from "../../shared/ipc";
import { conversationToMarkdown, conversationTitle, slugify } from "../export";
import { deleteBackendSession, fetchAccountStatus, log, runBackendTurn } from "../backend";
import { disableSshCheck, restoreLastPolicy } from "../tailscale";
import { cancelPairing, setDmPolicy, startPairing, whatsappBranch, whatsappLogout, whatsappPause, whatsappStatus } from "../whatsapp";
import { cancelClaudeLogin, claudeLogout, startClaudeLogin, submitClaudeLoginCode } from "../claudeLogin";
import { cancelXaiLogin, startXaiLogin, xaiLogout } from "../xaiLogin";
import {
  archiveConversation, branchConversation, closeTab, createConversation, dropConversation, duplicateConversation, getConversation,
  getStoredConversation, listConversationsForHost, openConversation, renameConversation, reorderConversations, setConversationModel,
} from "../conversation";
import { isBackendModel } from "../settings";
import { toggleQuickEntry } from "../quickEntry";
import { installAudio, installStatusLine, prepareGrokOauth, statusLineInstalled, uninstallStatusLine } from "../hostProbe";
import { readSegments, writeSegments } from "../statusLine";
import { deliverNow, reportSupportProgress, resetSupport, setSupport, setSupportNameOnly, setSupportShare, supportCodeText, supportInfo } from "../client/support";
import { openMainWindow, sendWhenLoaded } from "../windows";
import { hostFromEvent, ownedConversation, waNumber } from "./context";
import { handleClient } from "./registry";

/**
 * Padrão do app: máquina com OpenClaw pareada entende áudios. Depois de parear, se não há transcritor, instala
 * (uma vez; baixa ~500 MB) e conta pelo mesmo canal de eventos do pareamento. O admin pode desativar depois.
 */
async function ensureTranscription(host: string, send: (ev: WhatsappEvent) => void): Promise<void> {
  const st = await whatsappStatus(host).catch(() => null);
  if (st === null || st.gateway !== "openclaw" || st.audioIn !== false) return;
  send({ kind: "step", text: "ligando a transcrição de áudio (padrão do meu-bot; baixa ~500 MB só na primeira vez)…" });
  const r = await installAudio(host, { kind: "in" }, (line) => send({ kind: "log", text: line }));
  send({ kind: r.ok ? "step" : "log", text: r.ok ? "transcrição de áudio pronta: o agente entende áudios" : `a transcrição não ligou: ${r.log.at(-1) ?? "erro"}` });
}

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
  handleClient("support:share", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportShare(h.host, payload);
  });
  // "Refazer do zero" do tutorial de suporte: desliga e esquece o nome.
  handleClient("support:reset", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return resetSupport(h.host);
  });

  // Grok por OAuth em máquina sem Hermes: instala Hermes + proxy (install-grok-oauth.sh); cada linha vai ao log do login.
  handleClient("xai-login:prepare", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return prepareGrokOauth(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", { kind: "log", text: line }); });
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
  // Segmentos da status line (preferência na máquina) e "Refazer do zero".
  handleClient("statusline:segments", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return readSegments(h.host);
  });
  handleClient("statusline:set-segments", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return writeSegments(h.host, payload);
  });
  handleClient("statusline:uninstall", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return uninstallStatusLine(h.host);
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
  handleClient("whatsapp:pair", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const reset = (payload as { reset?: unknown } | null)?.reset === true;
    let connected = false;
    const send = (ev: WhatsappEvent): void => { if (ev.kind === "connected") connected = true; if (!h.win.isDestroyed()) h.win.webContents.send("whatsapp:event", ev); };
    await startPairing(h.host, reset, send);
    if (connected) void ensureTranscription(h.host, send);
  });
  handleClient("whatsapp:audio", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { kind?: unknown; mode?: unknown } | null;
    const setup: AudioSetup | null = p?.kind === "in" ? { kind: "in", ...((p as { off?: unknown }).off === true ? { off: true } : {}) }
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
    if (owned === null) return;
    dropConversation(owned.conv.id);
    // A transcrição do Claude Code na máquina vai junto (o admin também deixa de vê-la). Backend antigo: ignora.
    void deleteBackendSession(owned.host, owned.conv.id).then((n) => { if (n !== null && n > 0) log(`[${owned.host}] conversa ${owned.conv.id}: ${n} transcrição(ões) apagada(s) na máquina`); });
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
