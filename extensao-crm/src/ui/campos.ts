/** Editores por tipo de campo. Data = <input type=date> (sem showPicker, que falha no webview) com fallback texto. */
import type { Campo, CaixaFicha } from "../tipos.ts";
import { h } from "./h.ts";

/** dd/mm/aaaa ou yyyy-mm-dd → yyyy-mm-dd para o <input type=date>; "" se não parece data. */
export function paraInputData(texto: string): string {
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim()); if (br) return `${br[3]}-${String(br[2]).padStart(2, "0")}-${String(br[1]).padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(texto.trim()) ? texto.trim() : "";
}
/** yyyy-mm-dd → dd/mm/aaaa (o host entende os dois). */
export const deInputData = (v: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : v; };

/** O valor bruto que o host guarda, a partir da ficha (fields da view vêm formatados por nome). */
export function valorExibido(ficha: CaixaFicha, campo: Campo): string { return ficha.box.fields[campo.name] ?? ""; }

export function editorCampo(campo: Campo, valor: string, salvar: (novo: unknown) => Promise<void>): HTMLElement {
  const commit = async (el: HTMLInputElement | HTMLSelectElement, novo: unknown): Promise<void> => { el.disabled = true; try { await salvar(novo); } finally { el.disabled = false; } };
  if (campo.type === "DROPDOWN" || campo.type === "TAG") {
    const sel = h("select", { ...(campo.type === "TAG" ? { multiple: "multiple" } : {}) }, ...(campo.type === "TAG" ? [] : [h("option", { value: "" }, "—")]), ...campo.options.map((o) => h("option", { value: o.key, selected: valor.split(", ").includes(o.name) }, o.name)));
    sel.addEventListener("change", () => { const v = campo.type === "TAG" ? [...sel.selectedOptions].map((o) => o.value) : sel.value; void commit(sel, v); });
    return sel;
  }
  if (campo.type === "CHECKBOX") { const c = h("input", { type: "checkbox", checked: valor === "sim" }); c.addEventListener("change", () => { void commit(c, c.checked); }); return c; }
  if (campo.type === "DATE") {
    const i = h("input", { type: "date", value: paraInputData(valor) });
    i.addEventListener("change", () => { void commit(i, i.value === "" ? "" : deInputData(i.value)); });
    return i;
  }
  const i = h("input", { type: campo.type === "NUMBER" ? "text" : "text", value: valor, inputmode: campo.type === "NUMBER" ? "decimal" : "text" });
  i.addEventListener("change", () => { void commit(i, i.value); });
  return i;
}
