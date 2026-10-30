/**
 * Variante: admin. Aba "Preparar máquina", acima de Usuários: o checklist do root. Cada item diz se está ok, o que
 * falta ou o que é humano (com o botão para a aba certa); um botão aplica tudo que falta, com o log ao vivo do job
 * (o mesmo canal do "Criar usuário"). Fábrica como claude-global-page.ts; o main confere tudo como root.
 */
import type { MeuBotApi, PrepararId, PrepararVisao } from "../../shared/ipc";
import { linhasPreparar } from "../lib/admin-view.js";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface PrepararPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  /** Abre a aba onde o passo humano se resolve. */
  abrirPagina(id: "claude-global" | "link-publico"): void;
  api: Pick<MeuBotApi, "adminPrepararEstado" | "adminPrepararAplicar" | "on">;
}

export function mountPrepararPage(deps: PrepararPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let visao: PrepararVisao | null = null;
  let erro: string | null = null;
  let ocupado = false;
  let msg: { text: string; bad: boolean } | null = null;
  let jobLog: string[] = [];
  /** O Chromium entra no "aplicar" marcado (máquina compartilhada: o "gostinho" do Pro inclui navegar na tela). */
  let chromium = true;

  deps.api.on("admin:usuarios-progresso", (p) => {
    if (!ocupado) return;
    if (/^(●|○|\s*(Active|Loaded|Main PID|Tasks|Memory|CPU|CGroup):)/.test(p.line)) return;
    jobLog.push(p.line); if (jobLog.length > 200) jobLog = jobLog.slice(-200); render();
  });

  async function ler(): Promise<void> {
    erro = null; render();
    try { visao = await deps.api.adminPrepararEstado(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  async function aplicar(ids: PrepararId[] | undefined): Promise<void> {
    ocupado = true; msg = null; jobLog = []; render();
    try {
      visao = await deps.api.adminPrepararAplicar(ids);
      const f = visao.falhas ?? [];
      msg = f.length === 0 ? { text: "✓ Máquina preparada.", bad: false } : { text: `✗ Não deu em: ${f.map((x) => `${x.id} (${x.motivo})`).join(" · ")}. O resto seguiu.`, bad: true };
    } catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; }
    finally { ocupado = false; render(); }
  }

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "preparar máquina"), el("h2", "", `Preparar máquina · ${deps.who}`),
      el("p", "", "Tudo que uma máquina precisa antes da primeira box, numa lista só: o que está ok, o que falta e o que depende de você (os logins do root). \"Criar usuário\" aplica sozinho o que falta; aqui você vê e aplica quando quiser. Nada reinicia o que já está no ar."));
    head.append(hb); panel.append(head);
    if (visao === null) { panel.append(erro !== null ? el("p", "hint bad-hint", `✗ ${erro}`) : espera("Lendo a máquina…")); return; }
    const v = visao;

    const card = el("div", "admin-card");
    const topo = el("div", "admin-card-head"); topo.append(el("strong", "", "O que a máquina precisa"));
    const at = el("button", "btn btn-ghost btn-small", "Atualizar"); at.type = "button"; at.disabled = ocupado; at.addEventListener("click", () => { void ler(); }); topo.append(at);
    card.append(topo);
    const ul = el("ul", "admin-health");
    const linhas = linhasPreparar(v);
    v.itens.forEach((it, i) => {
      const l = linhas[i]!;
      const li = el("li", l.ok === true ? "ok" : l.ok === false ? "bad" : "");
      li.append(l.text);
      if (l.step !== undefined) li.append(el("span", "admin-step", l.step));
      if (it.pagina !== undefined && it.estado !== "ok") {
        const b = el("button", "btn btn-ghost btn-small", `Abrir ${it.pagina === "claude-global" ? "Claude Code Global" : "Link Público Global"}`); b.type = "button"; b.style.marginLeft = "8px";
        const pagina = it.pagina; b.addEventListener("click", () => deps.abrirPagina(pagina));
        li.append(b);
      }
      ul.append(li);
    });
    card.append(ul);

    const chrom = v.itens.find((i) => i.id === "chromium");
    const podeChromium = chrom !== undefined && chrom.estado === "falta";
    if (podeChromium) {
      const lab = el("label", "hint"); const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.checked = chromium; cb.disabled = ocupado;
      cb.addEventListener("change", () => { chromium = cb.checked; render(); });
      lab.append(cb, " Instalar também o Chromium para a tela do bot (opcional; 300 a 600 MB de RAM por janela)");
      card.append(lab);
    }
    const n = v.faltam.length + (podeChromium && chromium ? 1 : 0);
    const acoes = el("div", "admin-actions");
    const b = el("button", "btn btn-primary btn-small", ocupado ? "Aplicando… (pode levar minutos)" : n === 0 ? "Nada a aplicar" : `Aplicar o que falta (${n})`); b.type = "button"; b.disabled = ocupado || n === 0;
    b.title = n === 0 ? "Tudo que dá para aplicar daqui já está feito; o resto é humano" : `Aplica na ordem: ${[...v.faltam, ...(podeChromium && chromium ? ["chromium"] : [])].join(" → ")}`;
    b.addEventListener("click", () => { void aplicar(podeChromium && chromium ? [...v.faltam, "chromium"] : undefined); });
    acoes.append(b); card.append(acoes);
    if (msg !== null) card.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (jobLog.length > 0) { const log = el("ul", "support-log"); for (const l of jobLog) log.append(el("li", "", l)); card.append(log); }
    panel.append(card);
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("preparar", `Preparar máquina · ${deps.who}`, panel, () => { render(); void ler(); });
      }
      deps.openPage(page);
    },
  };
}
