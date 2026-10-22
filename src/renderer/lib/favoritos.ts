/**
 * Barra de favoritos do Navegador: a lista mora no main (por máquina) e chega por `browserOpen`/`browser:favorites`;
 * aqui ficam só as regras de exibição. Puro, sem DOM.
 */
import type { NavFavorito } from "../../shared/ipc.js";

/** Rótulo curto do botão: título, senão host + começo do caminho. */
export function favLabel(f: NavFavorito, max = 22): string {
  let base = f.titulo.trim();
  if (base === "") { try { const u = new URL(f.url); base = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`; } catch { base = f.url; } }
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}
/** O favorito desta url (igualdade exata, sem o "#" final solto). */
export const favOf = (list: NavFavorito[], url: string): NavFavorito | null => list.find((f) => f.url === url || f.url === url.replace(/#$/, "")) ?? null;
/** Título sugerido ao favoritar a aba: o da página, limpo de sufixos longos como " - Gmail"; vazio vira o host. */
export function favTitleFor(pageTitle: string, url: string): string {
  const t = pageTitle.replace(/\s+/g, " ").trim();
  if (t !== "") return t.slice(0, 60);
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 60); }
}
