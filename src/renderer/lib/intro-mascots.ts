/**
 * Mascotes da abertura: bolhas de chat (o ícone do app) dispostas num arco em volta do "meu-bot", cada
 * uma com cor própria e uma semente que desloca a fase e a duração dos loops de idle (piscar, olhar de
 * lado, inclinar, squish) — por isso nunca se mexem em uníssono. Puro: testável com node --test.
 */
export interface Mascot {
  /** Deslocamento do centro da abertura, em px. */
  x: number; y: number;
  /** Lado do quadrado, em px (26–34: variação dá profundidade). */
  size: number;
  /** Matiz HSL da bolha. */
  hue: number;
  /** [0, 1): dessincroniza os loops no CSS (animation-delay/duration via var(--seed)). */
  seed: number;
  /** Quando entra, depois do nome aparecer. */
  delayMs: number;
}

/** Azul da marca, verde (ok), âmbar, rosa, violeta: coloridos, mas da mesma família do tema. */
export const MASCOT_HUES = [220, 145, 40, 330, 270] as const;

/** Arco superior da elipse (190°→350°): o rodapé fica livre para as pílulas de máquina/backend/túnel. */
const ARC_START_DEG = 190;
const ARC_SPAN_DEG = 160;

export function planMascots(count: number, rand: () => number = Math.random, rx = 170, ry = 78): Mascot[] {
  const out: Mascot[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const deg = ARC_START_DEG + t * ARC_SPAN_DEG + (rand() - 0.5) * 10; // ±5° de irregularidade
    const rad = (deg * Math.PI) / 180;
    out.push({
      x: Math.round(Math.cos(rad) * rx),
      y: Math.round(Math.sin(rad) * ry),
      size: 26 + Math.round(rand() * 8),
      hue: MASCOT_HUES[i % MASCOT_HUES.length]!,
      seed: rand(),
      delayMs: 120 + i * 70,
    });
  }
  return out;
}
