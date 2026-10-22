/**
 * Permissões de câmera e microfone das páginas do Navegador, como o Brave e o Chrome: o site pede, a janela mostra um
 * balão ("Permitir sempre neste site", "Permitir desta vez", "Não permitir") e a escolha permanente fica por origem
 * (https://accounts.google.com). Puro: testável com node --test. Quem pergunta e grava é nav-permissoes.ts.
 */
export type TipoMidia = "camera" | "microfone";
export type Decisao = "sempre" | "agora" | "nunca";
/** origem → tipo → true (permitido sempre) | false (nunca). Ausente = perguntar. */
export type PermissoesGuardadas = Record<string, Partial<Record<TipoMidia, boolean>>>;

/** "https://accounts.google.com/v3/signin?x" → "https://accounts.google.com"; null se não for http(s). */
export function origemDe(url: string): string | null {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null; } catch { return null; }
}
/** mediaTypes do Electron ("video", "audio") → os tipos daqui; vazio (pedido genérico) conta como câmera e microfone. */
export function tiposDe(mediaTypes: readonly string[] | undefined): TipoMidia[] {
  const t = new Set<TipoMidia>();
  for (const m of mediaTypes ?? []) { if (m === "video") t.add("camera"); else if (m === "audio") t.add("microfone"); }
  return t.size === 0 ? ["camera", "microfone"] : [...t].sort();
}
/** O que já foi decidido para todos os tipos pedidos: "permitir", "negar" ou "perguntar" (algum ainda sem escolha). */
export function decisaoGuardada(g: PermissoesGuardadas, origem: string, tipos: readonly TipoMidia[]): "permitir" | "negar" | "perguntar" {
  const o = g[origem] ?? {};
  if (tipos.some((t) => o[t] === false)) return "negar";
  return tipos.every((t) => o[t] === true) ? "permitir" : "perguntar";
}
/** Grava "sempre"/"nunca" (o "agora" não fica guardado). */
export function guardar(g: PermissoesGuardadas, origem: string, tipos: readonly TipoMidia[], d: Decisao): PermissoesGuardadas {
  if (d === "agora") return g;
  const o = { ...(g[origem] ?? {}) };
  for (const t of tipos) o[t] = d === "sempre";
  return { ...g, [origem]: o };
}
export function esquecer(g: PermissoesGuardadas, origem: string): PermissoesGuardadas { const { [origem]: _x, ...resto } = g; return resto; }
/** Lê o arquivo sem confiar nele: só origens http(s) e valores booleanos. */
export function parsePermissoes(v: unknown): PermissoesGuardadas {
  const out: PermissoesGuardadas = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (origemDe(k) !== k || x === null || typeof x !== "object") continue;
    const o: Partial<Record<TipoMidia, boolean>> = {};
    for (const t of ["camera", "microfone"] as const) { const b = (x as Record<string, unknown>)[t]; if (typeof b === "boolean") o[t] = b; }
    if (Object.keys(o).length > 0) out[k] = o;
  }
  return out;
}
/** "câmera", "microfone", "câmera e microfone". */
export const nomeTipos = (tipos: readonly TipoMidia[]): string => tipos.map((t) => (t === "camera" ? "câmera" : "microfone")).join(" e ");
