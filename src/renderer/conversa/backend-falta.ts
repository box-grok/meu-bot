/**
 * Máquina sem o backend do meu-bot: em vez de mandar a pessoa ao seletor, a própria janela oferece "Instalar backend"
 * (o mesmo instalador do seletor), mostra o progresso e, ao terminar, o túnel recomeça e o tutorial segue sozinho.
 * O mesmo cartão aparece na conversa (quando uma mensagem falha por isso) e no topo do tutorial aberto.
 */
import type { BackendStatusEvent } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { Tab } from "../renderer.js";
import { ctx } from "../app/ctx.js";

/** Começo do erro "sem backend" (src/main/maquina/tunnel.ts, SEM_BACKEND_MSG). */
const SEM_BACKEND_RE = /^Esta máquina ainda não tem o backend do meu-bot/;

/** null = ainda não se sabe; true = falta o backend nesta máquina. */
let falta: boolean | null = null;
let ocupado = false;
let linhas: string[] = [];
let recado: { text: string; bad: boolean } | null = null;
/** Cartões montados na conversa: repintados a cada mudança (os do tutorial vêm da repintura do guia). */
const montados = new Set<HTMLElement>();

export const backendFalta = (): boolean => falta === true;

function repintar(): void {
  for (const c of montados) {
    if (!c.isConnected) { montados.delete(c); continue; }
    c.replaceChildren(); desenhar(c);
  }
  if (ctx.tutorialsReady) ctx.paintGuide();
}

/** Pergunta à máquina (pela sondagem do seletor) se o backend está lá. Este Mac: sempre está. */
export async function conferirBackend(): Promise<void> {
  // Este Mac não usa backend por SSH; o admin não instala na máquina da pessoa (sem o canal, sem o cartão).
  if (ctx.windowHost === "" || ctx.windowHost === "local" || !ctx.caps.install) { falta = false; return; }
  try { falta = !(await window.meuBot.backendPresente()); } catch { /* sem resposta: fica o que se sabia */ }
  repintar();
}

/** Estado do túnel: "sem backend" liga o cartão; túnel no ar desliga. */
export function backendStatusVisto(st: BackendStatusEvent): void {
  if (st.host !== ctx.windowHost || !ctx.caps.install) return;
  const antes = falta;
  if (st.semBackend === true) falta = true;
  else if (st.state === "ready") falta = false;
  if (falta !== antes) repintar();
}

function desenhar(box: HTMLElement): void {
  box.append(el("strong", "", "Esta máquina ainda não tem o backend do meu-bot"));
  box.append(el("p", "hint", "É ele que roda o Claude Code aqui e responde às suas mensagens. A instalação leva alguns minutos; depois é só seguir de onde parou."));
  const b = el("button", "btn btn-primary btn-small", ocupado ? "Instalando…" : recado?.bad === true ? "Tentar de novo" : "Instalar backend");
  b.type = "button"; b.disabled = ocupado;
  b.addEventListener("click", () => { void instalar(); });
  box.append(b);
  if (ocupado && linhas.length > 0) box.append(el("pre", "admin-logs", linhas.slice(-12).join("\n")));
  if (recado !== null) box.append(el("p", `hint ${recado.bad ? "guide-pair-note" : "audio-ok"}`, recado.text));
}

async function instalar(): Promise<void> {
  if (ocupado) return;
  ocupado = true; linhas = []; recado = null; repintar();
  try {
    const r = await window.meuBot.installBackend();
    if (r.ok) { falta = false; recado = { text: "✓ Backend instalado. Pode seguir: mande a mensagem de novo.", bad: false }; }
    else recado = { text: r.log.at(-1) ?? "a instalação falhou", bad: true };
  } catch (err) {
    recado = { text: ipcErrorText(err), bad: true };
  } finally {
    ocupado = false;
    repintar();
  }
}

/** No tutorial: o cartão vai no topo enquanto faltar o backend (o recado de sucesso fica até a próxima repintura). */
export function renderBackendInstall(container: HTMLElement): void {
  if (falta !== true && !ocupado && recado === null) return;
  if (falta !== true && recado !== null && !recado.bad) { container.append(el("p", "hint audio-ok", recado.text)); return; }
  const box = el("div", "guide-note backend-falta");
  desenhar(box);
  container.append(box);
}

/** Na conversa: quando a mensagem falhou por falta do backend, o cartão com o botão vai logo abaixo do erro. */
export function offerBackendInstall(tab: Tab, text: string): void {
  if (!SEM_BACKEND_RE.test(text) || !ctx.caps.install) return;
  falta = true;
  const box = el("div", "notice notice-warn backend-falta");
  montados.add(box);
  desenhar(box);
  tab.messagesEl.appendChild(box);
  ctx.scrollToBottom(tab, false);
  if (ctx.tutorialsReady) ctx.paintGuide();
}

/** Progresso do instalador (o mesmo do seletor), linha a linha. */
export function ligarBackendFalta(): void {
  window.meuBot.on("backend:install-progress", ({ line }) => { linhas.push(line); repintar(); });
}
