/** Helper de DOM: h("div", {class, onClick, …}, ...filhos). */
type Filho = Node | string | null | undefined | false;
type Props = Record<string, unknown> | null;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = null, ...filhos: Filho[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props !== null) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v as Record<string, string>);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
    else if (k === "checked" && "checked" in el) (el as HTMLInputElement).checked = v === true;
    else if (k === "disabled" && "disabled" in el) (el as HTMLButtonElement).disabled = v === true;
    else if (k === "selected" && "selected" in el) (el as HTMLOptionElement).selected = v === true;
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const f of filhos) { if (f === null || f === undefined || f === false) continue; el.append(typeof f === "string" ? document.createTextNode(f) : f); }
  return el;
}
export const limpar = (el: HTMLElement): void => { while (el.firstChild) el.firstChild.remove(); };
/** Texto com as URLs (http/https ou "site.com.br/...") viradas em links que abrem em aba nova (no app: aba do Navegador). */
export function comLinks(texto: string): DocumentFragment {
  const f = document.createDocumentFragment(); const re = /\b(https?:\/\/[^\s<>"')]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|com\.br|net|org|br|io|app|dev|co)(?:\/[^\s<>"')]*)?)/gi;
  let i = 0;
  for (const m of texto.matchAll(re)) {
    const u = m[0].replace(/[.,;:!?]+$/, ""); const at = m.index ?? 0;
    if (at > 0 && texto[at - 1] === "@") continue; // e-mail, não site
    f.append(texto.slice(i, at), h("a", { href: /^https?:/i.test(u) ? u : `https://${u}`, target: "_blank", rel: "noopener" }, u));
    i = at + u.length;
  }
  f.append(texto.slice(i));
  return f;
}
/** Botão ↗ ao lado de um campo com endereço (site, LinkedIn, Instagram). */
export function linkExterno(valor: string, base = ""): HTMLElement | null {
  const v = valor.trim(); if (v === "") return null;
  const url = /^https?:\/\//i.test(v) ? v : base !== "" && !v.includes(".") ? `${base}${v.replace(/^@/, "")}` : `https://${v.replace(/^@/, "")}`;
  return h("a", { class: "mbcrm-icone mbcrm-mini", href: url, target: "_blank", rel: "noopener", title: `Abrir ${url}` }, "↗");
}

/** Entrega ao navegador um arquivo que veio da API em base64 (anexos da caixa, conversas arquivadas). */
export function salvarBase64(r: { nome: string; tipo: string; base64: string }): void {
  const bin = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: r.tipo }));
  const l = h("a", { href: url, download: r.nome }); document.body.append(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
