/**
 * Variante: admin. A página "Suporte" da janela de uma pessoa no meu-bot-admin: saúde da máquina, progresso
 * nos tutoriais, ações de suporte (dois cliques) e os registros (recolhidos; só lê o journal ao abrir). Fábrica
 * com dependências explícitas, no padrão de snake.ts: o renderer.ts dá o sistema de páginas e recebe de volta,
 * por `onWhatsapp`, o estado do WhatsApp que a saúde traz (é ele quem pinta a lateral).
 */
import type { AdminAction, AdminHealth, MeuBotApi, WhatsappStatus } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { cacheAgeText, type Cached } from "../lib/cache.js";
import { actionResultText, healthLines, progressEmptyText, progressLines, progressUpdatedText, transcriptionNote, visibleActions, type HealthLine } from "../lib/admin-view.js";

export interface SuportePageDeps {
  /** A máquina da janela e, se conhecido, o nome da pessoa. */
  who: { host: string; person: string | null; machine: string | null };
  /** Versão deste app (a do admin), para comparar com a do meu-bot dela. */
  adminVersion: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  /** Botão de dois cliques (o segundo confirma). */
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  fmtPhone(digits: string | null): string;
  api: Pick<MeuBotApi, "adminHealth" | "adminLogs" | "adminAction">;
  /** A saúde trouxe o WhatsApp da máquina (null = ela não compartilha ou não tem): o renderer atualiza a lateral. */
  onWhatsapp(status: WhatsappStatus | null): void;
  /** Cache desta janela (lib/cache.ts, por máquina): a saúde da última vez aparece na hora, com "há X min". */
  cache: { read<T>(name: string): Cached<T> | null; write(name: string, value: unknown): void };
}

export interface SuportePage {
  /** Cria a página na primeira vez (e consulta a saúde) e a traz para a frente. */
  open(): void;
  refreshHealth(): Promise<void>;
}

interface State { health: AdminHealth | null; /** Quando a saúde na tela foi lida de verdade (null = veio do cache ou ainda não leu). */ healthAt: number | null; healthErr: string | null; logs: string | null; busy: AdminAction | "health" | "logs" | null; msg: { text: string; bad: boolean } | null }

export function mountSuportePage(deps: SuportePageDeps): SuportePage {
  const state: State = { health: null, healthAt: null, healthErr: null, logs: null, busy: null, msg: null };
  // A saúde da última vez aparece na hora (com a idade); a consulta real troca por baixo.
  const cachedHealth = deps.cache.read<AdminHealth>("health");
  if (cachedHealth !== null) { state.health = cachedHealth.value; state.healthAt = cachedHealth.at; deps.onWhatsapp(cachedHealth.value.whatsapp); }
  let page: PageTab | null = null;
  /** Registros recolhidos por padrão: só lê o journal da máquina quando a pessoa abre. */
  let logsOpen = false;
  const who = deps.who.person ?? deps.who.host;

  async function refreshHealth(): Promise<void> {
    state.busy = "health"; render();
    try {
      state.health = await deps.api.adminHealth(); state.healthErr = null; state.healthAt = Date.now(); deps.cache.write("health", state.health);
      deps.onWhatsapp(state.health.whatsapp);
    } catch (err) { state.healthErr = ipcErrorText(err); }
    finally { state.busy = null; render(); }
  }
  async function refreshLogs(): Promise<void> {
    state.busy = "logs"; render();
    try { state.logs = await deps.api.adminLogs(); } catch (err) { state.logs = `não consegui ler: ${err instanceof Error ? err.message : String(err)}`; }
    finally { state.busy = null; render(); }
  }

  const list = (lines: HealthLine[]): HTMLUListElement => {
    const ul = el("ul", "admin-health");
    for (const l of lines) {
      const li = el("li", l.ok === null ? "" : l.ok ? "ok" : "bad", l.text);
      if (l.step !== undefined) li.append(el("span", "admin-step", l.step));
      ul.append(li);
    }
    return ul;
  };
  const smallBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", "btn btn-ghost btn-small", label); b.type = "button"; b.disabled = state.busy !== null;
    b.addEventListener("click", onClick);
    return b;
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel;
    panel.replaceChildren();
    const head = el("div", "guide-head");
    const body = el("div", "tut-body");
    body.append(el("span", "tut-badge", "suporte · espelho só leitura"), el("h2", "", who), el("p", "", `Máquina ${deps.who.machine ?? deps.who.host}. As ações abaixo ficam registradas para ${who} ver nas Configurações dela. Se ela desligar o suporte, o acesso acaba na hora.`));
    head.append(body);
    panel.append(head);

    // Saúde
    const h = el("div", "admin-card");
    const hHead = el("div", "admin-card-head"); hHead.append(el("strong", "", "Saúde da máquina"));
    if (state.health !== null && state.healthAt !== null && (state.busy === "health" || Date.now() - state.healthAt > 90_000)) hHead.append(el("span", "hint", state.busy === "health" ? `como estava ${cacheAgeText(state.healthAt)} · atualizando…` : `como estava ${cacheAgeText(state.healthAt)}`));
    hHead.append(smallBtn(state.busy === "health" ? "Consultando…" : "Atualizar", () => { void refreshHealth(); }));
    h.append(hHead);
    const hp = state.health;
    if (state.healthErr !== null) h.append(el("p", "hint guide-pair-note", state.healthErr));
    else if (hp === null) h.append(el("p", "hint", "Consultando…"));
    else {
      const lines = healthLines(hp, deps.fmtPhone, deps.adminVersion);
      if (!hp.share.whatsapp) lines.push({ text: `WhatsApp: ${who} preferiu não compartilhar`, ok: null });
      h.append(list(lines));
    }
    panel.append(h);

    // Progresso nos tutoriais (onde a pessoa está e onde travou)
    const pg = el("div", "admin-card");
    pg.append(el("strong", "", "Progresso nos tutoriais"));
    const prog = hp?.progress ?? null;
    if (hp === null) pg.append(el("p", "hint", "Consultando…"));
    else if (!hp.share.progress) pg.append(el("p", "hint", `${who} preferiu não compartilhar o progresso nos tutoriais.`));
    else if (prog === null) pg.append(el("p", "hint", progressEmptyText(who)));
    else pg.append(list(progressLines(prog)), el("p", "hint", progressUpdatedText(prog.at)));
    panel.append(pg);

    // Ações
    const a = el("div", "admin-card");
    a.append(el("strong", "", "Ações de suporte"));
    const acts = el("div", "admin-actions");
    for (const o of visibleActions(hp)) {
      const b = el("button", "btn btn-ghost btn-small", state.busy === o.id ? "Rodando…" : o.label); b.type = "button"; b.disabled = state.busy !== null;
      b.addEventListener("click", () => deps.armConfirm(b, o.confirm, () => {
        state.busy = o.id; state.msg = null; render();
        void deps.api.adminAction(o.id)
          .then((r) => { state.msg = { text: actionResultText(o.label, r), bad: !r.ok }; })
          .catch((err: unknown) => { state.msg = { text: ipcErrorText(err), bad: true }; })
          .finally(() => { state.busy = null; void refreshHealth(); if (logsOpen) void refreshLogs(); });
      }));
      acts.append(b);
    }
    a.append(acts);
    const note = transcriptionNote(hp);
    if (note !== null) a.append(el("p", "hint", note));
    if (state.msg !== null) a.append(el("p", `hint ${state.msg.bad ? "guide-pair-note" : "audio-ok"}`, state.msg.text));
    panel.append(a);

    // Registros: recolhido por padrão (é o que menos se olha e o mais pesado de ler). Só se ela compartilha.
    if (hp !== null && !hp.share.logs) {
      const nr = el("div", "admin-card"); nr.append(el("strong", "", "Registros (gateway e backend)"), el("p", "hint", `${who} preferiu não compartilhar os registros.`));
      panel.append(nr, el("p", "hint", "As conversas do WhatsApp dela estão na lateral (só leitura)."));
      return;
    }
    const r = el("details", "admin-card admin-logs-card");
    r.open = logsOpen;
    const sum = el("summary", "admin-card-head");
    sum.append(el("strong", "", "Registros (gateway e backend)"), el("span", "hint", logsOpen ? "" : "clique para abrir"));
    r.append(sum);
    r.addEventListener("toggle", () => {
      if (r.open === logsOpen) return;
      logsOpen = r.open;
      if (logsOpen && state.logs === null) void refreshLogs(); else render();
    });
    if (logsOpen) {
      const pre = el("pre", "admin-logs", state.logs ?? "Lendo…");
      r.append(smallBtn(state.busy === "logs" ? "Lendo…" : "Atualizar", () => { void refreshLogs(); }), pre);
      requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
    }
    panel.append(r);
    panel.append(el("p", "hint", "As conversas do WhatsApp dela estão na lateral (só leitura)."));
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel admin-panel"); panel.hidden = true;
        deps.panelsEl.append(panel);
        page = deps.definePage("suporte", `Suporte · ${who}`, panel, render);
        void refreshHealth();
      }
      deps.openPage(page);
    },
    refreshHealth,
  };
}
