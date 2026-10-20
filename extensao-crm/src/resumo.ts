/**
 * Resumo da caixa e textos de tempo, sem IA e sem propaganda: o que importa para decidir o próximo passo, a
 * partir dos dados que já existem (etapa, há quanto tempo, última atividade, "Próximo passo" das anotações).
 * Puro, testado.
 */
import type { CaixaFicha } from "./tipos.ts";

/** "agora", "há 5 min", "há 3 h", "há 2 dias", "há 3 meses". */
export function haQuanto(iso: string | undefined, agora: number = Date.now()): string {
  const t = iso === undefined ? Number.NaN : Date.parse(iso.length === 16 ? `${iso}:00Z` : iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86_400);
  if (d < 45) return `há ${d} dia${d === 1 ? "" : "s"}`;
  const m = Math.round(d / 30);
  return `há ${m} ${m === 1 ? "mês" : "meses"}`;
}
/** Dias inteiros desde `iso` (0 = hoje). */
export const diasDesde = (iso: string | undefined, agora: number = Date.now()): number | null => { const t = iso === undefined ? Number.NaN : Date.parse(iso); return Number.isNaN(t) ? null : Math.max(0, Math.floor((agora - t) / 86_400_000)); };
/** A linha "Próximo passo: …" das anotações, se houver. */
export function proximoPasso(notas: string): string | null {
  const m = /(?:^|\n)\s*pr[oó]ximo passo\s*:\s*(.+)/i.exec(notas);
  return m ? (m[1] as string).trim().slice(0, 200) : null;
}
export function resumoDaCaixa(f: CaixaFicha, agora: number = Date.now()): string {
  const partes: string[] = [];
  const dias = diasDesde(f.box.etapaDesde, agora);
  partes.push(dias === null ? `Em ${f.box.stage}` : `Em ${f.box.stage} ${dias === 0 ? "desde hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`}`);
  const ultimo = f.comentarios.at(-1);
  if (ultimo) partes.push(`último registro ${haQuanto(ultimo.em, agora)}: "${ultimo.texto.length > 90 ? `${ultimo.texto.slice(0, 89)}…` : ultimo.texto}"`);
  else partes.push("nenhum registro ainda");
  const prox = proximoPasso(f.notes);
  if (prox) partes.push(`próximo passo: ${prox}`);
  return partes.join(" · ");
}
