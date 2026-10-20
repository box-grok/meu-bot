/**
 * Home do CRM (#meu-bot-crm/home), como a do Streak, só com o que interessa: Acesso rápido (pipelines abertos por
 * último + ações), Caixas recentes (as que você abriu) / Tendências (mais movimentadas em 7 dias) e Pipelines.
 * Também o botão do CRM na barra do topo do Gmail, ao lado da busca.
 */
import type { CustomRouteView, InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { CaixaHome, Pipeline, PipelineResumo } from "../tipos.ts";
import { ROTA_CAIXA, ROTA_INICIO, ROTA_PIPELINE } from "../rotas.ts";
import { CHAVE_CAIXAS, CHAVE_PIPELINES, ler } from "../recentes.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";
import { haQuanto } from "../resumo.ts";
import { lerCsv, planejarImport } from "../csv.ts";
import { T } from "../textos.ts";
import { h, limpar } from "./h.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";
import { abrirMenu } from "./flutuante.ts";
import { chipEtapa, chipPipeline } from "./navegar.ts";
import { campo, modal, novoPipeline } from "./menu.ts";
import { formularioNovaCaixa } from "./painel-thread.ts";

/** Ícones Material (Apache-2.0), como no Streak. */
const ICONES = {
  pipeline: "M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  caixa: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  enviar: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  importar: "M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z",
  mais: "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  relogio: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  alta: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
  raio: "M7 2v11h3v9l7-12h-4l4-8z",
} as const;
const icone = (d: string, cor = "currentColor", tam = 24): HTMLElement => h("span", { class: "mbcrm-ic", html: `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true"><path d="${d}" fill="${cor}"/></svg>` });
const ABA = "mbcrm:home:aba";
const ir = (sdk: InboxSDK, rota: string, key?: string) => (ev?: Event): void => { ev?.preventDefault(); void sdk.Router.goto(rota, key !== undefined ? { key } : undefined); };

export function registrarRotaInicio(sdk: InboxSDK, estado: Estado, tema: () => string): void {
  sdk.Router.handleCustomRoute(ROTA_INICIO, (v: CustomRouteView) => {
    try { v.setFullWidth(true); } catch { /* versões antigas do SDK */ }
    const el = h("div", { class: `mbcrm mbcrm-rota mbcrm-pagina mbcrm-home ${tema()}` });
    v.getElement().append(el);
    const fechar = estado.abrirVisao();
    const off = montarHome(sdk, estado, el);
    v.on("destroy", () => { off(); fechar(); });
  });
}

function montarHome(sdk: InboxSDK, estado: Estado, el: HTMLElement): () => void {
  let aba: "recentes" | "alta" = "recentes"; try { if (localStorage.getItem(ABA) === "alta") aba = "alta"; } catch { /* sem storage */ }
  const rapido = h("div", { class: "mbcrm-rapido" });
  const lista = h("div", { class: "mbcrm-col" });
  const pipes = h("div", { class: "mbcrm-col" });
  const abaBtn = (id: typeof aba, rotulo: string): HTMLButtonElement => h("button", { class: `mbcrm-aba${aba === id ? " mbcrm-aba-ativa" : ""}`, onClick: () => { aba = id; try { localStorage.setItem(ABA, id); } catch { /* sem storage */ } void desenharCaixas(); } }, rotulo);
  const abas = h("div", { class: "mbcrm-abas" });
  const cabCaixas = h("div", { class: "mbcrm-cartao-cab" }, icone(ICONES.relogio, "currentColor", 20), h("h3", null, "Caixas recentes"), h("span", { class: "mbcrm-cresce" }), abas);
  el.append(
    h("div", { class: "mbcrm-cartao mbcrm-home-cartao" }, h("div", { class: "mbcrm-cartao-cab" }, icone(ICONES.raio, "currentColor", 20), h("h3", null, "Acesso rápido")), rapido),
    h("div", { class: "mbcrm-home-grade" },
      h("div", { class: "mbcrm-cartao mbcrm-home-cartao" }, cabCaixas, lista),
      h("div", { class: "mbcrm-cartao mbcrm-home-cartao" }, h("div", { class: "mbcrm-cartao-cab" }, icone(ICONES.pipeline, "currentColor", 20), h("h3", null, "Pipelines"), h("span", { class: "mbcrm-cresce" }), h("button", { class: "mbcrm-icone", title: "Novo pipeline", onClick: () => novoPipeline(sdk, estado) }, "＋")), pipes)),
  );

  const tile = (rotulo: string, ic: HTMLElement, onClick: (ev: Event) => void, title?: string): HTMLElement => h("button", { class: "mbcrm-tile", title: title ?? rotulo, onClick }, ic, h("span", null, rotulo));

  async function desenharRapido(ps: PipelineResumo[]): Promise<void> {
    limpar(rapido);
    const recentes = ler(CHAVE_PIPELINES);
    const ordem = [...recentes.map((k) => ps.find((p) => p.key === k)).filter((p): p is PipelineResumo => p !== undefined), ...ps.filter((p) => !recentes.includes(p.key))].slice(0, 6);
    for (const p of ordem) { const i = ps.indexOf(p); rapido.append(tile(p.name, icone(ICONES.pipeline, corDaEtapa(i)), ir(sdk, ROTA_PIPELINE, p.key), `${p.name} · ${T.caixas(p.boxes)}`)); }
    if (ordem.length > 0) rapido.append(h("span", { class: "mbcrm-divisor" }));
    rapido.append(
      tile("Criar caixa", icone(ICONES.caixa), () => { void criarCaixa(sdk, estado); }),
      tile("Iniciar mala direta", icone(ICONES.enviar), () => { sdk.ButterBar.showMessage({ text: "A mala direta do meu-bot CRM está sendo construída.", time: 4000 }); }),
      tile("Importar", icone(ICONES.importar), () => { void importarCsv(sdk, estado); }, "Importar caixas de uma planilha (CSV)"),
    );
    const mais = tile("Mais", icone(ICONES.mais), () => { abrirMenu(mais, [["Novo pipeline", () => novoPipeline(sdk, estado)], ["Importar do Streak (pelo agente)", () => sdk.ButterBar.showMessage({ text: "No chat do meu-bot-crm, peça: \"importa meus pipelines do Streak\".", time: 7000 })]]); });
    rapido.append(mais);
  }

  async function desenharCaixas(): Promise<void> {
    limpar(abas); abas.append(abaBtn("recentes", "Recentes"), abaBtn("alta", "Tendências"));
    let cs: CaixaHome[];
    try { cs = aba === "recentes" ? await estado.caixasPorChave(ler(CHAVE_CAIXAS)) : await estado.caixasEmAlta(20); }
    catch (e) { limpar(lista); lista.append(h("div", { class: "mbcrm-erro" }, textoDoErro(e))); return; }
    limpar(lista);
    if (cs.length === 0) { lista.append(h("div", { class: "mbcrm-dica mbcrm-vazio" }, aba === "recentes" ? "As caixas que você abrir aparecem aqui." : "Nenhuma caixa ainda.")); return; }
    for (const b of cs) {
      lista.append(h("a", { class: "mbcrm-linha-caixa", href: sdk.Router.createLink(ROTA_CAIXA, { key: b.key }), onClick: ir(sdk, ROTA_CAIXA, b.key) },
        icone(ICONES.pipeline, "var(--mb-fg2)", 18), h("span", { class: "mbcrm-lc-nome" }, b.name),
        b.stage !== "" ? chipEtapa(sdk, b.pipelineKey, b.stageKey, b.stage, b.stageIndex, "mbcrm-lc-etapa") : null,
        chipPipeline(sdk, b.pipelineKey, b.pipelineName, "mbcrm-lc-pipe"),
        h("span", { class: "mbcrm-lc-quando", title: new Date(b.updatedAt).toLocaleString("pt-BR") }, aba === "alta" && b.atividade ? `${b.atividade} mudança${b.atividade === 1 ? "" : "s"} · ${haQuanto(new Date(b.updatedAt).toISOString())}` : haQuanto(new Date(b.updatedAt).toISOString()))));
    }
  }

  async function render(): Promise<void> {
    try {
      const ps = await estado.pipelines();
      await desenharRapido(ps);
      limpar(pipes);
      if (ps.length === 0) pipes.append(h("div", { class: "mbcrm-dica" }, "Seu CRM ainda não tem pipelines. Crie o primeiro no ＋, ou peça ao agente para importar os do Streak."));
      else pipes.append(...ps.map((p, i) => h("a", { class: "mbcrm-linha-caixa", href: sdk.Router.createLink(ROTA_PIPELINE, { key: p.key }), onClick: ir(sdk, ROTA_PIPELINE, p.key) }, icone(ICONES.pipeline, corDaEtapa(i), 18), h("span", { class: "mbcrm-lc-nome" }, p.name), h("span", { class: "mbcrm-lc-quando" }, T.caixas(p.boxes)))));
    } catch (e) { limpar(rapido); rapido.append(h("div", { class: "mbcrm-erro" }, textoDoErro(e))); }
    await desenharCaixas();
  }
  const off = estado.assinar(({ mudancas, reset, conexao }) => { if (reset || conexao !== "ok" || mudancas.length > 0) void render(); });
  void render();
  return off;
}

/** Escolhe o pipeline (o último aberto vem marcado) e abre o formulário de caixa. */
async function criarCaixa(sdk: InboxSDK, estado: Estado): Promise<void> {
  let ps: PipelineResumo[]; try { ps = await estado.pipelines(); } catch (e) { mostrarErro(sdk, e); return; }
  if (ps.length === 0) { novoPipeline(sdk, estado); return; }
  const ultimo = ler(CHAVE_PIPELINES)[0];
  const abrir = async (key: string): Promise<void> => { try { const p = await estado.pipeline(key); await formularioNovaCaixa(sdk, estado, p, null, (b) => { void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); }); } catch (e) { mostrarErro(sdk, e); } };
  if (ps.length === 1) { await abrir((ps[0] as PipelineResumo).key); return; }
  const sel = h("select", null, ...ps.map((p) => h("option", { value: p.key, selected: p.key === ultimo }, p.name)));
  modal(sdk, "Criar caixa", h("div", { class: "mbcrm-col" }, campo(T.pipeline, sel)), "Continuar", async () => { setTimeout(() => { void abrir(sel.value); }, 0); return null; });
}

/** Importar caixas de um CSV (Excel/Planilhas Google → "Salvar como CSV"): prévia do mapeamento, depois cria uma a uma. */
async function importarCsv(sdk: InboxSDK, estado: Estado): Promise<void> {
  let ps: PipelineResumo[]; try { ps = await estado.pipelines(); } catch (e) { mostrarErro(sdk, e); return; }
  if (ps.length === 0) { sdk.ButterBar.showMessage({ text: "Crie um pipeline antes de importar.", time: 4000 }); return; }
  const ultimo = ler(CHAVE_PIPELINES)[0];
  const sel = h("select", null, ...ps.map((p) => h("option", { value: p.key, selected: p.key === ultimo }, p.name)));
  const arq = h("input", { type: "file", accept: ".csv,text/csv,text/plain" });
  const previa = h("div", { class: "mbcrm-col mbcrm-dica" }, "A 1ª linha é o cabeçalho. \"Nome\" vira o nome da caixa; \"Etapa\", \"E-mail\", \"Telefone\" e \"Contato\" são reconhecidos; colunas com o nome de um campo do pipeline vão para ele.");
  let texto = ""; let pipeline: Pipeline | null = null;
  const planejar = async (): Promise<ReturnType<typeof planejarImport> | null> => {
    if (texto === "") return null;
    pipeline = await estado.pipeline(sel.value);
    const plano = planejarImport(lerCsv(texto), pipeline);
    limpar(previa);
    previa.append(h("strong", null, `${T.caixas(plano.linhas.length)} para criar em "${pipeline.name}"${plano.ignoradas > 0 ? ` (${plano.ignoradas} linha${plano.ignoradas === 1 ? "" : "s"} sem nome fica${plano.ignoradas === 1 ? "" : "m"} de fora)` : ""}`), ...plano.colunas.map((c) => h("div", null, `${c.titulo || "(sem título)"} → ${c.destino}`)));
    return plano;
  };
  arq.addEventListener("change", () => { const f = arq.files?.[0]; if (!f) return; void f.text().then((t) => { texto = t; return planejar(); }).catch((e) => { previa.textContent = textoDoErro(e); }); });
  sel.addEventListener("change", () => { void planejar(); });
  modal(sdk, "Importar caixas (CSV)", h("div", { class: "mbcrm-col" }, campo(T.pipeline, sel), campo("Planilha", arq), previa), "Importar", async () => {
    const plano = await planejar().catch(() => null);
    if (!plano || !pipeline) return "Escolha um arquivo CSV.";
    if (plano.linhas.length === 0) return "Nenhuma linha com nome para importar.";
    const p = pipeline; let ok = 0; const erros: string[] = [];
    const sv = sdk.ButterBar.showSaving({ text: `Importando ${T.caixas(plano.linhas.length)}…`, confirmationText: "Importado", showConfirmation: true, confirmationTime: 2000 });
    for (const l of plano.linhas) { try { await estado.criarCaixa(p.key, l); ok++; } catch (e) { erros.push(`${l.name}: ${textoDoErro(e)}`); } }
    if (erros.length === 0) sv.resolve(); else { sv.reject(); sdk.ButterBar.showError({ text: `${ok} criadas; ${erros.length} com erro (ex.: ${erros[0]})`, time: 8000 }); }
    void sdk.Router.goto(ROTA_PIPELINE, { key: p.key });
    return null;
  });
}

/** Botão do CRM na barra do topo do Gmail (ao lado da busca, como o do Streak), com um menu rápido. */
export function registrarBotaoTopo(sdk: InboxSDK, estado: Estado, tema: () => string): void {
  try {
    sdk.Toolbars.addToolbarButtonForApp({
      title: "meu-bot CRM", iconUrl: chrome.runtime.getURL("icones/crm-32.png"), arrowColor: null,
      onClick: (e) => {
        const d = e.dropdown; if (!d) return;
        const el = h("div", { class: `mbcrm mbcrm-menu-topo ${tema()}` }, h("div", { class: "mbcrm-dica" }, T.carregando));
        d.el.append(el);
        const item = (rotulo: string, fn: () => void, ic?: HTMLElement): HTMLElement => h("button", { class: "mbcrm-item-topo", onClick: () => { d.close(); fn(); } }, ic ?? null, h("span", null, rotulo));
        void estado.pipelines().then((ps) => {
          limpar(el);
          const rec = ler(CHAVE_PIPELINES);
          const ordem = [...rec.map((k) => ps.find((p) => p.key === k)).filter((p): p is PipelineResumo => p !== undefined), ...ps.filter((p) => !rec.includes(p.key))].slice(0, 8);
          el.append(item("Início", ir(sdk, ROTA_INICIO), icone("M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z", "currentColor", 18)), ...(ordem.length > 0 ? [h("div", { class: "mbcrm-sep" })] : []), ...ordem.map((p) => item(p.name, ir(sdk, ROTA_PIPELINE, p.key), icone(ICONES.pipeline, corDaEtapa(ps.indexOf(p)), 18))), h("div", { class: "mbcrm-sep" }), item("Criar caixa", () => { void criarCaixa(sdk, estado); }, icone(ICONES.caixa, "currentColor", 18)), item("Novo pipeline", () => novoPipeline(sdk, estado), icone("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z", "currentColor", 18)));
        }, (er) => { limpar(el); el.append(h("div", { class: "mbcrm-erro" }, textoDoErro(er))); });
      },
    });
  } catch { /* Gmail sem barra de apps: o trilho e o menu continuam */ }
}
