/**
 * Onde nasce uma janela do app (máquina, seletor, Produtos): bem colada à direita da área útil da tela, de cima até o
 * Dock, na largura mínima confortável (a mesma para todas). Se o canto já tem uma janela, a nova cola à esquerda dela
 * (e assim por diante), sem passar da borda esquerda. Puro: testado com node --test.
 */
export interface Retangulo { x: number; y: number; width: number; height: number }

/** Folga para "já está ali": o macOS arredonda a posição em alguns pixels. */
const MESMO_LUGAR_PX = 8;

export function posicaoNoCanto(area: Retangulo, largura: number, ocupadas: readonly Retangulo[] = []): Retangulo {
  const w = Math.min(largura, area.width);
  const cruzaAltura = (b: Retangulo): boolean => b.y < area.y + area.height && b.y + b.height > area.y;
  let x = area.x + area.width - w;
  while (x > area.x && ocupadas.some((b) => cruzaAltura(b) && Math.abs(b.x - x) <= MESMO_LUGAR_PX)) x -= w;
  return { x: Math.max(area.x, x), y: area.y, width: w, height: area.height };
}
