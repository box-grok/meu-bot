/**
 * Histórico de aberturas do app numa máquina (aberturas.jsonl, que o backend anota a cada hello): quando, qual app,
 * versão e Mac. O admin lê por SSH para saber o que a pessoa usa (produção ou staging, e em que versão). Puro: só
 * parse; o arquivo vem da máquina da pessoa, então é dado, nunca comando.
 */
import type { Abertura } from "../../shared/ipc";

const PRODUTO_RE = /^meu-bot(-[a-z0-9-]{1,30})?$/;
const VERSAO_RE = /^[0-9A-Za-z.+-]{1,40}$/;
const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Linhas JSONL → aberturas válidas, da mais nova para a mais antiga; linha estragada é pulada. */
export function parseAberturas(raw: string, max = 30): Abertura[] {
  const out: Abertura[] = [];
  for (const linha of raw.split("\n")) {
    if (linha.trim() === "") continue;
    let o: unknown;
    try { o = JSON.parse(linha); } catch { continue; }
    if (o === null || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const em = texto(r["em"], 40);
    const produto = texto(r["produto"], 40);
    const versao = texto(r["versao"], 40);
    if (Number.isNaN(Date.parse(em)) || !PRODUTO_RE.test(produto) || !VERSAO_RE.test(versao)) continue;
    out.push({ em, produto, versao, mac: texto(r["mac"], 80), user: texto(r["user"], 40) });
  }
  return out.reverse().slice(0, max);
}
