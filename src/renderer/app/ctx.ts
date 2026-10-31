/**
 * Ponte tardia entre o renderer.ts (raiz de composição) e as páginas por domínio: o renderer registra aqui, com
 * getters, o que as páginas usam dele; as páginas importam só este arquivo (nunca o renderer.ts em tempo de execução),
 * então não há import circular. Só vale depois de o renderer.ts começar a rodar: código de página que roda no
 * carregamento do módulo não pode usar ctx.
 */
import type { AppCtx } from "../renderer.js";

export const ctx = {} as AppCtx;

/** Janela de uma máquina por SSH (nem este Mac, nem o seletor): o que depende da máquina só se aplica aqui. */
export const ehRemoto = (): boolean => ctx.caps.install && ctx.windowHost !== "" && ctx.windowHost !== "local";
