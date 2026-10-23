/**
 * Atualização automática, a parte pura: qual release do GitHub é a mais nova, qual asset é deste app (nome e
 * arquitetura) e como comparar versões. O download, a troca do .app e o reinício ficam em updater.ts.
 * Puro: testável com node --test.
 */
import { createPublicKey, verify } from "node:crypto";

/** Repositório público de onde vêm as releases (`scripts/release.mjs` publica lá). */
export const UPDATE_REPO = "diegofornalha/meu-bot";

export interface ReleaseAsset { name: string; url: string; size: number }
/** `sig` = o `<zip>.sig` que o release publica ao lado (assinatura Ed25519 do zip, em base64). */
export interface UpdateCandidate { version: string; asset: ReleaseAsset; sig: ReleaseAsset }

/**
 * Chaves públicas Ed25519 das releases (SPKI DER em base64), como o SUPublicEDKey do Sparkle: o app só instala o zip
 * que uma delas confere. A principal assina toda release (privada no Chaveiro de quem publica); a reserva só existe
 * para trocar de chave sem reinstalar ninguém se a principal se perder ou vazar (privada só no gerenciador de senhas).
 * Troca: a reserva vira principal, entra uma reserva nova e a antiga sai (scripts/chave-release.mjs, skill publicar).
 */
export const UPDATE_PUBLIC_KEYS: readonly { id: string; chave: string }[] = [
  { id: "principal-2026-10", chave: "MCowBQYDK2VwAyEABo4DH23ayzUorwJWeJ8yfYnLmI89dGZSGgv/Z1hoDg0=" },
  { id: "reserva-2026-10", chave: "MCowBQYDK2VwAyEAv6Om08l77vi7GPD3A5rxD68OOnCZq+H/vLiV1qXzAlU=" },
];

/** O zip baixado é o que uma das chaves da release assinou? `sig` é o conteúdo do .sig (base64); qualquer erro = não. */
export function verificaAssinatura(zip: Buffer, sig: string, chaves: string | readonly string[] = UPDATE_PUBLIC_KEYS.map((k) => k.chave)): boolean {
  let s: Buffer;
  try { s = Buffer.from(sig.trim(), "base64"); } catch { return false; }
  if (s.length !== 64) return false;
  for (const chave of typeof chaves === "string" ? [chaves] : chaves) {
    try { if (verify(null, zip, createPublicKey({ key: Buffer.from(chave, "base64"), format: "der", type: "spki" }), s)) return true; } catch { /* chave inválida: tenta a próxima */ }
  }
  return false;
}

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
  const achar = (n: string): ReleaseAsset | null => {
    for (const a of r.assets as unknown[]) {
      if (a === null || typeof a !== "object") continue;
      const o = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
      if (o.name === n && typeof o.browser_download_url === "string" && /^https:\/\//.test(o.browser_download_url)) return { name: n, url: o.browser_download_url, size: typeof o.size === "number" ? o.size : 0 };
    }
    return null;
  };
  // Sem o .sig ao lado não é candidata: zip que ninguém assinou nunca é instalado.
  const asset = achar(name), sig = achar(`${name}.sig`);
  return asset === null || sig === null ? null : { version, asset, sig };
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

/**
 * Reinstalar o backend da máquina (o install.sh reinicia o serviço) na sondagem: só onde ele já está instalado, só
 * para subir de versão (backend sem VERSION conta como antigo) e só ocioso, com zero chats em andamento. "ocupado" =
 * precisa, mas espera a próxima sondagem; null `busy` (backend antigo, sem o contador) conta como ocioso.
 */
export function precisaAtualizarBackend(p: { backendInstalled: boolean; backendVersion: string | null; backendBusy: number | null }, doApp: string | null): "atualizar" | "ocupado" | "nao" {
  if (!p.backendInstalled || !deveAtualizar(p.backendVersion, doApp)) return "nao";
  return p.backendBusy !== null && p.backendBusy > 0 ? "ocupado" : "atualizar";
}

/**
 * Atualização recém-aplicada, ainda sem prova de que a versão nova abre: `userData/update-pendente.json`, gravado na
 * troca dos .app. `antigos` = os `<app>.antigo` guardados para voltar; `tentativas` = aberturas já feitas na nova.
 */
export interface UpdatePendente { de: string; para: string; antigos: string[]; tentativas: number }
export function parsePendente(raw: unknown): UpdatePendente | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.de !== "string" || typeof o.para !== "string" || !Array.isArray(o.antigos)) return null;
  const antigos = o.antigos.filter((x): x is string => typeof x === "string" && x.endsWith(".app.antigo"));
  return { de: o.de, para: o.para, antigos, tentativas: Number.isInteger(o.tentativas) && (o.tentativas as number) >= 0 ? (o.tentativas as number) : 0 };
}
/** Aberturas da versão nova sem chegar a 30 s de vida antes de voltar à anterior. */
export const TENTATIVAS_ATE_VOLTAR = 3;
/**
 * O que fazer ao abrir com uma atualização pendente: "aguardar" (conta a tentativa e confirma se o app ficar de pé),
 * "voltar" (a nova não passou das primeiras aberturas: restaura os .antigo) ou "descartar" (esta não é a versão
 * pendente: já voltou ou a pessoa instalou outra por fora; só limpa o registro).
 */
export function decideRollback(p: UpdatePendente, versaoAtual: string): "aguardar" | "voltar" | "descartar" {
  if (versaoAtual !== p.para) return "descartar";
  return p.tentativas + 1 >= TENTATIVAS_ATE_VOLTAR ? "voltar" : "aguardar";
}
