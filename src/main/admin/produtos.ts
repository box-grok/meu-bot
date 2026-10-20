/**
 * Variante: admin. Os MVPs de produtos (meu-bot-fit, meu-bot-vendas…) que o admin registra, em
 * userData/produtos.json (0600, gravação atômica). O admin não altera o repositório: a definição exportada é o
 * insumo para a implementação (ver produtos-core.ts).
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ProdutoMvp } from "../../shared/ipc";
import { aplicarPatch, checklist, definicaoJson, parseProdutoPatch, parseProdutos } from "./produtos-core";

const file = (): string => path.join(app.getPath("userData"), "produtos.json");
function load(): ProdutoMvp[] {
  try { return parseProdutos(JSON.parse(fs.readFileSync(file(), "utf8"))); } catch { return []; }
}
function save(list: ProdutoMvp[]): void {
  const f = file(); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify({ produtos: list }, null, 1)}\n`, { mode: 0o600 }); fs.renameSync(tmp, f);
}
export const listProdutos = (): ProdutoMvp[] => load();
export function saveProduto(payload: unknown): ProdutoMvp[] {
  const patch = parseProdutoPatch(payload);
  const list = load();
  const i = list.findIndex((p) => p.nome === patch.nome);
  const next = aplicarPatch(i >= 0 ? (list[i] as ProdutoMvp) : null, patch);
  if (i >= 0) list[i] = next; else list.push(next);
  save(list.sort((a, b) => a.nome.localeCompare(b.nome)));
  return list;
}
export function removeProduto(nome: unknown): ProdutoMvp[] {
  const list = load().filter((p) => p.nome !== nome);
  save(list);
  return list;
}
/** A definição (produto.json) e o checklist, para copiar/salvar. */
export function exportProduto(nome: unknown): { json: string; checklist: string[] } {
  const p = load().find((x) => x.nome === nome);
  if (p === undefined) throw new Error("produto não encontrado");
  return { json: definicaoJson(p), checklist: checklist(p) };
}
