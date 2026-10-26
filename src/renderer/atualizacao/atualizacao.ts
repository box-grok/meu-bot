import type { UpdateState } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { updateStateText, updateBlockerText } from "../lib/update-text.js";
import { ctx } from "../app/ctx.js";

/* ---------- Atualização automática (molde do Grok Bot): faixa com a versão pronta, ponto de progresso na barra,
   "Sobre e atualização" nas Configurações e o bloqueador quando o backend exige uma versão mais nova ---------- */
const updateBar = $<HTMLElement>("update-bar");
const updateText = $<HTMLElement>("update-text");
const updateApply = $<HTMLButtonElement>("update-apply");
const updateCheckDot = $<HTMLElement>("update-check-dot");
const aboutVersion = $<HTMLElement>("about-version");
const aboutSum = $<HTMLElement>("about-sum");
const updateLine = $<HTMLElement>("update-line");
const updateCheckBtn = $<HTMLButtonElement>("update-check-btn");
const updateNotesBtn = $<HTMLButtonElement>("update-notes-btn");
const updateApply2 = $<HTMLButtonElement>("update-apply-2");
export const atualizarOciosoInput = $<HTMLInputElement>("atualizar-ocioso");
const updateBlocker = $<HTMLElement>("update-blocker");
const updateBlockerTitle = $<HTMLElement>("update-blocker-title");
const updateBlockerMsg = $<HTMLElement>("update-blocker-text");
const updateBlockerApply = $<HTMLButtonElement>("update-blocker-apply");
const updateBlockerManual = $<HTMLButtonElement>("update-blocker-manual");
const RELEASES_URL = "https://github.com/diegofornalha/meu-bot/releases";
/** Último estado recebido do main; os botões mandam a versão que a tela mostrou (`expectedVersion`). */
export let lastUpdate: UpdateState | null = null;
export function paintUpdateState(u: UpdateState): void {
  lastUpdate = u;
  // Antes de window:info (caps e versão) não há como pintar certo; a IIFE de arranque pede o estado de novo.
  if (ctx.appVersion === "") return;
  const t = updateStateText(u, ctx.caps.nome);
  updateCheckDot.textContent = t.short ?? "";
  updateCheckDot.hidden = t.short === null;
  aboutVersion.textContent = `${ctx.caps.nome} ${u.current} · ${navigator.userAgent.includes("Intel") ? "Intel" : "Apple Silicon"}`;
  aboutSum.textContent = `versão ${u.current}`;
  updateLine.textContent = t.text;
  updateLine.className = `update-line ${t.kind === "muted" ? "" : t.kind}`.trim();
  updateCheckBtn.disabled = u.phase === "checking" || u.phase === "idle" || u.phase === "downloading" || u.phase === "verifying" || u.phase === "applying";
  updateApply2.hidden = !t.showApply;
  updateApply2.disabled = false;
  atualizarOciosoInput.checked = u.atualizarOcioso;
  // Faixa de cima: só com a versão pronta. Staging (como as trilhas de teste do Cursor) não mostra a faixa; a versão
  // nova entra calada ao fechar o app ou com o Mac ocioso (Configurações › Sobre e atualização continua com o botão).
  const faixa = t.showApply && ctx.caps.canal !== "staging" && !u.abaixoDaMinima;
  if (faixa) { updateText.textContent = `${ctx.caps.nome} ${u.ready ?? ""} pronta para instalar (você está na ${ctx.appVersion}).`; updateApply.disabled = false; updateApply.textContent = "Reiniciar e atualizar"; }
  updateBar.hidden = !faixa;
  // Bloqueador: o backend exige uma versão mais nova; até reiniciar nela, só esta tela.
  const b = updateBlockerText(u, ctx.caps.nome);
  updateBlockerTitle.textContent = b.title; updateBlockerMsg.textContent = b.text;
  updateBlockerApply.hidden = !b.showApply; updateBlockerApply.disabled = false;
  updateBlockerManual.hidden = !b.showManual;
  updateBlocker.hidden = !u.abaixoDaMinima;
}
/** "Reiniciar e atualizar": a versão que a tela mostrou vai junto; se mudou no meio, o main recusa e a tela repinta. */
function applyFromButton(btn: HTMLButtonElement, onError: (msg: string) => void): void {
  const v = lastUpdate?.ready ?? null;
  if (v === null) return;
  btn.disabled = true; btn.textContent = "Reiniciando…";
  void window.meuBot.applyUpdate(v).catch((err: unknown) => { btn.disabled = false; btn.textContent = "Reiniciar e atualizar"; onError(ipcErrorText(err)); });
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarAtualizacao(): void {
  updateCheckBtn.addEventListener("click", () => { updateCheckBtn.disabled = true; void window.meuBot.checkUpdate().then(paintUpdateState).catch(() => { updateCheckBtn.disabled = false; }); });
  updateNotesBtn.addEventListener("click", () => { void window.meuBot.openExternal(RELEASES_URL); });
  updateBlockerManual.addEventListener("click", () => { void window.meuBot.openExternal(RELEASES_URL); });
  updateApply2.addEventListener("click", () => applyFromButton(updateApply2, (msg) => { updateLine.textContent = `Não consegui atualizar: ${msg}`; updateLine.className = "update-line bad"; }));
  updateApply.addEventListener("click", () => applyFromButton(updateApply, (msg) => { updateText.textContent = `Não consegui atualizar: ${msg}`; }));
  updateBlockerApply.addEventListener("click", () => applyFromButton(updateBlockerApply, (msg) => { updateBlockerMsg.textContent = `Não consegui atualizar: ${msg}`; }));
  atualizarOciosoInput.addEventListener("change", () => { void window.meuBot.setSettings({ atualizarOcioso: atualizarOciosoInput.checked }).then(ctx.applySettings).catch((err: unknown) => { atualizarOciosoInput.checked = !atualizarOciosoInput.checked; updateLine.textContent = `Não salvou: ${ipcErrorText(err)}`; }); });
  window.meuBot.on("update:state", paintUpdateState);
}
