/**
 * Contatos e Organizações (#meu-bot-crm/contatos, /contato/:key, /organizacoes, /organizacao/:key), como no
 * Streak, sem o que é dele (time, enriquecimento pago, redes de terceiros): lista em planilha com busca e edição
 * na célula; página com os dados editáveis à esquerda e caixas + conversas do Gmail à direita. A organização é
 * ligada ao contato pelo domínio do e-mail (gmail, hotmail, uol… não contam), ou escolhida à mão.
 */
import type { CustomRouteView, InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import type { Arquivo, CaixaHome, Contato, GoogleStatus, Org, ThreadDeContato, WhatsappResumo } from "../tipos.ts";
import { ROTA_CAIXA, ROTA_CONTATO, ROTA_CONTATOS, ROTA_ORG, ROTA_ORGS, keyValida } from "../rotas.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";
import { haQuanto } from "../resumo.ts";
import { comLinks, h, limpar, linkExterno, salvarBase64 } from "./h.ts";
import { mostrarErro, textoDoErro } from "./avisos.ts";
import { abrirMenu } from "./flutuante.ts";
import { chipEtapa, chipPipeline } from "./navegar.ts";
import { campo, modal } from "./menu.ts";
import { lerCsv, planejarContatos } from "../csv.ts";
import { VISTA_VAZIA, aplicarVista, parseVista, textoFiltro, valoresDaColuna, type Filtro, type Vista } from "../planilha.ts";

type Raiz = (el: HTMLElement) => void;
const quando = (t: number): string => haQuanto(new Date(t).toISOString());
const link = (sdk: InboxSDK, rota: string, params: Record<string, string> | undefined, texto: string, cls?: string): HTMLAnchorElement =>
  h("a", { class: cls ?? null, href: sdk.Router.createLink(rota, params), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(rota, params); } }, texto);
const salvando = (sdk: InboxSDK) => sdk.ButterBar.showSaving({ text: "Salvando…", confirmationText: "Salvo", showConfirmation: true, confirmationTime: 1200 });
const listaDe = (v: string): string[] => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** Montagem comum das rotas: página larga, tema, visão aberta (polling curto), recarga no feed. */
function pagina(estado: Estado, v: CustomRouteView, raiz: Raiz, classe: string, desenhar: (root: HTMLElement) => Promise<void>, interessa: (tipo: string) => boolean): void {
  try { v.setFullWidth(true); } catch { /* versões antigas do SDK */ }
  const root = h("div", { class: `mbcrm mbcrm-rota mbcrm-pagina ${classe}` }); raiz(root); v.getElement().append(root);
  const fechar = estado.abrirVisao();
  let editando = false;
  root.addEventListener("focusin", () => { editando = true; }); root.addEventListener("focusout", () => { editando = false; });
  const off = estado.assinar(({ mudancas, reset }) => { if (!editando && (reset || mudancas.some((m) => interessa(m.tipo)))) void desenhar(root); });
  v.on("destroy", () => { off(); fechar(); });
  void desenhar(root);
}
const ehPessoa = (t: string): boolean => t.startsWith("contato.") || t.startsWith("org.") || t.startsWith("box.") || t === "import" || t.startsWith("pipeline.");

/** Campo de texto que grava ao sair (ou Enter, se não for multilinha). */
function editavel(valor: string, salvar: (v: string) => Promise<void>, o: { multilinha?: boolean; placeholder?: string } = {}): HTMLElement {
  const el = o.multilinha === true ? h("textarea", { rows: "4", placeholder: o.placeholder ?? "" }, valor) : h("input", { type: "text", value: valor, placeholder: o.placeholder ?? "" });
  let atual = valor;
  el.addEventListener("keydown", (ev) => { const k = (ev as KeyboardEvent).key; if (k === "Enter" && o.multilinha !== true) el.blur(); if (k === "Escape") { el.value = atual; el.blur(); } });
  el.addEventListener("change", () => { const n = el.value.trim(); if (n === atual) return; el.disabled = true; salvar(n).then(() => { atual = n; }, () => { el.value = atual; }).finally(() => { el.disabled = false; }); });
  return el;
}

function caixasCartao(sdk: InboxSDK, bs: CaixaHome[], adicionar?: () => void): HTMLElement {
  return h("div", { class: "mbcrm-cartao" }, h("div", { class: "mbcrm-cartao-cab" }, h("h3", null, `Caixas (${bs.length})`), h("span", { class: "mbcrm-cresce" }), adicionar ? h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: adicionar }, "＋ Adicionar a um pipeline") : null),
    bs.length === 0 ? h("div", { class: "mbcrm-dica" }, "Ainda não está em nenhuma caixa.") : null,
    ...bs.map((b) => { return h("a", { class: "mbcrm-linha-caixa", href: sdk.Router.createLink(ROTA_CAIXA, { key: b.key }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(ROTA_CAIXA, { key: b.key }); } }, h("span", { class: "mbcrm-lc-nome" }, b.name), b.stage ? chipEtapa(sdk, b.pipelineKey, b.stageKey, b.stage, b.stageIndex, "mbcrm-lc-etapa") : null, chipPipeline(sdk, b.pipelineKey, b.pipelineName, "mbcrm-lc-pipe"), h("span", { class: "mbcrm-lc-quando" }, quando(b.updatedAt))); }));
}
/**
 * "Conversa no WhatsApp": o resumo que o agente mantém da conversa atual, com o link para abrir o chat; embaixo, o
 * consolidado das conversas que o dono limpou no app e (no contato sem caixa) as transcrições para baixar.
 */
export function whatsappCartao(w: WhatsappResumo | null | undefined, telefones: string[], titulo = "Conversa no WhatsApp", abrirNoApp?: () => void, arquivadas?: { lista: Arquivo[]; baixar: (a: Arquivo) => void }): HTMLElement {
  const tel = telefones[0]?.replace(/\D/g, "") ?? "";
  const arq = w?.arquivo;
  const atual = w && (w.resumo || !arq) ? w : null;
  const lista = arquivadas?.lista ?? [];
  return h("div", { class: "mbcrm-cartao mbcrm-zap" }, h("div", { class: "mbcrm-cartao-cab" }, h("span", { class: "mbcrm-zap-ic" }, "💬"), h("h3", null, titulo), h("span", { class: "mbcrm-cresce" }), tel && abrirNoApp ? h("button", { class: "mbcrm-btn mbcrm-pequeno", title: "Abrir a aba desta conversa no meu-bot", onClick: abrirNoApp }, "Abrir no meu-bot") : null, tel ? h("a", { class: "mbcrm-link-acao", href: `https://wa.me/${tel}`, target: "_blank", rel: "noopener" }, "WhatsApp Web") : null),
    atual ? h("div", { class: "mbcrm-evento-texto" }, comLinks(atual.resumo || "Sem resumo ainda.")) : arq ? h("div", { class: "mbcrm-dica" }, "A conversa recomeçou depois de arquivada; o agente resume as mensagens novas aqui.") : h("div", { class: "mbcrm-dica" }, tel ? "Ainda sem resumo. O agente escreve aqui depois de ler a conversa (10 min após a última mensagem), ou peça no WhatsApp: \"anota no CRM\"." : "Sem telefone: adicione um para o agente acompanhar o WhatsApp."),
    atual ? h("div", { class: "mbcrm-dica" }, `${atual.mensagens} mensage${atual.mensagens === 1 ? "m" : "ns"} · última ${quando(atual.ultimaEm)} · resumo atualizado ${quando(atual.atualizadoEm)}`) : null,
    arq?.resumo ? h("div", { class: "mbcrm-zap-arquivo" }, h("div", { class: "mbcrm-rotulo" }, `Conversas arquivadas (${arq.mensagens} mensage${arq.mensagens === 1 ? "m" : "ns"}, até ${quando(arq.em)})`), h("div", { class: "mbcrm-evento-texto" }, comLinks(arq.resumo))) : null,
    ...lista.map((a) => h("a", { class: "mbcrm-link-acao mbcrm-zap-anexo", href: "#", title: "Baixar a transcrição", onClick: (ev: Event) => { ev.preventDefault(); arquivadas?.baixar(a); } }, `📦 ${a.nome}${a.mensagens ? ` · ${a.mensagens} mensagens` : ""}`)));
}
function conversasCartao(sdk: InboxSDK, ts: ThreadDeContato[]): HTMLElement {
  return h("div", { class: "mbcrm-cartao" }, h("h3", null, `Conversas do Gmail (${ts.length})`),
    ts.length === 0 ? h("div", { class: "mbcrm-dica" }, "Nenhuma conversa ligada a uma caixa com estes e-mails.") : null,
    ...ts.map((t) => h("div", { class: "mbcrm-linha-caixa" }, h("a", { class: "mbcrm-lc-nome", href: sdk.Router.createLink(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }), onClick: (ev: Event) => { ev.preventDefault(); void sdk.Router.goto(sdk.Router.NativeRouteIDs.THREAD, { threadID: t.threadGmailId }); } }, t.assunto || t.threadGmailId), h("span", { class: "mbcrm-lc-pipe" }, t.boxName), h("span", { class: "mbcrm-lc-quando" }, haQuanto(t.em)))));
}

/** Cabeçalho das listas: título, contagem, busca e o botão de criar. */
function topoLista(titulo: string, contagem: HTMLElement, busca: HTMLInputElement, novo: () => void, rotuloNovo: string): HTMLElement {
  return h("div", { class: "mbcrm-pl-topo" }, h("h1", { class: "mbcrm-titulo-fixo" }, titulo), contagem, h("span", { class: "mbcrm-cresce" }), busca, h("button", { class: "mbcrm-btn mbcrm-primario", onClick: novo }, rotuloNovo));
}
function buscaCom(fn: () => void, placeholder: string): HTMLInputElement {
  let t: ReturnType<typeof setTimeout> | null = null;
  return h("input", { type: "search", class: "mbcrm-busca", placeholder, onInput: () => { if (t) clearTimeout(t); t = setTimeout(fn, 250); } });
}
/** Célula de texto editável na lista (clique → campo; Enter/sair grava; Esc cancela). */
function celula(txt: string, salvar: (v: string) => Promise<void>): HTMLTableCellElement {
  const td = h("td", { class: "mbcrm-editavel", title: txt }, txt);
  td.addEventListener("click", () => {
    if (td.querySelector("input")) return;
    const i = h("input", { type: "text", value: txt }); limpar(td); td.append(i); i.focus();
    let feito = false;
    const fim = (gravar: boolean): void => { if (feito) return; feito = true; const n = i.value.trim(); limpar(td); td.append(gravar ? n : txt); if (gravar && n !== txt) void salvar(n).catch(() => { limpar(td); td.append(txt); }); };
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") fim(true); if (ev.key === "Escape") fim(false); });
    i.addEventListener("blur", () => fim(true));
  });
  return td;
}

// ---- Contatos -----------------------------------------------------------------------------------------------------
/**
 * Pôr o contato num pipeline (da linha dos Contatos ou da ficha): escolhe pipeline e etapa, a caixa nasce com o
 * nome da pessoa e ela já vinculada. Depois oferece abrir a caixa.
 */
export async function adicionarAoPipeline(sdk: InboxSDK, estado: Estado, k: Pick<Contato, "key" | "nome" | "emails" | "telefones">): Promise<void> {
  let ps; try { ps = await estado.pipelines(); } catch (e) { mostrarErro(sdk, e); return; }
  if (ps.length === 0) { sdk.ButterBar.showMessage({ text: "Crie um pipeline primeiro (Início → Novo pipeline).", time: 4000 }); return; }
  const selP = h("select", null, ...ps.map((p) => h("option", { value: p.key }, p.name)));
  const selE = h("select", null);
  const preencherEtapas = async (): Promise<void> => { limpar(selE); try { const p = await estado.pipeline(selP.value); selE.append(...p.stages.map((st, i) => h("option", { value: st.key, selected: i === 0 }, st.name))); } catch { /* fica vazio: o host usa a 1ª etapa */ } };
  selP.addEventListener("change", () => { void preencherEtapas(); });
  await preencherEtapas();
  const nome = h("input", { type: "text", value: k.nome || k.telefones[0] || k.emails[0] || "" });
  modal(sdk, `Adicionar ${k.nome || "contato"} a um pipeline`, h("div", { class: "mbcrm-col" }, campo("Pipeline", selP), campo("Etapa", selE), campo("Nome da caixa", nome)), "Adicionar", async () => {
    const n = nome.value.trim(); if (n === "") return "Dê um nome à caixa.";
    try {
      const b = await estado.criarCaixa(selP.value, { name: n, ...(selE.value ? { stageKey: selE.value } : {}) });
      await estado.vincularContato(b.key, { key: k.key });
      const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
      sdk.ButterBar.showMessage({ html: `Caixa “${esc(n)}” criada em ${esc(ps.find((p) => p.key === selP.value)?.name ?? "pipeline")}. <a href="${esc(sdk.Router.createLink(ROTA_CAIXA, { key: b.key }))}" style="color:inherit;text-decoration:underline">Abrir caixa</a>`, time: 6000 });
      return null;
    } catch (e) { return textoDoErro(e); }
  });
  setTimeout(() => nome.focus(), 50);
}

type ConversasWa = Record<string, { sessao: string | null; nome: string | null }>;
/** A conversa do WhatsApp deste contato no app (pelos 10 últimos dígitos de algum telefone). */
function conversaDe(k: Contato, wa: ConversasWa): { numero: string; sessao: string | null } | null {
  for (const t of k.telefones) { const d = t.replace(/\D/g, ""); const n = Object.keys(wa).find((x) => x.endsWith(d.slice(-10))); if (n !== undefined) return { numero: n, sessao: wa[n]?.sessao ?? null }; }
  return null;
}
/** Botão "💬 ID 65859583": abre a aba da conversa do WhatsApp dentro do app (meu-bot). */
function botaoWhatsapp(sdk: InboxSDK, estado: Estado, numero: string, sessao: string | null): HTMLElement {
  const b = h("button", { class: "mbcrm-wa-id", title: `Abrir a conversa do WhatsApp no app${sessao ? `\nsessão ${sessao}` : ""}` }, `💬 ${sessao ? `ID ${sessao.slice(0, 8)}` : "abrir conversa"}`);
  b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); estado.abrirWhatsapp(numero).then((ok) => { if (!ok) sdk.ButterBar.showMessage({ text: "Abra a janela do meu-bot-crm para ver a conversa.", time: 3000 }); }, (e) => mostrarErro(sdk, e)); });
  return b;
}
/**
 * Bloco "Google Contatos" da página Contatos: conectar (login do Google no navegador do Mac, só leitura), estado
 * da última sincronização (automática a cada 30 min) e "Sincronizar agora".
 */
function blocoGoogle(sdk: InboxSDK, estado: Estado): HTMLElement {
  const el = h("div", { class: "mbcrm-google" }, h("span", { class: "mbcrm-dica" }, "Google Contatos…"));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const desenhar = (g: GoogleStatus): void => {
    limpar(el);
    const logo = h("span", { class: "mbcrm-google-logo", html: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>' });
    if (!g.configurado) { el.append(logo, h("span", { class: "mbcrm-dica" }, "Google Contatos: falta configurar o login do Google neste app.")); return; }
    const acompanhar = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (el.isConnected) void estado.google("status").then(desenhar, () => undefined); }, 3000); };
    if (!g.conectado && g.conectando) { el.append(logo, h("span", null, "Autorize o acesso na aba do Google que abriu (no Navegador do app ou no navegador do Mac)…"), h("span", { class: "mbcrm-dica" }, "(só leitura dos contatos)")); acompanhar(); return; }
    if (!g.conectado) {
      const b = h("button", { class: "mbcrm-btn", onClick: () => { b.disabled = true; estado.google("conectar").then(desenhar, (e) => { mostrarErro(sdk, e); void estado.google("status").then(desenhar); }); } }, "Conectar Google Contatos");
      el.append(logo, b, h("span", { class: "mbcrm-dica" }, g.erro ? `Última tentativa: ${g.erro}` : "Traz seus contatos do Google para cá e mantém atualizado (só leitura).")); return;
    }
    const sinc = h("button", { class: "mbcrm-btn mbcrm-pequeno", disabled: g.sincronizando, onClick: () => { sinc.disabled = true; sinc.textContent = "Sincronizando…"; estado.google("sincronizar").then(desenhar, (e) => { mostrarErro(sdk, e); }); } }, g.sincronizando ? "Sincronizando…" : "Sincronizar agora");
    const sair = h("button", { class: "mbcrm-btn mbcrm-pequeno", title: "Parar de sincronizar com o Google", onClick: () => { modal(sdk, "Desconectar Google Contatos", h("div", { class: "mbcrm-dica" }, "Parar de trazer contatos do Google? Os que já estão no CRM continuam aqui."), "Desconectar", async () => { try { desenhar(await estado.google("desconectar")); return null; } catch (e) { return textoDoErro(e); } }); } }, "Desconectar");
    const info = g.erro ? `erro na última sincronização: ${g.erro}` : g.ultimaSync ? `${g.total ?? 0} no Google · sincronizado ${haQuanto(g.ultimaSync)}${(g.criados ?? 0) + (g.atualizados ?? 0) > 0 ? ` (${g.criados ?? 0} novos, ${g.atualizados ?? 0} completados)` : ""}` : "primeira sincronização em andamento…";
    // WhatsApp → Google: precisa da permissão de escrita (a conexão antiga era só leitura).
    const reconectar = g.precisaReconectar ? h("button", { class: "mbcrm-btn mbcrm-primario mbcrm-pequeno", title: "Autorizar os Contatos (salvar lá os contatos novos do WhatsApp) e o Drive, só nos arquivos do meu-bot (guardar as conversas ao limpar o histórico)", onClick: () => { estado.google("conectar").then(desenhar, (e) => mostrarErro(sdk, e)); } }, "Reconectar o Google (Contatos e Drive)") : null;
    const wa = g.escrita ? h("span", { class: g.whatsappErro ? "mbcrm-erro" : "mbcrm-dica", title: g.whatsappErro ?? "Todo número novo do WhatsApp é salvo no Google Contatos, no marcador WhatsApp" }, g.whatsappErro ? `WhatsApp → Google: ${g.whatsappErro}` : `WhatsApp → Google: ${g.whatsappSalvos ?? 0} salvos`) : null;
    el.append(...[logo, h("span", null, h("strong", null, "Google Contatos"), ` · ${g.email ?? "conectado"}`), h("span", { class: g.erro ? "mbcrm-erro" : "mbcrm-dica" }, info), wa, h("span", { class: "mbcrm-cresce" }), reconectar, sinc, sair].filter((x): x is HTMLElement => x !== null));
    if (g.sincronizando || (!g.ultimaSync && !g.erro)) acompanhar();
  };
  void estado.google("status").then(desenhar, () => { limpar(el); });
  return el;
}

/** Importar do Google Contatos: contacts.google.com → Exportar → "CSV do Google"; prévia e, depois, um envio só. */
export function importarContatos(sdk: InboxSDK, estado: Estado): void {
  const arq = h("input", { type: "file", accept: ".csv,text/csv" });
  const previa = h("div", { class: "mbcrm-col mbcrm-dica" },
    h("div", null, "1. Abra contacts.google.com e clique em Exportar (ícone de seta, no topo)."),
    h("div", null, "2. Escolha \"Contatos\" (ou um marcador) e o formato \"CSV do Google\"; salve o arquivo."),
    h("div", null, "3. Escolha o arquivo aqui. Quem já existe (mesmo e-mail ou telefone) é completado, sem apagar nada; a empresa vira a organização."));
  let plano: ReturnType<typeof planejarContatos> | null = null;
  arq.addEventListener("change", () => { const f = arq.files?.[0]; if (!f) return; void f.text().then((t) => {
    plano = planejarContatos(lerCsv(t)); limpar(previa);
    const empresas = new Set(plano.contatos.map((c) => c.empresa).filter(Boolean));
    previa.append(h("strong", null, `${plano.contatos.length} contato${plano.contatos.length === 1 ? "" : "s"} no arquivo${empresas.size > 0 ? `, de ${empresas.size} empresa${empresas.size === 1 ? "" : "s"}` : ""}${plano.ignoradas > 0 ? ` (${plano.ignoradas} linha${plano.ignoradas === 1 ? "" : "s"} vazia${plano.ignoradas === 1 ? "" : "s"} fica${plano.ignoradas === 1 ? "" : "m"} de fora)` : ""}.`),
      ...plano.contatos.slice(0, 5).map((c) => h("div", null, [c.nome, c.emails[0], c.telefones[0], c.empresa].filter(Boolean).join(" · "))), ...(plano.contatos.length > 5 ? [h("div", null, "…")] : []));
  }, (e) => { previa.textContent = textoDoErro(e); }); });
  modal(sdk, "Importar do Google Contatos", h("div", { class: "mbcrm-col" }, campo("Arquivo CSV", arq), previa), "Importar", async () => {
    if (!plano) return "Escolha o arquivo exportado do Google Contatos.";
    if (plano.contatos.length === 0) return "O arquivo não tem contatos com nome, e-mail ou telefone.";
    try {
      let t = { criados: 0, atualizados: 0, ignorados: 0, orgsCriadas: 0 };
      for (let i = 0; i < plano.contatos.length; i += 2000) { const r = await estado.importarContatos(plano.contatos.slice(i, i + 2000)); t = { criados: t.criados + r.criados, atualizados: t.atualizados + r.atualizados, ignorados: t.ignorados + r.ignorados, orgsCriadas: t.orgsCriadas + r.orgsCriadas }; }
      sdk.ButterBar.showMessage({ text: `Importado: ${t.criados} novos, ${t.atualizados} completados${t.orgsCriadas > 0 ? `, ${t.orgsCriadas} organizações criadas` : ""}${t.ignorados > 0 ? `, ${t.ignorados} ignorados` : ""}.`, time: 7000 });
      return null;
    } catch (e) { return textoDoErro(e); }
  });
}

export function novoContato(sdk: InboxSDK, estado: Estado, orgKey?: string): void {
  const nome = h("input", { type: "text", placeholder: "Nome e sobrenome" }); const email = h("input", { type: "email", placeholder: "nome@empresa.com.br" });
  const tel = h("input", { type: "tel", placeholder: "+55 11 99999-9999" }); const cargo = h("input", { type: "text", placeholder: "Ex.: Compras" });
  modal(sdk, "Novo contato", h("div", { class: "mbcrm-col" }, campo("Nome", nome), campo("E-mail", email), campo("Telefone", tel), campo("Cargo", cargo), h("div", { class: "mbcrm-dica" }, "Com e-mail de empresa, ele entra sozinho na organização daquele domínio.")), "Criar", async () => {
    if (nome.value.trim() === "" && email.value.trim() === "" && tel.value.trim() === "") return "Preencha nome, e-mail ou telefone.";
    try {
      const k = await estado.criarContato({ ...(nome.value.trim() ? { name: nome.value.trim() } : {}), ...(email.value.trim() ? { email: email.value.trim() } : {}), ...(tel.value.trim() ? { phone: tel.value.trim() } : {}), ...(cargo.value.trim() ? { cargo: cargo.value.trim() } : {}) });
      if (orgKey !== undefined) await estado.editarContato(k, { orgKey });
      void sdk.Router.goto(ROTA_CONTATO, { key: k }); return null;
    } catch (e) { return textoDoErro(e); }
  });
  setTimeout(() => nome.focus(), 50);
}

/** Colunas da grade de Contatos: título, valores da linha (filtro/ordem de planilha) e se o menu lista os valores. */
const COLS_CONTATOS: { id: string; titulo: string; lista: boolean }[] = [
  { id: "nome", titulo: "Nome", lista: false }, { id: "whatsapp", titulo: "WhatsApp", lista: false }, { id: "pipelines", titulo: "Pipelines", lista: true },
  { id: "telefone", titulo: "Telefone", lista: false }, { id: "org", titulo: "Organização", lista: true }, { id: "cargo", titulo: "Cargo", lista: true },
  { id: "atualizado", titulo: "Atualizado", lista: false }, { id: "email", titulo: "E-mail", lista: false },
];
const CHAVE_VISTA_CONTATOS = "mbcrm:vista:contatos";

export function montarContatos(sdk: InboxSDK, estado: Estado, v: CustomRouteView, raiz: Raiz): void {
  const contagem = h("span", { class: "mbcrm-contagem" });
  const chips = h("div", { class: "mbcrm-chips-filtro" });
  const grade = h("div", { class: "mbcrm-grade" });
  let root: HTMLElement | null = null;
  let vista: Vista = (() => { try { return parseVista(localStorage.getItem(CHAVE_VISTA_CONTATOS)); } catch { return { ...VISTA_VAZIA }; } })();
  let ultimo: { contatos: Contato[]; wa: ConversasWa; total: number } | null = null;
  const guardar = (): void => { try { localStorage.setItem(CHAVE_VISTA_CONTATOS, JSON.stringify(vista)); } catch { /* sem storage */ } };
  const mudar = (nova: Vista): void => { vista = nova; guardar(); desenharTabela(); };
  const busca = buscaCom(() => { if (root) void desenhar(root); }, "Buscar por nome, e-mail ou cargo…");
  const valores = (k: Contato, col: string): string[] => {
    const wa = ultimo?.wa ?? {};
    switch (col) {
      case "nome": return [k.nome || k.emails[0] || k.telefones[0] || ""];
      case "whatsapp": { const c = conversaDe(k, wa); return c ? [c.sessao ?? "conversa"] : []; }
      case "pipelines": return k.pipelines ?? [];
      case "telefone": return k.telefones;
      case "org": return k.orgNome ? [k.orgNome] : [];
      case "cargo": return k.cargo ? [k.cargo] : [];
      case "atualizado": return [new Date(k.updatedAt).toISOString()];
      case "email": return k.emails;
      default: return [];
    }
  };
  /** Menu ▾ do cabeçalho: ordenar, só preenchidos/vazios e, nas colunas com poucos valores, escolher um. */
  function menuColuna(btn: HTMLElement, col: { id: string; titulo: string; lista: boolean }): void {
    const f = vista.filtros[col.id]; const o = vista.ordem?.col === col.id ? vista.ordem.dir : null;
    const semFiltro = (): Record<string, Filtro> => { const r = { ...vista.filtros }; delete r[col.id]; return r; };
    const itens: [string, () => void, boolean, { marcado?: boolean }][] = [
      [col.id === "atualizado" ? "Mais antigos primeiro" : "Ordenar A → Z", () => mudar({ ...vista, ordem: { col: col.id, dir: "asc" } }), false, { marcado: o === "asc" }],
      [col.id === "atualizado" ? "Mais recentes primeiro" : "Ordenar Z → A", () => mudar({ ...vista, ordem: { col: col.id, dir: "desc" } }), false, { marcado: o === "desc" }],
      ["Só preenchidos", () => mudar({ ...vista, filtros: { ...vista.filtros, [col.id]: { tipo: "preenchido" } } }), false, { marcado: f?.tipo === "preenchido" }],
      ["Só vazios", () => mudar({ ...vista, filtros: { ...vista.filtros, [col.id]: { tipo: "vazio" } } }), false, { marcado: f?.tipo === "vazio" }],
      ...(col.lista && ultimo ? valoresDaColuna(ultimo.contatos, valores, col.id).map((x): [string, () => void, boolean, { marcado?: boolean }] => [`= ${x.valor} (${x.n})`, () => mudar({ ...vista, filtros: { ...vista.filtros, [col.id]: { tipo: "valor", valor: x.valor } } }), false, { marcado: f?.tipo === "valor" && f.valor === x.valor }]) : []),
      ...(f || o ? [["Limpar esta coluna", () => mudar({ ordem: o ? null : vista.ordem, filtros: semFiltro() }), false, {}] as [string, () => void, boolean, { marcado?: boolean }]] : []),
    ];
    abrirMenu(btn, itens, 240);
  }
  function desenharChips(): void {
    limpar(chips);
    const titulo = (id: string): string => COLS_CONTATOS.find((c) => c.id === id)?.titulo ?? id;
    const chip = (texto: string, tirar: () => void): HTMLElement => h("span", { class: "mbcrm-chip-filtro" }, texto, h("button", { title: "Tirar", onClick: tirar }, "×"));
    for (const [col, f] of Object.entries(vista.filtros)) chips.append(chip(`${titulo(col)}: ${textoFiltro(f)}`, () => { const r = { ...vista.filtros }; delete r[col]; mudar({ ...vista, filtros: r }); }));
    if (vista.ordem) chips.append(chip(`Ordem: ${titulo(vista.ordem.col)} ${vista.ordem.dir === "asc" ? "A→Z" : "Z→A"}`, () => mudar({ ...vista, ordem: null })));
    if (Object.keys(vista.filtros).length + (vista.ordem ? 1 : 0) > 1) chips.append(h("button", { class: "mbcrm-link-acao", onClick: () => mudar({ ...VISTA_VAZIA }) }, "Limpar tudo"));
  }
  function desenharTabela(): void {
    desenharChips();
    if (ultimo === null) return;
    const { contatos, wa, total } = ultimo;
    const lista = aplicarVista(contatos, valores, vista);
    contagem.textContent = lista.length === total ? `${total} contato${total === 1 ? "" : "s"}` : `${lista.length} de ${total} contatos`;
    limpar(grade);
    if (contatos.length === 0) { grade.append(h("div", { class: "mbcrm-vazio" }, busca.value.trim() !== "" ? "Nenhum contato encontrado." : "Nenhum contato ainda. Traga os do Google em “Importar do Google Contatos”, crie em ＋ Novo contato, ou ligue e-mails e telefones às caixas.")); return; }
    const salvar = (k: Contato, patch: Parameters<Estado["editarContato"]>[1]) => async (): Promise<void> => { const sv = salvando(sdk); try { await estado.editarContato(k.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); throw e; } };
    const cab = COLS_CONTATOS.map((c, i) => {
      const ativo = vista.filtros[c.id] !== undefined || vista.ordem?.col === c.id;
      const marca = vista.ordem?.col === c.id ? (vista.ordem.dir === "asc" ? " ▲" : " ▼") : "";
      const btn: HTMLButtonElement = h("button", { class: `mbcrm-th-menu${ativo ? " mbcrm-th-ativo" : ""}`, title: "Ordenar e filtrar", onClick: () => menuColuna(btn, c) }, `${c.titulo}${marca}`, h("span", { class: "mbcrm-th-seta" }, vista.filtros[c.id] ? " ⏷" : " ▾"));
      return h("th", { class: i === 0 ? "mbcrm-col-nome" : null }, btn);
    });
    grade.append(h("table", { class: "mbcrm-tabela" },
      h("thead", null, h("tr", null, ...cab)),
      h("tbody", null, ...lista.map((k) => { const c = conversaDe(k, wa); return h("tr", { class: "mbcrm-caixa-linha" },
        h("td", { class: "mbcrm-col-nome" }, link(sdk, ROTA_CONTATO, { key: k.key }, k.nome || k.emails[0] || k.telefones[0] || "(sem nome)")),
        h("td", null, c ? botaoWhatsapp(sdk, estado, c.numero, c.sessao) : h("span", { class: "mbcrm-dica" }, "—")),
        h("td", { title: (k.pipelines ?? []).join(", ") }, h("span", { class: "mbcrm-pl-cel" }, h("span", { class: "mbcrm-dica" }, (k.pipelines ?? []).join(", ")), h("button", { class: "mbcrm-add-pl", title: "Adicionar a um pipeline (cria uma caixa com esta pessoa)", onClick: (ev: Event) => { ev.stopPropagation(); void adicionarAoPipeline(sdk, estado, k); } }, (k.pipelines ?? []).length > 0 ? "＋" : "＋ pipeline"))),
        h("td", null, k.telefones.join(", ")),
        h("td", null, k.orgKey && k.orgNome ? link(sdk, ROTA_ORG, { key: k.orgKey }, k.orgNome) : ""),
        celula(k.cargo, (n) => salvar(k, { cargo: n })()),
        h("td", { class: "mbcrm-dica" }, quando(k.updatedAt)),
        h("td", { title: k.emails.join(", ") }, k.emails.join(", "))); }))));
    if (lista.length === 0) grade.append(h("div", { class: "mbcrm-vazio" }, "Nenhum contato com esses filtros."));
  }
  async function desenhar(r: HTMLElement): Promise<void> {
    if (root === null) { root = r; const topo = topoLista("Contatos", contagem, busca, () => novoContato(sdk, estado), "＋ Novo contato"); topo.insertBefore(h("button", { class: "mbcrm-btn", title: "Importar um arquivo CSV exportado do Google Contatos", onClick: () => importarContatos(sdk, estado) }, "Importar CSV"), topo.lastChild); r.append(topo, blocoGoogle(sdk, estado), chips, grade); }
    let dados; try { dados = await estado.contatos({ q: busca.value.trim() }); } catch (e) { limpar(grade); grade.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, textoDoErro(e))); return; }
    let wa: ConversasWa = {}; try { wa = await estado.conversasWhatsapp(); } catch { wa = {}; }
    ultimo = { contatos: dados.contatos, wa, total: dados.total };
    desenharTabela();
  }
  pagina(estado, v, raiz, "mbcrm-pl", desenhar, ehPessoa);
}

export function montarContato(sdk: InboxSDK, estado: Estado, v: CustomRouteView, raiz: Raiz): void {
  const key = v.getParams()["key"] ?? "";
  if (!keyValida(key)) { void sdk.Router.goto(ROTA_CONTATOS); return; }
  async function desenhar(root: HTMLElement): Promise<void> {
    let pg; try { pg = await estado.contato(key); } catch (e) { limpar(root); root.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, textoDoErro(e)), link(sdk, ROTA_CONTATOS, undefined, "← Contatos")); return; }
    const k = pg.contato;
    const salvar = async (patch: Parameters<Estado["editarContato"]>[1]): Promise<void> => { const sv = salvando(sdk); try { await estado.editarContato(k.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); throw e; } };
    let orgs: Org[] = []; try { orgs = (await estado.orgs()).orgs; } catch { orgs = []; }
    const selOrg = h("select", null, h("option", { value: "" }, "— nenhuma —"), ...orgs.map((o) => h("option", { value: o.key, selected: o.key === k.orgKey }, o.nome)), h("option", { value: "__nova" }, "＋ Nova organização…"));
    selOrg.addEventListener("change", () => {
      if (selOrg.value === "__nova") { selOrg.value = k.orgKey ?? ""; novaOrg(sdk, estado, k.emails[0]?.split("@")[1], async (o) => { await salvar({ orgKey: o.key }); }); return; }
      void salvar({ orgKey: selOrg.value === "" ? null : selOrg.value }).catch(() => { selOrg.value = k.orgKey ?? ""; });
    });
    const titulo = h("input", { class: "mbcrm-titulo", value: k.nome, placeholder: "Nome do contato" });
    titulo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") titulo.blur(); });
    titulo.addEventListener("change", () => { void salvar({ nome: titulo.value.trim() }).catch(() => { titulo.value = k.nome; }); });
    const mais: HTMLButtonElement = h("button", { class: "mbcrm-icone", title: "Mais ações", onClick: () => abrirMenu(mais, [["Apagar contato", () => {
      modal(sdk, "Apagar contato", h("div", { class: "mbcrm-dica" }, `Apagar "${k.nome || k.emails[0] || "este contato"}"? Ele sai das caixas (as caixas ficam); fica guardado na lixeira da máquina.`), "Apagar", async () => { try { await estado.apagarContato(k.key); void sdk.Router.goto(ROTA_CONTATOS); return null; } catch (e) { return textoDoErro(e); } });
    }, true]]) }, "⋮");
    limpar(root);
    root.append(
      h("div", { class: "mbcrm-topo" }, link(sdk, ROTA_CONTATOS, undefined, "←", "mbcrm-voltar"), link(sdk, ROTA_CONTATOS, undefined, "Contatos", "mbcrm-migalha"), h("span", { class: "mbcrm-dica" }, "›"), titulo, h("span", { class: "mbcrm-cresce" }), k.google?.url ? h("a", { class: "mbcrm-btn mbcrm-pequeno", href: k.google.url, target: "_blank", rel: "noopener", title: "Abrir este contato no Google Contatos" }, "Google Contatos ↗") : null, mais),
      h("div", { class: "mbcrm-duas-colunas" },
        h("div", { class: "mbcrm-cartao" }, h("h3", null, "Dados"),
          campo("E-mails", editavel(k.emails.join(", "), (n) => salvar({ emails: listaDe(n) }), { placeholder: "separe por vírgula" })),
          campo("Telefones", editavel(k.telefones.join(", "), (n) => salvar({ telefones: listaDe(n) }), { placeholder: "separe por vírgula" })),
          campo("Organização", h("div", { class: "mbcrm-linha" }, selOrg, k.orgKey && k.orgNome ? link(sdk, ROTA_ORG, { key: k.orgKey }, "abrir") : null, k.orgAuto ? h("span", { class: "mbcrm-dica", title: "Ligado pelo domínio do e-mail" }, "automático") : null)),
          campo("Cargo", editavel(k.cargo, (n) => salvar({ cargo: n }))),
          campo("LinkedIn", h("div", { class: "mbcrm-linha mbcrm-sem-quebra" }, editavel(k.linkedin, (n) => salvar({ linkedin: n }), { placeholder: "linkedin.com/in/…" }), linkExterno(k.linkedin, "https://www.linkedin.com/in/"))),
          campo("Instagram", h("div", { class: "mbcrm-linha mbcrm-sem-quebra" }, editavel(k.instagram, (n) => salvar({ instagram: n }), { placeholder: "@perfil" }), linkExterno(k.instagram, "https://www.instagram.com/"))),
          campo("Notas", editavel(k.notas, (n) => salvar({ notas: n }), { multilinha: true })),
          h("div", { class: "mbcrm-dica" }, `Criado ${quando(k.createdAt)} · atualizado ${quando(k.updatedAt)}`)),
        h("div", { class: "mbcrm-col" }, caixasCartao(sdk, pg.boxes, () => { void adicionarAoPipeline(sdk, estado, k); }), conversasCartao(sdk, pg.threads), whatsappCartao(k.whatsapp, k.telefones, "Conversa no WhatsApp", k.telefones[0] ? () => { estado.abrirWhatsapp(k.telefones[0] as string).then((ok) => { if (!ok) sdk.ButterBar.showMessage({ text: "Abra a janela do meu-bot-crm para ver a conversa.", time: 3000 }); }, (e) => mostrarErro(sdk, e)); } : undefined, { lista: k.arquivos ?? [], baixar: (a) => { estado.baixarArquivoContato(k.key, a.key).then(salvarBase64, (e) => mostrarErro(sdk, e)); } }))));
  }
  pagina(estado, v, raiz, "mbcrm-pessoa", desenhar, ehPessoa);
}

// ---- Organizações -------------------------------------------------------------------------------------------------
export function novaOrg(sdk: InboxSDK, estado: Estado, dominio?: string, feito?: (o: Org) => Promise<void>): void {
  const nome = h("input", { type: "text", placeholder: "Ex.: Acme Ltda" }); const dom = h("input", { type: "text", value: dominio ?? "", placeholder: "acme.com.br" });
  const setor = h("input", { type: "text", placeholder: "Ex.: Varejo" });
  modal(sdk, "Nova organização", h("div", { class: "mbcrm-col" }, campo("Nome", nome), campo("Domínio", dom), campo("Setor", setor), h("div", { class: "mbcrm-dica" }, "Contatos com e-mail desse domínio entram nela sozinhos. Provedores como gmail, hotmail e uol não contam.")), "Criar", async () => {
    if (nome.value.trim() === "" && dom.value.trim() === "") return "Dê um nome ou domínio.";
    try {
      const r = await estado.criarOrg({ ...(nome.value.trim() ? { nome: nome.value.trim() } : {}), ...(dom.value.trim() ? { dominio: dom.value.trim() } : {}), ...(setor.value.trim() ? { setor: setor.value.trim() } : {}) });
      if (!r.nova) sdk.ButterBar.showMessage({ text: `Já existia: "${r.org.nome}" tem esse domínio.`, time: 4000 });
      if (feito) await feito(r.org); else void sdk.Router.goto(ROTA_ORG, { key: r.org.key });
      return null;
    } catch (e) { return textoDoErro(e); }
  });
  setTimeout(() => nome.focus(), 50);
}

export function montarOrgs(sdk: InboxSDK, estado: Estado, v: CustomRouteView, raiz: Raiz): void {
  const contagem = h("span", { class: "mbcrm-contagem" });
  const grade = h("div", { class: "mbcrm-grade" });
  let root: HTMLElement | null = null;
  const busca = buscaCom(() => { if (root) void desenhar(root); }, "Buscar por nome, domínio ou setor…");
  async function desenhar(r: HTMLElement): Promise<void> {
    if (root === null) { root = r; r.append(topoLista("Organizações", contagem, busca, () => novaOrg(sdk, estado), "＋ Nova organização"), grade); }
    let dados; try { dados = await estado.orgs({ q: busca.value.trim() }); } catch (e) { limpar(grade); grade.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, textoDoErro(e))); return; }
    contagem.textContent = `${dados.total} organizaç${dados.total === 1 ? "ão" : "ões"}`;
    limpar(grade);
    if (dados.orgs.length === 0) { grade.append(h("div", { class: "mbcrm-vazio" }, busca.value.trim() !== "" ? "Nenhuma organização encontrada." : "Nenhuma organização ainda. Crie em ＋ Nova organização: os contatos com e-mail daquele domínio entram nela sozinhos.")); return; }
    const salvar = (o: Org, patch: Parameters<Estado["editarOrg"]>[1]) => async (): Promise<void> => { const sv = salvando(sdk); try { await estado.editarOrg(o.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); throw e; } };
    grade.append(h("table", { class: "mbcrm-tabela" },
      h("thead", null, h("tr", null, ...["Organização", "Site / domínio", "Setor", "Funcionários", "Contatos", "Pipelines", "Atualizado"].map((t, i) => h("th", { class: i === 0 ? "mbcrm-col-nome" : null }, t)))),
      h("tbody", null, ...dados.orgs.map((o) => h("tr", { class: "mbcrm-caixa-linha" },
        h("td", { class: "mbcrm-col-nome" }, link(sdk, ROTA_ORG, { key: o.key }, o.nome)),
        h("td", null, o.site || o.dominios.join(", ")),
        celula(o.setor, (n) => salvar(o, { setor: n })()),
        celula(o.funcionarios, (n) => salvar(o, { funcionarios: n })()),
        h("td", null, String(o.contatos)),
        h("td", { class: "mbcrm-dica", title: o.pipelines.join(", ") }, o.pipelines.join(", ")),
        h("td", { class: "mbcrm-dica" }, quando(o.updatedAt)))))));
  }
  pagina(estado, v, raiz, "mbcrm-pl", desenhar, ehPessoa);
}

export function montarOrg(sdk: InboxSDK, estado: Estado, v: CustomRouteView, raiz: Raiz): void {
  const key = v.getParams()["key"] ?? "";
  if (!keyValida(key)) { void sdk.Router.goto(ROTA_ORGS); return; }
  async function desenhar(root: HTMLElement): Promise<void> {
    let pg; try { pg = await estado.org(key); } catch (e) { limpar(root); root.append(h("div", { class: "mbcrm-vazio mbcrm-erro" }, textoDoErro(e)), link(sdk, ROTA_ORGS, undefined, "← Organizações")); return; }
    const o = pg.org;
    const salvar = async (patch: Parameters<Estado["editarOrg"]>[1]): Promise<void> => { const sv = salvando(sdk); try { await estado.editarOrg(o.key, patch); sv.resolve(); } catch (e) { sv.reject(); mostrarErro(sdk, e); throw e; } };
    const titulo = h("input", { class: "mbcrm-titulo", value: o.nome });
    titulo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") titulo.blur(); });
    titulo.addEventListener("change", () => { void salvar({ nome: titulo.value.trim() }).catch(() => { titulo.value = o.nome; }); });
    const mais: HTMLButtonElement = h("button", { class: "mbcrm-icone", title: "Mais ações", onClick: () => abrirMenu(mais, [["Apagar organização", () => {
      modal(sdk, "Apagar organização", h("div", { class: "mbcrm-dica" }, `Apagar "${o.nome}"? Os ${o.contatos} contato(s) continuam, só sem organização. Fica guardada na lixeira da máquina.`), "Apagar", async () => { try { await estado.apagarOrg(o.key); void sdk.Router.goto(ROTA_ORGS); return null; } catch (e) { return textoDoErro(e); } });
    }, true]]) }, "⋮");
    const contatos = h("div", { class: "mbcrm-cartao" }, h("div", { class: "mbcrm-cartao-cab" }, h("h3", null, `Contatos (${pg.contatos.length})`), h("span", { class: "mbcrm-cresce" }), h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: () => novoContato(sdk, estado, o.key) }, "＋ Contato")),
      pg.contatos.length === 0 ? h("div", { class: "mbcrm-dica" }, "Nenhum contato ainda.") : null,
      ...pg.contatos.map((k) => h("div", { class: "mbcrm-linha-caixa" }, link(sdk, ROTA_CONTATO, { key: k.key }, k.nome || k.emails[0] || "(sem nome)", "mbcrm-lc-nome"), h("span", { class: "mbcrm-lc-pipe" }, [k.cargo, k.emails[0]].filter(Boolean).join(" · ")), k.orgAuto ? h("span", { class: "mbcrm-dica", title: "Ligado pelo domínio do e-mail" }, "auto") : null)));
    limpar(root);
    root.append(
      h("div", { class: "mbcrm-topo" }, link(sdk, ROTA_ORGS, undefined, "←", "mbcrm-voltar"), link(sdk, ROTA_ORGS, undefined, "Organizações", "mbcrm-migalha"), h("span", { class: "mbcrm-dica" }, "›"), titulo, h("span", { class: "mbcrm-cresce" }), mais),
      h("div", { class: "mbcrm-duas-colunas" },
        h("div", { class: "mbcrm-cartao" }, h("h3", null, "Dados"),
          campo("Domínios", editavel(o.dominios.join(", "), (n) => salvar({ dominios: listaDe(n) }), { placeholder: "acme.com.br, acme.com" })),
          campo("Site", h("div", { class: "mbcrm-linha mbcrm-sem-quebra" }, editavel(o.site, (n) => salvar({ site: n }), { placeholder: "https://…" }), linkExterno(o.site || o.dominios[0] || ""))),
          campo("Setor", editavel(o.setor, (n) => salvar({ setor: n }))),
          campo("Funcionários", editavel(o.funcionarios, (n) => salvar({ funcionarios: n }), { placeholder: "Ex.: 11-50" })),
          campo("Telefones", editavel(o.telefones.join(", "), (n) => salvar({ telefones: listaDe(n) }))),
          campo("Endereço", editavel(o.endereco, (n) => salvar({ endereco: n }))),
          campo("LinkedIn", h("div", { class: "mbcrm-linha mbcrm-sem-quebra" }, editavel(o.linkedin, (n) => salvar({ linkedin: n })), linkExterno(o.linkedin, "https://www.linkedin.com/company/"))),
          campo("Instagram", h("div", { class: "mbcrm-linha mbcrm-sem-quebra" }, editavel(o.instagram, (n) => salvar({ instagram: n })), linkExterno(o.instagram, "https://www.instagram.com/"))),
          campo("Notas", editavel(o.notas, (n) => salvar({ notas: n }), { multilinha: true })),
          h("div", { class: "mbcrm-dica" }, `Criada ${quando(o.createdAt)} · atualizada ${quando(o.updatedAt)}`)),
        h("div", { class: "mbcrm-col" }, contatos, caixasCartao(sdk, pg.boxes), conversasCartao(sdk, pg.threads), ...pg.contatos.filter((k) => k.whatsapp).map((k) => whatsappCartao(k.whatsapp, k.telefones, `WhatsApp · ${k.nome || k.telefones[0]}`)))));
  }
  pagina(estado, v, raiz, "mbcrm-pessoa", desenhar, ehPessoa);
}
