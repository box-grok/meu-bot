/**
 * Balão de informação: um ⓘ abre uma explicação curta, bem visível, por cima da tela; fecha em "Entendi", Esc ou
 * clicando fora. Um só por vez. Usado pelo "Copiar ID" (o que o ID é) e por quem mais precisar explicar algo.
 */
import { el } from "./dom.js";

let open: HTMLElement | null = null;

export function infoBalloon(title: string, text: string): void {
  closeInfoBalloon();
  const veil = el("div", "info-veil");
  const box = el("div", "info-balloon"); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", title);
  const ok = el("button", "btn btn-primary btn-small", "Entendi"); ok.type = "button";
  box.append(el("div", "info-balloon-title", `ⓘ ${title}`), el("p", "", text), ok);
  veil.append(box);
  const close = (): void => { veil.remove(); document.removeEventListener("keydown", onKey, true); if (open === veil) open = null; };
  const onKey = (ev: KeyboardEvent): void => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
  veil.addEventListener("click", (ev) => { if (ev.target === veil) close(); });
  ok.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(veil);
  open = veil;
  ok.focus();
}
export function closeInfoBalloon(): void { if (open !== null) { open.remove(); open = null; } }

/** O texto do ⓘ do "Copiar ID", igual nos dois apps. */
export const ID_INFO_TITLE = "O que é o ID da conversa";
export const ID_INFO_TEXT = "É o endereço desta conversa na máquina: a transcrição (.jsonl) que o Claude Code grava por lá. Cole numa IA, ou mande para alguém, para encontrar exatamente esta conversa, sem adivinhar.";
