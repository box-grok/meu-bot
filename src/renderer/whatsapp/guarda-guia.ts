/** Guarda do WhatsApp no guia (tutorial 9): estado na máquina, ativar e o progresso do instalador. */
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Guarda do WhatsApp nesta máquina (tutorial 9): null = não consultado ou sem OpenClaw. */
export let guardaState: boolean | null = null;
let guardaBusy = false;
let guardaLog: string[] = [];
/** Último recado do passo "Ativar" (erro ou "Guarda ativa."); `setGuardaMsg` para quem muda de fora (o reset do tutorial). */
export let guardaMsg: { text: string; bad: boolean } | null = null;
export function setGuardaMsg(v: { text: string; bad: boolean } | null): void { guardaMsg = v; }

export async function refreshGuarda(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { guardaState = await window.meuBot.guardaInstalled(); } catch { /* máquina fora: fica o que havia */ }
  ctx.paintGuide();
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
    guardaBusy = true; guardaLog = []; guardaMsg = null; ctx.paintGuide();
    void window.meuBot.installGuarda()
      .then((r) => { guardaMsg = r.ok ? { text: "Guarda ativa.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { guardaMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { guardaBusy = false; void refreshGuarda(); });
  });
  row.append(b);
  box.append(row);
  if (guardaState === null) box.append(carregando("Consultando a máquina…", "guia-guarda"));
  if (guardaBusy && guardaLog.length > 0) box.append(el("pre", "admin-logs", guardaLog.join("\n")));
  if (guardaMsg !== null) box.append(el("p", `hint ${guardaMsg.bad ? "guide-pair-note" : "audio-ok"}`, guardaMsg.text));
  container.append(box);
}

/** Liga o passo da guarda ao guia e o progresso do instalador; o renderer.ts chama uma vez. */
export function ligarGuardaGuia(): void {
  registrarPassos({ "guarda-install": (txt) => renderGuardaInstall(txt) });
  window.meuBot.on("guarda:progress", ({ line }) => { guardaLog = [...guardaLog, line].slice(-6); if (guardaBusy) ctx.paintGuide(); });
}
