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

/**
 * Compara versões na ordem do semver; negativo = `a` é mais antiga: 0.2.0-staging.3 < 0.2.0-staging.10 < 0.2.0.
 * (Mesma regra de src/renderer/lib/admin-view.ts: o renderer compila à parte e não importa daqui.)
 */
export function compareVersions(a: string, b: string): number {
  // Núcleo "x.y.z" numérico; depois a pre-release: sem ela vence ("0.2.0" > "0.2.0-staging.9"); com as duas,
  // compara parte a parte (número com número, texto com texto, número < texto, mais partes > menos).
  const parse = (v: string): { nucleo: number[]; pre: string[] } => {
    const [semMeta = ""] = v.trim().replace(/^v/, "").split("+");
    const i = semMeta.indexOf("-");
    const nucleo = (i < 0 ? semMeta : semMeta.slice(0, i)).split(".").map((x) => Number.parseInt(x, 10) || 0);
    return { nucleo, pre: i < 0 ? [] : semMeta.slice(i + 1).split(".") };
  };
  const x = parse(a), y = parse(b);
  for (let k = 0; k < Math.max(x.nucleo.length, y.nucleo.length); k++) { const d = (x.nucleo[k] ?? 0) - (y.nucleo[k] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let k = 0; k < Math.max(x.pre.length, y.pre.length); k++) {
    const p = x.pre[k], q = y.pre[k];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    const d = np && nq ? Number(p) - Number(q) : np ? -1 : nq ? 1 : p < q ? -1 : p > q ? 1 : 0;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Tag de um build staging: v0.2.0-staging.3. */
export const STAGING_TAG = /^v?\d+\.\d+\.\d+-staging\.\d+$/;
/** De onde o app lê as releases: o estável, a última (sem pre-release); o staging, a lista (as pre-releases). */
export const releasesUrl = (canal: "estavel" | "staging"): string => `https://api.github.com/repos/${UPDATE_REPO}/releases${canal === "staging" ? "?per_page=30" : "/latest"}`;

/**
 * A atualização deste app na resposta da API do GitHub (o asset é o deste app nesta arquitetura; a versão vem do
 * `tag_name`, com ou sem "v"). Estável: `raw` é a /releases/latest e só vale release normal "x.y.z". Staging: `raw`
 * é a lista /releases e vale a maior pre-release com tag v*-staging.* que tenha o asset deste app. null = nada mais
 * novo que `current`.
 */
export function pickUpdate(raw: unknown, want: { app: string; arch: string; current: string; canal?: "estavel" | "staging" }): UpdateCandidate | null {
  if (want.canal === "staging") {
    if (!Array.isArray(raw)) return null;
    let best: UpdateCandidate | null = null;
    for (const r of raw) {
      const c = candidato(r, want, true);
      if (c !== null && (best === null || compareVersions(c.version, best.version) > 0)) best = c;
    }
    return best;
  }
  return candidato(raw, want, false);
}
function candidato(raw: unknown, want: { app: string; arch: string; current: string }, staging: boolean): UpdateCandidate | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  // Estável só aceita release normal; staging só pre-release.
  if (typeof r.tag_name !== "string" || r.draft === true || (r.prerelease === true) !== staging) return null;
  const version = r.tag_name.replace(/^v/, "");
  if (staging ? !STAGING_TAG.test(r.tag_name) : !/^\d+(\.\d+){0,3}$/.test(version)) return null;
  if (compareVersions(version, want.current) <= 0) return null;
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

/**
 * Atualizar um componente que o app instala na máquina (a guarda do WhatsApp): só quando a versão que vem no app é
 * MAIS NOVA que a instalada (ou a instalada não diz versão). Com o estável e o staging falando com a mesma máquina,
 * "diferente" faria um trocar a guarda do outro a cada abertura.
 */
export function deveAtualizar(instalada: string | null, doApp: string | null): boolean {
  if (doApp === null) return false;
  return instalada === null || compareVersions(doApp, instalada) > 0;
}
