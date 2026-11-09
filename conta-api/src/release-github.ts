/**
 * A release mais nova do meu-bot no GitHub (diegofornalha/meu-bot), para o "Baixar para macOS" da home. Em produção, a
 * estável (`meu-bot-<v>-arm64.zip`); no site de staging, a pre-release de staging mais nova
 * (`meu-bot-staging-<v>-staging.<n>-arm64.zip`, o app meu-bot-staging), com a estável de reserva se não houver.
 * O release publica `meu-bot-<versão>-arm64.zip` (scripts/release.mjs); o site não sabe a versão, pergunta à API do
 * GitHub (cache de 10 min no edge: o limite anônimo é 60 pedidos/hora por IP) e manda a pessoa direto ao asset.
 */
export interface DownloadMac { versao: string; url: string; tamanho: number; publicadoEm: string; nome: string }

export const REPO = "diegofornalha/meu-bot";
export type CanalSite = "producao" | "staging";
const ASSET_RE: Record<CanalSite, RegExp> = {
  producao: /^meu-bot-(\d+\.\d+\.\d+)-arm64\.zip$/,
  staging: /^meu-bot-staging-(\d+\.\d+\.\d+-staging\.\d+)-arm64\.zip$/,
};
const GH = { headers: { accept: "application/vnd.github+json", "user-agent": "meu-bot-site (conta-api)" }, cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit;

/** Escolhe o asset do app da pessoa (não o admin, não o .sig) numa resposta de /releases/latest; null se não há. */
export function escolherAsset(release: unknown, canal: CanalSite = "producao"): DownloadMac | null {
  if (release === null || typeof release !== "object") return null;
  const r = release as { tag_name?: unknown; published_at?: unknown; assets?: unknown };
  if (!Array.isArray(r.assets)) return null;
  for (const a of r.assets) {
    if (a === null || typeof a !== "object") continue;
    const x = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (typeof x.name !== "string" || typeof x.browser_download_url !== "string") continue;
    const m = ASSET_RE[canal].exec(x.name);
    if (m === null) continue;
    return { versao: m[1]!, url: x.browser_download_url, tamanho: typeof x.size === "number" ? x.size : 0, publicadoEm: typeof r.published_at === "string" ? r.published_at : "", nome: x.name };
  }
  return null;
}

/** Numa resposta de /releases (mais nova primeiro), o asset de staging da primeira release que o tiver; rascunho fica fora. */
export function escolherStaging(releases: unknown): DownloadMac | null {
  if (!Array.isArray(releases)) return null;
  for (const r of releases) {
    if (r === null || typeof r !== "object" || (r as { draft?: unknown }).draft === true) continue;
    const d = escolherAsset(r, "staging");
    if (d !== null) return d;
  }
  return null;
}

/** Busca a release mais nova do canal. Produção: /releases/latest (pre-releases ficam de fora). Staging: a pre-release de
 *  staging mais nova em /releases, ou a estável se não houver. null = GitHub fora ou sem asset. */
export async function downloadMac(buscar: typeof fetch = fetch, canal: CanalSite = "producao"): Promise<DownloadMac | null> {
  if (canal === "staging") {
    try {
      const r = await buscar(`https://api.github.com/repos/${REPO}/releases?per_page=30`, GH);
      const d = r.ok ? escolherStaging(await r.json()) : null;
      if (d !== null) return d;
    } catch { /* cai na estável */ }
  }
  try {
    const r = await buscar(`https://api.github.com/repos/${REPO}/releases/latest`, GH);
    if (!r.ok) return null;
    return escolherAsset(await r.json());
  } catch { return null; }
}
