/** Chips de pipeline e de etapa que levam ao pipeline (a etapa já filtrada), como os do Streak na linha do tempo. */
import type { InboxSDK } from "@inboxsdk/core";
import { ROTA_PIPELINE } from "../rotas.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";
import { h } from "./h.ts";

const CHAVE_FILTRO = "mbcrm:filtroEtapa";
/** A página do pipeline lê (e apaga) a etapa pedida ao abrir. */
export function etapaPedida(pipelineKey: string): string {
  try { const v = sessionStorage.getItem(CHAVE_FILTRO); sessionStorage.removeItem(CHAVE_FILTRO); if (v === null) return ""; const [p, s] = v.split("|"); return p === pipelineKey ? s ?? "" : ""; } catch { return ""; }
}
export function irParaPipeline(sdk: InboxSDK, pipelineKey: string, stageKey?: string): void {
  try { if (stageKey) sessionStorage.setItem(CHAVE_FILTRO, `${pipelineKey}|${stageKey}`); else sessionStorage.removeItem(CHAVE_FILTRO); } catch { /* sem storage: abre sem filtro */ }
  void sdk.Router.goto(ROTA_PIPELINE, { key: pipelineKey });
}
/** Clique no chip não deve abrir a linha onde ele está (a caixa). */
const so = (fn: () => void) => (ev: Event): void => { ev.preventDefault(); ev.stopPropagation(); fn(); };
export function chipPipeline(sdk: InboxSDK, pipelineKey: string, nome: string, classe = "mbcrm-chip-pipe"): HTMLElement {
  return h("span", { class: `${classe} mbcrm-clicavel`, role: "link", tabindex: "0", title: `Abrir o pipeline ${nome}`, onClick: so(() => irParaPipeline(sdk, pipelineKey)) }, nome);
}
export function chipEtapa(sdk: InboxSDK, pipelineKey: string, stageKey: string, nome: string, indice: number, classe = "mbcrm-chip-etapa"): HTMLElement {
  const cor = corDaEtapa(indice);
  return h("span", { class: `${classe} mbcrm-clicavel`, role: "link", tabindex: "0", style: { background: cor, color: textoSobre(cor) }, title: `Ver as caixas em ${nome}`, onClick: so(() => irParaPipeline(sdk, pipelineKey, stageKey)) }, nome);
}
