/**
 * Conta meu-bot deste Mac, lado da tela: guarda a última ContaView que o main mandou, avisa quem desenha com ela
 * (painel "Sua conta" das Configurações, bloqueio Pro do Navegador) e monta o bloco "Entrar / e-mail · Sair".
 */
import type { ContaView } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { resumoPlano } from "../lib/conta-resumo.js";

let view: ContaView | null = null;
const ouvintes = new Set<() => void>();
export const contaAtual = (): ContaView | null => view;
export const contaEntrou = (): boolean => view !== null && view.situacao === "dentro";
export function aoMudarConta(cb: () => void): () => void { ouvintes.add(cb); return () => ouvintes.delete(cb); }
const mudou = (v: ContaView): void => { view = v; for (const cb of ouvintes) cb(); };
/** Na abertura: pega a conta e passa a receber as mudanças. */
export function ligarConta(): void {
  window.meuBot.on("conta:changed", mudou);
  void window.meuBot.contaGet().then(mudou).catch(() => undefined);
  ligarMenuConta();
}

/* ---------- Avatar no topo + menu da conta (molde Rambox) ---------- */
const inicial = (c: ContaView["conta"]): string => (c === null ? "?" : (c.nome ?? c.email).trim().charAt(0).toUpperCase() || "?");
const fotoOk = (v: ContaView): string | null => (v.foto !== null && v.foto.startsWith("data:image/") ? v.foto : null);
let menu: HTMLElement | null = null;
/** O avatar existe nas duas barras (cheia e mini): a que estiver visível é a que a pessoa clica. */
const botoes = (): HTMLButtonElement[] => ["conta-btn", "conta-btn-mini"].map((id) => document.getElementById(id) as HTMLButtonElement | null).filter((b): b is HTMLButtonElement => b !== null);
function fecharMenu(): void { if (menu !== null) { menu.remove(); menu = null; } for (const b of botoes()) b.setAttribute("aria-expanded", "false"); }
function pintarAvatar(): void {
  const v = view;
  for (const b of botoes()) {
    b.hidden = v === null;
    if (v === null) continue;
    b.replaceChildren();
    const c = v.conta;
    if (v.situacao === "dentro" && c !== null) {
      b.classList.remove("fora");
      const foto = fotoOk(v);
      if (foto !== null) { const img = document.createElement("img"); img.src = foto; img.alt = ""; b.append(img); } else b.textContent = inicial(c);
      b.title = `${c.email} · ${resumoPlano(c).rotulo}`;
    } else { b.classList.add("fora"); b.textContent = "⚇"; b.title = v.situacao === "entrando" ? "Aguardando o login no navegador…" : "Entrar com sua conta meu-bot"; }
  }
}
function item(ico: string, texto: string, cls: string, acao: () => void, atalho?: string): HTMLButtonElement {
  const b = el("button", `cm-item${cls === "" ? "" : ` ${cls}`}`); b.type = "button";
  b.append(el("span", "cm-ico", ico), el("span", "", texto));
  if (atalho !== undefined) { const k = el("span", "cm-atalho", atalho); k.style.marginLeft = "auto"; k.style.color = "var(--muted)"; k.style.fontSize = "11px"; b.append(k); }
  b.addEventListener("click", () => { fecharMenu(); acao(); });
  return b;
}
function abrirMenu(b: HTMLButtonElement): void {
  const v = view;
  if (v === null) return;
  if (menu !== null) { fecharMenu(); return; }
  const m = el("div", "conta-menu"); m.setAttribute("role", "menu");
  const c = v.conta;
  const externo = (caminho: string): void => { void window.meuBot.openExternal(`${v.urlConsole}${caminho}`).catch(() => undefined); };
  if (v.situacao === "dentro" && c !== null) {
    const r = resumoPlano(c);
    const topo = el("div", "cm-topo");
    const av = el("div", "cm-avatar"); const foto = fotoOk(v); if (foto !== null) { const img = document.createElement("img"); img.src = foto; img.alt = ""; av.append(img); } else av.textContent = inicial(c);
    topo.append(av, el("span", `cm-selo ${r.selo}`, r.rotulo), el("span", "cm-nome", c.nome ?? c.email));
    if (c.nome !== null) topo.append(el("span", "cm-email", c.email));
    m.append(topo);
    if (r.prazo !== null) m.append(item(r.vencido ? "⚠" : "🎁", r.prazo, `cm-trial${r.vencido ? " vencido" : ""}`, () => externo("/account/plan")));
    m.append(item("👤", "Perfil", "", () => externo("/account/profile")), item("▤", "Plano e pagamento", "", () => externo("/account/plan")), item("▭", "Devices", "", () => externo("/account/devices")));
    if (c.admin !== null) m.append(item("★", "Console do admin", "", () => externo("/account/overview")));
    m.append(el("div", "cm-sep"));
  } else {
    m.append(el("div", "cm-dica", v.situacao === "entrando" ? "Aguardando o login no navegador…" : "Você ainda não entrou com sua conta meu-bot neste Mac."));
    if (v.situacao === "entrando") m.append(item("✕", "Cancelar o login", "", () => { void window.meuBot.contaCancelar().then(mudou).catch(() => undefined); }));
    else m.append(item("→", "Entrar com Google ou e-mail", "", () => { void window.meuBot.contaEntrar().then(mudou).catch(() => undefined); }));
    if (v.situacao === "erro" && v.erro !== null) m.append(el("div", "cm-dica", `O último login não terminou: ${v.erro}`));
    m.append(el("div", "cm-sep"));
  }
  m.append(item("⚙", "Configurações", "", () => ctx.settingsBtn.click(), "⌘,"), item("▦", "Tutoriais", "", () => ctx.openPage(ctx.tutoriaisPage)), item("📣", "Novidades", "", () => { void window.meuBot.openExternal("https://github.com/diegofornalha/meu-bot/blob/main/docs/CHANGELOG.md").catch(() => undefined); }));
  if (v.situacao === "dentro") { m.append(el("div", "cm-sep"), item("⏻", "Sair", "cm-sair", () => { void window.meuBot.contaSair().then(mudou).catch(() => undefined); })); }
  document.body.append(m);
  const r = b.getBoundingClientRect();
  m.style.top = `${Math.round(r.bottom + 6)}px`;
  m.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  b.setAttribute("aria-expanded", "true");
  menu = m;
}
function ligarMenuConta(): void {
  for (const b of botoes()) b.addEventListener("click", (ev) => { ev.stopPropagation(); abrirMenu(b); });
  document.addEventListener("click", (ev) => { if (menu !== null && !menu.contains(ev.target as Node)) fecharMenu(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && menu !== null) fecharMenu(); });
  window.addEventListener("resize", fecharMenu);
  aoMudarConta(() => { pintarAvatar(); if (menu !== null) { fecharMenu(); } });
  pintarAvatar();
}

/** O bloco da conta para o painel "Sua conta": botão Entrar, "aguardando o navegador", ou e-mail com Sair. */
export function blocoConta(): HTMLElement {
  const box = el("div", "conta-bloco");
  const pinta = (): void => {
    box.replaceChildren();
    const c = view;
    if (c === null) { box.append(el("p", "hint", "Lendo a conta…")); return; }
    if (c.situacao === "dentro" && c.conta !== null) {
      const linha = el("p", "", "");
      linha.append(el("strong", "", c.conta.email), document.createTextNode(c.conta.nome !== null ? ` · ${c.conta.nome}` : ""), document.createTextNode(c.conta.admin !== null ? " · admin" : ""));
      const sair = el("button", "btn btn-ghost", "Sair"); sair.type = "button";
      sair.addEventListener("click", () => { sair.disabled = true; void window.meuBot.contaSair().then(mudou).catch((err: unknown) => { sair.disabled = false; box.append(el("p", "error", `Não consegui sair: ${ipcErrorText(err)}`)); }); });
      const acoes = el("div", "actions"); acoes.append(sair);
      const este = c.conta.devices.find((d) => d.este);
      box.append(linha, el("p", "hint", `Plano da conta: ${c.conta.licenca.plan === "pro" ? "Pro" : "Free"} · ${c.conta.devices.length} device${c.conta.devices.length === 1 ? "" : "s"}${c.conta.pedidos > 0 ? ` · ${c.conta.pedidos} pedido${c.conta.pedidos === 1 ? "" : "s"} aberto${c.conta.pedidos === 1 ? "" : "s"}` : ""}. Nesta versão a licença da máquina ainda vem do backend dela.`));
      if (este !== undefined && este.status === "pending") box.append(el("p", "error", `Este Mac aguarda a liberação do admin: a conta já usa ${c.conta.licenca.deviceLimit} device${c.conta.licenca.deviceLimit === 1 ? "" : "s"}.`));
      box.append(acoes);
      return;
    }
    if (c.situacao === "entrando") {
      const cancelar = el("button", "btn btn-ghost", "Cancelar"); cancelar.type = "button";
      cancelar.addEventListener("click", () => { void window.meuBot.contaCancelar().then(mudou).catch(() => undefined); });
      const acoes = el("div", "actions"); acoes.append(cancelar);
      box.append(el("p", "", "Aguardando o login no navegador…"), el("p", "hint", `A página ${c.urlLogin.replace(/^https:\/\//, "")} abriu no seu navegador. Entre com o Google ou peça o link por e-mail; o app volta sozinho quando terminar.`), acoes);
      return;
    }
    const entrar = el("button", "btn btn-primary", "Entrar com Google ou e-mail"); entrar.type = "button";
    entrar.addEventListener("click", () => { entrar.disabled = true; void window.meuBot.contaEntrar().then(mudou).catch((err: unknown) => { entrar.disabled = false; box.append(el("p", "error", `Não consegui abrir o login: ${ipcErrorText(err)}`)); }); });
    const acoes = el("div", "actions"); acoes.append(entrar);
    box.append(el("p", "", "Você ainda não entrou com sua conta meu-bot neste Mac."), el("p", "hint", "O login abre no seu navegador e volta para o app sozinho. O plano free continua funcionando sem conta."));
    if (c.situacao === "erro" && c.erro !== null) box.append(el("p", "error", `O último login não terminou: ${c.erro}`));
    box.append(acoes);
  };
  pinta();
  // Enquanto o bloco está na tela, repinta a cada mudança (o deep link chega com o painel aberto).
  const solta = aoMudarConta(() => { if (box.isConnected) pinta(); else solta(); });
  return box;
}
