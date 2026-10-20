/** O que o usuário abriu por último (pipelines e caixas), guardado no navegador; a lista em si é pura. */
export const MAX_RECENTES = 20;
export const CHAVE_PIPELINES = "mbcrm:recentes:pipelines";
export const CHAVE_CAIXAS = "mbcrm:recentes:caixas";

/** Põe `key` na frente, sem repetir, cortando em `max`. */
export const lembrar = (lista: string[], key: string, max = MAX_RECENTES): string[] => [key, ...lista.filter((k) => k !== key)].slice(0, max);

export function ler(chave: string): string[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
export function registrar(chave: string, key: string): void {
  try { localStorage.setItem(chave, JSON.stringify(lembrar(ler(chave), key))); } catch { /* sem storage: só não lembra */ }
}
