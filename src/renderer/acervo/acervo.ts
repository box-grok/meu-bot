import { ACERVO_SKILLS } from "../lib/acervo.js";
import { byId as $ } from "../lib/dom.js";
import { ctx } from "../app/ctx.js";

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
