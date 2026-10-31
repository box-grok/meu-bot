import type { ObjectiveInfo } from "../../shared/ipc";
import { ACERVO_SKILLS } from "../lib/acervo.js";
import { byId as $ } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";

export let objectiveBusy = false;
export async function refreshObjective(): Promise<void> {
  if (ctx.windowHost === "" || ctx.windowHost === "local" || !ctx.caps.install) return;
  try { ctx.objectiveState = await window.meuBot.objectiveInfo(); } catch { /* sem resposta: fica o que havia */ }
  paintAcervoCount(); ctx.paintGuide();
  if (ctx.pageShown(ctx.acervoPage)) ctx.acervoPage.render();
}
export async function objectiveDo(run: () => Promise<ObjectiveInfo>, okText: string | null): Promise<void> {
  if (objectiveBusy) return;
  objectiveBusy = true; ctx.objectiveMsg = null; ctx.paintGuide();
  try { ctx.objectiveState = await run(); ctx.objectiveMsg = okText === null ? null : { text: okText, bad: false }; }
  catch (err) { ctx.objectiveMsg = { text: ipcErrorText(err), bad: true }; }
  finally { objectiveBusy = false; paintAcervoCount(); ctx.paintGuide(); if (ctx.pageShown(ctx.acervoPage)) ctx.acervoPage.render(); }
}
export function paintAcervoCount(): void {
  const n = ACERVO_SKILLS.length + (ctx.objectiveState?.skills.length ?? 0);
  $<HTMLElement>("acervo-count").textContent = n === 1 ? "1 skill" : `${n} skills`;
}

// ---- Acervo: biblioteca de skills (lib/acervo.ts) + as skills do workspace do agente nesta máquina (tutorial 8).
export const acervoList = $<HTMLElement>("acervo-list");

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarAcervo(): void {
  paintAcervoCount();
  $<HTMLButtonElement>("acervo-line").addEventListener("click", () => ctx.openPage(ctx.acervoPage));
}
