/**
 * Entrada "CRM" no menu esquerdo: o item abre a página inicial do CRM e tem "+" para novo pipeline; cada pipeline
 * é um filho com o menu "⋯" (abrir, renomear, editar etapas, apagar). E o atalho de teclado.
 */
import type { InboxSDK, NavItemView } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { PipelineResumo } from "../tipos.ts";
import { ROTA_CONTATOS, ROTA_INICIO, ROTA_MALAS, ROTA_ORGS, ROTA_PIPELINE } from "../rotas.ts";
import { T } from "../textos.ts";
import { h } from "./h.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";

const ULTIMO = "mbcrm:ultimoPipeline";

/** Modal com um formulário; `salvar` devolve a mensagem de erro (ou null para fechar). */
export function modal(sdk: InboxSDK, titulo: string, corpo: HTMLElement, botao: string, salvar: () => Promise<string | null>): void {
  const erro = h("div", { class: "mbcrm-erro" });
  const el = h("div", { class: "mbcrm mbcrm-menu" }, corpo, erro);
  const m = sdk.Widgets.showModalView({ el, title: titulo, buttons: [{ text: botao, type: "PRIMARY_ACTION", onClick: () => { void salvar().then((msg) => { if (msg === null) m.close(); else erro.textContent = msg; }); } }] });
}
export const campo = (rotulo: string, input: HTMLElement): HTMLElement => h("div", { class: "mbcrm-campo" }, h("label", null, rotulo), input);

export function novoPipeline(sdk: InboxSDK, estado: Estado): void {
  const nome = h("input", { type: "text", placeholder: "Nome do pipeline (ex.: Clientes)" });
  const etapas = h("input", { type: "text", value: "Lead, Contato, Proposta, Fechado" });
  modal(sdk, "Novo pipeline", h("div", { class: "mbcrm-col" }, campo(T.nome, nome), campo("Etapas (separadas por vírgula)", etapas)), "Criar", async () => {
    const n = nome.value.trim(); if (n === "") return "Dê um nome.";
    try { const p = await estado.criarPipeline({ name: n, stages: etapas.value.split(",").map((x) => x.trim()).filter(Boolean) }); void sdk.Router.goto(ROTA_PIPELINE, { key: p.key }); return null; } catch (e) { return textoDoErro(e); }
  });
  setTimeout(() => nome.focus(), 50);
}
function renomear(sdk: InboxSDK, estado: Estado, p: PipelineResumo): void {
  const nome = h("input", { type: "text", value: p.name });
  modal(sdk, "Renomear pipeline", campo(T.nome, nome), "Salvar", async () => {
    const n = nome.value.trim(); if (n === "") return "Dê um nome.";
    try { await estado.atualizarPipeline(p.key, { name: n }); return null; } catch (e) { return textoDoErro(e); }
  });
  setTimeout(() => { nome.focus(); nome.select(); }, 50);
}
export async function editarEtapas(sdk: InboxSDK, estado: Estado, p: { key: string; name: string }): Promise<void> {
  let atual; try { atual = await estado.pipeline(p.key); } catch (e) { mostrarErro(sdk, e); return; }
  // Uma etapa por linha, na ordem; renomear mantém a etapa (e as caixas nela), linha nova cria, linha apagada remove.
  const ta = h("textarea", { rows: String(Math.max(4, atual.stages.length + 1)) }, atual.stages.map((s) => s.name).join("\n"));
  const dica = h("div", { class: "mbcrm-dica" }, "Uma etapa por linha, na ordem. Para renomear, edite a linha no lugar. Etapa com caixas só sai se você escolher para onde elas vão.");
  const mover = h("select", null, h("option", { value: "" }, "—"), ...atual.stages.map((s) => h("option", { value: s.name }, s.name)));
  modal(sdk, `Etapas · ${p.name}`, h("div", { class: "mbcrm-col" }, ta, dica, campo("Caixas de etapas removidas vão para", mover)), "Salvar", async () => {
    const linhas = ta.value.split("\n").map((x) => x.trim()).filter(Boolean);
    if (linhas.length === 0) return "O pipeline precisa de ao menos uma etapa.";
    // Linha i que existia na posição i mantém a chave (renomear); as demais casam pelo nome; o resto é nova.
    const stages = linhas.map((name, i) => { const mesmoNome = atual.stages.find((s) => s.name === name); const naPosicao = atual.stages[i]; const key = mesmoNome?.key ?? (naPosicao && !linhas.includes(naPosicao.name) ? naPosicao.key : undefined); return key ? { key, name } : { name }; });
    try { await estado.atualizarPipeline(p.key, { stages, ...(mover.value !== "" ? { moverPara: mover.value } : {}) }); return null; } catch (e) { return textoDoErro(e); }
  });
}
function apagar(sdk: InboxSDK, estado: Estado, p: PipelineResumo): void {
  if (p.boxes > 0) { sdk.ButterBar.showError({ text: `O pipeline "${p.name}" tem ${T.caixas(p.boxes)}; apague ou mova as caixas antes.`, time: 6000 }); return; }
  modal(sdk, "Apagar pipeline", h("div", { class: "mbcrm-dica" }, `Apagar "${p.name}"? Ele está vazio; a definição fica guardada na lixeira da máquina.`), "Apagar", async () => {
    try { await estado.apagarPipeline(p.key); void sdk.Router.goto(ROTA_INICIO); return null; } catch (e) { return textoDoErro(e); }
  });
}

/** Ícones simples (SVG em data URL) para os itens do painel, nas cores do tema. */
const svg = (d: string, cor: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${d}" fill="none" stroke="${cor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`;
const ICONE_CASA = "M4 11l8-7 8 7M6 9.5V20h12V9.5";
const ICONE_MAIS = "M12 5v14M5 12h14";
/** Ícones preenchidos (Material, Apache-2.0), como os do painel do Streak. */
const svgCheio = (d: string, cor: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${d}" fill="${cor}"/></svg>`)}`;
const ICONE_PIPELINE = "M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z";
const ICONE_CONTATOS = "M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25s-1.01 2.25-2.25 2.25S9.75 10.24 9.75 9 10.76 6.75 12 6.75zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z";
const ICONE_ORGS = "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z";
const ICONE_MALAS = "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z";

/** O que monta o menu: no painel do trilho de apps (como o Streak) ou, sem trilho, no menu esquerdo. */
interface Raiz { addNavItem: NavItemView["addNavItem"] }

export function registrarMenu(sdk: InboxSDK, estado: Estado): void {
  void (async () => {
    let raiz: Raiz | null = null;
    try {
      if (await sdk.AppMenu.isShown()) raiz = await trilhoDeApps(sdk, estado);
    } catch { raiz = null; }
    // Sem o trilho de apps (Gmail sem Chat/Meet): o item "CRM" no menu esquerdo, com "+" para novo pipeline.
    if (raiz === null) raiz = sdk.NavMenu.addNavItem({ name: T.crm, iconUrl: chrome.runtime.getURL("icones/crm-16.png"), orderHint: 100, key: "mbcrm", routeID: ROTA_INICIO, accessory: { type: "CREATE", onClick: () => novoPipeline(sdk, estado) } });
    montarPipelinesNoMenu(sdk, estado, raiz);
  })();
  atalhoDeTeclado(sdk, estado);
}

/**
 * Item "meu-bot CRM" no trilho de apps do Gmail (Mail, Streak, Chat, Meet), logo abaixo do Streak, com o painel no
 * mesmo desenho do dele: "Novo pipeline" no topo, "Início" e a seção "Pipelines" (com "+"). Mesmo mecanismo que a
 * engenharia reversa do Streak mostrou: AppMenu.addMenuItem({insertIndex}) + addCollapsiblePanel({primaryButton}).
 */
async function trilhoDeApps(sdk: InboxSDK, estado: Estado): Promise<Raiz | null> {
  const icone = chrome.runtime.getURL("icones/crm-32.png");
  const item = sdk.AppMenu.addMenuItem({
    name: "meu-bot CRM",
    insertIndex: 2,
    isRouteActive: (rv) => (rv.getRouteID() ?? "").startsWith("meu-bot-crm/"),
    // Como o Streak: o ícone leva ao Início (a "Casa" dele).
    onClick: () => { void sdk.Router.goto(ROTA_INICIO); },
    iconUrl: { lightTheme: { active: icone, default: icone }, darkTheme: { active: icone, default: icone } },
  });
  const painel = await item.addCollapsiblePanel({ primaryButton: { name: "Novo pipeline", onClick: () => novoPipeline(sdk, estado), iconUrl: { lightTheme: svg(ICONE_MAIS, "#202124"), darkTheme: { panelDefault: svg(ICONE_MAIS, "#202124"), panelHovered: svg(ICONE_MAIS, "#ffffff") } } } });
  if (!painel) return null;
  painel.addNavItem({ name: "Início", iconUrl: svg(ICONE_CASA, "#5f6368"), routeID: ROTA_INICIO, key: "mbcrm:inicio" });
  painel.addNavItem({ name: "Contatos", iconUrl: svgCheio(ICONE_CONTATOS, "#5f6368"), routeID: ROTA_CONTATOS, key: "mbcrm:contatos" });
  painel.addNavItem({ name: "Organizações", iconUrl: svgCheio(ICONE_ORGS, "#5f6368"), routeID: ROTA_ORGS, key: "mbcrm:orgs" });
  painel.addNavItem({ name: "Mala direta", iconUrl: svgCheio(ICONE_MALAS, "#5f6368"), routeID: ROTA_MALAS, key: "mbcrm:malas" });
  return painel.addNavItem({ name: "Pipelines", type: "SECTION", sectionTooltip: "Novo pipeline", onClick: () => novoPipeline(sdk, estado), key: "mbcrm:pipelines" });
}

function montarPipelinesNoMenu(sdk: InboxSDK, estado: Estado, raiz: Raiz): void {
  let filhos: NavItemView[] = [];
  async function render(): Promise<void> {
    try {
      const ps = await estado.pipelines();
      for (const f of filhos) f.remove(); filhos = [];
      for (const p of ps) filhos.push(raiz.addNavItem({
        name: p.name, iconUrl: svgCheio(ICONE_PIPELINE, "#5f6368"), routeID: ROTA_PIPELINE, routeParams: { key: p.key }, key: `mbcrm:${p.key}`,
        accessory: { type: "DROPDOWN_BUTTON", onClick: (ev) => {
          const item = (texto: string, run: () => void): HTMLElement => h("a", { href: "#", onClick: (e: Event) => { e.preventDefault(); ev.dropdown.close(); run(); } }, texto);
          ev.dropdown.el.append(h("div", { class: "mbcrm mbcrm-menu" }, h("div", { class: "mbcrm-lista-simples" },
            item("Abrir", () => { void sdk.Router.goto(ROTA_PIPELINE, { key: p.key }); }),
            item("Renomear", () => renomear(sdk, estado, p)),
            item("Editar etapas", () => { void editarEtapas(sdk, estado, p); }),
            item("Apagar", () => apagar(sdk, estado, p)),
          )));
        } },
      }));
    } catch { /* sem conexão: fica como estava */ }
  }
  estado.assinar(({ mudancas, reset }) => { if (reset || mudancas.some((m) => m.tipo.startsWith("pipeline.") || m.tipo === "import" || m.tipo === "box.create" || m.tipo === "box.delete")) void render(); });
  void render();
}

function atalhoDeTeclado(sdk: InboxSDK, estado: Estado): void {
  sdk.Router.handleAllRoutes((v) => { if (v.getRouteID() === ROTA_PIPELINE) { const k = v.getParams()["key"]; if (k) { try { localStorage.setItem(ULTIMO, k); } catch { /* sem storage */ } } } });
  const atalho = sdk.Keyboard.createShortcutHandle({ chord: "ctrl+shift+c", description: T.atalho });
  sdk.Toolbars.registerThreadButton({ title: T.atalho, positions: [], keyboardShortcutHandle: atalho, onClick: () => { void (async () => { let k: string | null = null; try { k = localStorage.getItem(ULTIMO); } catch { /* sem storage */ } if (k === null) { const ps = await estado.pipelines().catch(() => []); k = ps[0]?.key ?? null; } if (k !== null) void sdk.Router.goto(ROTA_PIPELINE, { key: k }); else void sdk.Router.goto(ROTA_INICIO); })(); } });
}
