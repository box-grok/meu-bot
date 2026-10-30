/**
 * Variante: admin. Aba "Link Público Global", abaixo do Claude Code Global: cada usuário desta máquina com um link
 * `https://<nome>.<domínio>/` servido pela pasta dele, atrás de um Cloudflare Tunnel do root (sem abrir porta). A gestão
 * é só daqui: instalar (nginx + cloudflared com o domínio), entrar na Cloudflare (o link abre no navegador deste Mac;
 * esta aba confirma sozinha), subir o túnel e ligar ou desligar o link por usuário. O nome do link cada pessoa troca
 * no meu-bot dela (tutorial 17). Fábrica como claude-global-page.ts; o main confere tudo como root.
 */
import type { LpEstado, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface LinkPublicoPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminLinkPublico" | "adminLinkPublicoInstalar" | "adminLinkPublicoEntrar" | "adminLinkPublicoTunel" | "adminLinkPublicoUsuario" | "on">;
}

/** Domínio sugerido quando a máquina ainda não tem um (o da Karen). */
export const DOMINIO_SUGERIDO = "agentesgrok.com";
const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** O passo em que a máquina está, para a aba contar a história em ordem. */
export function etapaLp(e: LpEstado): "instalar" | "entrar" | "tunel" | "pronto" {
  if (!e.instalado) return "instalar";
  if (!e.login) return "entrar";
  if (e.tunel === null || !e.servico) return "tunel";
  return "pronto";
}

export function mountLinkPublicoPage(deps: LinkPublicoPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let estado: LpEstado | null = null;
  let erro: string | null = null;
  let ocupado: string | null = null;
  let msg: { text: string; bad: boolean } | null = null;
  let dominio: string | null = null;
  /** Link de login aberto nesta sessão (a página mostra para copiar se o navegador não abriu). */
  let loginUrl: string | null = null;
  let vigia: ReturnType<typeof setInterval> | null = null;

  async function ler(): Promise<void> {
    erro = null; render();
    try { estado = await deps.api.adminLinkPublico(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  async function rodar(chave: string, f: () => Promise<LpEstado | void>, ok: string): Promise<boolean> {
    ocupado = chave; msg = null; render();
    try { const r = await f(); if (r) estado = r; msg = { text: ok, bad: false }; return true; }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; return false; }
    finally { ocupado = null; render(); }
  }
  /** Acompanha o login aberto no navegador: relê a cada 10 s até o cert chegar ou 15 min. */
  function vigiar(): void {
    if (vigia !== null) clearInterval(vigia);
    const ate = Date.now() + 15 * 60_000;
    vigia = setInterval(() => {
      if (Date.now() > ate) { if (vigia !== null) clearInterval(vigia); vigia = null; return; }
      void deps.api.adminLinkPublico().then((e) => { estado = e; if (e.login && vigia !== null) { clearInterval(vigia); vigia = null; loginUrl = null; msg = { text: "✓ Login na Cloudflare confirmado. Agora suba o túnel.", bad: false }; } render(); }).catch(() => { /* tenta de novo */ });
    }, 10_000);
  }
  // A aba Usuários liga o link da conta nova no fim do onboarding: a lista daqui relê sozinha.
  let releitura: ReturnType<typeof setTimeout> | null = null;
  deps.api.on("admin:usuarios-progresso", (p) => {
    if (page === null || !/link público|^pronto|^✗ parou|^usuário .* criado/.test(p.line)) return;
    if (releitura !== null) clearTimeout(releitura);
    releitura = setTimeout(() => { releitura = null; if (ocupado === null) void ler(); }, 1500);
  });
  const botao = (rotulo: string, chave: string, primario = false): HTMLButtonElement => {
    const b = el("button", `btn ${primario ? "btn-primary" : "btn-ghost"} btn-small`, ocupado === chave ? "…" : rotulo) as HTMLButtonElement;
    b.type = "button"; b.disabled = ocupado !== null; return b;
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "link público global"), el("h2", "", `Link Público Global · ${deps.who}`),
      el("p", "", "Cada usuário desta máquina ganha um link público próprio (https://<nome>.<domínio>/) servido pela pasta ~/publico dele, atrás de um túnel da Cloudflare do root: a máquina não abre porta nenhuma. O agente de cada um dá links com o comando `publicar`; o nome do link a pessoa troca no meu-bot dela (tutorial 17)."));
    head.append(hb); panel.append(head);
    if (estado === null) { panel.append(erro !== null ? el("p", "hint bad-hint", `✗ ${erro}`) : espera("Lendo o Link Público Global…")); return; }
    const e = estado; const etapa = etapaLp(e);

    // 1. Instalação (nginx + cloudflared) com o domínio.
    const inst = el("div", "admin-card"); inst.append(el("strong", "", "1. Domínio e instalação"));
    if (!e.instalado) {
      inst.append(el("p", "hint", "O domínio precisa estar numa conta da Cloudflare (DNS dela): os links serão <nome>.<domínio>. Instala o nginx (só em 127.0.0.1) e o cloudflared."));
      const row = el("div", "admin-actions");
      const i = el("input") as HTMLInputElement; i.type = "text"; i.placeholder = DOMINIO_SUGERIDO; i.value = dominio ?? DOMINIO_SUGERIDO; i.style.width = "220px"; i.disabled = ocupado !== null;
      i.addEventListener("input", () => { dominio = i.value; });
      const b = botao("Instalar o Link Público Global", "instalar", true);
      b.addEventListener("click", () => {
        const d = (dominio ?? DOMINIO_SUGERIDO).trim().toLowerCase();
        if (!DOMINIO_RE.test(d)) { msg = { text: "✗ Domínio inválido: use algo como agentesgrok.com.", bad: true }; render(); return; }
        void rodar("instalar", () => deps.api.adminLinkPublicoInstalar(d), `✓ Instalado para *.${d}. Agora entre na Cloudflare.`);
      });
      row.append(i, b); inst.append(row);
    } else {
      inst.append(el("p", "", `Links em https://<nome>.${e.dominio ?? "?"}/ · nginx ${e.nginx ? "no ar (127.0.0.1)" : "parado"}`));
      const b = botao("Atualizar a instalação", "instalar"); b.title = "Refaz nginx, cloudflared, comandos e modelos (idempotente)";
      b.addEventListener("click", () => { if (e.dominio !== null) void rodar("instalar", () => deps.api.adminLinkPublicoInstalar(e.dominio!), "✓ Instalação atualizada."); });
      inst.append(b);
    }
    panel.append(inst);

    // 2. Login do root na Cloudflare.
    if (e.instalado) {
      const cf = el("div", "admin-card"); cf.append(el("strong", "", "2. Conta da Cloudflare do root"));
      if (!e.login) {
        cf.append(el("p", "hint", "O login abre no navegador deste Mac: entre na conta que tem o domínio, escolha a zona dele e autorize. A máquina baixa o certificado sozinha e esta aba confirma."));
        const b = botao(e.loginUrl !== null || loginUrl !== null ? "Abrir o login de novo" : "Entrar na Cloudflare", "entrar", true);
        b.addEventListener("click", () => { void rodar("entrar", async () => { loginUrl = (await deps.api.adminLinkPublicoEntrar()).url; }, "Login aberto no navegador. Esta aba confirma sozinha quando terminar.").then((ok) => { if (ok) vigiar(); }); });
        cf.append(b);
        const u = loginUrl ?? e.loginUrl;
        if (u !== null) {
          const row = el("div", "audio-row");
          const code = el("code", "conta-codigo", u); code.style.wordBreak = "break-all";
          const copy = el("button", "btn btn-ghost btn-small", "Copiar o link"); copy.type = "button";
          copy.addEventListener("click", () => { void navigator.clipboard.writeText(u).then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar o link"; }, 1500); }); });
          row.append(code, copy); cf.append(el("p", "hint", "Se o navegador não abriu, copie o link:"), row);
        }
      } else cf.append(el("p", "", "✓ O root está logado na Cloudflare (certificado em /root/.cloudflared)."));
      panel.append(cf);
    }

    // 3. Túnel e rota curinga.
    if (e.instalado && e.login) {
      const tn = el("div", "admin-card"); tn.append(el("strong", "", "3. Túnel"));
      if (etapa === "tunel") {
        tn.append(el("p", "hint", `Cria o túnel "meu-bot-publico", aponta *.${e.dominio ?? "?"} para ele no DNS da Cloudflare e sobe o serviço (cloudflared) que religa sozinho.`));
        const b = botao("Subir o túnel", "tunel", true);
        b.addEventListener("click", () => { void rodar("tunel", () => deps.api.adminLinkPublicoTunel(), "✓ Túnel no ar. Os links dos usuários ligados já funcionam."); });
        tn.append(b);
      } else {
        tn.append(el("p", "", `✓ Túnel ${e.tunel ?? "?"} no ar · DNS *.${e.dominio ?? "?"} ${e.rota ? "apontado" : "ainda não resolve (propagando?)"}`));
        const b = botao("Conferir o túnel", "tunel"); b.title = "Regrava a configuração, a rota e reinicia o serviço";
        b.addEventListener("click", () => { void rodar("tunel", () => deps.api.adminLinkPublicoTunel(), "✓ Túnel conferido."); });
        tn.append(b);
      }
      panel.append(tn);
    }

    // 4. Usuários.
    if (e.instalado) {
      const us = el("div", "admin-card");
      const cab = el("div", "admin-actions"); cab.append(el("strong", "", "Usuários com link"));
      const atualizar = botao("Atualizar", "ler"); atualizar.addEventListener("click", () => { void ler(); });
      cab.append(atualizar); us.append(cab);
      if (etapa !== "pronto") us.append(el("p", "hint", "Dá para ligar já; os links só abrem na internet depois do túnel."));
      if (e.usuarios.length === 0) us.append(el("p", "hint", "Nenhum usuário de login além do root."));
      else {
        const tu = el("table", "usuarios-tabela");
        const hu = el("tr"); for (const h of ["Usuário", "Link", "No ar", ""]) hu.append(el("th", "", h)); tu.append(hu);
        for (const u of e.usuarios) {
          const tr = el("tr");
          const link = u.ligado && u.link !== null ? `https://${u.link}.${e.dominio ?? "?"}/` : null;
          const tdLink = el("td", "");
          if (link !== null) { const a = el("a", "", link) as HTMLAnchorElement; a.href = link; a.target = "_blank"; a.rel = "noopener"; tdLink.append(a); } else tdLink.append(el("span", "hint", "desligado"));
          tr.append(el("td", "", u.nome), tdLink, el("td", "", u.ligado ? `${u.arquivos} ${u.arquivos === 1 ? "item" : "itens"}` : "—"));
          const td = el("td", "");
          const b = botao(u.ligado ? "Desligar" : "Ligar", `usuario:${u.nome}`, !u.ligado);
          b.title = u.ligado ? "O link sai do ar (os arquivos ficam guardados); a skill e o comando somem para o agente dele" : "Cria a pasta ~/publico dele, a skill do Hermes e o bloco no CLAUDE.md; o agente dele passa a dar links";
          b.addEventListener("click", () => { void rodar(`usuario:${u.nome}`, () => deps.api.adminLinkPublicoUsuario(u.nome, !u.ligado), u.ligado ? `✓ Link de ${u.nome} desligado.` : `✓ Link de ${u.nome} ligado: o agente dele já dá links com \`publicar\`.`); });
          td.append(b); tr.append(td); tu.append(tr);
        }
        const rolo = el("div", "usuarios-rolo"); rolo.append(tu); us.append(rolo);
      }
      panel.append(us);
    }
    if (msg !== null) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("link-publico", `Link Público Global · ${deps.who}`, panel, () => { render(); void ler(); });
      }
      deps.openPage(page);
    },
  };
}
