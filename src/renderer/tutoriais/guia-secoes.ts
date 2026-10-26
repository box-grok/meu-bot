import type { ObjectiveChoice, ContaEstado, ContaId, StatusLineSegments, SupportInfo, SupportShare, ContaEvento } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { browserAccess, financeOk, proBlockText } from "../lib/pro.js";
import { hostLabel } from "../lib/probe-text.js";
import { previewLine, SL_TEST_COMMAND } from "../lib/status-line.js";
import { type GuideContext, grupoAlvo, OBJECTIVE_OPTIONS, LEVEL_OPTIONS, fallbackOrderText, FALLBACK_PRIMARIES } from "../lib/tutoriais.js";
import { ctx } from "../app/ctx.js";

let supportBusy = false;
const supportGroup = $<HTMLDetailsElement>("support-group");
const supportBody = $<HTMLElement>("support-body");
/** Liga sozinho uma vez por janela (máquina por SSH com o pacote), a não ser que o admin tenha desligado. */
let supportAutoTried = false;
let supportMsg: { text: string; bad: boolean } | null = null;
/** Código de suporte revelado (plano B; some ao fechar as Configurações ou esconder). */
let supportCodeShown: string | null = null;
let supportPoll: number | null = null;
/** Status line do Claude nesta máquina: instalada? (null = ainda não consultado); limites = a conta já tem números. */
let statusLineState: boolean | null = null;
/** Guarda do WhatsApp nesta máquina (tutorial 8): null = não consultado ou sem OpenClaw. */
let guardaState: boolean | null = null;
export let navInstState: boolean | null = null;
let navInstBusy = false;
let navInstLog: string[] = [];
let navInstMsg: { text: string; bad: boolean } | null = null;
let guardaBusy = false;
let guardaLog: string[] = [];
let statusLineBusy = false;
let statusLineLog: string[] = [];
let statusLineMsg: { text: string; bad: boolean } | null = null;
const accountHasLimits = (): boolean => ctx.account !== null && (ctx.account.sessionPct !== null || ctx.account.weeklyPct !== null);
let statusLineSegsBusy = false;
let statusLineSegsMsg: string | null = null;
/** Alguma conversa desta máquina já teve resposta do agente (o index só tem conversas do windowHost). */
export const firstReplyOnHost = (): boolean => [...ctx.index.values()].some((c) => c.messages.some((m) => m.role === "assistant"));
export const guideCtx = (): GuideContext => ({
  support: ctx.supportState,
  statusLine: { installed: statusLineState, limits: accountHasLimits(), segments: ctx.statusLineSegs },
  claude: { loggedIn: ctx.clAuth?.loggedIn ?? null, email: ctx.clAuth?.email ?? null, firstReply: firstReplyOnHost() },
  xai: {
    possible: !ctx.caps.install || ctx.windowHost === "local" ? false : ctx.xaiAuth !== null ? true : ctx.xaiKey === null ? null : ctx.xaiKey.backend,
    hermes: ctx.xaiAuth !== null ? true : ctx.xaiKey === null ? null : false,
    loggedIn: ctx.xaiAuth?.loggedIn ?? null, label: ctx.xaiAuth?.email ?? null,
  },
  fallback: { primary: ctx.backendModelSelect.value === "" ? null : ctx.backendModelSelect.value, chain: ctx.account?.providers ?? null },
  guarda: { installed: guardaState, possible: ctx.waStatus === null ? null : ctx.waStatus.capacidades.guarda },
  navegador: { access: !ctx.navLicenseAsked ? null : browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto), installed: navInstState, tabs: ctx.navTabs.filter((t) => t.url !== "" && !t.url.startsWith("about:")).length, extensions: ctx.navExtensions.length, agentOn: ctx.navAgent.on && ctx.navAgent.state === "up", servicos: ctx.navServicosCount(), extensaoEmbutida: ctx.navExtensions.some((x) => x.embutida === true) },
  notify: { enabled: ctx.settings?.navNotify.enabled === true, conversas: [...ctx.index.values()].filter((c) => (c.title ?? "").startsWith("🔔 ") && !c.archived).length },
  objective: ctx.objectiveState,
  crm: { access: !ctx.navLicenseAsked ? null : browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto), info: ctx.crmState, local: ctx.crmLocalState },
  grupos: (() => { const alvo = grupoAlvo(ctx.waGroups, ctx.loadGrupoAlvo()); return { info: ctx.waGroups, alvo: ctx.loadGrupoAlvo(), respondeu: alvo !== null && (alvo.agenteRespondeu === true || ctx.waGroupReplied.get(alvo.jid) === true) }; })(),
  contas: contasState,
  finance: { access: ctx.navLicenseAsked ? financeOk(ctx.license, ctx.windowHost) : null, info: ctx.financeState },
  produto: (() => { const proprio = ctx.crmProprio() && ctx.motorCrm() === "proprio"; return { planoExigido: ctx.caps.planoExigido, crmProprio: proprio, crmStreak: !proprio }; })(),
  // Fonte "conhecida" = a consulta desta janela já respondeu, ou ela não se aplica aqui (este Mac, sem o pacote,
  // máquina sem OpenClaw). Consulta que falhou deixa null: continua desconhecida, não vira "não feito".
  known: (() => {
    const remote = ctx.caps.install && ctx.windowHost !== "" && ctx.windowHost !== "local";
    return {
      whatsapp: ctx.waStatus !== null,
      claude: ctx.clAuth !== null,
      statusline: statusLineState !== null || !ctx.caps.install || ctx.windowHost === "",
      xai: !remote || ctx.xaiAuth !== null || ctx.xaiKey !== null,
      fallback: ctx.account !== null,
      support: ctx.supportState !== null || !ctx.caps.supportClient || ctx.windowHost === "" || ctx.windowHost === "local",
      objective: ctx.objectiveState !== null || !remote,
      guarda: guardaState !== null || !remote || (ctx.waStatus !== null && !ctx.waStatus.capacidades.guarda),
      navegador: ctx.navLicenseAsked && (navInstState !== null || !remote),
      crm: ctx.navLicenseAsked && (ctx.crmState !== null || !remote) && (!ctx.crmProprio() || !remote || ctx.crmLocalState !== null),
      grupos: ctx.waGroups !== null || !remote || (ctx.waStatus !== null && !ctx.waStatus.capacidades.grupos),
      contas: contasState !== null || !remote,
      finance: ctx.navLicenseAsked && (!remote || !financeOk(ctx.license, ctx.windowHost) || ctx.financeState !== null),
    };
  })(),
});

/** Tutorial 7, passo 1: cartões de objetivo + frase, "Salvar objetivo" grava na máquina. */
export function renderObjectiveChoice(container: HTMLElement): void {
  const cur = ctx.objectiveState?.objective ?? null;
  const draft = ctx.objectiveDraft ?? (cur === null ? null : { id: cur.id, text: cur.text });
  const cards = el("div", "reply-cards guide-cards");
  for (const o of OBJECTIVE_OPTIONS) {
    const on = draft?.id === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = ctx.objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.label));
    if (cur?.id === o.id) title.append(el("span", "reply-default", "Salvo"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { ctx.objectiveDraft = { id: o.id, text: draft?.id === o.id ? draft.text : (cur?.id === o.id ? cur.text : "") }; ctx.paintGuide(); });
    cards.append(card);
  }
  container.append(cards);
  const row = el("div", "support-name");
  const opt = OBJECTIVE_OPTIONS.find((o) => o.id === draft?.id) ?? null;
  const input = el("input"); input.type = "text"; input.maxLength = 300; input.disabled = ctx.objectiveBusy || draft === null;
  input.placeholder = opt?.needsText === true ? "Em uma frase: o que o agente deve resolver (obrigatório)" : "Complete em uma frase, se quiser";
  input.value = draft?.text ?? "";
  input.addEventListener("input", () => { if (ctx.objectiveDraft !== null) ctx.objectiveDraft.text = input.value; else if (draft !== null) ctx.objectiveDraft = { id: draft.id, text: input.value }; });
  const save = el("button", "btn btn-primary btn-small", cur === null ? "Salvar objetivo" : "Salvar mudança"); save.type = "button";
  save.disabled = ctx.objectiveBusy || draft === null || (opt?.needsText === true && input.value.trim() === "");
  input.addEventListener("input", () => { save.disabled = ctx.objectiveBusy || (opt?.needsText === true && input.value.trim() === ""); });
  save.addEventListener("click", () => {
    if (draft === null || opt === null) return;
    const choice: ObjectiveChoice = { id: opt.id, label: opt.label, text: input.value.trim() };
    void ctx.objectiveDo(() => window.meuBot.setObjective({ objective: choice }), null).then(() => { ctx.objectiveDraft = null; ctx.paintGuide(); });
  });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !save.disabled) { ev.preventDefault(); save.click(); } });
  row.append(input, save);
  container.append(row);
  if (ctx.objectiveMsg !== null && ctx.objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${ctx.objectiveMsg.text}`));
}
/** Tutorial 7, passo 2: os três níveis; clicar grava na hora (como "quem o agente responde"). */
export function renderObjectiveLevel(container: HTMLElement): void {
  const cur = ctx.objectiveState?.level ?? null;
  const cards = el("div", "reply-cards guide-cards");
  for (const o of LEVEL_OPTIONS) {
    const on = cur === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = ctx.objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (cur !== o.id) void ctx.objectiveDo(() => window.meuBot.setObjective({ level: o.id }), null); });
    cards.append(card);
  }
  container.append(cards);
  if (ctx.objectiveMsg !== null && ctx.objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${ctx.objectiveMsg.text}`));
}
/** Tutorial 7, passo 3: resumo do que vai para a skill e o botão que grava no workspace do agente. */
export function renderObjectiveSkill(container: HTMLElement): void {
  const st = ctx.objectiveState;
  const box = el("div", "audio-controls");
  if (st?.objective !== null && st?.objective !== undefined && st.level !== null) {
    const lv = LEVEL_OPTIONS.find((l) => l.id === st.level);
    box.append(el("div", "hint", `🎯 ${st.objective.label}${st.objective.text !== "" ? `: ${st.objective.text}` : ""}`), el("div", "hint", `🔒 ${lv?.title ?? st.level}`));
  }
  const save = el("button", "btn btn-primary btn-small", ctx.objectiveBusy ? "Salvando…" : st?.savedAt === null || st?.savedAt === undefined ? "Salvar como skill no Acervo" : "Salvar de novo"); save.type = "button";
  save.disabled = ctx.objectiveBusy || st?.objective === null || st?.level === null;
  save.addEventListener("click", () => { void ctx.objectiveDo(async () => { const r = await window.meuBot.saveObjectiveSkill(); ctx.objectiveMsg = { text: r.detail, bad: false }; return r; }, "skill salva"); });
  const row = el("div", "support-name"); row.append(save);
  if (st?.savedAt !== null && st?.savedAt !== undefined) {
    const open = el("button", "btn btn-ghost btn-small", "Abrir o Acervo"); open.type = "button";
    open.addEventListener("click", () => ctx.openPage(ctx.acervoPage));
    row.append(open);
  }
  box.append(row);
  if (ctx.objectiveMsg !== null) box.append(el("p", `hint${ctx.objectiveMsg.bad ? " bad" : " ok"}`, `${ctx.objectiveMsg.bad ? "✗" : "✓"} ${ctx.objectiveMsg.text}`));
  container.append(box);
}
/**
 * Passo "Escolher primário e reserva" (tutorial 5): a mesma escolha de Configurações › Fallback, salva na hora
 * (o modelo padrão desta máquina muda), com a linha da corrente e o estado das duas contas.
 */
export function renderFallbackOrder(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const accounts = el("div", "sl-switches");
  const line = (ok: boolean | null, text: string): HTMLElement => el("div", `hint${ok === true ? " ok" : ok === false ? " bad" : ""}`, `${ok === true ? "✓" : ok === false ? "✗" : "•"} ${text}`);
  accounts.append(
    line(ctx.clAuth?.loggedIn ?? null, `Claude Code${ctx.clAuth?.email ? `: ${ctx.clAuth.email}` : ""} → modelo agente`),
    line(ctx.xaiAuth?.loggedIn ?? null, `xAI${ctx.xaiAuth?.email ? `: ${ctx.xaiAuth.email}` : ""} → modelo grok-4`),
  );
  const label = el("label", "", "Primário nesta máquina ");
  const sel = el("select");
  for (const [value, text] of [["claude", "Claude (agente)"], ["xai", "xAI (grok-4)"]] as const) { const o = el("option", "", text); o.value = value; sel.append(o); }
  const cur = ctx.backendModelSelect.value;
  if (cur === "grok-4") sel.value = "xai"; else if (cur === "agente") sel.value = "claude"; else { const o = el("option", "", `outro (${cur || "sem modelo"}): fora da corrente`); o.value = "other"; o.disabled = true; sel.append(o); sel.value = "other"; }
  label.append(sel);
  const hint = el("p", "hint", fallbackOrderText(cur, ctx.account?.providers ?? null));
  sel.addEventListener("change", () => {
    const m = ctx.PRIMARY_OF[sel.value];
    if (m === undefined) return;
    sel.disabled = true;
    void window.meuBot.setSettings({ backendModelForHost: m }).then((view) => {
      ctx.applySettings(view); ctx.backendModelSelect.value = m; ctx.syncPrimaryFromModel(); ctx.paintFallbackOrder();
      ctx.saveGuideFlag(ctx.FALLBACK_TUTORIAL, "fallbackChosen"); ctx.paintGuide();
    }).catch((err: unknown) => { hint.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { sel.disabled = false; });
  });
  const keep = el("button", "btn btn-small", "Manter assim"); keep.type = "button";
  keep.title = "A escolha atual já serve: o primário fica como está";
  keep.hidden = !FALLBACK_PRIMARIES.includes(cur) || ctx.loadGuideFlags(ctx.FALLBACK_TUTORIAL).fallbackChosen;
  keep.addEventListener("click", () => { ctx.saveGuideFlag(ctx.FALLBACK_TUTORIAL, "fallbackChosen"); ctx.paintGuide(); });
  box.append(accounts, label, hint, keep);
  container.append(box);
}
export async function refreshNavInst(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { navInstState = await window.meuBot.navegadorInstalled(); } catch { /* máquina fora: fica o que havia */ }
  ctx.paintGuide();
}
/** Tutorial 9, passo 2: instalar o lado da máquina (MCP + regra). */
export function renderNavInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  if (navInstState === true && !navInstBusy) row.append(el("span", "audio-ok", "✓ pronto nesta máquina"));
  const b = el("button", `btn ${navInstState === true ? "btn-ghost" : "btn-primary"} btn-small`, navInstBusy ? "Preparando…" : navInstState === true ? "Reinstalar" : "Preparar");
  b.type = "button"; b.disabled = navInstBusy || navInstState === null;
  b.addEventListener("click", () => {
    navInstBusy = true; navInstLog = []; navInstMsg = null; ctx.paintGuide();
    void window.meuBot.installNavegador()
      .then((r) => { navInstMsg = r.ok ? { text: "Máquina pronta: o agente já tem as ações do navegador.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { navInstMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { navInstBusy = false; void refreshNavInst(); });
  });
  row.append(b);
  box.append(row);
  if (navInstState === null) box.append(el("p", "hint", "Consultando a máquina…"));
  if (navInstBusy && navInstLog.length > 0) box.append(el("pre", "admin-logs", navInstLog.join("\n")));
  if (navInstMsg !== null) box.append(el("p", `hint ${navInstMsg.bad ? "guide-pair-note" : "audio-ok"}`, navInstMsg.text));
  container.append(box);
}
/** Tutorial 9, passo 1: o plano desta máquina e o pedido ao admin. */
export function renderNavPro(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const a = browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);
  if (a === "ok") { box.append(el("p", "audio-ok", ctx.caps.planoExigido === "free" ? `✓ plano Pro ativo em ${hostLabel(ctx.windowHost)}` : `✓ assinatura do ${ctx.caps.produto} ativa em ${hostLabel(ctx.windowHost)}`)); container.append(box); return; }
  const t = proBlockText(a, ctx.license, "navegador", ctx.caps.produto);
  box.append(el("p", "hint", t.text));
  const row = el("div", "audio-row");
  if (t.askAdmin) {
    const b = el("button", "btn btn-primary btn-small", ctx.navAskedPro ? "Pedido enviado ao admin ✓" : a === "assinatura" ? "Avisar o admin" : "Pedir o Pro ao admin"); b.type = "button"; b.disabled = ctx.navAskedPro;
    b.addEventListener("click", () => { b.disabled = true; void window.meuBot.browserRequestPro().then(() => { ctx.navAskedPro = true; ctx.paintGuide(); }).catch(() => { b.disabled = false; }); });
    row.append(b);
  }
  const again = el("button", "btn btn-ghost btn-small", "Conferir de novo"); again.type = "button";
  again.addEventListener("click", () => { void ctx.refreshLicense().then(() => ctx.paintGuide()); });
  row.append(again);
  box.append(row);
  container.append(box);
}
/**
 * Link de uma mensagem: site (http/https) abre numa aba do Navegador do próprio app, onde o agente também enxerga;
 * Cmd+clique, outros esquemas (mailto:…) ou Navegador indisponível (sem módulo/assinatura) → navegador do Mac.
 */
export async function abrirLinkDoChat(url: string, externo: boolean): Promise<void> {
  if (externo || !ctx.caps.navegador || !/^https?:\/\//i.test(url)) { void window.meuBot.openExternal(url); return; }
  await ctx.openNavTab(url);
  if (ctx.navAccess !== "ok" || ctx.navPartition === null) void window.meuBot.openExternal(url);
}
/** Tutorial 9, passo 3: abrir a aba do Navegador. */
export function renderNavOpen(container: HTMLElement, url?: string): void {
  const row = el("div", "audio-row");
  const b = el("button", "btn btn-primary btn-small", url !== undefined ? "Abrir o Gmail no Navegador" : ctx.navTabs.length > 0 ? "Ir para o Navegador" : "Abrir o Navegador"); b.type = "button";
  b.addEventListener("click", () => { void ctx.openNavTab(url); });
  row.append(b);
  container.append(row);
}
export async function refreshGuarda(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { guardaState = await window.meuBot.guardaInstalled(); } catch { /* máquina fora: fica o que havia */ }
  ctx.paintGuide();
}
/** Tutorial 13: contas de CLI desta máquina (null = ainda não consultado) e o login em andamento. */
let contasState: ContaEstado[] | null = null;
let contaLogin: { id: ContaId; trocar: boolean; url: string | null; codigo: string | null; texto: string; rodando: boolean; ok: boolean | null } | null = null;
export async function refreshContas(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { const r = await window.meuBot.contasStatus(); if (r !== null) contasState = r; } catch { /* máquina fora: fica o que havia */ }
  ctx.paintGuide();
}
/** O link do login abre no Navegador do app: é por ele que o retorno do Cloudflare chega ao localhost da máquina. */
const navegadorPronto = (): boolean => ctx.caps.chat && ctx.caps.navegador && browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto) === "ok";
async function entrarConta(id: ContaId, trocar = false): Promise<void> {
  if (contaLogin?.rodando === true) return;
  contaLogin = { id, trocar, url: null, codigo: null, texto: "Pedindo o login na máquina…", rodando: true, ok: null };
  ctx.paintGuide();
  try { await window.meuBot.contasEntrar(id, navegadorPronto(), trocar); }
  catch (err) { contaLogin = { ...contaLogin, texto: `✗ ${ipcErrorText(err)}`, ok: false }; }
  finally { if (contaLogin !== null) contaLogin.rodando = false; ctx.paintGuide(); }
}
export function renderConta(container: HTMLElement, id: ContaId): void {
  const box = el("div", "audio-controls");
  const st = contasState?.find((c) => c.id === id) ?? null;
  const login = contaLogin?.id === id ? contaLogin : null;
  const row = el("div", "audio-row");
  if (contasState === null) row.append(el("span", "hint", "Consultando a máquina…"));
  else if (st !== null && !st.presente) row.append(el("span", "hint", id === "github" ? "O GitHub CLI (gh) não está instalado nesta máquina." : "Esta máquina não tem o Node (npx) para o Cloudflare."));
  else {
    if (st?.conectado === true) row.append(el("span", "audio-ok", `✓ conectado${st.conta !== null ? ` · ${st.conta}` : ""}`));
    // Conectada: "Trocar de conta" (outra conta); "Conectar de novo" só quando o acesso é amplo (mesma conta, só sites).
    const conectada = st?.conectado === true;
    if (!conectada || st?.amplo === true || login?.rodando === true) {
      const b = el("button", `btn ${conectada ? "btn-ghost" : "btn-primary"} btn-small`, login?.rodando === true ? "Esperando a autorização…" : conectada ? "Conectar de novo (só sites)" : "Conectar"); b.type = "button";
      b.disabled = contaLogin?.rodando === true;
      b.addEventListener("click", () => { void entrarConta(id); });
      row.append(b);
    }
    if (conectada && login?.rodando !== true) {
      const t = el("button", "btn btn-ghost btn-small", "Trocar de conta"); t.type = "button";
      t.disabled = contaLogin?.rodando === true;
      t.addEventListener("click", () => { void entrarConta(id, true); });
      row.append(t);
    }
    if (login?.rodando === true) {
      const c = el("button", "btn btn-ghost btn-small", "Cancelar"); c.type = "button";
      c.addEventListener("click", () => { void window.meuBot.contasCancelar(); });
      row.append(c);
    } else if (st?.conectado === true) {
      const sair = el("button", "btn btn-ghost btn-small", "Sair"); sair.type = "button";
      sair.addEventListener("click", () => ctx.armConfirm(sair, "Confirmar? o agente perde o acesso", () => {
        void window.meuBot.contasSair(id).then((r) => { if (r !== null) contasState = r; contaLogin = null; ctx.paintGuide(); });
      }));
      row.append(sair);
    }
  }
  box.append(row);
  if (st?.amplo === true && login?.rodando !== true) box.append(el("p", "hint", "Esta conta foi logada com acesso amplo (Workers, D1, e-mail…). \"Conectar de novo\" troca por um acesso só para sites."));
  if (login !== null) {
    box.append(el("p", login.ok === false ? "hint bad-hint" : "hint", login.texto));
    if (login.codigo !== null && login.rodando) {
      const cr = el("div", "audio-row");
      const code = el("code", "conta-codigo", login.codigo);
      const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
      copy.addEventListener("click", () => { void navigator.clipboard.writeText(login.codigo ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
      cr.append(code, copy);
      box.append(cr);
    }
    if (login.url !== null && login.rodando) {
      const again = el("button", "btn btn-ghost btn-small", "Abrir a página de novo"); again.type = "button";
      again.addEventListener("click", () => { if (login.url !== null) void abrirLinkDoChat(login.url, false); });
      box.append(again);
    }
  }
  container.append(box);
}
export function renderGuardaInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  // Agente que não aceita a guarda (capacidade): explica, sem botão que falharia na máquina.
  if (ctx.waStatus !== null && !ctx.waStatus.capacidades.guarda) { box.append(el("p", "hint", "O agente desta máquina não aceita a guarda do meu-bot; este tutorial não se aplica aqui.")); container.append(box); return; }
  const row = el("div", "audio-row");
  if (guardaState === true && !guardaBusy) row.append(el("span", "audio-ok", "✓ ativa nesta máquina"));
  const b = el("button", `btn ${guardaState === true ? "btn-ghost" : "btn-primary"} btn-small`, guardaBusy ? "Ativando…" : guardaState === true ? "Reinstalar" : "Ativar");
  b.type = "button"; b.disabled = guardaBusy || guardaState === null;
  b.addEventListener("click", () => {
    guardaBusy = true; guardaLog = []; ctx.guardaMsg = null; ctx.paintGuide();
    void window.meuBot.installGuarda()
      .then((r) => { ctx.guardaMsg = r.ok ? { text: "Guarda ativa.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { ctx.guardaMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { guardaBusy = false; void refreshGuarda(); });
  });
  row.append(b);
  box.append(row);
  if (guardaState === null) box.append(el("p", "hint", "Consultando a máquina…"));
  if (guardaBusy && guardaLog.length > 0) box.append(el("pre", "admin-logs", guardaLog.join("\n")));
  if (ctx.guardaMsg !== null) box.append(el("p", `hint ${ctx.guardaMsg.bad ? "guide-pair-note" : "audio-ok"}`, ctx.guardaMsg.text));
  container.append(box);
}
export async function refreshStatusLine(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "") return;
  try { statusLineState = await window.meuBot.statusLineInstalled(); } catch { /* máquina fora: fica o que havia */ }
  try { ctx.statusLineSegs = await window.meuBot.statusLineSegments(); } catch { /* idem */ }
  ctx.paintContext(ctx.active());
  ctx.paintGuide();
}
const SEGMENT_LABELS: { key: keyof StatusLineSegments; label: string; hint: string }[] = [
  { key: "model", label: "Modelo", hint: "qual modelo está respondendo" },
  { key: "ctx", label: "Contexto", hint: "quanto da janela de contexto já foi usado" },
  { key: "account", label: "Conta", hint: "e-mail e plano (Premium/Padrão)" },
  { key: "session", label: "Sessão", hint: "limite de 5 horas e quando reinicia" },
  { key: "weekly", label: "Semanal", hint: "limite de 7 dias e quando reinicia" },
];
/** Passo "Escolher o que aparece": cinco interruptores, prévia da linha, gravação na máquina a cada troca. */
export function renderStatusLineSegments(container: HTMLElement): void {
  const cur: StatusLineSegments = ctx.statusLineSegs ?? { model: true, ctx: true, account: true, session: true, weekly: true };
  const box = el("div", "audio-controls");
  box.append(el("code", "sl-preview", previewLine(cur) || "(nada ligado)"));
  const list = el("div", "sl-switches");
  for (const s of SEGMENT_LABELS) {
    const sw = el("label", "switch switch-row"); sw.title = s.hint;
    const inp = el("input"); inp.type = "checkbox"; inp.checked = cur[s.key]; inp.disabled = statusLineSegsBusy || statusLineState !== true;
    sw.append(inp, el("span", "track"), el("span", "switch-label", s.label));
    inp.addEventListener("change", () => {
      const next = { ...cur, [s.key]: inp.checked };
      if (!Object.values(next).some(Boolean)) { inp.checked = true; statusLineSegsMsg = "Deixe pelo menos um ligado."; ctx.paintGuide(); return; }
      statusLineSegsBusy = true; statusLineSegsMsg = null; ctx.statusLineSegs = next; ctx.paintContext(ctx.active()); ctx.paintGuide();
      void window.meuBot.setStatusLineSegments(next)
        .then((saved) => { ctx.statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; ctx.paintContext(ctx.active()); ctx.paintGuide(); });
    });
    list.append(sw);
  }
  box.append(list);
  // Nunca gravou nada (está no padrão): o passo só conclui quando a escolha vai para a máquina. O botão
  // grava a escolha atual, mesmo que seja o padrão; pulsa para dizer "é aqui".
  if (ctx.statusLineSegs === null && statusLineState === true) {
    const done = el("button", "btn btn-primary btn-small attention", statusLineSegsBusy ? "Gravando…" : "Concluir com esta escolha"); done.type = "button"; done.disabled = statusLineSegsBusy;
    done.title = "Grava a escolha nesta máquina e conclui o passo";
    done.addEventListener("click", () => {
      statusLineSegsBusy = true; statusLineSegsMsg = null; ctx.paintGuide();
      void window.meuBot.setStatusLineSegments(cur)
        .then((saved) => { ctx.statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; ctx.paintContext(ctx.active()); ctx.paintGuide(); });
    });
    box.append(done);
  }
  if (statusLineState !== true) box.append(el("p", "hint", "Instale a status line (passo 1) para escolher."));
  if (statusLineSegsBusy) box.append(el("p", "hint", "gravando na máquina…"));
  if (statusLineSegsMsg !== null) box.append(el("p", "hint guide-pair-note", statusLineSegsMsg));
  container.append(box);
}
/** Passo "Conferir no terminal": digita o teste do script num terminal desta máquina; a pessoa dá Enter. */
export function renderStatusLineTest(container: HTMLElement): void {
  const b = el("button", "btn btn-primary btn-small", "Testar no terminal"); b.type = "button";
  b.addEventListener("click", () => { void ctx.runInTerminal(SL_TEST_COMMAND, "bash", true); });
  container.append(b);
}
/** Passo "Instalar a status line": Instalar (ou ✓ + Reinstalar), progresso do instalador e erro no próprio passo. */
export function renderStatusLineInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  if (statusLineState === true && !statusLineBusy) row.append(el("span", "audio-ok", "✓ instalada nesta máquina"));
  const b = el("button", `btn ${statusLineState === true ? "btn-ghost" : "btn-primary"} btn-small`, statusLineBusy ? "Instalando…" : statusLineState === true ? "Reinstalar" : "Instalar");
  b.type = "button"; b.disabled = statusLineBusy || statusLineState === null;
  b.addEventListener("click", () => {
    statusLineBusy = true; statusLineLog = []; statusLineMsg = null; ctx.paintGuide();
    void window.meuBot.installStatusLine()
      .then((r) => { statusLineMsg = r.ok ? { text: "Status line instalada.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { statusLineMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { statusLineBusy = false; void refreshStatusLine(); });
  });
  row.append(b);
  box.append(row);
  if (statusLineState === null) box.append(el("p", "hint", "Consultando a máquina…"));
  if (statusLineBusy && statusLineLog.length > 0) box.append(el("pre", "admin-logs", statusLineLog.join("\n")));
  if (statusLineMsg !== null) box.append(el("p", `hint ${statusLineMsg.bad ? "guide-pair-note" : "audio-ok"}`, statusLineMsg.text));
  container.append(box);
}

export async function refreshSupportState(): Promise<void> {
  if (ctx.windowHost === "" || ctx.windowHost === "local" || !ctx.caps.supportClient) return;
  try { ctx.supportState = await window.meuBot.supportInfo(); } catch { /* sem resposta: fica o que havia */ }
  repaintSupport();
  const s = ctx.supportState;
  if (s !== null && s.available && !s.on && !s.blockedByAdmin && !supportBusy && !supportAutoTried) {
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), "Suporte ligado. Avisando o admin…");
  } else if (s !== null && s.available && s.on && s.staleId && !supportBusy && !supportAutoTried) {
    // Código antigo na máquina (id só pela chave): regrava para esta conta não se misturar com outra na mesma máquina.
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), null);
  }
}
export function paintSupport(): void {
  const s = ctx.supportState;
  supportGroup.hidden = s === null || !s.available;
  if (s === null || !s.available) return;
  supportBody.replaceChildren();
  supportBody.append(el("p", "hint", s.on
    ? `Ligado: o admin consegue entrar em ${hostLabel(ctx.windowHost)} para te ajudar. Tudo o que ele fizer aparece abaixo. Só o admin desliga.`
    : s.blockedByAdmin ? "Desligado pelo admin. Se quiser pedir suporte de novo, clique em Ligar o suporte."
      : "Ligando o suporte…"));
  renderSupportParts(supportBody, ["name", "share", "delivery", "log"]);
}
export function repaintSupport(): void {
  if (ctx.dialog.open) paintSupport();
  ctx.paintGuide();
  // Ligado e o aviso ainda não chegou: confere de novo em 10 s (a máquina entrega sozinha).
  if (supportPoll !== null) { clearTimeout(supportPoll); supportPoll = null; }
  if (ctx.supportState?.on === true && ctx.supportState.deliveredAt === null) supportPoll = window.setTimeout(() => { supportPoll = null; void refreshSupportState(); }, 10_000);
}
async function supportDo(run: () => Promise<SupportInfo>, ok: string | null): Promise<void> {
  supportBusy = true; supportMsg = null; repaintSupport();
  try { ctx.supportState = await run(); supportMsg = ok === null ? null : { text: ok, bad: false }; }
  catch (err) { supportMsg = { text: ipcErrorText(err), bad: true }; }
  finally { supportBusy = false; repaintSupport(); }
}

type SupportPart = "name" | "share" | "delivery" | "log";
const SHOW_SUPPORT_SHARE = false;
export function renderSupportParts(container: HTMLElement, parts: readonly SupportPart[]): void {
  const s = ctx.supportState;
  if (s === null || !s.available) return;
  if (parts.includes("name")) {
    const row = el("div", "support-name");
    // Vazio, já vem com a sugestão (git/usuário do Mac): salvar liga o suporte com um clique.
    const name = el("input"); name.type = "text"; name.placeholder = "Seu nome"; name.value = s.name !== "" ? s.name : s.suggestedName; name.maxLength = 40;
    name.disabled = supportBusy;
    const save = el("button", `btn ${s.on ? "btn-ghost" : "btn-primary"} btn-small`, s.on ? "Salvar nome" : "Ligar o suporte"); save.type = "button"; save.disabled = supportBusy;
    // Salvar o nome liga o suporte (ligado, só regrava o aviso com o nome novo). Não há interruptor para a pessoa
    // desligar: quem desliga é o admin, pela página Suporte.
    save.addEventListener("click", () => { void supportDo(() => window.meuBot.setSupport(true, name.value), s.on ? null : "Suporte ligado. Avisando o admin…"); });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save.click(); } });
    row.append(name, save);
    container.append(row, el("p", "hint", "É assim que o admin vai te ver (não é o nome da máquina)."));
  }
  // Escolha do que o admin vê: oculta por ora (poluía a tela); tudo segue compartilhado por padrão. SHOW_SUPPORT_SHARE religa.
  if (SHOW_SUPPORT_SHARE && parts.includes("share") && s.on) {
    container.append(el("p", "hint strong-hint", "O que o app do admin pode ver"));
    const SHARE_LABELS: { key: keyof SupportShare; label: string }[] = [
      { key: "progress", label: "Meu progresso nos tutoriais" },
      { key: "whatsapp", label: "O WhatsApp (estado e conversas, só leitura)" },
      { key: "logs", label: "Os registros do gateway e do backend" },
      { key: "chat", label: "Minhas conversas com o meu-bot (só leitura)" },
    ];
    const list = el("div", "support-share");
    for (const o of SHARE_LABELS) {
      const sw = el("label", "switch switch-row");
      const box = el("input"); box.type = "checkbox"; box.checked = s.share[o.key]; box.disabled = supportBusy;
      sw.append(box, el("span", "track"), el("span", "switch-label", o.label));
      box.addEventListener("change", () => { void supportDo(() => window.meuBot.setSupportShare({ ...s.share, [o.key]: box.checked }), null); });
      list.append(sw);
    }
    container.append(list);
  }
  // Backup completo pelo admin: sempre visível (é a única permissão desligada por padrão) e sempre escolha da pessoa.
  if (parts.includes("share") && s.on) {
    const sw = el("label", "switch switch-row");
    const box = el("input"); box.type = "checkbox"; box.checked = s.share.backup; box.disabled = supportBusy;
    sw.append(box, el("span", "track"), el("span", "switch-label", "Permitir backup completo pelo admin (para mudar de máquina; inclui a sessão do WhatsApp e seus logins)"));
    box.addEventListener("change", () => { void supportDo(() => window.meuBot.setSupportShare({ ...s.share, backup: box.checked }), null); });
    container.append(sw);
  }
  if (parts.includes("delivery") && s.on) {
    const box = el("div", "support-delivery");
    // "Avisar o admin agora": entrega o aviso na hora e o admin sincroniza (a máquina também avisa sozinha a cada 30 min).
    const now = el("button", "btn btn-ghost btn-small", supportBusy ? "Avisando…" : "Avisar o admin agora"); now.type = "button"; now.disabled = supportBusy;
    now.addEventListener("click", () => { void supportDo(() => window.meuBot.supportDeliver(), "Aviso entregue: o admin já vê esta máquina."); });
    if (s.deliveredAt !== null) { const row = el("div", "support-name"); row.append(el("p", "audio-ok", `✓ O admin recebeu o aviso (${new Date(s.deliveredAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}).`), now); box.append(row); }
    else {
      const wait = el("div", "wa-progress"); wait.append(el("span", "wa-pulse"), el("span", "grow", "Avisando o admin…"), now);
      box.append(wait);
    }
    // O código de suporte, para colar no meu-bot-admin ("Adicionar pessoa") quando a entrega automática não serve.
    const more = el("details", "support-more");
    more.open = supportCodeShown !== null;
    more.append(el("summary", "", "Código de suporte (para colar no meu-bot-admin)"));
    if (supportCodeShown === null) {
      const reveal = el("button", "btn btn-ghost btn-small", "Mostrar código"); reveal.type = "button";
      reveal.addEventListener("click", () => {
        reveal.disabled = true; reveal.textContent = "Gerando…";
        void window.meuBot.supportCode().then((code) => { supportCodeShown = code; repaintSupport(); })
          .catch((err: unknown) => { supportMsg = { text: ipcErrorText(err), bad: true }; repaintSupport(); });
      });
      more.append(reveal);
    } else {
      const code = el("textarea"); code.readOnly = true; code.rows = 3; code.value = supportCodeShown;
      code.addEventListener("focus", () => code.select());
      const copy = el("button", "btn btn-primary btn-small", "Copiar"); copy.type = "button";
      copy.addEventListener("click", () => { void navigator.clipboard.writeText(supportCodeShown ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
      more.append(code, copy, el("p", "hint", "Mande para o admin (WhatsApp, e-mail); ele cola em \"Adicionar pessoa\" no meu-bot-admin. Não é senha: diz só como o admin chega nesta máquina."));
    }
    box.append(more);
    container.append(box);
  }
  if (supportMsg !== null) container.append(el("p", `hint ${supportMsg.bad ? "guide-pair-note" : "audio-ok"}`, supportMsg.text));
  if (parts.includes("log") && s.log.length > 0) {
    // Registro de auditoria da máquina: por padrão só o que o suporte fez; "ver tudo" mostra também o que você, o
    // agente e o sistema fizeram.
    const box = el("div", "support-log-box");
    const draw = (): void => {
      const lista = supportLogAll ? s.log : s.log.filter((e) => e.tipo === "admin" || e.tipo === "legado");
      const head = el("p", "hint strong-hint", supportLogAll ? "Tudo o que aconteceu nesta máquina " : "O que o suporte fez nesta máquina ");
      const toggle = el("button", "btn btn-ghost btn-small", supportLogAll ? "só o suporte" : "ver tudo"); toggle.type = "button";
      toggle.addEventListener("click", () => { supportLogAll = !supportLogAll; draw(); });
      head.append(toggle);
      const ul = el("ul", "support-log");
      for (const e of lista) ul.append(el("li", "", `${new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${e.who}: ${e.what}`));
      if (lista.length === 0) ul.append(el("li", "", "O suporte ainda não fez nada nesta máquina."));
      box.replaceChildren(head, ul);
    };
    draw();
    container.append(box);
  }
}
/** "ver tudo" no registro da máquina (Configurações › Suporte). */
let supportLogAll = false;

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarGuiaSecoes(): void {
  window.meuBot.on("navegador:progress", ({ line }) => { navInstLog = [...navInstLog, line].slice(-6); if (navInstBusy) ctx.paintGuide(); });
  window.meuBot.on("contas:evento", (ev: ContaEvento) => {
    if (contaLogin === null || contaLogin.id !== ev.id) return;
    if (ev.kind === "url") {
      contaLogin.url = ev.url; contaLogin.codigo = ev.codigo;
      contaLogin.texto = contaLogin.trocar
        ? ev.id === "github" ? "A página abriu no Navegador: entre com a outra conta do GitHub, cole o código abaixo e autorize. A conta antiga sai desta máquina quando a nova entrar." : "A página abriu no Navegador, já fora da conta antiga: entre com a outra conta do Cloudflare e autorize."
        : ev.codigo !== null ? "A página abriu no Navegador: cole o código abaixo e autorize." : "A página abriu no Navegador: entre na conta e autorize. Aqui atualiza sozinho.";
      void abrirLinkDoChat(ev.url, false);
    } else if (ev.kind === "log") contaLogin.texto = ev.text;
    else {
      contaLogin.ok = ev.ok; contaLogin.texto = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      if (ev.estado != null) { const est = ev.estado; contasState = [...(contasState ?? []).filter((c) => c.id !== est.id), est]; }
    }
    ctx.paintGuide();
  });
  window.meuBot.on("guarda:progress", ({ line }) => { guardaLog = [...guardaLog, line].slice(-6); if (guardaBusy) ctx.paintGuide(); });
  window.meuBot.on("statusline:progress", ({ line }) => {
    statusLineLog = [...statusLineLog, line].slice(-6);
    ctx.paintGuide();
  });
}
