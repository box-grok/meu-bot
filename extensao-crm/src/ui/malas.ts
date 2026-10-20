/** Mala direta (#meu-bot-crm/mala-direta): página reservada no menu, como "Mail Merges" do Streak; o envio vem a seguir. */
import type { CustomRouteView, InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import { h } from "./h.ts";

export function montarMalas(_sdk: InboxSDK, _estado: Estado, v: CustomRouteView, raiz: (el: HTMLElement) => void): void {
  try { v.setFullWidth(true); } catch { /* versões antigas do SDK */ }
  const root = h("div", { class: "mbcrm mbcrm-rota mbcrm-pagina" }); raiz(root); v.getElement().append(root);
  root.append(h("div", { class: "mbcrm-pl-topo" }, h("h1", { class: "mbcrm-titulo-fixo" }, "Mala direta")),
    h("div", { class: "mbcrm-cartao" }, h("h3", null, "Em construção"),
      h("div", null, "Aqui você vai mandar um e-mail personalizado para várias caixas ou contatos de uma vez, um e-mail por pessoa, saindo do seu próprio Gmail:"),
      h("ul", null, ...["Destinatários: caixas marcadas no pipeline, contatos de uma organização ou uma planilha (CSV).", "Texto com variáveis, como {{nome}} e {{empresa}}, e prévia de cada destinatário antes de enviar.", "Envio agora ou agendado, em ritmo seguro para o Gmail, com acompanhamento de quem respondeu.", "Opcional: mover a caixa de etapa quando o e-mail sai ou quando a pessoa responde."].map((t) => h("li", null, t)))));
}
