/**
 * Sessão da conta, a parte pura (WebCrypto, roda no Worker e no node --test): segredos, PKCE, JWT HS256 do token de
 * acesso, validação do que o app e a página mandam. Vem de fora = dado, nunca comando.
 */

/** Código do deep link e `state` do app: 32 bytes em base64url (43 caracteres). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** PKCE (RFC 7636): verifier de 43 a 128 caracteres; challenge = base64url(sha256(verifier)), 43 caracteres. */
export const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** Esquema do deep link (esquemaDe em src/main/app/variant-core.ts): o nome do produto. */
export const ESQUEMA_RE = /^[a-z][a-z0-9-]{1,40}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Id de device: o uuid do device.json, ou o alias antigo (12 hex). */
export const DEVICE_ID_RE = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** Campos livres do device e do app (nome do Mac, usuário…), como MACHINE_FIELD_RE do backend. */
const CAMPO_RE = /^[^\p{C}]{0,80}$/u;
const APP_RE = /^meu-bot(?:-[a-z0-9-]{1,30})?$/;
const VERSAO_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/;

export const CODE_TTL_S = 120;
export const ACESSO_TTL_S = 60 * 60;
/** Refresh: 90 dias em produção; 7 no staging (lá o safeStorage do app é só ofuscação, use-mock-keychain). */
export const refreshTtlS = (canal: string): number => (canal === "staging" ? 7 : 90) * 24 * 60 * 60;
/** Quantos /sessao por IP por minuto. */
export const LIMITE_SESSAO_POR_MIN = 20;

const enc = new TextEncoder();

export function b64url(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function deB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
/** `n` bytes aleatórios em base64url (code, state, refresh). */
export function segredo(n = 32): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}
export const uuid = (): string => crypto.randomUUID();
export const agoraIso = (agoraMs = Date.now()): string => new Date(agoraMs).toISOString();
export const maisSegundos = (s: number, agoraMs = Date.now()): string => new Date(agoraMs + s * 1000).toISOString();

export async function sha256(s: string): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function sha256Hex(s: string): Promise<string> { return [...await sha256(s)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
/** O challenge que o app mandou é deste verifier? (S256) */
export async function pkceConfere(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  return b64url(await sha256(verifier)) === challenge;
}

// ---- JWT HS256 (token de acesso): header fixo, claims JSON, assinatura HMAC com a chave do secret.
const HEADER = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
async function chaveHmac(segredoB64: string): Promise<CryptoKey> {
  const raw = deB64url(segredoB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw === null || raw.length < 32) throw new Error("SESSAO_HMAC_KEY precisa ter pelo menos 32 bytes em base64");
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function assinarJwt(claims: Record<string, unknown>, segredoB64: string): Promise<string> {
  const corpo = `${HEADER}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign("HMAC", await chaveHmac(segredoB64), enc.encode(corpo));
  return `${corpo}.${b64url(sig)}`;
}
/** Claims de um JWT HS256 nosso, válido e não vencido; null para qualquer outra coisa. */
export async function verificarJwt(token: string, segredoB64: string, agoraS = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown> | null> {
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== HEADER) return null;
  const [h, p, s] = partes as [string, string, string];
  const sig = deB64url(s);
  if (sig === null) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await chaveHmac(segredoB64), sig, enc.encode(`${h}.${p}`)); } catch { return null; }
  if (!ok) return null;
  const claims = parseJsonB64url(p);
  if (claims === null) return null;
  const exp = claims.exp, iat = claims.iat;
  if (typeof exp !== "number" || typeof iat !== "number" || exp <= agoraS || iat > agoraS + 60) return null;
  return claims;
}
export function parseJsonB64url(s: string): Record<string, unknown> | null {
  const b = deB64url(s);
  if (b === null) return null;
  try { const j: unknown = JSON.parse(new TextDecoder().decode(b)); return j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
}

// ---- O que chega nos pedidos.
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);

export interface PedidoSessao { idToken: string; state: string; challenge: string; esquema: string; app: string | null; versao: string | null }
/** `POST /sessao` da página: ID token do Firebase mais o que o app pôs na URL de login. */
export function validaPedidoSessao(raw: unknown): PedidoSessao | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const idToken = typeof raw.idToken === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.idToken) && raw.idToken.length < 8192 ? raw.idToken : null;
  if (idToken === null) return { erro: "idToken ausente ou fora do formato" };
  const state = str(raw.state, TOKEN_RE), challenge = str(raw.challenge, CHALLENGE_RE), esquema = str(raw.esquema, ESQUEMA_RE);
  if (state === null) return { erro: "state ausente ou fora do formato" };
  if (challenge === null) return { erro: "challenge (PKCE) ausente ou fora do formato" };
  if (esquema === null) return { erro: "esquema do app ausente ou fora do formato" };
  return { idToken, state, challenge, esquema, app: str(raw.app, APP_RE), versao: str(raw.v, VERSAO_RE) };
}

export interface DeviceValido { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string }
export function validaDevice(raw: unknown): DeviceValido | { erro: string } {
  if (!isObj(raw)) return { erro: "device ausente" };
  const id = str(raw.id, DEVICE_ID_RE);
  if (id === null) return { erro: "id do device fora do formato" };
  const alias = raw.alias === undefined || raw.alias === null ? null : str(raw.alias, /^[a-f0-9]{12}$/);
  if (raw.alias !== undefined && raw.alias !== null && alias === null) return { erro: "alias do device fora do formato" };
  const app = str(raw.app, APP_RE), versao = str(raw.versao, VERSAO_RE);
  if (app === null || versao === null) return { erro: "app ou versão fora do formato" };
  const campo = (k: string): string => str(raw[k], CAMPO_RE) ?? "";
  return { id, alias, name: campo("name"), user: campo("user"), platform: str(raw.platform, /^(darwin|win32|linux)$/) ?? "", app, versao };
}

export type PedidoToken = { grant: "code"; code: string; verifier: string; device: DeviceValido } | { grant: "refresh"; refresh: string };
export function validaPedidoToken(raw: unknown): PedidoToken | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  if (raw.grant === "code") {
    const code = str(raw.code, TOKEN_RE), verifier = str(raw.verifier, VERIFIER_RE);
    if (code === null) return { erro: "code ausente ou fora do formato" };
    if (verifier === null) return { erro: "verifier (PKCE) ausente ou fora do formato" };
    const device = validaDevice(raw.device);
    if ("erro" in device) return device;
    return { grant: "code", code, verifier, device };
  }
  if (raw.grant === "refresh") {
    const refresh = str(raw.refresh, TOKEN_RE);
    if (refresh === null) return { erro: "refresh ausente ou fora do formato" };
    return { grant: "refresh", refresh };
  }
  return { erro: "grant desconhecido (code | refresh)" };
}

/** Admissão de um device (cópia de admitDevice do backend-colima/licenca.js): conhecido mantém; novo cabe até o limite. */
export function admitirDevice(conhecido: { status: string } | null, ativos: number, limite: number): "active" | "pending" {
  if (conhecido !== null) return conhecido.status === "pending" ? "pending" : "active";
  return ativos < limite ? "active" : "pending";
}

/** Janela do rate limit: minuto corrente em ISO sem segundos. */
export const janelaMinuto = (agoraMs = Date.now()): string => new Date(agoraMs).toISOString().slice(0, 16);
