/**
 * O client OAuth do Google que o build pode ter vindo sem (config/google-*.json fica fora do git, e um Mac sem os
 * arquivos empacota o app sem eles): a release publica os dois JSONs como assets avulsos, assinados com a chave das
 * atualizações, e o app os busca sozinho quando percebe que não tem. Parte pura: qual asset e qual .sig pegar na
 * release, onde guardar e quando buscar de novo. IO em cliente-release.ts.
 */
import type { ReleaseAsset } from "../atualizacao/updater-core";

export const CLIENTES_GOOGLE = ["google-oauth.json", "google-conta-oauth.json"] as const;
export type NomeCliente = (typeof CLIENTES_GOOGLE)[number];
/** Pasta em userData com o que veio da release: terceira origem, atrás do arquivo manual e do pacote (nunca os vence). */
export const PASTA_BAIXADOS = "google-cliente-baixado";
/** O JSON do Google Cloud tem ~400 bytes; acima disto não é um client. */
export const MAX_CLIENTE_BYTES = 64 * 1024;
/** Sem o arquivo na release, tenta de novo só depois de 6 h (ou quando a pessoa pede). */
export const REBUSCA_MS = 6 * 60 * 60_000;

/** O asset `<nome>` e o `<nome>.sig` da release (só https); sem o .sig não há candidato: JSON que ninguém assinou nunca é usado. */
export function pickClienteAsset(raw: unknown, nome: NomeCliente): { tag: string; asset: ReleaseAsset; sig: ReleaseAsset } | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { tag_name?: unknown; draft?: unknown; assets?: unknown };
  if (r.draft === true || !Array.isArray(r.assets)) return null;
  const achar = (n: string): ReleaseAsset | null => {
    for (const a of r.assets as unknown[]) {
      if (a === null || typeof a !== "object") continue;
      const o = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
      if (o.name === n && typeof o.browser_download_url === "string" && /^https:\/\//.test(o.browser_download_url)) return { name: n, url: o.browser_download_url, size: typeof o.size === "number" ? o.size : 0 };
    }
    return null;
  };
  const asset = achar(nome); const sig = achar(`${nome}.sig`);
  if (asset === null || sig === null || asset.size > MAX_CLIENTE_BYTES) return null;
  return { tag: typeof r.tag_name === "string" ? r.tag_name : "", asset, sig };
}

export const deveBuscar = (ultima: number | null, agora: number, forcar: boolean): boolean => forcar || ultima === null || agora - ultima >= REBUSCA_MS;

/** Texto para a tela quando a busca não resolveu (null = resolveu ou nem precisou). */
export function motivoSemCliente(r: { tag: string | null; faltam: readonly string[]; erro: string | null }): string | null {
  if (r.erro !== null) return `não consegui consultar a release: ${r.erro}`;
  if (r.faltam.length === 0) return null;
  return r.tag === null ? "nenhuma release publicada ainda" : `a release ${r.tag} não traz ${r.faltam.join(" nem ")}`;
}
