/**
 * Painel "CRM" fixo na barra lateral direita do Gmail (Global.addSidebarContentPanel): sempre visível, em
 * qualquer página. Lista os pipelines com o número de caixas e leva à página de cada um; sem pipeline, mostra o
 * formulário para criar o primeiro (nome + etapas). É a porta de entrada que sobrevive aos recortes do app.
 */
import type { InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { CustomRouteView } from "@inboxsdk/core";
import { ROTA_INICIO, ROTA_PIPELINE } from "../rotas.ts";
import { T } from "../textos.ts";
import { h, limpar } from "./h.ts";
import { textoDoErro } from "./avisos.ts";

/** O conteúdo "início do CRM" (pipelines + novo pipeline), desenhado em `el`; devolve o desligar. */
function montarInicio(sdk: InboxSDK, estado: Estado, el: HTMLElement, classe: () => string): () => void {
  let formAberto = false;
  function formulario(): HTMLElement {
    const nome = h("input", { type: "text", placeholder: "Nome do pipeline (ex.: Clientes)" });
    const etapas = h("input", { type: "text", placeholder: "Etapas separadas por vírgula", value: "Lead, Contato, Proposta, Fechado" });
    const erro = h("div", { class: "mbcrm-erro" });
    const btn = h("button", { class: "mbcrm-btn mbcrm-primario mbcrm-pequeno" }, "Criar pipeline");
    btn.addEventListener("click", () => {
      const n = nome.value.trim(); const st = etapas.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (n === "") { erro.textContent = "Dê um nome."; return; }
      btn.disabled = true;
      estado.criarPipeline({ name: n, stages: st }).then((p) => { formAberto = false; void render(); void sdk.Router.goto(ROTA_PIPELINE, { key: p.key }); }, (e) => { erro.textContent = textoDoErro(e); btn.disabled = false; });
    });
    return h("div", { class: "mbcrm-cartao" }, h("h3", null, "Novo pipeline"), nome, etapas, h("div", { class: "mbcrm-linha" }, btn), erro);
  }
  async function render(): Promise<void> {
    el.className = classe();
    try {
      const ps = await estado.pipelines();
      limpar(el);
      el.append(h("h2", null, "Pipelines"));
      if (ps.length === 0) {
        el.append(h("div", { class: "mbcrm-dica" }, "Seu CRM ainda não tem pipelines. Crie o primeiro aqui, ou peça ao agente para importar os do Streak."), formulario());
        return;
      }
      el.append(h("div", { class: "mbcrm-lista-simples" }, ...ps.map((p) => h("a", { href: sdk.Router.createLink(ROTA_PIPELINE, { key: p.key }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(ROTA_PIPELINE, { key: p.key }); } }, `${p.name} · ${T.caixas(p.boxes)}`))));
      el.append(h("div", { class: "mbcrm-dica" }, "Numa conversa, o painel CRM mostra a caixa dela ou deixa adicionar a um pipeline."));
      if (formAberto) el.append(formulario());
      else el.append(h("div", { class: "mbcrm-linha" }, h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: () => { formAberto = true; void render(); } }, "＋ Novo pipeline")));
    } catch (e) { limpar(el); el.append(h("div", { class: "mbcrm-erro" }, textoDoErro(e))); }
  }
  const off = estado.assinar(({ mudancas, reset, conexao }) => { if (reset || conexao !== "ok" || mudancas.some((m) => m.tipo.startsWith("pipeline.") || m.tipo === "import" || m.tipo === "box.create" || m.tipo === "box.delete")) void render(); });
  void render();
  return off;
}

/** Painel fixo na barra lateral direita (some quando o Gmail recolhe essa coluna em janela estreita). */
export function registrarPainelGlobal(sdk: InboxSDK, estado: Estado, tema: () => string): void {
  const el = h("div", { class: `mbcrm mbcrm-painel ${tema()}` }, h("div", { class: "mbcrm-dica" }, T.carregando));
  void sdk.Global.addSidebarContentPanel({ title: T.crm, iconUrl: chrome.runtime.getURL("icones/crm-32.png"), el, id: "mbcrm-global", orderHint: 1, appName: "meu-bot CRM" });
  montarInicio(sdk, estado, el, () => `mbcrm mbcrm-painel ${tema()}`);
}
