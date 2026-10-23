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
import { LARGURAS_PADRAO, aplicarOrdem, chaveLarguras, chaveOrdem, limparLargura, mesmoConjunto, moverColuna, parseLarguras, parseOrdem, type ColunaFixa } from "../colunas.ts";
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
  // Larguras das colunas: só deste navegador (o host guarda a ordem, não a largura). `colEls` é
  // preenchido a cada desenho e deixa o arrasto mexer na coluna sem redesenhar a tabela inteira.
  let larguras: Record<string, number> = (() => { try { return parseLarguras(localStorage.getItem(chaveLarguras(key))); } catch { return {}; } })();
  let colEls: HTMLTableColElement[] = [];
  // Ordem das colunas na tela, deste navegador. A ordem dos CAMPOS também vai para o host quando
  // só campos trocam entre si, para quem abrir em outra máquina pegar um padrão que faz sentido.
  let ordem: string[] = (() => { try { return parseOrdem(localStorage.getItem(chaveOrdem(key))); } catch { return []; } })();

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
    ["Restaurar larguras", () => restaurarLarguras()],
    ["Restaurar ordem das colunas", () => restaurarColunas()],
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

  // ---- colunas: uma lista só, que o cabeçalho e a linha percorrem ----

  /**
   * Uma coluna da grade. Antes a ordem estava escrita duas vezes (no cabeçalho e na montagem de
   * cada linha) e só os campos do pipeline se moviam; com a lista única, qualquer coluna anda e as
   * duas partes não têm como divergir.
   */
  interface ColunaGrade { id: string; titulo: string; campo: Campo | null; celula: (b: CaixaResumo, p: Pipeline) => HTMLElement }

  /** As colunas na ordem a mostrar: a padrão do pipeline, já casada com a que a pessoa arrastou. */
  function colunasDa(p: Pipeline): ColunaGrade[] {
    const fixas: Record<string, ColunaGrade> = {
      nome: { id: "nome", titulo: "Nome", campo: null, celula: (b) => celulaNome(b) },
      etapa: { id: "etapa", titulo: "Etapa", campo: null, celula: (b, pp) => celulaEtapa(b, pp) },
      responsaveis: { id: "responsaveis", titulo: "Responsáveis", campo: null, celula: (b) => celulaResponsaveis(b) },
      contatos: { id: "contatos", titulo: "@ Contatos", campo: null, celula: (b) => celulaContatos(b) },
      atualizado: { id: "atualizado", titulo: "Atualizado", campo: null, celula: (b) => celulaAtualizado(b) },
    };
    const deCampo = p.fields.map((f): ColunaGrade => ({ id: f.key, titulo: f.name, campo: f, celula: (b) => celulaCampo(b, f) }));
    const padrao = [fixas["nome"]!, fixas["etapa"]!, fixas["responsaveis"]!, fixas["contatos"]!, ...deCampo, fixas["atualizado"]!];
    const porId = new Map(padrao.map((c) => [c.id, c]));
    return aplicarOrdem(padrao.map((c) => c.id), ordem).flatMap((id) => { const c = porId.get(id); return c ? [c] : []; });
  }

  const larguraDe = (id: string): number => larguras[id] ?? LARGURAS_PADRAO[id as ColunaFixa] ?? LARGURAS_PADRAO.campo;
  function gravarLarguras(): void {
    try { localStorage.setItem(chaveLarguras(key), JSON.stringify(larguras)); } catch { /* sem storage: vale só nesta sessão */ }
  }
  function restaurarLarguras(): void { larguras = {}; try { localStorage.removeItem(chaveLarguras(key)); } catch { /* ok */ } desenhar(); }
  function restaurarColunas(): void { ordem = []; try { localStorage.removeItem(chaveOrdem(key)); } catch { /* ok */ } desenhar(); }

  /** Aplica a largura na coluna inteira pelo <col>, sem tocar em célula nenhuma. */
  function aplicarLargura(i: number, px: number): void {
    const col = colEls[i]; if (col) col.style.width = `${px}px`;
  }

  /**
   * Pegador na divisória direita do cabeçalho: arrastar redimensiona, duplo clique ajusta ao
   * conteúdo. `setPointerCapture` segura o arrasto mesmo quando o ponteiro sai do cabeçalho.
   */
  function pegador(id: string, i: number, tabela: HTMLTableElement): HTMLElement {
    const p = h("span", { class: "mbcrm-col-resize", title: "Arraste para redimensionar; duplo clique ajusta ao conteúdo" });
    let x0 = 0; let w0 = 0;
    p.addEventListener("pointerdown", (ev: PointerEvent) => {
      ev.preventDefault(); ev.stopPropagation(); // não deixa virar arrasto de mover coluna
      x0 = ev.clientX; w0 = larguraDe(id);
      p.setPointerCapture(ev.pointerId);
      p.classList.add("mbcrm-col-ativo");
    });
    p.addEventListener("pointermove", (ev: PointerEvent) => {
      if (!p.hasPointerCapture(ev.pointerId)) return;
      const l = limparLargura(w0 + (ev.clientX - x0)); if (l === null) return;
      larguras[id] = l; aplicarLargura(i, l);
    });
    const soltar = (ev: PointerEvent): void => {
      if (!p.hasPointerCapture(ev.pointerId)) return;
      p.releasePointerCapture(ev.pointerId); p.classList.remove("mbcrm-col-ativo"); gravarLarguras();
    };
    p.addEventListener("pointerup", soltar);
    p.addEventListener("pointercancel", soltar);
    p.addEventListener("dblclick", (ev: Event) => {
      ev.preventDefault(); ev.stopPropagation();
      // O maior conteúdo da coluna (as células cortam com overflow hidden, então scrollWidth é o texto inteiro).
      let maior = 0;
      for (const c of tabela.querySelectorAll<HTMLElement>(`tr > *:nth-child(${i + 1})`)) maior = Math.max(maior, c.scrollWidth);
      const l = limparLargura(maior + 26); if (l === null) return; // 26 = padding das células
      larguras[id] = l; aplicarLargura(i, l); gravarLarguras();
    });
    return p;
  }

  function gravarOrdem(): void {
    try { localStorage.setItem(chaveOrdem(key), JSON.stringify(ordem)); } catch { /* sem storage: vale só nesta sessão */ }
  }

  /**
   * Move uma coluna de lugar. A ordem da tela é deste navegador e vale para qualquer coluna; a
   * ordem dos CAMPOS, quando muda, também vai para o host, para quem abrir em outra máquina pegar
   * um padrão coerente. Mover uma coluna fixa não toca no host.
   */
  function mover(colunas: ColunaGrade[], de: number, para: number): void {
    const p = pipeline; if (!p || de === para) return;
    const antes = colunas.filter((c) => c.campo !== null).map((c) => c.id);
    ordem = moverColuna(colunas.map((c) => c.id), de, para);
    gravarOrdem();
    desenhar();
    const depois = ordem.filter((id) => antes.includes(id));
    if (depois.join("|") !== antes.join("|")) void gravarOrdemDosCampos(p, depois);
  }

  /**
   * Leva a ordem dos campos ao host. Releitura obrigatória antes: o host remove do pipeline todo
   * campo ausente da lista enviada, então salvar com um conjunto desatualizado apagaria a coluna
   * que outra pessoa acabou de criar, junto com os valores dela.
   */
  async function gravarOrdemDosCampos(p: Pipeline, ids: string[]): Promise<void> {
    const porId = new Map(p.fields.map((f) => [f.key, f]));
    const nova = ids.flatMap((id) => { const f = porId.get(id); return f ? [f] : []; });
    if (nova.length !== p.fields.length) return;
    const sv = salvando();
    try {
      const atual = await estado.pipeline(key);
      if (!mesmoConjunto(atual.fields, p.fields)) {
        sv.reject();
        sdk.ButterBar.showError({ text: "As colunas mudaram enquanto você arrastava; a ordem não foi salva no servidor. Confira e tente de novo." });
        void carregar();
        return;
      }
      pipeline = await estado.atualizarPipeline(key, { fields: camposDoPatch(nova) });
      sv.resolve();
    } catch (e) { sv.reject(); mostrarErro(sdk, e); void carregar(); }
  }

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
    const colunas = colunasDa(p);
    const tabela = h("table", { class: "mbcrm-tabela" });
    // Um <col> por coluna manda na largura de todas as células dela (a tabela é table-layout: fixed).
    // A coluna "＋" entra no fim e fora da ordem: não é dado, é o botão de criar coluna.
    colEls = [...colunas.map((c) => h("col", { style: { width: `${larguraDe(c.id)}px` } })), h("col", { style: { width: `${larguraDe("add")}px` } })];
    tabela.append(h("colgroup", null, ...colEls));

    let arrastando: number | null = null;
    const th = (c: ColunaGrade, i: number): HTMLElement => {
      const tipo = c.campo === null ? "" : ` · ${TIPOS.find(([v]) => v === c.campo?.type)?.[1] ?? c.campo.type}`;
      // A primeira coluna é a presa à esquerda, seja ela qual for depois do arrasto.
      const el = h("th", { class: `mbcrm-col-mover${i === 0 ? " mbcrm-col-presa" : ""}${c.id === "nome" ? " mbcrm-col-nome" : ""}`, draggable: "true", title: `${c.titulo}${tipo} · arraste para mover a coluna` }, c.titulo);
      el.addEventListener("dragstart", (ev: DragEvent) => { arrastando = i; el.classList.add("mbcrm-col-arrastando"); ev.dataTransfer?.setData("text/plain", c.id); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move"; });
      el.addEventListener("dragend", () => { arrastando = null; el.classList.remove("mbcrm-col-arrastando"); for (const o of tabela.querySelectorAll(".mbcrm-col-alvo")) o.classList.remove("mbcrm-col-alvo"); });
      el.addEventListener("dragover", (ev: DragEvent) => { if (arrastando === null || arrastando === i) return; ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move"; el.classList.add("mbcrm-col-alvo"); });
      el.addEventListener("dragleave", () => el.classList.remove("mbcrm-col-alvo"));
      el.addEventListener("drop", (ev: DragEvent) => { ev.preventDefault(); el.classList.remove("mbcrm-col-alvo"); const de = arrastando; arrastando = null; if (de !== null && de !== i) mover(colunas, de, i); });
      el.append(pegador(c.id, i, tabela));
      return el;
    };

    tabela.append(h("thead", null, h("tr", null,
      ...colunas.map(th),
      h("th", { class: "mbcrm-col-add" }, h("button", { class: "mbcrm-icone", title: "Adicionar coluna", onClick: () => novaColuna() }, "＋")))));
    const ncol = colunas.length + 1; // +1 da coluna "＋"
    p.stages.forEach((s, i) => {
      if (filtroEtapa !== "" && filtroEtapa !== s.key) return;
      const lista = grupos.get(s.key) ?? []; const cor = corDaEtapa(i); const fechado = recolhidas.has(s.key);
      const tb = h("tbody", null);
      const chip = h("button", { class: "mbcrm-etapa-chip", style: { background: cor, color: textoSobre(cor) }, title: fechado ? "Expandir" : "Recolher", onClick: () => { if (fechado) recolhidas.delete(s.key); else recolhidas.add(s.key); desenhar(); } }, `${s.name} ${fechado ? "▸" : "▾"}`);
      const mais = h("button", { class: "mbcrm-icone", title: `Adicionar caixa em ${s.name}`, onClick: () => { recolhidas.delete(s.key); adicionandoEm = s.key; desenhar(); } }, "＋");
      tb.append(h("tr", { class: "mbcrm-grupo-linha" }, h("td", { colspan: String(ncol) }, chip, mais, h("span", { class: "mbcrm-n" }, lista.length > 0 ? String(lista.length) : ""))));
      if (!fechado) {
        for (const b of lista) tb.append(linha(b, p, colunas));
        tb.append(linhaAdicionar(s, p, ncol));
      }
      tabela.append(tb);
    });
    grade.append(tabela);
    if (caixas.length === 0 && busca !== "") grade.append(h("div", { class: "mbcrm-vazio" }, `Nada encontrado para "${busca}".`));
  }

  // ---- células: uma função por coluna, chamada pela lista de colunasDa() ----
  const celulaNome = (b: CaixaResumo): HTMLElement =>
    h("td", { class: "mbcrm-col-nome" }, h("a", { href: sdk.Router.createLink(ROTA_CAIXA, { key: b.key }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); } }, b.name));

  function celulaEtapa(b: CaixaResumo, p: Pipeline): HTMLElement {
    const idx = p.stages.findIndex((s) => s.key === b.stageKey);
    const etapa = h("td", { class: "mbcrm-editavel", title: "Clique para mudar de etapa" }, h("span", { class: "mbcrm-mini-chev", style: { background: corDaEtapa(idx) } }), p.stages[idx]?.name ?? "");
    etapa.addEventListener("click", () => {
      if (etapa.querySelector("select")) return;
      const sel = h("select", null, ...p.stages.map((s) => h("option", { value: s.key, selected: s.key === b.stageKey }, s.name)));
      editarCelula(etapa, sel, async () => { if (sel.value !== b.stageKey) await estado.atualizarCaixa(b.key, { stageKey: sel.value }); });
      sel.addEventListener("change", () => sel.blur());
    });
    return etapa;
  }

  const celulaResponsaveis = (b: CaixaResumo): HTMLElement =>
    h("td", { title: (b.responsaveis ?? []).map((r) => r.email).join(", ") }, h("span", { class: "mbcrm-resps-mini" }, ...(b.responsaveis ?? []).slice(0, 4).map((r) => avatarEmail(r))));

  function celulaContatos(b: CaixaResumo): HTMLElement {
    const pessoas = b.pessoas ?? [];
    return h("td", { class: "mbcrm-dica" }, pessoas.length > 0 ? pessoas.join(", ") + (b.contatos > pessoas.length ? ` +${b.contatos - pessoas.length}` : "") : b.contatos > 0 ? `${b.contatos} contato${b.contatos === 1 ? "" : "s"}` : "");
  }

  const celulaAtualizado = (b: CaixaResumo): HTMLElement =>
    h("td", { class: "mbcrm-dica", title: new Date(b.updatedAt).toLocaleString("pt-BR") }, haQuanto(new Date(b.updatedAt).toISOString()));

  function celulaCampo(b: CaixaResumo, f: Campo): HTMLElement {
    const txt = valorTexto(f, b.fields[f.key]);
    const td = h("td", { class: "mbcrm-editavel", title: txt }, txt);
    td.addEventListener("click", () => {
      if (td.querySelector("input, select")) return;
      let novo: unknown; let mudou = false;
      const ed = editorCampo(f, txt, async (v) => { novo = v; mudou = true; });
      editarCelula(td, ed, async () => { if (mudou) await estado.atualizarCaixa(b.key, { fields: { [f.key]: novo } }); });
    });
    return td;
  }

  function linha(b: CaixaResumo, p: Pipeline, colunas: ColunaGrade[]): HTMLElement {
    const tr = h("tr", { class: "mbcrm-caixa-linha" });
    colunas.forEach((c, i) => {
      const td = c.celula(b, p);
      if (i === 0) td.classList.add("mbcrm-col-presa"); // a primeira é a que fica presa à esquerda
      tr.append(td);
    });
    tr.append(h("td", null)); // alinha com a coluna "＋" do cabeçalho
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
