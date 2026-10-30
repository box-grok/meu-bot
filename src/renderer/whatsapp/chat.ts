import type { WhatsappChat, WhatsappThreadMessage, WhatsappOrigin } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { PageTab } from "../lib/pages-types.js";
import { pausaAteTexto } from "../lib/pausa-texto.js";
import { hostLabel } from "../lib/probe-text.js";
import { waReferenceText } from "../lib/reference.js";
import type { Tab } from "../renderer.js";
import { ctx } from "../app/ctx.js";

interface WaChatPage {
  page: PageTab; chat: WhatsappChat; msgs: WhatsappThreadMessage[]; err: string | null; loaded: boolean; inflight: Promise<void> | null; timer: number | null;
  /** Chaves das mensagens já na tela (para só acrescentar as novas). */
  shown?: string[];
  /** O que está na tela veio do cache desta janela; a leitura real ainda não chegou. */
  stale?: boolean;
}
export const waChatPages = new Map<string, WaChatPage>();
export function paintWaChatTab(g: WaChatPage): void {
  g.page.title = ctx.waChatTitle(g.chat);
  const t = g.page.tabEl?.querySelector(".tab-title"); if (t !== null && t !== undefined) t.textContent = g.page.title;
}
/** `aoLado`: Option+clique na lista abre numa coluna nova da tela dividida (para ver duas conversas juntas). */
export function openWaChat(c: WhatsappChat, aoLado = false): void {
  const id = `wa-${c.number}`;
  let g = waChatPages.get(id);
  if (g === undefined) {
    const panel = el("section", "wa-chat-panel"); panel.hidden = true;
    ctx.panelsEl.append(panel);
    const created: WaChatPage = { page: null as unknown as PageTab, chat: c, msgs: [], err: null, loaded: false, inflight: null, timer: null };
    // A conversa da última vez aparece na hora (cache desta janela, até 200 mensagens); a leitura real troca por baixo.
    const cached = ctx.cacheRead<WhatsappThreadMessage[]>(`waThread:${c.number}`);
    if (cached !== null && cached.value.length > 0) { created.msgs = cached.value; created.loaded = true; created.stale = true; }
    created.page = ctx.definePage(id, ctx.waChatTitle(c), panel, () => renderWaChat(created));
    waChatPages.set(id, created);
    g = created;
  } else { g.chat = c; }
  if (aoLado) { ctx.openPage(g.page, false); ctx.splitOn(g.page); } else ctx.openPage(g.page);
  paintWaChatTab(g);
  ctx.renderSidebar();
}
function refreshWaThread(g: WaChatPage): Promise<void> {
  if (g.inflight !== null) return g.inflight;
  if (g.timer !== null) { clearTimeout(g.timer); g.timer = null; }
  g.inflight = (async () => {
    try { g.msgs = await window.meuBot.whatsappThread(g.chat.number); g.err = null; g.stale = false; ctx.cacheWrite(`waThread:${g.chat.number}`, g.msgs.slice(-200)); }
    catch (err) { g.err = err instanceof Error ? err.message : String(err); }
    finally { g.loaded = true; g.inflight = null; }
    if (ctx.pageShown(g.page)) { g.timer = window.setTimeout(() => { g.timer = null; void refreshWaThread(g); }, waAgentTyping(g) ? 3_000 : 8_000); renderWaChat(g); }
  })();
  return g.inflight;
}
const hhmm = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
/** Bolha do WhatsApp: contato à esquerda, agente à direita (markdown), hora embaixo. */
export function waBubble(m: WhatsappThreadMessage): HTMLElement {
  const bubble = el("div", `msg wa-msg ${m.role === "contact" ? "wa-in" : "wa-out"}`);
  const body = el("div", "wa-body");
  if (m.role === "agent") body.append(renderMarkdown(m.text)); else body.textContent = m.text;
  bubble.dataset["waAt"] = m.at;
  // Grupos: o autor de cada mensagem em cima da bolha.
  if (m.autor !== undefined && m.role === "contact") bubble.append(el("span", "wa-author", m.autor));
  // Recebida na pausa: o agente não a viu (o plugin a guardou); ao retomar, ele recebe um resumo numa nota só.
  if (m.durantePausa === true) { bubble.classList.add("wa-pausa"); bubble.title = "Recebida durante a pausa: o agente não viu esta mensagem. Ao retomar, ele recebe um resumo do que chegou."; }
  bubble.append(body, el("span", "wa-time", `${m.role === "agent" ? "agente · " : m.durantePausa === true ? "na pausa · " : ""}${hhmm(m.at)}`));
  return bubble;
}
/** Conversa do WhatsApp trazida, no topo da aba do meu-bot: o mesmo visual do espelho, só para ler. */
export function renderWaQuote(tab: Tab, w: WhatsappOrigin, pending: boolean): void {
  const box = el("div", "wa-quote");
  const head = el("div", "wa-quote-head");
  head.append(el("strong", "", `WhatsApp · ${w.name}`), el("span", "", `${w.count} ${w.count === 1 ? "mensagem" : "mensagens"}`));
  box.append(head);
  let lastDay = "";
  for (const m of w.messages ?? []) {
    const day = new Date(m.at).toLocaleDateString("pt-BR");
    if (day !== lastDay) { box.append(el("div", "wa-day", day)); lastDay = day; }
    box.append(waBubble(m));
  }
  box.append(el("div", "wa-quote-foot", pending
    ? "Daqui para baixo é a conversa com o meu-bot: ele recebe o trecho acima junto da sua primeira mensagem. Nada daqui vai para o WhatsApp."
    : "Daqui para baixo, conversa com o meu-bot. Nada daqui vai para o WhatsApp."));
  tab.messagesEl.appendChild(box);
}
export const waMsgKey = (m: WhatsappThreadMessage): string => `${m.role}|${m.at}|${m.text}`;
/** Por quanto tempo depois da última mensagem do contato o "digitando…" ainda faz sentido. */
const WA_TYPING_WINDOW = 3 * 60_000;
/**
 * O agente vai responder a última mensagem? Só uma simulação para quem acompanha: a última é do contato,
 * recente, o WhatsApp está conectado, a conversa não está pausada e a política responde essa pessoa
 * ("todo mundo", ou "só eu" na conversa consigo mesmo).
 */
function waAgentTyping(g: WaChatPage): boolean {
  const last = g.msgs.at(-1);
  const st = ctx.waStatus;
  if (last === undefined || last.role !== "contact" || g.chat.paused || st === null || !st.connected) return false;
  if (!(st.dmPolicy === "open" || (st.dmPolicy === "allowlist" && (g.chat.isSelf || g.chat.isDono === true)))) return false;
  return Date.now() - new Date(last.at).getTime() < WA_TYPING_WINDOW;
}
/** Balão do agente com três pontinhos. */
function waTypingBubble(): HTMLElement {
  const b = el("div", "msg wa-msg wa-out wa-typing wa-enter");
  b.setAttribute("aria-label", "o agente está digitando");
  b.append(el("span", "wa-dot"), el("span", "wa-dot"), el("span", "wa-dot"));
  return b;
}
/** Bolhas "esqueleto" enquanto a conversa carrega (alternando lados, larguras variadas). */
export function waSkeleton(): HTMLElement {
  const box = el("div", "wa-skeleton");
  box.setAttribute("aria-label", "Carregando a conversa…");
  for (const [side, w] of [["in", 46], ["out", 62], ["in", 34], ["out", 54], ["in", 58]] as const) {
    const b = el("div", `wa-skel ${side}`); b.style.width = `${w}%`; box.append(b);
  }
  return box;
}
/**
 * Desenha a conversa sem piscar: o cabeçalho é atualizado no lugar e, se as mensagens novas só continuam as
 * que já estão na tela, elas entram no fim com animação (rolagem suave se a pessoa estava no fim). Primeira
 * carga: as últimas bolhas entram em cascata. Qualquer outra mudança (histórico limpo, sessão nova) redesenha.
 */
export function renderWaChat(g: WaChatPage): void {
  const panel = g.page.panel;
  const first = panel.dataset["rendered"] !== "1";
  const atEnd = first || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
  let head = panel.querySelector<HTMLElement>(".wa-chat-head");
  let list = panel.querySelector<HTMLElement>(".wa-chat-msgs");
  if (head === null || list === null) {
    head = el("div", "wa-chat-head"); list = el("div", "wa-chat-msgs");
    panel.replaceChildren(head, list);
  }
  // Com apelido, o nome original (pushname) continua visível ao lado do número.
  const sub = g.chat.alias !== null && g.chat.name !== null && !g.chat.isSelf ? `${g.chat.name} · ${ctx.fmtPhone(g.chat.number)}` : ctx.fmtPhone(g.chat.number);
  // ID da conversa (a mesma referência do "Copiar ID" da lista): sessão atual do OpenClaw, clique copia a linha inteira.
  const sid = g.chat.sessionKeys.map((k) => g.chat.sessionIds[k]).find((x): x is string => typeof x === "string") ?? null;
  const ref = waReferenceText(g.chat, hostLabel(ctx.windowHost));
  const idBtn = el("button", "wa-chat-id", sid !== null ? `ID ${sid.slice(0, 8)}` : "ID"); idBtn.type = "button";
  idBtn.title = `${ref}\n\nClique para copiar`;
  idBtn.addEventListener("click", () => ctx.copyReference(ref));
  head.replaceChildren(el("strong", "", ctx.waChatTitle(g.chat)), el("span", "wa-chat-num", sub), idBtn,
    el("span", "wa-chat-hint", g.stale === true ? "atualizando…" : g.chat.paused ? `pausado${pausaAteTexto(g.chat.pausaAte) ? ` ${pausaAteTexto(g.chat.pausaAte)}` : ""}: o agente não responde a esta pessoa · somente leitura` : "somente leitura · atualiza sozinho"));
  panel.dataset["rendered"] = "1";
  const keys = g.msgs.map(waMsgKey);
  const shown = g.shown ?? [];
  const appendOnly = g.loaded && shown.length > 0 && shown.length <= keys.length && shown.every((k, i) => keys[i] === k);
  if (!g.loaded || g.msgs.length === 0 || !appendOnly) {
    list.replaceChildren();
    g.shown = [];
    if (!g.loaded) list.append(waSkeleton());
    else if (g.err !== null && g.msgs.length === 0) list.append(el("p", "hint wa-fade", `Não consegui ler a conversa: ${g.err}`));
    else if (g.msgs.length === 0) list.append(el("p", "hint wa-fade", "Sem mensagens ainda."));
  }
  const from = g.shown?.length ?? 0;
  // O "digitando…" fica sempre por último: sai antes de entrar mensagem nova e volta se ainda couber.
  const typingEl = list.querySelector(".wa-typing");
  const typing = g.loaded && waAgentTyping(g);
  if (typingEl !== null && (!typing || from < g.msgs.length)) typingEl.remove();
  if (g.loaded && from < g.msgs.length) {
    const cascade = from === 0; // primeira vez com mensagens: as últimas entram em sequência
    let lastDay = from === 0 ? "" : new Date(g.msgs[from - 1]!.at).toLocaleDateString("pt-BR");
    const total = g.msgs.length - from;
    g.msgs.slice(from).forEach((m, i) => {
      const day = new Date(m.at).toLocaleDateString("pt-BR");
      if (day !== lastDay) { list!.append(el("div", "wa-day", day)); lastDay = day; }
      const bubble = waBubble(m);
      const actions = el("div", "msg-actions");
      actions.append(ctx.iconButton("wa-copy", "Copiar", ctx.ICON_COPY));
      bubble.append(actions);
      const rank = total - 1 - i; // 0 = a mais nova
      if (!cascade || rank < 10) { bubble.classList.add("wa-enter"); bubble.style.animationDelay = cascade ? `${(9 - Math.min(rank, 9)) * 35}ms` : "0ms"; }
      list!.append(bubble);
    });
    g.shown = keys;
  }
  const typingNow = typing && list.querySelector(".wa-typing") === null;
  if (typingNow) list.append(waTypingBubble());
  if ((g.loaded && from < g.msgs.length) || typingNow) {
    if (atEnd) panel.scrollTo({ top: panel.scrollHeight, behavior: from === 0 ? "auto" : "smooth" });
  }
  // Voltou para a frente sem consulta agendada: retoma o ciclo.
  if (ctx.pageShown(g.page) && g.inflight === null && g.timer === null) void refreshWaThread(g);
}
/** Copiar o texto de uma bolha do espelho. */
export function waCopy(btn: HTMLButtonElement): void {
  const g = [...waChatPages.values()].find((p) => p.page === ctx.pageActive);
  if (g === undefined) return;
  const bubble = btn.closest<HTMLElement>(".wa-msg");
  const at = bubble?.dataset["waAt"] ?? null;
  const m = g.msgs.find((x) => x.at === at);
  void navigator.clipboard.writeText(m?.text ?? bubble?.querySelector(".wa-body")?.textContent ?? "").then(() => {
    btn.replaceChildren(ctx.svgIcon(ctx.ICON_CHECK)); btn.title = "Copiado"; btn.classList.add("done");
    window.setTimeout(() => { btn.replaceChildren(ctx.svgIcon(ctx.ICON_COPY)); btn.title = "Copiar"; btn.classList.remove("done"); }, 1500);
  });
}
/** Abre a conversa nova do meu-bot com o trecho do WhatsApp: aba na frente, lista no meu-bot, cursor no campo. */
export async function openWaBranch(number: string): Promise<void> {
  const view = await window.meuBot.whatsappBranch(number);
  ctx.upsertIndex(view);
  ctx.buildTab(view.id, view.model, view.host, view);
  ctx.activate(view.id);
  if (ctx.getListMode() === "whatsapp") ctx.setListMode("bot");
  ctx.inputEl.focus();
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarChat(): void {
  /** A extensão do CRM pediu a conversa deste número: abre a aba (atualiza a lista se ele ainda não está nela). */
  window.meuBot.on("whatsapp:abrir", ({ number }) => {
    void (async () => {
      const achar = (): WhatsappChat | undefined => ctx.waChats.find((c) => c.number === number || c.number.endsWith(number.slice(-10)));
      let c = achar();
      if (c === undefined) { try { ctx.waChats = await window.meuBot.whatsappChats(); } catch { /* máquina fora */ } c = achar(); }
      if (c !== undefined) openWaChat(c);
    })();
  });
}
