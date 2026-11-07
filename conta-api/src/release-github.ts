/**
 * A release estável mais nova do meu-bot no GitHub (diegofornalha/meu-bot), para o "Baixar para macOS" da home.
 * O release publica `meu-bot-<versão>-arm64.zip` (scripts/release.mjs); o site não sabe a versão, pergunta à API do
 * GitHub (cache de 10 min no edge: o limite anônimo é 60 pedidos/hora por IP) e manda a pessoa direto ao asset.
 */
export interface DownloadMac { versao: string; url: string; tamanho: number; publicadoEm: string; nome: string }

export const REPO = "diegofornalha/meu-bot";
const ASSET_RE = /^meu-bot-(\d+\.\d+\.\d+)-arm64\.zip$/;

/** Escolhe o asset do app da pessoa (não o admin, não o .sig) numa resposta de /releases/latest; null se não há. */
export function escolherAsset(release: unknown): DownloadMac | null {
  if (release === null || typeof release !== "object") return null;
  const r = release as { tag_name?: unknown; published_at?: unknown; assets?: unknown };
  if (!Array.isArray(r.assets)) return null;
  for (const a of r.assets) {
    if (a === null || typeof a !== "object") continue;
    const x = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (typeof x.name !== "string" || typeof x.browser_download_url !== "string") continue;
    const m = ASSET_RE.exec(x.name);
    if (m === null) continue;
    return { versao: m[1]!, url: x.browser_download_url, tamanho: typeof x.size === "number" ? x.size : 0, publicadoEm: typeof r.published_at === "string" ? r.published_at : "", nome: x.name };
  }
  return null;
}

/** Busca a release mais nova (estável; pre-releases ficam de fora em /releases/latest). null = GitHub fora ou sem asset. */
export async function downloadMac(buscar: typeof fetch = fetch): Promise<DownloadMac | null> {
  try {
    const r = await buscar(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "meu-bot-site (conta-api)" }, cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit);
    if (!r.ok) return null;
    return escolherAsset(await r.json());
  } catch { return null; }
}
