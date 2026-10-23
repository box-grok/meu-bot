/**
 * Colunas da grade do pipeline: mover de lugar e redimensionar (puro, testável, como planilha.ts).
 *
 * As duas preferências moram em lugares diferentes de propósito. A ORDEM é a própria ordem de
 * `pipeline.fields` no host, então vale para todo mundo que abre o pipeline. A LARGURA é de quem
 * olha (o monitor de cada um é diferente) e o modelo de campo do host não a guarda, então fica no
 * localStorage, uma entrada por pipeline.
 */
import type { Campo } from "./tipos.ts";

/** Faixa aceita para a largura de uma coluna, em pixels. Fora dela o valor é descartado. */
export const LARGURA_MIN = 80;
export const LARGURA_MAX = 900;

/** Colunas fixas da grade, na ordem em que aparecem. Os campos do pipeline entram entre `contatos` e `atualizado`. */
export type ColunaFixa = "nome" | "etapa" | "responsaveis" | "contatos" | "atualizado" | "add";

/**
 * Larguras iniciais, escolhidas para reproduzir o que a grade já mostrava antes de `table-layout:
 * fixed` (Nome tinha min-width 220, as demais células teto de 260 e a coluna "＋" 48).
 *
 * `add` fica abaixo de LARGURA_MIN de propósito: é a coluna do botão "＋", que não é
 * redimensionável. A faixa vale para o que a pessoa arrasta.
 */
export const LARGURAS_PADRAO: Record<ColunaFixa | "campo", number> = {
  nome: 220,
  etapa: 140,
  responsaveis: 120,
  contatos: 200,
  atualizado: 120,
  add: 48,
  campo: 180,
};

/** Chaves no localStorage: uma por pipeline, para pipelines diferentes não se misturarem. */
export const chaveLarguras = (pipelineKey: string): string => `mbcrm:larguras:${pipelineKey}`;
export const chaveOrdem = (pipelineKey: string): string => `mbcrm:ordem:${pipelineKey}`;

/** Lê a ordem guardada das colunas (lista de ids), tolerante a lixo: o que não for texto é descartado. */
export function parseOrdem(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(v)) return [];
    const vistos = new Set<string>();
    return v.filter((x): x is string => typeof x === "string" && x !== "" && !vistos.has(x) && (vistos.add(x), true));
  } catch { return []; }
}

/**
 * Casa a ordem guardada com as colunas que existem agora.
 *
 * Some o que não existe mais (campo apagado) e entra o que é novo, na posição que teria por
 * padrão, em vez de cair no fim da tabela. Sem isso, criar uma coluna a colocaria depois de
 * "Atualizado", onde ninguém procura.
 */
export function aplicarOrdem(padrao: readonly string[], guardada: readonly string[]): string[] {
  const existe = new Set(padrao);
  const out = guardada.filter((id) => existe.has(id));
  const dentro = new Set(out);
  padrao.forEach((id, i) => { if (!dentro.has(id)) { out.splice(Math.min(i, out.length), 0, id); dentro.add(id); } });
  return out;
}

/**
 * Arredonda e prende à faixa; o que não é número vira null (o chamador usa o padrão).
 *
 * Só número e string numérica passam. `Number(null)` e `Number([])` dão 0, que seria preso em
 * LARGURA_MIN e viraria uma largura "válida" vinda de lixo no storage: por isso o tipo é conferido
 * antes da conversão, em vez de confiar em Number.isFinite.
 */
export function limparLargura(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(v)));
}

/**
 * Lê as larguras guardadas, tolerante a lixo (mesma postura de parseVista): o que não for número
 * dentro da faixa é descartado em vez de derrubar a grade inteira.
 */
export function parseLarguras(raw: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
    for (const [col, n] of Object.entries(v as Record<string, unknown>)) {
      if (col === "") continue;
      const l = limparLargura(n);
      if (l !== null) out[col] = l;
    }
  } catch { /* sem storage ou JSON quebrado: volta ao padrão */ }
  return out;
}

/**
 * Move o item de `de` para `para`, devolvendo uma lista nova. Índice fora da faixa, ou destino
 * igual à origem, devolve a lista como está: arrastar e soltar no mesmo lugar não é erro.
 */
export function moverColuna<T>(lista: readonly T[], de: number, para: number): T[] {
  const out = [...lista];
  if (!Number.isInteger(de) || !Number.isInteger(para)) return out;
  if (de < 0 || de >= out.length || para < 0 || para >= out.length || de === para) return out;
  const [item] = out.splice(de, 1);
  if (item === undefined) return [...lista];
  out.splice(para, 0, item);
  return out;
}

/**
 * Os dois lados têm exatamente os mesmos campos (por chave), em qualquer ordem?
 *
 * Gravar a ordem manda a lista inteira de campos, e o host remove do pipeline todo campo ausente
 * dessa lista. Então, antes de gravar, o conjunto relido do host precisa bater com o que estava na
 * tela; se alguém adicionou ou removeu uma coluna nesse meio-tempo, salvar apagaria o trabalho
 * dessa pessoa junto com os valores.
 */
export function mesmoConjunto(a: readonly Campo[], b: readonly Campo[]): boolean {
  if (a.length !== b.length) return false;
  const chaves = new Set(a.map((f) => f.key));
  return b.every((f) => chaves.has(f.key));
}
