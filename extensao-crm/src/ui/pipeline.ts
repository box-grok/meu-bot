/**
 * Rota crm/pipeline/:key — como o pipeline do Streak: cabeçalho (nome editável, contagem, busca, ⋮, ＋), faixa de
 * etapas em chevrons com a contagem (clique filtra; ▾ renomeia ou gerencia), grade em planilha agrupada por
 * etapa com colunas (Nome, Etapa, Contatos, campos, Atualizado), edição na própria célula e "Adicionar caixa".
 */
import type { CustomRouteView, InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { CaixaResumo, Campo, Etapa, Pipeline } from "../tipos.ts";
import { ROTA_CAIXA, keyValida } from "../rotas.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";
import { agruparPorEtapa, renomearEtapa, valorTexto } from "../grade.ts";
import { haQuanto } from "../resumo.ts";
import { T } from "../textos.ts";
import { h, limpar } from "./h.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";
import { editorCampo } from "./campos.ts";
import { abrirMenu } from "./flutuante.ts";
import { campo, editarEtapas, modal } from "./menu.ts";
import { formularioNovaCaixa } from "./painel-thread.ts";
import { avatarEmail } from "./caixa.ts";
import { etapaPedida } from "./navegar.ts";

const TIPOS: [string, string][] = [["TEXT", "Texto"], ["NUMBER", "Número"], ["DATE", "Data"], ["DROPDOWN", "Lista (uma opção)"], ["TAG", "Etiquetas (várias)"], ["CHECKBOX", "Sim/não"]];

export function montarPipeline(sdk: InboxSDK, estado: Estado, view: CustomRouteView, raiz: (el: HTMLElement) => void): void {
  const key = view.getParams()["key"] ?? "";
  const el = view.getElement();
  if (!keyValida(key)) { sdk.ButterBar.showError({ text: "Pipeline inválido" }); void sdk.Router.goto(sdk.Router.NativeRouteIDs.INBOX); return; }
  try { view.setFullWidth(true); } catch { /* versões antigas do SDK */ }
  const root = h("div", { class: "mbcrm mbcrm-rota mbcrm-pagina mbcrm-pl" }); raiz(root); el.append(root);
  const fechar = estado.abrirVisao();
  let pipeline: Pipeline | null = null; let caixas: CaixaResumo[] = [];
  let filtroEtapa = etapaPedida(key); let busca = ""; let timer: ReturnType<typeof setTimeout> | null = null;
  const recolhidas = new Set<string>(); let adicionandoEm: string | null = null; let editando = false;

  const salvando = () => sdk.ButterBar.showSaving({ text: T.salvando, confirmationText: T.salvo, showConfirmation: true, confirmationTime: 1200 });
  async function gravarPipeline(patch: Parameters<Estado["atualizarPipeline"]>[1]): Promise<string | null> {
    if (!pipeline) return null;
    try { pipeline = await estado.atualizarPipeline(pipeline.key, patch); void render(); return null; } catch (e) { return textoDoErro(e); }
  }

  // ---- cabeçalho ----
  const titulo = h("input", { class: "mbcrm-titulo", value: T.carregando, title: "Clique para renomear o pipeline" });
  titulo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") titulo.blur(); if (ev.key === "Escape" && pipeline) { titulo.value = pipeline.name; titulo.blur(); } });
  titulo.addEventListener("change", () => {
    const novo = titulo.value.trim();
    if (!pipeline || novo === "" || novo === pipeline.name) { if (pipeline) titulo.value = pipeline.name; return; }
    const sv = salvando();
    estado.atualizarPipeline(pipeline.key, { name: novo }).then((p) => { pipeline = p; sv.resolve(); }, (e) => { sv.reject(); mostrarErro(sdk, e); if (pipeline) titulo.value = pipeline.name; });
  });
  const contagem = h("span", { class: "mbcrm-contagem" });
  const inBusca = h("input", { type: "search", placeholder: "Buscar caixas, contatos, notas…", class: "mbcrm-busca", hidden: "hidden", onInput: () => { busca = inBusca.value.trim(); if (timer) clearTimeout(timer); timer = setTimeout(() => { void carregar(); }, 250); } });
  inBusca.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { inBusca.value = ""; busca = ""; inBusca.hidden = true; void carregar(); } });
  const btnBusca = h("button", { class: "mbcrm-icone", title: "Buscar e filtrar", onClick: () => { inBusca.hidden = !inBusca.hidden; if (!inBusca.hidden) inBusca.focus(); else if (busca !== "") { inBusca.value = ""; busca = ""; void carregar(); } } }, "⌕");
  const btnMais: HTMLButtonElement = h("button", { class: "mbcrm-icone", title: "Mais ações", onClick: () => { abrirMenu(btnMais, [
    ["Renomear pipeline", () => { titulo.focus(); titulo.select(); }],
    ["Gerenciar etapas", () => { if (pipeline) void editarEtapas(sdk, estado, pipeline); }],
    ["Adicionar coluna", () => novaColuna()],
    ["Gerenciar colunas", () => gerenciarColunas()],
    ...(recolhidas.size > 0 ? [["Expandir todas as etapas", () => { recolhidas.clear(); desenhar(); }] as [string, () => void]] : [["Recolher etapas vazias", () => { if (pipeline) { const g = agruparPorEtapa(pipeline.stages, caixas); for (const [k, l] of g) if (l.length === 0) recolhidas.add(k); desenhar(); } }] as [string, () => void]]),
  ]); } }, "⋮");
  const btnNova = h("button", { class: "mbcrm-fab", title: T.novaCaixa, onClick: () => { if (pipeline) void formularioNovaCaixa(sdk, estado, pipeline, null, (b) => { void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); }); } }, "＋");
  const faixa = h("div", { class: "mbcrm-faixa" });
  const rolar = (dx: number) => faixa.scrollBy({ left: dx, behavior: "smooth" });
  const setaEsq = h("button", { class: "mbcrm-seta mbcrm-seta-esq", title: "Etapas anteriores", onClick: () => rolar(-400) }, "‹");
  const setaDir = h("button", { class: "mbcrm-seta mbcrm-seta-dir", title: "Mais etapas", onClick: () => rolar(400) }, "›");
  const atualizarSetas = (): void => { setaEsq.hidden = faixa.scrollLeft <= 2; setaDir.hidden = faixa.scrollLeft + faixa.clientWidth >= faixa.scrollWidth - 2; };
  faixa.addEventListener("scroll", atualizarSetas);
  const grade = h("div", { class: "mbcrm-grade" });
  root.append(
    h("div", { class: "mbcrm-pl-topo" }, titulo, h("span", { class: "mbcrm-cresce" }), contagem, inBusca, btnBusca, btnMais, btnNova),
    h("div", { class: "mbcrm-faixa-moldura" }, setaEsq, faixa, setaDir),
    grade,
  );

  // ---- etapas: renomear / gerenciar ----
  function renomear(s: Etapa): void {
    const i = h("input", { type: "text", value: s.name });
    modal(sdk, "Renomear etapa", h("div", { class: "mbcrm-col" }, campo(T.nome, i), h("div", { class: "mbcrm-dica" }, "As caixas continuam nesta etapa.")), "Salvar", async () => {
      const n = i.value.trim(); if (n === "") return "Dê um nome."; if (!pipeline || n === s.name) return null;
      return gravarPipeline({ stages: renomearEtapa(pipeline.stages, s.key, n) });
    });
    setTimeout(() => { i.focus(); i.select(); }, 50);
  }
  function menuEtapa(ancora: HTMLElement, s: Etapa): void {
    abrirMenu(ancora, [
      ["Renomear", () => renomear(s)],
      ["Gerenciar etapas", () => { if (pipeline) void editarEtapas(sdk, estado, pipeline); }],
      ["Adicionar caixa aqui", () => { recolhidas.delete(s.key); adicionandoEm = s.key; desenhar(); }],
      filtroEtapa === s.key ? ["Mostrar todas as etapas", () => { filtroEtapa = ""; desenhar(); }] : ["Mostrar só esta etapa", () => { filtroEtapa = s.key; desenhar(); }],
    ]);
  }

  // ---- colunas ----
  function novaColuna(): void {
    const nome = h("input", { type: "text", placeholder: "Ex.: Valor, Origem, Próximo contato" });
    const tipo = h("select", null, ...TIPOS.map(([v, r]) => h("option", { value: v }, r)));
    const opcoes = h("input", { type: "text", placeholder: "Opções separadas por vírgula" });
    const linhaOpcoes = campo("Opções", opcoes); linhaOpcoes.hidden = true;
    tipo.addEventListener("change", () => { linhaOpcoes.hidden = tipo.value !== "DROPDOWN" && tipo.value !== "TAG"; });
    modal(sdk, "Adicionar coluna", h("div", { class: "mbcrm-col" }, campo(T.nome, nome), campo("Tipo", tipo), linhaOpcoes), "Adicionar", async () => {
      if (!pipeline) return null; const n = nome.value.trim(); if (n === "") return "Dê um nome.";
      const ops = opcoes.value.split(",").map((x) => x.trim()).filter(Boolean);
      if ((tipo.value === "DROPDOWN" || tipo.value === "TAG") && ops.length === 0) return "Liste as opções.";
      return gravarPipeline({ fields: [...camposDoPatch(pipeline.fields), { name: n, type: tipo.value, ...(ops.length > 0 ? { options: ops.map((name) => ({ name })) } : {}) }] });
    });
    setTimeout(() => nome.focus(), 50);
  }
  function gerenciarColunas(): void {
    if (!pipeline) return;
    const linhas = pipeline.fields.map((f) => { const i = h("input", { type: "text", value: f.name }); const rm = h("input", { type: "checkbox" }); return { f, i, rm, el: h("div", { class: "mbcrm-coluna-ed" }, i, h("span", { class: "mbcrm-dica" }, TIPOS.find(([v]) => v === f.type)?.[1] ?? f.type), h("label", { class: "mbcrm-dica" }, rm, " remover")) }; });
    const corpo = linhas.length === 0 ? h("div", { class: "mbcrm-dica" }, "Este pipeline ainda não tem colunas próprias.") : h("div", { class: "mbcrm-col" }, ...linhas.map((l) => l.el), h("div", { class: "mbcrm-dica" }, "Remover uma coluna apaga o valor dela em todas as caixas."));
    modal(sdk, "Colunas", corpo, "Salvar", async () => {
      if (!pipeline) return null;
      const fields = linhas.filter((l) => !l.rm.checked).map((l) => ({ ...camposDoPatch([l.f])[0] as { key: string; name: string }, name: l.i.value.trim() || l.f.name }));
      return gravarPipeline({ fields });
    });
  }

  // ---- dados ----
  async function carregar(): Promise<void> {
    try {
      pipeline = await estado.pipeline(key);
      const r = await estado.caixasDoPipeline(key, { ...(busca !== "" ? { q: busca } : {}), limit: 1000 });
      caixas = r.boxes;
      desenhar();
    } catch (e) { limpar(grade); grade.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, T.semConexao)); mostrarErro(sdk, e); }
  }
  const render = carregar;

  function desenhar(): void {
    const p = pipeline; if (!p) return;
    if (document.activeElement !== titulo) titulo.value = p.name;
    contagem.textContent = busca !== "" ? `${T.caixas(caixas.length)} encontradas` : T.caixas(caixas.length);
    const grupos = agruparPorEtapa(p.stages, caixas);

    limpar(faixa);
    p.stages.forEach((s, i) => {
      const cor = corDaEtapa(i); const n = grupos.get(s.key)?.length ?? 0;
      const seta = h("button", { class: "mbcrm-chev-menu", title: "Opções da etapa", style: { color: textoSobre(cor) } }, "▾");
      seta.addEventListener("click", (ev) => { ev.stopPropagation(); menuEtapa(seta, s); });
      faixa.append(h("div", { class: `mbcrm-chev${filtroEtapa !== "" && filtroEtapa !== s.key ? " mbcrm-apagada" : ""}`, title: filtroEtapa === s.key ? "Clique para mostrar todas" : `Mostrar só ${s.name}`, style: { background: cor, color: textoSobre(cor), zIndex: String(p.stages.length - i) }, onClick: () => { filtroEtapa = filtroEtapa === s.key ? "" : s.key; desenhar(); } },
        h("div", { class: "mbcrm-chev-n" }, String(n)), h("div", { class: "mbcrm-chev-nome" }, h("span", null, s.name), seta)));
    });
    requestAnimationFrame(atualizarSetas);

    if (editando) return; // não arranca o editor aberto numa célula
    limpar(grade);
    const cols = p.fields;
    const tabela = h("table", { class: "mbcrm-tabela" });
    tabela.append(h("thead", null, h("tr", null, h("th", { class: "mbcrm-col-nome" }, "Nome"), h("th", null, "Etapa"), h("th", null, "Responsáveis"), h("th", null, "@ Contatos"), ...cols.map((f) => h("th", { title: TIPOS.find(([v]) => v === f.type)?.[1] ?? f.type }, f.name)), h("th", null, "Atualizado"), h("th", { class: "mbcrm-col-add" }, h("button", { class: "mbcrm-icone", title: "Adicionar coluna", onClick: () => novaColuna() }, "＋")))));
    const ncol = cols.length + 6;
    p.stages.forEach((s, i) => {
      if (filtroEtapa !== "" && filtroEtapa !== s.key) return;
      const lista = grupos.get(s.key) ?? []; const cor = corDaEtapa(i); const fechado = recolhidas.has(s.key);
      const tb = h("tbody", null);
      const chip = h("button", { class: "mbcrm-etapa-chip", style: { background: cor, color: textoSobre(cor) }, title: fechado ? "Expandir" : "Recolher", onClick: () => { if (fechado) recolhidas.delete(s.key); else recolhidas.add(s.key); desenhar(); } }, `${s.name} ${fechado ? "▸" : "▾"}`);
      const mais = h("button", { class: "mbcrm-icone", title: `Adicionar caixa em ${s.name}`, onClick: () => { recolhidas.delete(s.key); adicionandoEm = s.key; desenhar(); } }, "＋");
      tb.append(h("tr", { class: "mbcrm-grupo-linha" }, h("td", { colspan: String(ncol) }, chip, mais, h("span", { class: "mbcrm-n" }, lista.length > 0 ? String(lista.length) : ""))));
      if (!fechado) {
        for (const b of lista) tb.append(linha(b, p, cols));
        tb.append(linhaAdicionar(s, p, ncol));
      }
      tabela.append(tb);
    });
    grade.append(tabela);
    if (caixas.length === 0 && busca !== "") grade.append(h("div", { class: "mbcrm-vazio" }, `Nada encontrado para "${busca}".`));
  }

  function linha(b: CaixaResumo, p: Pipeline, cols: Campo[]): HTMLElement {
    const idx = p.stages.findIndex((s) => s.key === b.stageKey);
    const tr = h("tr", { class: "mbcrm-caixa-linha" });
    const nome = h("td", { class: "mbcrm-col-nome" }, h("a", { href: sdk.Router.createLink(ROTA_CAIXA, { key: b.key }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); } }, b.name));
    const etapa = h("td", { class: "mbcrm-editavel", title: "Clique para mudar de etapa" }, h("span", { class: "mbcrm-mini-chev", style: { background: corDaEtapa(idx) } }), p.stages[idx]?.name ?? "");
    etapa.addEventListener("click", () => {
      if (etapa.querySelector("select")) return;
      const sel = h("select", null, ...p.stages.map((s) => h("option", { value: s.key, selected: s.key === b.stageKey }, s.name)));
      editarCelula(etapa, sel, async () => { if (sel.value !== b.stageKey) await estado.atualizarCaixa(b.key, { stageKey: sel.value }); });
      sel.addEventListener("change", () => sel.blur());
    });
    const pessoas = b.pessoas ?? [];
    const contatos = h("td", { class: "mbcrm-dica" }, pessoas.length > 0 ? pessoas.join(", ") + (b.contatos > pessoas.length ? ` +${b.contatos - pessoas.length}` : "") : b.contatos > 0 ? `${b.contatos} contato${b.contatos === 1 ? "" : "s"}` : "");
    const resps = h("td", { title: (b.responsaveis ?? []).map((r) => r.email).join(", ") }, h("span", { class: "mbcrm-resps-mini" }, ...(b.responsaveis ?? []).slice(0, 4).map((r) => avatarEmail(r))));
    tr.append(nome, etapa, resps, contatos);
    for (const f of cols) {
      const txt = valorTexto(f, b.fields[f.key]);
      const td = h("td", { class: "mbcrm-editavel", title: txt }, txt);
      td.addEventListener("click", () => {
        if (td.querySelector("input, select")) return;
        let novo: unknown; let mudou = false;
        const ed = editorCampo(f, txt, async (v) => { novo = v; mudou = true; });
        editarCelula(td, ed, async () => { if (mudou) await estado.atualizarCaixa(b.key, { fields: { [f.key]: novo } }); });
      });
      tr.append(td);
    }
    tr.append(h("td", { class: "mbcrm-dica", title: new Date(b.updatedAt).toLocaleString("pt-BR") }, haQuanto(new Date(b.updatedAt).toISOString())), h("td", null));
    return tr;
  }

  /** Troca o conteúdo da célula pelo editor; ao sair (blur/Enter) grava e redesenha; Esc cancela. */
  function editarCelula(td: HTMLElement, ed: HTMLElement, gravar: () => Promise<void>): void {
    editando = true; limpar(td); td.append(ed);
    const alvo = (ed.matches("input, select") ? ed : ed.querySelector("input, select")) as HTMLInputElement | HTMLSelectElement | null;
    let feito = false;
    const fim = async (salvar: boolean): Promise<void> => {
      if (feito) return; feito = true;
      if (salvar) { const sv = salvando(); try { await gravar(); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); } }
      editando = false; await carregar();
    };
    alvo?.addEventListener("keydown", (ev) => { const k = (ev as KeyboardEvent).key; if (k === "Enter") alvo.blur(); if (k === "Escape") void fim(false); });
    // O editor grava no "change", que vem antes do blur; espera um tique para o change chegar.
    alvo?.addEventListener("blur", () => { setTimeout(() => { void fim(true); }, 0); });
    alvo?.focus();
  }

  function linhaAdicionar(s: Etapa, p: Pipeline, ncol: number): HTMLElement {
    if (adicionandoEm !== s.key) return h("tr", { class: "mbcrm-add-linha" }, h("td", { colspan: String(ncol), onClick: () => { adicionandoEm = s.key; desenhar(); } }, "＋ Adicionar caixa"));
    const i = h("input", { type: "text", placeholder: `Nome da caixa em ${s.name} (Enter cria, Esc cancela)` });
    let feito = false;
    const criar = async (): Promise<void> => {
      const n = i.value.trim(); if (feito) return; feito = true;
      if (n !== "") { try { await estado.criarCaixa(p.key, { name: n, stageKey: s.key }); } catch (e) { mostrarErro(sdk, e); } }
      adicionandoEm = null; editando = false; await carregar();
    };
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void criar(); if (ev.key === "Escape") { feito = true; adicionandoEm = null; editando = false; desenhar(); } });
    i.addEventListener("blur", () => { void criar(); });
    editando = true; setTimeout(() => i.focus(), 0);
    return h("tr", { class: "mbcrm-add-linha mbcrm-add-ativa" }, h("td", { colspan: String(ncol) }, i));
  }

  const off = estado.assinar(({ mudancas, reset }) => { if (reset || mudancas.some((m) => m.pipeline === key || m.tipo === "box.create" || m.tipo === "import" || m.tipo === "box.delete" || m.tipo.startsWith("box."))) void carregar(); });
  view.on("destroy", () => { off(); fechar(); if (timer) clearTimeout(timer); });
  void render();
}

/** Campos atuais no formato do patch (chave mantida = renomear sem perder valores). */
function camposDoPatch(fs: Campo[]): { key: string; name: string; type: string; options?: { key: string; name: string }[] }[] {
  return fs.map((f) => ({ key: f.key, name: f.name, type: f.type, ...(f.options.length > 0 ? { options: f.options.map((o) => ({ key: o.key, name: o.name })) } : {}) }));
}
