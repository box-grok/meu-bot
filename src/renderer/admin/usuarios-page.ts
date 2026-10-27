/**
 * Variante: admin. Aba "Usuários" da janela de uma pessoa, abaixo de Auditoria: só numa máquina em que o admin entra
 * como root. Lista os usuários de login (com sudo, meu-bot e chave) e cria usuários comuns, sem sudo, com a chave SSH
 * deste Mac. O main acha a máquina pela janela e confere o nome; a tela só pede. Fábrica como auditoria-page.ts.
 */
import type { MeuBotApi, UsuariosVisao } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface UsuariosPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminUsuarios" | "adminUsuarioCriar">;
}
const NOME_RE = /^[a-z][a-z0-9_-]{1,31}$/;

export function mountUsuariosPage(deps: UsuariosPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let visao: UsuariosVisao | null = null;
  let erro: string | null = null;
  let ocupado = false;
  let nome = "";
  let msg: { text: string; bad: boolean } | null = null;

  async function ler(): Promise<void> {
    erro = null; render();
    try { visao = await deps.api.adminUsuarios(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  async function criar(): Promise<void> {
    const n = nome.trim();
    if (!NOME_RE.test(n)) { msg = { text: "Nome inválido: minúsculas, números, - ou _, começando por letra (2 a 32).", bad: true }; render(); return; }
    ocupado = true; msg = null; render();
    try { visao = await deps.api.adminUsuarioCriar(n); msg = { text: `✓ Usuário ${n} criado (sem sudo), com a chave SSH deste Mac.`, bad: false }; nome = ""; }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; }
    finally { ocupado = false; render(); }
  }

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "usuários"), el("h2", "", `Usuários · ${deps.who}`), el("p", "", "Os usuários de login desta máquina. Os novos são comuns (sem sudo): cada um mexe só na própria conta. O acesso é pela chave SSH deste Mac."));
    head.append(hb); panel.append(head);

    const form = el("div", "admin-card"); form.append(el("strong", "", "Criar usuário"));
    const linha = el("div", "admin-actions");
    const input = el("input") as HTMLInputElement; input.type = "text"; input.placeholder = "nome (ex.: maria)"; input.value = nome; input.maxLength = 32; input.disabled = ocupado;
    input.autocapitalize = "off"; input.spellcheck = false;
    input.addEventListener("input", () => { nome = input.value.toLowerCase(); if (input.value !== nome) input.value = nome; });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void criar(); });
    const b = el("button", "btn btn-primary btn-small", ocupado ? "Criando…" : "Criar"); b.type = "button"; b.disabled = ocupado;
    b.addEventListener("click", () => { void criar(); });
    linha.append(input, b); form.append(linha);
    if (msg !== null) form.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    panel.append(form);

    const lista = el("div", "admin-card");
    const topo = el("div", "admin-actions"); topo.append(el("strong", "grow", "Usuários de login"));
    const at = el("button", "btn btn-ghost btn-small", "Atualizar"); at.type = "button"; at.addEventListener("click", () => { void ler(); }); topo.append(at);
    lista.append(topo);
    if (erro !== null) lista.append(el("p", "hint bad-hint", erro));
    else if (visao === null) lista.append(espera("Lendo os usuários da máquina…"));
    else if (visao.usuarios.length === 0) lista.append(el("p", "hint", "Nenhum usuário de login além do root."));
    else {
      const t = el("table", "auditoria-tabela");
      const cab = el("tr"); for (const h of ["Usuário", "Sudo", "meu-bot", "Chave SSH", "Entrar"]) cab.append(el("th", "", h)); t.append(cab);
      for (const u of visao.usuarios) {
        const tr = el("tr");
        const acesso = visao.hostname !== null ? `ssh ${u.nome}@${visao.hostname}${visao.port !== null && visao.port !== "22" ? ` -p ${visao.port}` : ""}` : "";
        tr.append(el("td", "", u.nome), el("td", "", u.sudo ? "sim" : "não"), el("td", "", u.meuBot ? "instalado" : "—"), el("td", "", u.chave ? "sim" : "não"), el("td", "", acesso));
        t.append(tr);
      }
      lista.append(t);
    }
    panel.append(lista);
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("usuarios", `Usuários · ${deps.who}`, panel, () => { render(); void ler(); });
      }
      deps.openPage(page);
    },
  };
}
