/**
 * QR impresso como blocos no terminal (`openclaw channels login`, estilo qrcode-terminal "small"): cada
 * caractere codifica dois módulos na vertical — '█' os dois acesos, '▀' só o de cima, '▄' só o de baixo,
 * ' ' nenhum. "Aceso" é o glifo claro sobre o fundo escuro do terminal; desenhamos igual (claro sobre
 * escuro), que é como o celular já lê direto do terminal. Puro: testável com node --test.
 */

/** Tira códigos ANSI (cor, cursor) e \r do que o CLI imprime. */
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");

const BLOCK_LINE = /^[ █▀▄]+$/;
/** Linha só de blocos e espaços, com pelo menos 10 blocos: faz parte de um QR. */
export const isBlockLine = (line: string): boolean => BLOCK_LINE.test(line) && line.replace(/ /g, "").length >= 10;

/** Junta as linhas de blocos; a primeira linha que não é bloco fecha o QR (≥ 6 linhas) e o devolve. */
export class BlockQrCollector {
  private lines: string[] = [];
  feed(line: string): string[] | null {
    if (isBlockLine(line)) { this.lines.push(line); return null; }
    return this.flush();
  }
  flush(): string[] | null {
    const out = this.lines; this.lines = [];
    return out.length >= 6 ? out : null;
  }
}

/** Grade de módulos [linha][coluna] (true = glifo aceso) a partir das linhas de blocos. */
export function blocksToGrid(lines: string[]): boolean[][] {
  const width = Math.max(0, ...lines.map((l) => l.length));
  const grid: boolean[][] = [];
  for (const line of lines) {
    const top: boolean[] = []; const bottom: boolean[] = [];
    for (let i = 0; i < width; i++) {
      const c = line[i] ?? " ";
      top.push(c === "█" || c === "▀"); bottom.push(c === "█" || c === "▄");
    }
    grid.push(top, bottom);
  }
  return grid;
}

/** SVG do QR (claro sobre escuro, como no terminal) em data URL para um <img>. */
export function gridToSvgDataUrl(grid: boolean[][], scale = 8): string {
  const h = grid.length; const w = h === 0 ? 0 : grid[0]!.length;
  const rects: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y]![x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges"><rect width="${w}" height="${h}" fill="#000"/><g fill="#fff">${rects.join("")}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export const blocksToSvgDataUrl = (lines: string[]): string => gridToSvgDataUrl(blocksToGrid(lines));
