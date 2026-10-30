/**
 * Textos do espaço (cota de disco) nas Configurações: tamanho em pt-BR, tom da barra, resumo do que ocupa. Puro, sem
 * DOM; `tam` é cópia da do main/agente/espaco-core.ts (o renderer não importa o main).
 */
import type { CotaInfo, CotaItem } from "../../shared/ipc";

/** KB → "3,9 GB" / "42 MB" / "512 KB". */
export function tam(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1).replace(".", ",")} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${Math.round(kb)} KB`;
}

/** Tom da barra: vermelho de 95%, amarelo de 80%, nada antes. */
export const toneEspaco = (pct: number): "warn" | "bad" | null => (pct >= 95 ? "bad" : pct >= 80 ? "warn" : null);

/** "3,2 GB usados de 3,9 GB · 82%". */
export const textoEspaco = (c: CotaInfo): string => `${tam(c.usadoKb)} usados de ${tam(c.limiteKb)} · ${Math.round(c.pct)}%`;

/** Os `n` maiores itens ("Conversas 1,2 GB · Caches 300 MB"); `outros` só entra quando não há mais nada. */
export function resumoItens(itens: CotaItem[], n = 4): string {
  const semOutros = itens.filter((i) => i.id !== "outros");
  const base = semOutros.length > 0 ? semOutros : itens;
  return [...base].sort((a, b) => b.kb - a.kb).slice(0, n).map((i) => `${i.rotulo} ${tam(i.kb)}`).join(" · ");
}

/** Caminho sem o home ("agent-workspace/x.pdf"); inteiro quando o home não bate. */
export function caminhoRelativo(home: string | null, caminho: string): string {
  if (home !== null && home !== "" && caminho.startsWith(`${home}/`)) return caminho.slice(home.length + 1);
  return caminho;
}
