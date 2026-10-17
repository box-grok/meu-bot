/**
 * Variante: admin. Espelho das conversas da pessoa com o meu-bot (só leitura): a lista na lateral, no modo
 * "meu-bot", e uma página por conversa com as mensagens, que se atualiza enquanto está na frente. Lê pelas
 * transcrições do Claude Code na máquina dela (admin:bot-chats / admin:bot-thread), então não depende do app
 * dela estar aberto. Mesmo desenho das bolhas do WhatsApp (classes wa-*).
 */
import type { BotChat, BotMessage, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { renderMarkdown } from "../lib/markdown.js";
import { groupByDate, normalize, shortDate } from "../lib/sidebar.js";
import { botReferenceText } from "../lib/reference.js";

export interface BotMirrorDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  activePage(): PageTab | null;
  api: Pick<MeuBotApi, "adminBotChats" | "adminBotThread" | "adminBotDelete" | "showBotMenu">;
  /** Apelido da máquina da janela (entra na referência). */
  machine(): string;
  /** Copia o texto e avisa de leve na lateral. */
  copyReference(text: string): void;
  /** Botão de dois cliques (o segundo confirma). */
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  closePage(page: PageTab): void;
  /** A lista mudou (chegou do servidor ou falhou): o renderer redesenha a lateral. */
  onListChanged(): void;
}
export interface BotMirror {
  /** Desenha a lista na lateral (chama a primeira leitura se ainda não houve). */
  paintList(container: HTMLElement, query: string): void;
  refresh(): Promise<void>;
}
interface ChatPage { page: PageTab; chat: BotChat; msgs: BotMessage[]; err: string | null; loaded: boolean; timer: number | null; inflight: Promise<void> | null }

const hhmm = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

export function mountBotMirror(deps: BotMirrorDeps): BotMirror {
  let chats: BotChat[] = []; let err: string | null = null; let loaded = false; let inflight: Promise<void> | null = null; let listTimer: number | null = null;
  const pages = new Map<string, ChatPage>();

  async function refresh(): Promise<void> {
    if (inflight !== null) return inflight;
    inflight = (async () => {
      try { chats = await deps.api.adminBotChats(); err = null; } catch (e) { err = ipcErrorText(e); }
      finally { loaded = true; inflight = null; deps.onListChanged(); }
      if (listTimer !== null) clearTimeout(listTimer);
      listTimer = window.setTimeout(() => { listTimer = null; void refresh(); }, 30_000);
    })();
    return inflight;
  }

  function bubble(m: BotMessage): HTMLElement {
    if (m.role === "tool") { const t = el("div", "bot-tool hint", `🔧 ${m.text}`); t.title = "o agente usou uma ferramenta"; return t; }
    const b = el("div", `msg wa-msg ${m.role === "person" ? "wa-in" : "wa-out"}`);
    const body = el("div", "wa-body");
    if (m.role === "agent") body.append(renderMarkdown(m.text)); else body.textContent = m.text;
    b.append(body, el("span", "wa-time", `${m.role === "agent" ? "meu-bot · " : ""}${hhmm(m.at)}`));
    return b;
  }

  function render(g: ChatPage): void {
    const panel = g.page.panel;
    const atEnd = panel.dataset["rendered"] !== "1" || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
    panel.replaceChildren();
    const head = el("div", "wa-chat-head");
    head.append(el("strong", "", g.chat.title), el("span", "wa-chat-num", `${g.chat.replies} resposta${g.chat.replies === 1 ? "" : "s"} · ${shortDate(g.chat.updatedAt)}`), el("span", "wa-chat-hint", "conversa dela com o meu-bot · somente leitura · atualiza sozinho"));
    // Apagar (travou, ficou lixo): dois cliques; some da máquina dela e fica no registro que ela vê.
    const del = el("button", "btn btn-ghost btn-small btn-danger", "Apagar esta conversa"); del.type = "button";
    del.addEventListener("click", () => deps.armConfirm(del, "Confirmar? some da máquina dela", () => {
      del.disabled = true;
      void deps.api.adminBotDelete(g.chat.sessionId)
        .then(() => { if (g.timer !== null) { clearTimeout(g.timer); g.timer = null; } pages.delete(`bot-${g.chat.sessionId}`); deps.closePage(g.page); void refresh(); })
        .catch((e: unknown) => { del.disabled = false; g.err = ipcErrorText(e); render(g); });
    }));
    // "Copiar ID": o .jsonl desta conversa na máquina dela, uma linha para colar numa IA.
    const ref = el("button", "btn btn-ghost btn-small", "Copiar ID"); ref.type = "button";
    ref.title = "Copia o caminho do .jsonl desta conversa na máquina dela";
    ref.addEventListener("click", () => deps.copyReference(botReferenceText(g.chat, deps.machine())));
    head.append(ref, del);
    const list = el("div", "wa-chat-msgs");
    if (!g.loaded) list.append(el("p", "hint", "Lendo a conversa na máquina…"));
    else if (g.err !== null && g.msgs.length === 0) list.append(el("p", "hint wa-fade", `Não consegui ler a conversa: ${g.err}`));
    else if (g.msgs.length === 0) list.append(el("p", "hint wa-fade", "Sem mensagens."));
    else for (const m of g.msgs) list.append(bubble(m));
    panel.append(head, list);
    panel.dataset["rendered"] = "1";
    if (atEnd) requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight; });
  }

  function refreshThread(g: ChatPage): Promise<void> {
    if (g.inflight !== null) return g.inflight;
    if (g.timer !== null) { clearTimeout(g.timer); g.timer = null; }
    g.inflight = (async () => {
      try { g.msgs = await deps.api.adminBotThread(g.chat.sessionId); g.err = null; } catch (e) { g.err = ipcErrorText(e); }
      finally { g.loaded = true; g.inflight = null; }
      if (deps.activePage() === g.page) { g.timer = window.setTimeout(() => { g.timer = null; void refreshThread(g); }, 8_000); render(g); }
    })();
    return g.inflight;
  }

  function open(chat: BotChat): void {
    const id = `bot-${chat.sessionId}`;
    let g = pages.get(id);
    if (g === undefined) {
      const panel = el("section", "wa-chat-panel"); panel.hidden = true;
      deps.panelsEl.append(panel);
      const created: ChatPage = { page: null as unknown as PageTab, chat, msgs: [], err: null, loaded: false, timer: null, inflight: null };
      created.page = deps.definePage(id, chat.title, panel, () => { render(created); void refreshThread(created); });
      pages.set(id, created); g = created;
    } else g.chat = chat;
    deps.openPage(g.page);
    deps.onListChanged();
  }

  return {
    refresh,
    paintList: (container, query) => {
      if (!loaded && inflight === null) void refresh();
      container.replaceChildren();
      const q = normalize(query.trim());
      const rows = chats.filter((c) => q === "" || normalize(c.title).includes(q));
      if (rows.length === 0) {
        const msg = err !== null ? `Não consegui ler as conversas: ${err}` : !loaded ? "Lendo as conversas dela com o meu-bot…" : q !== "" ? "Nada encontrado." : "Ela ainda não conversou com o meu-bot nesta máquina.";
        container.append(el("div", "sidebar-empty", msg));
        return;
      }
      const active = deps.activePage();
      for (const group of groupByDate(rows)) {
        container.append(el("div", "sidebar-group", group.label));
        for (const c of group.items) {
          const item = el("div", `sidebar-item${active?.id === `bot-${c.sessionId}` ? " active" : ""}`);
          // Menu "…" (como no WhatsApp): hoje só "Copiar ID".
          const menu = el("button", "si-menu", "…"); menu.type = "button"; menu.title = "Ações";
          menu.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void deps.api.showBotMenu(c.sessionId).then((a) => { if (a === "copy-ref") deps.copyReference(botReferenceText(c, deps.machine())); });
          });
          item.append(el("span", "si-title", c.title), el("span", "si-date", shortDate(c.updatedAt)), menu);
          item.title = `${c.replies} resposta${c.replies === 1 ? "" : "s"} do meu-bot · ${c.project.includes("agent") ? "modo agente" : "chat"}`;
          item.addEventListener("click", () => open(c));
          container.append(item);
        }
      }
    },
  };
}
