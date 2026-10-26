import type { BackendModel } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { fallbackOrderText } from "../lib/tutoriais.js";
import { ctx } from "../app/ctx.js";

// ---- Seção Fallback: o primário é o modelo padrão da máquina; a reserva vem da corrente do backend.
const primarySelect = $<HTMLSelectElement>("primary-provider");
const fallbackOrderEl = $<HTMLParagraphElement>("fallback-order");
export const PRIMARY_OF: Record<string, BackendModel> = { claude: "agente", xai: "grok-4" };
export function syncPrimaryFromModel(): void {
  const m = ctx.backendModelSelect.value;
  primarySelect.value = m === "grok-4" ? "xai" : m === "agente" ? "claude" : "other";
}
export function paintFallbackOrder(): void {
  fallbackOrderEl.textContent = fallbackOrderText(ctx.backendModelSelect.value, ctx.account?.providers ?? null);
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarFallback(): void {
  // Escolher o primário nas Configurações também conta como "escolhi" no tutorial 5 (vale ao salvar; o select já reflete).
  primarySelect.addEventListener("change", () => { const m = PRIMARY_OF[primarySelect.value]; if (m !== undefined) { ctx.backendModelSelect.value = m; ctx.saveGuideFlag(ctx.FALLBACK_TUTORIAL, "fallbackChosen"); } paintFallbackOrder(); });
  ctx.backendModelSelect.addEventListener("change", () => { syncPrimaryFromModel(); paintFallbackOrder(); });
}
