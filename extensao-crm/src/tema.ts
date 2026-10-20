/** Tema claro/escuro: o SDK diz (`Global.gmailTheme`), e a luminância do fundo desempata. Puro na conta. */
export function escuroPorCor(rgb: string): boolean {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
export function temaAtual(sdkEscuro: boolean | null): "claro" | "escuro" {
  if (sdkEscuro !== null) return sdkEscuro ? "escuro" : "claro";
  const el = document.querySelector('div[role="main"]') ?? document.body;
  return escuroPorCor(getComputedStyle(el).backgroundColor) ? "escuro" : "claro";
}
/** Paleta das etapas (a sequência quente→fria do funil, como no Streak), por índice. */
export const CORES_ETAPA = ["#d94a3d", "#f0875a", "#f6bd55", "#a2cb67", "#5fbad6", "#3d8fe6", "#5b3cc4", "#9130b5", "#d1365f"] as const;
export const corDaEtapa = (indice: number): string => CORES_ETAPA[((indice % CORES_ETAPA.length) + CORES_ETAPA.length) % CORES_ETAPA.length] as string;
/** Texto escrito sobre cada cor da paleta (escuro nas claras: laranja, amarelo, verde). */
const TEXTO_ETAPA: Record<string, string> = { "#f0875a": "#202124", "#f6bd55": "#202124", "#a2cb67": "#202124" };
/** Texto legível sobre a cor (#rrggbb): o da paleta; fora dela, pela luminância. */
export function textoSobre(hex: string): string {
  if ((CORES_ETAPA as readonly string[]).includes(hex)) return TEXTO_ETAPA[hex] ?? "#fff";
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  return escuroPorCor(`rgb(${parseInt(m[1] as string, 16)}, ${parseInt(m[2] as string, 16)}, ${parseInt(m[3] as string, 16)})`) ? "#fff" : "#202124";
}
