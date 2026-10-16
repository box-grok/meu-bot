/** Criar e achar elementos. Puro no sentido de não guardar estado; precisa de `document`. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `document.getElementById` que acusa o id errado em vez de devolver null. */
export function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`#${id} não existe`);
  return node as T;
}
