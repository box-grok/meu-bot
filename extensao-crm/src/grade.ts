/** Contas da grade do pipeline (puras, testáveis): texto de um valor cru, agrupamento e contagem por etapa. */
import type { CaixaResumo, Campo, Etapa } from "./tipos.ts";

/** Valor cru do host → texto da célula (o mesmo formato que a ficha da caixa mostra). */
export function valorTexto(campo: Campo, v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (campo.options.length > 0) return (Array.isArray(v) ? v : [v]).map((k) => campo.options.find((o) => o.key === k)?.name ?? String(k)).join(", ");
  if (campo.type === "DATE") { const t = Number(v); return Number.isFinite(t) ? new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : String(v); }
  if (campo.type === "CHECKBOX") return v === true ? "sim" : "";
  return String(v);
}

/** Caixas por etapa, na ordem das etapas; caixa de etapa que não existe mais vai para a primeira. */
export function agruparPorEtapa(etapas: Etapa[], caixas: CaixaResumo[]): Map<string, CaixaResumo[]> {
  const out = new Map<string, CaixaResumo[]>(etapas.map((s) => [s.key, []]));
  const primeira = etapas[0]?.key;
  for (const b of caixas) { const l = out.get(b.stageKey) ?? (primeira !== undefined ? out.get(primeira) : undefined); if (l) l.push(b); }
  for (const l of out.values()) l.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return out;
}

/** Etapas com o nome trocado numa delas (a chave fica: as caixas continuam nela). */
export const renomearEtapa = (etapas: Etapa[], key: string, nome: string): Etapa[] => etapas.map((s) => (s.key === key ? { key: s.key, name: nome } : { key: s.key, name: s.name }));
