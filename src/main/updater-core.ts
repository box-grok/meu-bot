/**
 * Atualização automática, a parte pura: qual release do GitHub é a mais nova, qual asset é deste app (nome e
 * arquitetura) e como comparar versões. O download, a troca do .app e o reinício ficam em updater.ts.
 * Puro: testável com node --test.
 */

/** Repositório público de onde vêm as releases (`scripts/release.mjs` publica lá). */
export const UPDATE_REPO = "diegofornalha/meu-bot";

export interface ReleaseAsset { name: string; url: string; size: number }
export interface UpdateCandidate { version: string; asset: ReleaseAsset }

/** Nome do asset de um app numa release: `meu-bot-0.2.0-arm64.zip` (o .app zipado com ditto). */
export const assetName = (app: string, version: string, arch: string): string => `${app}-${version}-${arch}.zip`;

/** Compara "a.b.c" numericamente; negativo = `a` é mais antiga. Partes que não são número contam como 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0), pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  return 0;
}

/**
 * Lê a resposta de /releases/latest da API do GitHub: a versão vem do `tag_name` (com ou sem "v") e o asset é
 * o deste app nesta arquitetura. null = sem release, sem asset para este app, ou nada mais novo que `current`.
 */
export function pickUpdate(raw: unknown, want: { app: string; arch: string; current: string }): UpdateCandidate | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (typeof r.tag_name !== "string" || r.draft === true || r.prerelease === true) return null;
  const version = r.tag_name.replace(/^v/, "");
  if (!/^\d+(\.\d+){0,3}$/.test(version) || compareVersions(version, want.current) <= 0) return null;
  if (!Array.isArray(r.assets)) return null;
  const name = assetName(want.app, version, want.arch);
  for (const a of r.assets) {
    if (a === null || typeof a !== "object") continue;
    const o = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (o.name === name && typeof o.browser_download_url === "string" && /^https:\/\//.test(o.browser_download_url)) {
      return { version, asset: { name, url: o.browser_download_url, size: typeof o.size === "number" ? o.size : 0 } };
    }
  }
  return null;
}
