/** Menu suspenso preso a um botão (como os ▾ do Streak); fecha com clique fora, Esc ou ao escolher. */
import { h } from "./h.ts";

export type ItemMenu = [rotulo: string, acao: () => void, perigo?: boolean, extra?: { cor?: string; marcado?: boolean }];
let aberto: (() => void) | null = null;

export function abrirMenu(ancora: HTMLElement, itens: ItemMenu[], largura?: number): void {
  aberto?.();
  const tema = ancora.closest(".mbcrm")?.className.split(/\s+/).filter((c) => c === "mbcrm-escuro").join(" ") ?? "";
  const el = h("div", { class: `mbcrm mbcrm-suspenso ${tema}`, role: "menu" }, ...itens.map(([rotulo, acao, perigo, extra]) => h("button", { class: [perigo === true ? "mbcrm-perigo" : "", extra?.marcado === true ? "mbcrm-marcado" : ""].join(" ").trim() || null, role: "menuitem", onClick: () => { fechar(); acao(); } }, extra?.cor ? h("span", { class: "mbcrm-mini-chev", style: { background: extra.cor } }) : null, h("span", { class: "mbcrm-cresce" }, rotulo), extra?.marcado === true ? h("span", { class: "mbcrm-check" }, "✓") : null)));
  const r = ancora.getBoundingClientRect();
  if (largura !== undefined) el.style.minWidth = `${largura}px`;
  Object.assign(el.style, { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 240))}px` });
  document.body.append(el);
  const fora = (ev: Event): void => { if (!el.contains(ev.target as Node) && !ancora.contains(ev.target as Node)) fechar(); };
  const tecla = (ev: KeyboardEvent): void => { if (ev.key === "Escape") fechar(); };
  function fechar(): void { el.remove(); document.removeEventListener("mousedown", fora, true); document.removeEventListener("keydown", tecla, true); removeEventListener("scroll", fechar, true); aberto = null; }
  setTimeout(() => { document.addEventListener("mousedown", fora, true); document.addEventListener("keydown", tecla, true); addEventListener("scroll", fechar, true); }, 0);
  aberto = fechar;
}
