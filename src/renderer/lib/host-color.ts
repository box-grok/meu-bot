/** Cor de destaque estável por máquina, para a faixa da janela e a bolinha do seletor. Puro. */

const LOCAL_HUE = 210;

/** FNV-1a espalhado pela razão áurea: nomes parecidos caem longe um do outro na roda de cores. */
function hashHue(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return Math.round(((h * 0.6180339887) % 1) * 360) % 360;
}

/** `hsl(h 65% 48%)`; `local` tem matiz fixo, os outros vêm de um hash do nome. */
export function hostAccent(host: string): string {
  const hue = host === "local" ? LOCAL_HUE : hashHue(host);
  return `hsl(${hue} 65% 48%)`;
}
