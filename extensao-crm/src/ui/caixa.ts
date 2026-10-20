/**
 * Rota crm/caixa/:key — a caixa como página inteira do Gmail, na mesma disposição do Streak, em português e sem
 * propaganda. Topo: voltar, pipeline › nome, link, ⋮, "1 de N". Esquerda: escrever um registro (atalhos de
 * tipo) e a linha do tempo com avatares. Direita: etapa (seletor colorido), resumo, colunas personalizadas em duas
 * colunas, contatos e organizações, anotações e indicadores, em seções que recolhem.
 */
import type { CustomRouteView, InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { CaixaFicha, Campo, Pipeline } from "../tipos.ts";
import { ROTA_CAIXA, ROTA_CONTATO, ROTA_ORG, ROTA_PIPELINE, keyValida } from "../rotas.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";
import { diasDesde, haQuanto, resumoDaCaixa } from "../resumo.ts";
import { T } from "../textos.ts";
import { comLinks, h, limpar, salvarBase64 } from "./h.ts";
import { editorCampo } from "./campos.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";
import { abrirMenu } from "./flutuante.ts";
import { chipEtapa, chipPipeline } from "./navegar.ts";
import { modal } from "./menu.ts";
import { whatsappCartao } from "./pessoas.ts";
import { separarContato, sugestoesDaConversa } from "../sugestoes.ts";

const TIPOS: { id: Campo["type"]; nome: string }[] = [{ id: "TEXT", nome: "Texto" }, { id: "NUMBER", nome: "Número" }, { id: "DATE", nome: "Data" }, { id: "DROPDOWN", nome: "Lista" }, { id: "TAG", nome: "Etiquetas" }, { id: "CHECKBOX", nome: "Sim/não" }];
/** Ícones Material (Apache-2.0) das seções, como no Streak. */
const IC = {
  colunas: "M10 18h5V5h-5v13zm-6 0h5V5H4v13zM16 5v13h5V5h-5z",
  pessoa: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z",
  nota: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  grafico: "M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z",
  brilho: "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  enviar: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  etapa: "M3 5h11l4 7-4 7H3l4-7z",
  predio: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z",
} as const;
const ic = (d: string, tam = 22, cor = "currentColor"): HTMLElement => h("span", { class: "mbcrm-ic", html: `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true"><path d="${d}" fill="${cor}"/></svg>` });
/** Seu e-mail (para não sugerir você mesmo); vazio se o SDK não disser. */
let meuEmailCache = "";
export const definirMeuEmail = (e: string): void => { meuEmailCache = e; };
const meuEmail = (): string => meuEmailCache;
/** Cor estável por e-mail (o mesmo responsável tem sempre a mesma cor). */
const CORES_AVATAR = ["#689f38", "#bf360c", "#1565c0", "#6a1b9a", "#00838f", "#ad1457", "#4e342e", "#283593"];
export const corDoEmail = (e: string): string => { let n = 0; for (const ch of e) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return CORES_AVATAR[n % CORES_AVATAR.length] as string; };
export const avatarEmail = (r: { email: string; nome: string }): HTMLElement => h("span", { class: "mbcrm-avatar mbcrm-avatar-p", style: { background: corDoEmail(r.email) } }, ((r.nome || r.email).trim()[0] ?? "?").toUpperCase());
const avatar = (nome: string, cor = "#34a853"): HTMLElement => h("span", { class: "mbcrm-avatar", style: { background: cor } }, (nome.trim()[0] ?? "?").toUpperCase());
/** Atalhos "Adicionar:" (só ícone, como no Streak) — viram um prefixo no registro (o host guarda texto). */
const ATALHOS: { titulo: string; prefixo: string; cor: string; d: string }[] = [
  { titulo: "Próximo passo", prefixo: "Próximo passo: ", cor: "#d93025", d: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" },
  { titulo: "Ligação", prefixo: "Ligação: ", cor: "#188038", d: "M20 15.5c-1.25 0-2.45-.2-3.57-.57-.35-.11-.74-.03-1.02.24l-2.2 2.2c-2.83-1.44-5.15-3.75-6.59-6.59l2.2-2.21c.28-.26.36-.65.25-1A11.36 11.36 0 0 1 8.5 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.5c0-.55-.45-1-1-1zM15 3h6v2h-6zm0 4h6v2h-6zm0 4h4v2h-4z" },
  { titulo: "Reunião", prefixo: "Reunião: ", cor: "#3f51b5", d: "M17 10H7v2h10v-2zm2-7h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zm-5-5H7v2h7v-2z" },
  { titulo: "WhatsApp", prefixo: "WhatsApp: ", cor: "#25a244", d: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z" },
];
const FILTRO = "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z";
const CLIPE = "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z";
const ARQUIVO_MAX = 15 * 1024 * 1024;
const tamanhoTexto = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);
const base64De = (f: File): Promise<string> => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => { const v = String(r.result); ok(v.slice(v.indexOf(",") + 1)); }; r.onerror = () => erro(r.error ?? new Error("não li o arquivo")); r.readAsDataURL(f); });
type FiltroTempo = "tudo" | "registros" | "conversas" | "arquivos";

export function montarCaixa(sdk: InboxSDK, estado: Estado, view: CustomRouteView, raiz: (el: HTMLElement) => void): void {
  const key = view.getParams()["key"] ?? "";
  if (!keyValida(key)) { sdk.ButterBar.showError({ text: "Caixa inválida" }); void sdk.Router.goto(sdk.Router.NativeRouteIDs.INBOX); return; }
  try { view.setFullWidth(true); } catch { /* versões antigas do SDK */ }
  const root = h("div", { class: "mbcrm mbcrm-rota mbcrm-pagina mbcrm-caixa" }); raiz(root); view.getElement().append(root);
  const fechar = estado.abrirVisao();
  const fechadas = new Set<string>(["indicadores"]);
  let rascunho = ""; let editando = false; let filtro: FiltroTempo = "tudo"; let resumoAberto = false; let gerandoResumo = false;

  async function render(): Promise<void> {
    if (editando) return;
    let ficha: CaixaFicha; let pipeline: Pipeline;
    try { ficha = await estado.caixa(key); pipeline = await estado.pipeline(ficha.pipelineKey); }
    catch (e) { limpar(root); root.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, textoDoErro(e))); return; }
    const b = ficha.box;
    const salvar = async (patch: Parameters<Estado["atualizarCaixa"]>[1]): Promise<void> => { const sv = sdk.ButterBar.showSaving({ text: T.salvando, confirmationText: T.salvo, showConfirmation: true, confirmationTime: 1200 }); try { await estado.atualizarCaixa(b.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); } editando = false; void render(); };

    // ---- topo
    const irPipeline = (ev: Event): void => { ev.preventDefault(); void sdk.Router.goto(ROTA_PIPELINE, { key: pipeline.key }); };
    const titulo = h("input", { class: "mbcrm-titulo", value: b.name, title: "Clique para renomear" });
    titulo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") titulo.blur(); if (ev.key === "Escape") { titulo.value = b.name; titulo.blur(); } });
    titulo.addEventListener("change", () => { const v = titulo.value.trim(); if (v !== "" && v !== b.name) void salvar({ name: v }); else titulo.value = b.name; });
    const navLado = h("span", { class: "mbcrm-contagem" });
    const anterior = h("button", { class: "mbcrm-icone", title: "Caixa anterior" }, "‹"); const proxima = h("button", { class: "mbcrm-icone", title: "Próxima caixa" }, "›");
    void estado.caixasDoPipeline(pipeline.key).then((r) => {
      const lista = r.boxes; const i = lista.findIndex((x) => x.key === b.key);
      navLado.textContent = i >= 0 ? `${i + 1} de ${lista.length}` : "";
      const ir = (j: number): void => { const alvo = lista[j]; if (alvo) void sdk.Router.goto(ROTA_CAIXA, { key: alvo.key }); };
      anterior.disabled = i <= 0; proxima.disabled = i < 0 || i >= lista.length - 1;
      anterior.onclick = () => ir(i - 1); proxima.onclick = () => ir(i + 1);
    }).catch(() => { anterior.disabled = true; proxima.disabled = true; });
    const btnLink = h("button", { class: "mbcrm-icone", title: "Copiar o link desta caixa", onClick: () => { void navigator.clipboard.writeText(`${location.origin}${location.pathname}${sdk.Router.createLink(ROTA_CAIXA, { key: b.key })}`).then(() => sdk.ButterBar.showMessage({ text: "Link copiado", time: 1500 })); } }, ic(IC.link));
    const mais: HTMLButtonElement = h("button", { class: "mbcrm-icone", title: "Mais ações", onClick: () => abrirMenu(mais, [
      ["Mover para outra etapa…", () => etapaBtn.click()],
      ["Apagar caixa", () => modal(sdk, "Apagar caixa", h("div", { class: "mbcrm-dica" }, `Apagar a caixa "${b.name}"? Ela vai para a lixeira da máquina; as conversas continuam no Gmail.`), "Apagar", async () => { try { await estado.apagarCaixa(b.key); void sdk.Router.goto(ROTA_PIPELINE, { key: pipeline.key }); return null; } catch (e) { return textoDoErro(e); } }), true],
    ]) }, "⋮");
    const topo = h("div", { class: "mbcrm-topo" },
      h("a", { href: sdk.Router.createLink(ROTA_PIPELINE, { key: pipeline.key }), class: "mbcrm-voltar", onClick: irPipeline, title: "Voltar ao pipeline" }, "←"),
      h("a", { href: sdk.Router.createLink(ROTA_PIPELINE, { key: pipeline.key }), class: "mbcrm-migalha", onClick: irPipeline }, pipeline.name), h("span", { class: "mbcrm-seta-migalha" }, "›"), titulo,
      h("span", { class: "mbcrm-cresce" }), btnLink, mais, anterior, navLado, proxima);

    // ---- esquerda: registro + linha do tempo
    const ta = h("textarea", { class: "mbcrm-registro-texto", placeholder: "Registre o que aconteceu: ligação, reunião, próximo passo…", rows: "2" }, rascunho);
    ta.addEventListener("input", () => { rascunho = ta.value; });
    const enviar = h("button", { class: "mbcrm-enviar", title: "Registrar (Cmd+Enter)" }, ic(IC.enviar, 20));
    enviar.addEventListener("click", () => { const t = ta.value.trim(); if (t === "") return; enviar.disabled = true; estado.comentar(b.key, t).then(() => { rascunho = ""; editando = false; void render(); }, (e) => mostrarErro(sdk, e)).finally(() => { enviar.disabled = false; }); });
    ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) enviar.click(); });
    ta.addEventListener("focus", () => { editando = true; }); ta.addEventListener("blur", () => { editando = false; });
    const registro = h("div", { class: "mbcrm-registro" }, ta, h("div", { class: "mbcrm-linha" }, h("span", { class: "mbcrm-chip-sel" }, "Registro"), h("span", { class: "mbcrm-cresce" }), enviar));
    const btnFiltro: HTMLButtonElement = h("button", { class: `mbcrm-icone mbcrm-filtro${filtro !== "tudo" ? " mbcrm-filtro-ativo" : ""}`, title: "Filtrar a linha do tempo", onClick: () => abrirMenu(btnFiltro, ([["tudo", "Tudo"], ["registros", "Só registros"], ["conversas", "Só conversas do Gmail"], ["arquivos", "Só arquivos"]] as [FiltroTempo, string][]).map(([id, r]) => [r, () => { filtro = id; void render(); }, false, { marcado: filtro === id }])) }, ic(FILTRO, 22));
    const enviarArquivos = async (fs: File[]): Promise<void> => {
      for (const f of fs) {
        if (f.size > ARQUIVO_MAX) { sdk.ButterBar.showError({ text: `"${f.name}" passa de 15 MB.`, time: 5000 }); continue; }
        const sv = sdk.ButterBar.showSaving({ text: `Anexando ${f.name}…`, confirmationText: "Anexado", showConfirmation: true, confirmationTime: 1500 });
        try { await estado.enviarArquivo(b.key, { nome: f.name, tipo: f.type || "application/octet-stream", base64: await base64De(f) }); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); }
      }
      editando = false; void render();
    };
    const inArquivo = h("input", { type: "file", multiple: "multiple", hidden: "hidden" });
    inArquivo.addEventListener("change", () => { const fs = [...(inArquivo.files ?? [])]; inArquivo.value = ""; void enviarArquivos(fs); });
    const btnClipe = h("button", { class: "mbcrm-atalho", title: "Arquivo (ou arraste para cá)", "aria-label": "Anexar arquivo", onClick: () => inArquivo.click() }, ic(CLIPE, 20, "#5f6368"));
    const atalhos = h("div", { class: "mbcrm-atalhos" }, h("span", { class: "mbcrm-dica" }, "Adicionar:"), ...ATALHOS.map((a) => h("button", { class: "mbcrm-atalho", title: a.titulo, "aria-label": a.titulo, onClick: () => { if (!ta.value.startsWith(a.prefixo)) ta.value = a.prefixo + ta.value; rascunho = ta.value; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, ic(a.d, 20, a.cor))), btnClipe, inArquivo, h("span", { class: "mbcrm-cresce" }), btnFiltro);
    const autorDe = (a: string): string => ({ agente: "Agente", whatsapp: "Agente (WhatsApp)", extensao: "Você", app: "Você", importador: "Importado do Streak", streak: "Streak" } as Record<string, string>)[a] ?? a;
    const eventos: { at: number; el: HTMLElement }[] = [];
    for (const c of filtro === "conversas" || filtro === "arquivos" ? [] : ficha.comentarios) {
      const texto = h("div", { class: "mbcrm-evento-texto" }, comLinks(c.texto));
      const editar = (): void => {
        editando = true;
        const ed = h("textarea", { rows: String(Math.min(10, Math.max(2, c.texto.split("\n").length + 1))) }, c.texto);
        const ok = h("button", { class: "mbcrm-btn mbcrm-primario mbcrm-pequeno" }, "Salvar");
        const cancelar = h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: () => { editando = false; void render(); } }, "Cancelar");
        ok.addEventListener("click", () => { const t = ed.value.trim(); if (t === "" || t === c.texto) { editando = false; void render(); return; } ok.disabled = true; estado.editarComentario(b.key, c.key, t).then(() => { editando = false; void render(); }, (e) => { ok.disabled = false; mostrarErro(sdk, e); }); });
        ed.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) ok.click(); if (ev.key === "Escape") cancelar.click(); });
        texto.replaceWith(h("div", { class: "mbcrm-col" }, ed, h("div", { class: "mbcrm-linha" }, ok, cancelar))); ed.focus();
      };
      const apagar = (): void => modal(sdk, "Apagar registro", h("div", { class: "mbcrm-dica" }, "Apagar este registro da linha do tempo?"), "Apagar", async () => { try { await estado.apagarComentario(b.key, c.key); void render(); return null; } catch (e) { return textoDoErro(e); } });
      eventos.push({ at: Date.parse(`${c.em}:00Z`) || 0, el: h("div", { class: "mbcrm-ev" }, avatar(autorDe(c.autor), c.autor === "agente" || c.autor === "whatsapp" ? "#1a73e8" : "#34a853"), h("div", { class: "mbcrm-evento mbcrm-ev-comentario" }, h("div", { class: "mbcrm-evento-cab" }, h("strong", null, autorDe(c.autor)), h("span", { class: "mbcrm-ev-acoes" }, h("button", { class: "mbcrm-icone mbcrm-mini", title: "Editar", onClick: editar }, "✎"), h("button", { class: "mbcrm-icone mbcrm-mini", title: "Apagar", onClick: apagar }, "🗑")), h("span", { class: "mbcrm-dica", title: c.editadoEm ? `editado ${haQuanto(c.editadoEm)}` : "" }, haQuanto(c.em) + (c.editadoEm ? " · editado" : ""))), texto)) });
    }
    for (const t of filtro === "registros" || filtro === "arquivos" ? [] : ficha.threads) eventos.push({ at: Date.parse(`${t.em}:00Z`) || 0, el: h("div", { class: "mbcrm-ev" }, h("span", { class: "mbcrm-avatar mbcrm-avatar-ic" }, "✉"), h("div", { class: "mbcrm-evento mbcrm-evento-email" }, h("div", { class: "mbcrm-evento-cab" }, h("a", { href: sdk.Router.createLink(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }); } }, h("strong", null, t.assunto || "Conversa do Gmail")), h("span", { class: "mbcrm-dica" }, haQuanto(t.em))), t.emails.length > 0 ? h("div", { class: "mbcrm-dica" }, t.emails.slice(0, 3).join(", ")) : null)) });
    for (const a of filtro === "tudo" || filtro === "arquivos" ? ficha.arquivos ?? [] : []) {
      const baixar = (ev: Event): void => { ev.preventDefault(); const sv = sdk.ButterBar.showSaving({ text: `Baixando ${a.nome}…`, confirmationText: "Pronto", showConfirmation: true, confirmationTime: 1200 }); estado.baixarArquivo(b.key, a.key).then((r) => { salvarBase64(r); sv.resolve(); }, (e) => { sv.reject(); mostrarErro(sdk, e); }); };
      const apagarArq = (): void => modal(sdk, "Apagar arquivo", h("div", { class: "mbcrm-dica" }, `Apagar "${a.nome}" desta caixa? Ele vai para a lixeira da máquina.`), "Apagar", async () => { try { await estado.apagarArquivo(b.key, a.key); void render(); return null; } catch (e) { return textoDoErro(e); } });
      eventos.push({ at: Date.parse(`${a.em}:00Z`) || 0, el: h("div", { class: "mbcrm-ev" }, h("span", { class: "mbcrm-avatar mbcrm-avatar-ic" }, ic(CLIPE, 16, "#5f6368")), h("div", { class: "mbcrm-evento mbcrm-ev-arquivo" }, h("div", { class: "mbcrm-evento-cab" }, h("a", { href: "#", onClick: baixar, title: "Baixar" }, h("strong", null, a.nome)), h("span", { class: "mbcrm-ev-acoes" }, h("button", { class: "mbcrm-icone mbcrm-mini", title: "Baixar", onClick: baixar }, "⤓"), h("button", { class: "mbcrm-icone mbcrm-mini", title: "Apagar", onClick: apagarArq }, "🗑")), h("span", { class: "mbcrm-dica" }, haQuanto(a.em))), h("div", { class: "mbcrm-dica" }, `${tamanhoTexto(a.tamanho)} · anexado por ${autorDe(a.por)}`))) });
    }
    eventos.sort((x, y) => y.at - x.at);
    const idx = pipeline.stages.findIndex((s) => s.key === b.stageKey);
    const cor = corDaEtapa(idx);
    const criada = h("div", { class: "mbcrm-ev mbcrm-ev-sistema" }, h("span", { class: "mbcrm-ponto-tempo" }), h("span", null, h("strong", null, "Caixa criada"), " em ", chipPipeline(sdk, pipeline.key, pipeline.name), " ", pipeline.stages[0] ? chipEtapa(sdk, pipeline.key, pipeline.stages[0].key, pipeline.stages[0].name, 0) : null, b.criadoEm ? h("span", { class: "mbcrm-dica" }, ` · ${haQuanto(b.criadoEm)}`) : null));
    const zap = ficha.contatos.filter((c) => c.whatsapp).map((c) => whatsappCartao(c.whatsapp, c.telefones, `Conversa no WhatsApp · ${c.nome || c.telefones[0]}`));
    const esquerda = h("div", { class: "mbcrm-col mbcrm-esq" }, registro, atalhos, ...zap, h("div", { class: "mbcrm-tempo" }, ...eventos.map((e) => e.el), criada));
    esquerda.addEventListener("dragover", (ev) => { if (ev.dataTransfer?.types.includes("Files")) { ev.preventDefault(); esquerda.classList.add("mbcrm-soltar"); } });
    esquerda.addEventListener("dragleave", (ev) => { if (ev.target === esquerda) esquerda.classList.remove("mbcrm-soltar"); });
    esquerda.addEventListener("drop", (ev) => { const fs = [...(ev.dataTransfer?.files ?? [])]; if (fs.length === 0) return; ev.preventDefault(); esquerda.classList.remove("mbcrm-soltar"); void enviarArquivos(fs); });

    // ---- direita
    const etapaBtn = h("button", { class: "mbcrm-etapa-sel", style: { background: cor, color: textoSobre(cor) }, title: "Mudar de etapa" }, ic(IC.etapa, 20), h("span", { class: "mbcrm-cresce" }, pipeline.stages[idx]?.name ?? b.stage), h("span", null, "▾"));
    etapaBtn.addEventListener("click", () => abrirMenu(etapaBtn, pipeline.stages.map((s, i) => [s.name, () => { if (s.key !== b.stageKey) void salvar({ stageKey: s.key }); }, false, { cor: corDaEtapa(i), marcado: s.key === b.stageKey }]), etapaBtn.getBoundingClientRect().width));
    const dias = diasDesde(b.etapaDesde);
    // Responsáveis (como no Streak): chips com avatar e ×; o campo aceita um e-mail (Enter) e sugere você.
    const resps = b.responsaveis ?? [];
    const gravarResps = (lista: { email: string; nome?: string }[]): void => { void salvar({ responsaveis: lista }); };
    const inResp = h("input", { type: "email", class: "mbcrm-resp-input", placeholder: resps.length === 0 ? "Adicionar responsável" : "＋" });
    const addResp = (email: string): void => { const e = email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { sdk.ButterBar.showError({ text: "Digite um e-mail.", time: 2500 }); return; } if (resps.some((r) => r.email === e)) return; gravarResps([...resps, { email: e }]); };
    inResp.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); addResp(inResp.value); } if (ev.key === "Escape") { inResp.value = ""; inResp.blur(); } if (ev.key === "Backspace" && inResp.value === "" && resps.length > 0) gravarResps(resps.slice(0, -1)); });
    inResp.addEventListener("focus", () => { editando = true; const eu = meuEmail(); if (eu && !resps.some((r) => r.email === eu.toLowerCase())) abrirMenu(inResp, [[`Eu (${eu})`, () => addResp(eu), false, {}]]); });
    inResp.addEventListener("blur", () => { setTimeout(() => { editando = false; }, 300); });
    const respEl = h("div", { class: "mbcrm-resps", title: "Responsáveis pela caixa" }, ...resps.map((r) => h("span", { class: "mbcrm-resp", title: r.email }, avatarEmail(r), h("span", { class: "mbcrm-resp-nome" }, r.nome || r.email), h("button", { class: "mbcrm-resp-x", title: `Tirar ${r.email}`, onClick: () => gravarResps(resps.filter((x) => x.email !== r.email)) }, "×"))), inResp);
    respEl.addEventListener("click", (ev) => { if (ev.target === respEl) inResp.focus(); });
    const cabEtapa = h("div", { class: "mbcrm-linha mbcrm-linha-etapa" }, etapaBtn, respEl);
    // Resumo (como o do Streak, sem 👍/👎): gerado pelo motor do chat; recolhido mostra a visão geral numa linha.
    const ria = ficha.resumoIA ?? null;
    const gerar = (ev?: Event): void => {
      ev?.stopPropagation(); if (gerandoResumo) return; gerandoResumo = true; resumoAberto = true; void render();
      estado.gerarResumo(b.key).then(() => { gerandoResumo = false; void render(); }, (e) => { gerandoResumo = false; mostrarErro(sdk, e); void render(); });
    };
    // A caixa mudou (registro, campo, WhatsApp…) depois do último resumo: abrir o cartão gera de novo.
    const desatualizado = ria !== null && Date.parse(b.lastUpdated) > Date.parse(ria.geradoEm) + 1000;
    const linhaResumo = ria ? ria.visaoGeral : gerandoResumo ? "Gerando com IA…" : resumoDaCaixa(ficha);
    const cabResumo = h("div", { class: "mbcrm-resumo-cab", onClick: () => { if (!ria && !gerandoResumo) { gerar(); return; } resumoAberto = !resumoAberto; if (resumoAberto && ria && desatualizado) { gerar(); return; } void render(); } }, ic(IC.brilho, 22, gerandoResumo ? "var(--mb-acento)" : "var(--mb-fg2)"), h("strong", null, "Resumo"),
      resumoAberto && ria ? h("span", { class: "mbcrm-cresce" }) : h("span", { class: "mbcrm-resumo-texto mbcrm-cresce", title: linhaResumo }, h("span", { class: "mbcrm-dica" }, " · "), linhaResumo),
      !ria && !gerandoResumo ? h("span", { class: "mbcrm-link-acao" }, "Gerar com IA") : h("span", { class: "mbcrm-secao-seta" }, resumoAberto ? "⌄" : "›"));
    const resumo = h("div", { class: `mbcrm-resumo-cartao${resumoAberto && ria ? " mbcrm-aberto" : ""}${gerandoResumo ? " mbcrm-gerando" : ""}` }, cabResumo);
    if (resumoAberto && ria) {
      const parte = (rotulo: string, texto: string): HTMLElement | null => (texto === "" ? null : h("p", null, h("strong", null, `${rotulo}: `), comLinks(texto)));
      const copiar = h("button", { class: "mbcrm-icone mbcrm-mini", title: "Copiar", onClick: () => { void navigator.clipboard.writeText([`Visão geral: ${ria.visaoGeral}`, ria.proximoPasso ? `Próximo passo: ${ria.proximoPasso}` : "", ria.historico ? `Histórico: ${ria.historico}` : ""].filter(Boolean).join("\n\n")).then(() => sdk.ButterBar.showMessage({ text: "Resumo copiado", time: 1500 })); } }, "⧉");
      const refazer = h("button", { class: "mbcrm-icone mbcrm-mini", title: "Gerar de novo com o que há agora", onClick: gerar, disabled: gerandoResumo }, "↻");
      resumo.append(h("div", { class: "mbcrm-resumo-corpo" }, parte("Visão geral", ria.visaoGeral), parte("Próximo passo", ria.proximoPasso), parte("Histórico", ria.historico)),
        h("div", { class: "mbcrm-resumo-rodape" }, h("span", { class: "mbcrm-cresce" }), h("span", { class: "mbcrm-dica" }, gerandoResumo ? "Gerando…" : `Gerado ${haQuanto(ria.geradoEm)}${desatualizado ? " · a caixa mudou depois" : ""}`), copiar, refazer));
    }

    const secao = (id: string, icone: string, titulo: string, extra: HTMLElement | null, ...corpo: (Node | null)[]): HTMLElement => {
      const aberta = !fechadas.has(id);
      const cab = h("div", { class: "mbcrm-secao-cab", onClick: (ev: Event) => { if ((ev.target as HTMLElement).closest("button, a, select, input")) return; if (aberta) fechadas.add(id); else fechadas.delete(id); void render(); } }, ic(icone, 22, "var(--mb-fg2)"), h("strong", null, titulo), h("span", { class: "mbcrm-cresce" }), extra, h("span", { class: "mbcrm-secao-seta" }, aberta ? "⌃" : "⌄"));
      const s = h("div", { class: "mbcrm-secao2" }, cab);
      if (aberta) s.append(h("div", { class: "mbcrm-secao-corpo" }, ...corpo.filter((c): c is Node => c !== null)));
      return s;
    };

    // Colunas personalizadas: pares "rótulo | valor" em duas colunas; clique no valor edita ali mesmo.
    const valorCelula = (f: Campo): HTMLElement => {
      const txt = b.fields[f.name] ?? "";
      const vis = txt === "" ? h("span", { class: "mbcrm-vazio-campo" }, "—") : f.type === "DROPDOWN" || f.type === "TAG" ? h("span", { class: "mbcrm-chip-valor-lista" }, ...txt.split(", ").map((x) => h("span", { class: "mbcrm-chip-valor" }, x))) : h("span", null, txt);
      const el = h("div", { class: "mbcrm-cp-valor mbcrm-editavel", title: "Clique para editar" }, vis);
      el.addEventListener("click", () => {
        if (el.querySelector("input, select")) return;
        editando = true; limpar(el);
        const ed = editorCampo(f, txt, (novo) => salvar({ fields: { [f.key]: novo } }));
        el.append(ed);
        const alvo = (ed.matches("input, select") ? ed : ed.querySelector("input, select")) as HTMLElement | null;
        alvo?.focus();
        alvo?.addEventListener("blur", () => { setTimeout(() => { if (editando) { editando = false; void render(); } }, 150); });
        alvo?.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Escape") { editando = false; void render(); } });
      });
      return el;
    };
    const grade = h("div", { class: "mbcrm-cp-grade" }, ...pipeline.fields.flatMap((f) => [h("div", { class: "mbcrm-cp-rotulo", title: TIPOS.find((t) => t.id === f.type)?.nome ?? f.type }, f.name), valorCelula(f)]));
    const addCampo = h("a", { href: "#", class: "mbcrm-link-acao", onClick: (ev: Event) => { ev.preventDefault(); novaColuna(); } }, "Adicionar novo");
    function novaColuna(): void {
      const nome = h("input", { type: "text", placeholder: "Nome da coluna" });
      const tipo = h("select", null, ...TIPOS.map((t) => h("option", { value: t.id }, t.nome)));
      const opcoes = h("input", { type: "text", placeholder: "Opções (Lista/Etiquetas), separadas por vírgula" });
      modal(sdk, "Nova coluna", h("div", { class: "mbcrm-col" }, nome, tipo, opcoes), "Adicionar", async () => {
        const n = nome.value.trim(); if (n === "") return "Dê um nome.";
        try { await estado.atualizarPipeline(pipeline.key, { fields: [...pipeline.fields, { name: n, type: tipo.value as Campo["type"], options: opcoes.value.split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name })) }] }); void render(); return null; } catch (e) { return textoDoErro(e); }
      });
      setTimeout(() => nome.focus(), 50);
    }

    // Contatos e organizações: os da caixa + um campo que busca enquanto digita (contato, criar contato, organização, criar organização).
    const linhaPessoa = (icone: HTMLElement, nome: string, sub: string, rota: string, k: string, tirar: () => Promise<void>): HTMLElement => h("div", { class: "mbcrm-contato" }, icone,
      h("div", { class: "mbcrm-cresce" }, h("a", { href: sdk.Router.createLink(rota, { key: k }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(rota, { key: k }); } }, h("strong", null, nome)), sub ? h("div", { class: "mbcrm-dica" }, sub) : null),
      h("button", { class: "mbcrm-icone", title: "Tirar desta caixa (continua salvo)", onClick: () => { tirar().then(() => void render(), (e) => mostrarErro(sdk, e)); } }, "×"));
    const contatos = h("div", { class: "mbcrm-col" },
      ...ficha.contatos.flatMap((c) => [linhaPessoa(avatar(c.nome || c.emails[0] || "?", "#5f6368"), c.nome || "(sem nome)", [...c.emails, ...c.telefones].join(" · "), ROTA_CONTATO, c.key, () => estado.desvincularContato(b.key, c.key)),
        ...(c.whatsapp ? [h("div", { class: "mbcrm-zap-mini", title: `${c.whatsapp.mensagens} mensagens · última ${haQuanto(new Date(c.whatsapp.ultimaEm).toISOString())}` }, h("span", null, "💬"), h("span", { class: "mbcrm-cresce" }, c.whatsapp.resumo), h("span", { class: "mbcrm-dica" }, haQuanto(new Date(c.whatsapp.ultimaEm).toISOString())))] : [])]),
      ...(ficha.orgs ?? []).map((o) => linhaPessoa(h("span", { class: "mbcrm-avatar mbcrm-avatar-org" }, ic(IC.predio, 18, "#fff")), o.nome, o.dominios.join(", "), ROTA_ORG, o.key, () => estado.desvincularOrg(b.key, o.key))));
    const addContato = buscaPessoa();
    function buscaPessoa(): HTMLElement {
      const entrada = h("input", { type: "text", class: "mbcrm-busca-pessoa", placeholder: "Adicionar contato ou organização (ex.: Ana +55 11 99999-9999)" });
      const caixaBusca = h("div", { class: "mbcrm-busca-caixa" }, h("span", { class: "mbcrm-mais-azul" }, "＋"), entrada);
      let t: ReturnType<typeof setTimeout> | null = null;
      const vinculados = new Set(ficha.contatos.map((c) => c.key)); const orgsVinc = new Set((ficha.orgs ?? []).map((o) => o.key));
      const sugerir = async (): Promise<void> => {
        const q = entrada.value.trim(); if (q === "") return;
        const sep = separarContato(q); const email = sep.email; const tel = sep.telefone; const nomeQ = sep.nome || undefined;
        let cs: { key: string; nome: string; emails: string[]; orgNome: string | null }[] = []; let os: { key: string; nome: string; dominios: string[] }[] = [];
        // Busca o que existe pelo telefone, pelo e-mail ou pelo nome (nessa ordem de precisão).
        const buscaContatos = tel ? estado.contatos({ q: "", limit: 6, phone: tel.replace(/\D/g, "").slice(-8) }) : estado.contatos({ q: email ?? q, limit: 6 });
        try { [cs, os] = await Promise.all([buscaContatos.then((r) => r.contatos), nomeQ ? estado.orgs({ q: nomeQ, limit: 4 }).then((r) => r.orgs) : Promise.resolve([])]); } catch { /* sem conexão: só as opções de criar */ }
        const criarContato = async (): Promise<void> => { await estado.vincularContato(b.key, { ...(nomeQ ? { name: nomeQ } : {}), ...(email ? { email } : {}), ...(tel ? { phone: tel } : {}) }); };
        const rotuloNovo = [nomeQ, email, tel].filter(Boolean).join(" · ");
        const itens: [string, () => void, boolean, { cor?: string; marcado?: boolean }][] = [
          ...cs.filter((c) => !vinculados.has(c.key)).map((c): [string, () => void, boolean, { cor?: string }] => [`👤 ${c.nome || c.emails[0]}${c.orgNome ? ` · ${c.orgNome}` : ""}${c.emails[0] && c.nome ? ` · ${c.emails[0]}` : ""}`, () => { void estado.vincularContato(b.key, { key: c.key }).then(() => render(), (e) => mostrarErro(sdk, e)); }, false, {}]),
          [`＋ Criar contato "${rotuloNovo}"`, () => { if (!email && !tel) { pedirContato(q); return; } void criarContato().then(() => render(), (e) => mostrarErro(sdk, e)); }, false, {}],
          ...os.filter((o) => !orgsVinc.has(o.key)).map((o): [string, () => void, boolean, { cor?: string }] => [`🏢 ${o.nome}${o.dominios[0] ? ` · ${o.dominios[0]}` : ""}`, () => { void estado.vincularOrg(b.key, o.key).then(() => render(), (e) => mostrarErro(sdk, e)); }, false, {}]),
          ...(email || tel ? [] : [[`🏢 Criar organização "${q}"`, () => { void estado.criarOrg(q.includes(".") && !q.includes(" ") ? { dominio: q } : { nome: q }).then((r) => estado.vincularOrg(b.key, r.org.key)).then(() => render(), (e) => mostrarErro(sdk, e)); }, false, {}] as [string, () => void, boolean, { cor?: string }]]),
        ];
        abrirMenu(caixaBusca, itens, caixaBusca.getBoundingClientRect().width);
      };
      // Campo vazio: sugere as pessoas das conversas do Gmail ligadas à caixa que ainda não são contatos dela.
      const daConversa = (): void => {
        const ps = sugestoesDaConversa(ficha.threads.flatMap((t) => t.emails.map((email, i) => ({ email, nome: t.nomes[i] ?? "" }))), meuEmail(), ficha.contatos.flatMap((c) => c.emails));
        if (ps.length === 0) return;
        abrirMenu(caixaBusca, ps.slice(0, 8).map((p): [string, () => void, boolean, Record<string, never>] => [`✉ ${p.nome ? `${p.nome} · ` : ""}${p.email} (da conversa)`, () => { void estado.vincularContato(b.key, { email: p.email, ...(p.nome ? { name: p.nome } : {}) }).then(() => render(), (e) => mostrarErro(sdk, e)); }, false, {}]), caixaBusca.getBoundingClientRect().width);
      };
      entrada.addEventListener("focus", () => { editando = true; if (entrada.value.trim() === "") daConversa(); });
      entrada.addEventListener("blur", () => { setTimeout(() => { editando = false; }, 300); });
      entrada.addEventListener("input", () => { if (t) clearTimeout(t); t = setTimeout(() => { void sugerir(); }, 200); });
      entrada.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void sugerir(); if (ev.key === "Escape") { entrada.value = ""; entrada.blur(); } });
      return caixaBusca;
    }
    /** Contato só com nome: pede e-mail ou telefone (o host precisa de um para achar a pessoa depois). */
    function pedirContato(nome: string): void {
      const n = h("input", { type: "text", value: nome }); const mail = h("input", { type: "email", placeholder: "E-mail" }); const tel = h("input", { type: "tel", placeholder: "Telefone (+55…)" });
      modal(sdk, "Novo contato", h("div", { class: "mbcrm-col" }, n, mail, tel, h("div", { class: "mbcrm-dica" }, "Informe e-mail ou telefone. Se já existir um contato com eles, ele é reaproveitado.")), "Adicionar", async () => {
        const d = { ...(n.value.trim() ? { name: n.value.trim() } : {}), ...(tel.value.trim() ? { phone: tel.value.trim() } : {}), ...(mail.value.trim() ? { email: mail.value.trim() } : {}) };
        if (!d.phone && !d.email) return "Informe e-mail ou telefone.";
        try { await estado.vincularContato(b.key, d); void render(); return null; } catch (e) { return textoDoErro(e); }
      });
      setTimeout(() => mail.focus(), 50);
    }

    const notas = h("textarea", { class: "mbcrm-notas", rows: "5", placeholder: "Ficha fixa da caixa: quem é, o que quer, combinados. Uma linha \"Próximo passo: …\" aparece no resumo." }, ficha.notes);
    const linksNotas = [...ficha.notes.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|com\.br|net|org|br|io|app|dev|co)(?:\/[^\s<>"')]*)?/gi)].filter((m) => (m.index ?? 0) === 0 || ficha.notes[(m.index ?? 1) - 1] !== "@").map((m) => m[0]);
    const notasLinks = linksNotas.length === 0 ? null : h("div", { class: "mbcrm-dica" }, "Links: ", ...linksNotas.flatMap((u, i) => [i > 0 ? " · " : "", h("a", { href: /^https?:/i.test(u) ? u : `https://${u}`, target: "_blank", rel: "noopener" }, u)]));
    notas.addEventListener("focus", () => { editando = true; });
    notas.addEventListener("blur", () => { editando = false; if (notas.value !== ficha.notes) void salvar({ notes: notas.value }); });
    const ultimo = ficha.comentarios.at(-1);
    const indicadores = h("div", { class: "mbcrm-cp-grade" },
      h("div", { class: "mbcrm-cp-rotulo" }, "Dias nesta etapa"), h("div", { class: "mbcrm-cp-valor" }, dias === null ? "—" : String(dias)),
      h("div", { class: "mbcrm-cp-rotulo" }, "Último registro"), h("div", { class: "mbcrm-cp-valor" }, ultimo ? haQuanto(ultimo.em) : "—"),
      h("div", { class: "mbcrm-cp-rotulo" }, "Conversas do Gmail"), h("div", { class: "mbcrm-cp-valor" }, String(ficha.threads.length)),
      h("div", { class: "mbcrm-cp-rotulo" }, "Criada"), h("div", { class: "mbcrm-cp-valor" }, b.criadoEm ? new Date(b.criadoEm).toLocaleDateString("pt-BR") : "—"));

    const direita = h("div", { class: "mbcrm-col mbcrm-dir" },
      cabEtapa, resumo,
      secao("campos", IC.colunas, "Colunas personalizadas", h("span", { class: "mbcrm-dica" }, `${pipeline.fields.length} campo${pipeline.fields.length === 1 ? "" : "s"}`), pipeline.fields.length > 0 ? grade : h("div", { class: "mbcrm-dica" }, "Este pipeline ainda não tem colunas."), addCampo),
      secao("contatos", IC.pessoa, "Contatos e organizações", ficha.contatos.length + (ficha.orgs?.length ?? 0) > 0 ? h("span", { class: "mbcrm-dica" }, String(ficha.contatos.length + (ficha.orgs?.length ?? 0))) : null, contatos, addContato),
      secao("notas", IC.nota, "Anotações", null, notas, notasLinks),
      secao("indicadores", IC.grafico, "Indicadores", null, indicadores));

    limpar(root);
    root.append(topo, h("div", { class: "mbcrm-duas-colunas" }, esquerda, direita));
  }
  const off = estado.assinar(({ mudancas, reset }) => { if (reset || mudancas.some((m) => m.box === key || m.tipo.startsWith("pipeline.") || m.tipo.startsWith("contato."))) void render(); });
  view.on("destroy", () => { off(); fechar(); });
  void render();
}
