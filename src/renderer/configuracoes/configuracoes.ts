import type { BackendModel, Theme } from "../../shared/ipc";
import { licenseSummary, deviceLine } from "../lib/admin-view.js";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { parseNotifyHosts } from "../lib/nav-notify.js";
import { ctx } from "../app/ctx.js";
import { paintEspaco } from "./espaco.js";

function openSettings(): void {
  if (ctx.dialog.open) return;
  ctx.paintSupport(); void ctx.refreshSupportState(); void loadAlertPrefs(); paintEspaco(ctx.account?.cota);
  void window.meuBot.updateState().then(ctx.paintUpdateState).catch(() => undefined);
  ctx.syncPrimaryFromModel();
  ctx.paintFallbackOrder();
  ctx.settingsError.hidden = true;
  for (const g of ctx.settingsGroups) g.open = false;
  void window.meuBot.getMemory().then(ctx.applyMemory);
  ctx.dialog.showModal();
}

/* ---------- Notificação de teste (REA do Rambox) e pedido no momento certo ---------- */
const notifyTestBtn = $<HTMLButtonElement>("notify-test-btn");
const notifyTestQ = $<HTMLElement>("notify-test-q");
function sendTestNotification(): void {
  notifyTestQ.hidden = true;
  void window.meuBot.notifyTest().then(() => { notifyTestQ.hidden = false; }).catch((err: unknown) => { ctx.settingsError.textContent = ipcErrorText(err); ctx.settingsError.hidden = false; });
}
/** Primeira notificação desta instalação no momento certo (WhatsApp pareado e testado): o macOS pede a permissão junto. */
export function maybeAskNotificationsOnce(): void {
  if (!ctx.caps.chat || ctx.settings?.notifications !== true) return;
  try { if (localStorage.getItem("notif:asked") === "1") return; localStorage.setItem("notif:asked", "1"); } catch { return; }
  void window.meuBot.notifyTest().catch(() => undefined);
}

/* ---------- Segurança (REA do Rambox): aviso quando um Mac novo usar o meu-bot desta máquina ---------- */
const alertsGroup = $<HTMLElement>("alerts-group");
const alertWa = $<HTMLInputElement>("alert-wa");
const alertsHint = $<HTMLElement>("alerts-hint");
let alertPrefsLoaded: { whatsapp: boolean } | null = null;
/**
 * Grupo "Sua conta" (lado da pessoa), o último das Configurações e recolhido como os outros: plano, status, membro
 * desde, ciclo e os devices da conta, só leitura, como as telas de billing do Rambox. Quem muda isso é o admin
 * (pela página Suporte). O grupo é fixo no HTML; aqui só o corpo e o resumo da linha do título.
 */
const licensePanel = $<HTMLDetailsElement>("license-panel");
const licenseBody = $<HTMLElement>("license-body");
const licenseSum = $<HTMLElement>("license-sum");
async function loadLicensePanel(): Promise<void> {
  if (!ctx.caps.chat || ctx.windowHost === "local") { licensePanel.hidden = true; return; }
  licensePanel.hidden = false;
  const view = await ctx.refreshLicense();
  if (view === null) { licenseSum.textContent = "plano e devices"; licenseBody.replaceChildren(el("p", "hint", "A máquina ainda não tem o backend novo: reinstale o backend para ver o plano e os devices.")); return; }
  const l = view.license;
  licenseSum.textContent = `${l.plan === "pro" ? "Pro" : "Free"} · ${view.devices.length} device${view.devices.length === 1 ? "" : "s"}`;
  const ul = el("ul", "admin-health");
  for (const line of licenseSummary(view, Date.now(), ctx.caps.addons)) ul.append(el("li", line.ok === null ? "" : line.ok ? "ok" : "bad", line.text));
  const devs = el("ul", "admin-health");
  for (const d of view.devices) { const dl = deviceLine(d); devs.append(el("li", d.status === "pending" ? "bad" : "ok", d.status === "pending" ? `${dl.text} · pedido enviado ao admin` : dl.text)); }
  if (view.devices.length === 0) devs.append(el("li", "", "Nenhum device ainda."));
  licenseBody.replaceChildren(ul, el("p", "hint strong-hint", "Seus devices"), devs);
}
async function loadAlertPrefs(): Promise<void> {
  void loadLicensePanel();
  if (!ctx.caps.chat || ctx.windowHost === "local") { alertsGroup.hidden = true; return; }
  alertsGroup.hidden = false;
  try {
    alertPrefsLoaded = await window.meuBot.alertPrefs();
    if (alertPrefsLoaded === null) { alertsHint.textContent = "A máquina ainda não tem o backend novo: reinstale o backend para ligar os avisos."; alertWa.disabled = true; return; }
    alertWa.disabled = false;
    alertWa.checked = alertPrefsLoaded.whatsapp;
    alertsHint.textContent = "O aviso vai pelo seu próprio número, já pareado nesta máquina.";
  } catch (err) { alertsHint.textContent = `Não consegui ler: ${ipcErrorText(err)}`; }
}
async function saveAlertPrefs(): Promise<void> {
  if (alertsGroup.hidden || alertPrefsLoaded === null || alertWa.disabled) return;
  // Só WhatsApp: o e-mail (Resend) saiu por completo em 30 out.
  const next = { whatsapp: alertWa.checked };
  if (next.whatsapp === alertPrefsLoaded.whatsapp) return;
  try { await window.meuBot.setAlertPrefs(next); alertPrefsLoaded = next; }
  catch (err) { const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, `Avisos de segurança: ${ipcErrorText(err)}`, "warn"); }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarConfiguracoes(): void {
  ctx.settingsBtn.addEventListener("click", () => openSettings());
  window.meuBot.on("ui:toggle-settings", () => { if (ctx.dialog.open) ctx.dialog.close(); else openSettings(); });
  notifyTestBtn.addEventListener("click", sendTestNotification);
  $<HTMLButtonElement>("notify-yes").addEventListener("click", () => { notifyTestQ.hidden = true; try { localStorage.setItem("notif:ok", "1"); } catch { /* opcional */ } });
  $<HTMLButtonElement>("notify-no").addEventListener("click", () => { void window.meuBot.openExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension"); });
  window.meuBot.on("chat:notice", ({ conversationId, text }) => { const tab = ctx.tabs.get(conversationId); if (tab !== undefined) { ctx.addNotice(tab, text, "warn"); ctx.offerClaudeLogin(tab, text); } });
  window.meuBot.on("chat:account", ({ host, status }) => {
    if (host !== ctx.windowHost) return;
    ctx.account = status;
    ctx.paintContext(ctx.active());
    ctx.paintFallbackOrder();
    ctx.checkSessionThreshold();
    ctx.checkEspacoThreshold();
    paintEspaco(status?.cota);
    ctx.paintGuide(); // o passo "Ver os limites no rodapé" se marca quando a conta traz números
  });
  ctx.cancelBtn.addEventListener("click", () => ctx.dialog.close());
  ctx.dialog.addEventListener("close", () => ctx.onboardEvent("settings-closed"));
  ctx.form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    ctx.settingsError.hidden = true;
    const port = Number.parseInt(ctx.backendPortInput.value, 10);
    const fontSize = Number.parseInt(ctx.fontSizeInput.value, 10);
    const budget = Number.parseInt(ctx.contextBudgetInput.value, 10);
    const every = Number.parseInt(ctx.memoryEveryInput.value, 10);
    void window.meuBot.setMemory({ notas: ctx.memoryNotas.value, perfil: ctx.memoryPerfil.value }).then(ctx.applyMemory);
    const update = {
      backendModelForHost: ctx.backendModelSelect.value as BackendModel,
      theme: ctx.themeSelect.value as Theme,
      notifications: ctx.notificationsInput.checked,
      navNotify: { enabled: ctx.navNotifyOn.checked, instruction: ctx.navNotifyInstruction.value, hosts: parseNotifyHosts(ctx.navNotifyHosts.value), mode: ctx.navNotifyMode.value === "each" ? "each" as const : "site" as const, avisar: ctx.navNotifyWhen.value === "chegada" ? "chegada" as const : ctx.navNotifyWhen.value === "nunca" ? "nunca" as const : "tratado" as const },
      // Na janela de uma máquina a porta é só dela; na deste Mac (sem túnel) o campo edita a padrão das demais.
      ...(Number.isInteger(port) ? (ctx.windowHost === "local" ? { backendPort: port } : { backendPortForHost: port }) : {}),
      ...(Number.isInteger(fontSize) ? { fontSize } : {}),
      ...(Number.isInteger(budget) ? { contextBudgetTokens: budget } : {}),
      ...(Number.isInteger(every) ? { memoryEveryTurns: every } : {}),
      quickEntryEnabled: ctx.quickEnabled.checked,
      ...(ctx.quickShortcut.value.trim() === "" ? {} : { quickEntryShortcut: ctx.quickShortcut.value.trim() }),
      ...(ctx.openAtLoginInput.disabled ? {} : { openAtLogin: ctx.openAtLoginInput.checked }),
    };
    void saveAlertPrefs();
    window.meuBot.setSettings(update).then(
      (view) => {
        ctx.applySettings(view);
        ctx.dialog.close();
        const tab = ctx.active();
        if (tab !== null) ctx.addNotice(tab, "Configurações salvas.");
      },
      (err: unknown) => {
        ctx.settingsError.textContent = ipcErrorText(err);
        ctx.settingsError.hidden = false;
      },
    );
  });
}
