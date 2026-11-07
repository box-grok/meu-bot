/**
 * Verificação do ID token do Firebase Authentication, sem Admin SDK: o token é um JWT RS256 assinado por uma das
 * chaves públicas que o Google publica (JWKS de securetoken@system); conferimos assinatura, `iss`, `aud`, `exp`,
 * `iat`, `auth_time` e `sub`, como a documentação manda. A parte pura (claims) é testável; a busca do JWKS entra por
 * parâmetro (no Worker, `fetch` com cache de 1 h).
 */
import { deB64url, parseJsonB64url } from "./sessao-core.js";

export interface UsuarioFirebase { uid: string; email: string; emailVerificado: boolean; nome: string | null; foto: string | null }
export interface JwkRsa { kid: string; kty: string; alg?: string; use?: string; n: string; e: string }
export type BuscaJwks = () => Promise<JwkRsa[]>;

export const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

/** As claims obrigatórias de um ID token deste projeto (sem olhar a assinatura). */
export function validaClaimsFirebase(claims: Record<string, unknown>, projectId: string, agoraS: number): UsuarioFirebase | { erro: string } {
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return { erro: "iss não é deste projeto" };
  if (claims.aud !== projectId) return { erro: "aud não é deste projeto" };
  const exp = claims.exp, iat = claims.iat, authTime = claims.auth_time;
  if (typeof exp !== "number" || exp <= agoraS) return { erro: "token vencido" };
  if (typeof iat !== "number" || iat > agoraS + 300) return { erro: "iat no futuro" };
  if (typeof authTime !== "number" || authTime > agoraS + 300) return { erro: "auth_time no futuro" };
  const uid = claims.sub;
  if (typeof uid !== "string" || uid === "" || uid.length > 128) return { erro: "sub ausente" };
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return { erro: "token sem e-mail" };
  const nome = typeof claims.name === "string" && claims.name.trim() !== "" ? claims.name.trim().slice(0, 120) : null;
  const foto = typeof claims.picture === "string" && /^https:\/\/\S{1,500}$/.test(claims.picture) ? claims.picture : null;
  return { uid, email, emailVerificado: claims.email_verified === true, nome, foto };
}

/** Importa uma chave do JWKS do Google (RSA pública, RS256). */
export async function chaveDoJwk(jwk: JwkRsa): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/** Verifica assinatura e claims; `{erro}` diz por quê (vai para o log, não para a pessoa). */
export async function verificarIdToken(token: string, projectId: string, buscaJwks: BuscaJwks, agoraS = Math.floor(Date.now() / 1000)): Promise<UsuarioFirebase | { erro: string }> {
  const partes = token.split(".");
  if (partes.length !== 3) return { erro: "não é um JWT" };
  const [h, p, s] = partes as [string, string, string];
  const header = parseJsonB64url(h);
  if (header === null || header.alg !== "RS256" || typeof header.kid !== "string") return { erro: "header não é RS256 com kid" };
  const claims = parseJsonB64url(p);
  const sig = deB64url(s);
  if (claims === null || sig === null) return { erro: "payload ou assinatura ilegíveis" };
  let chaves: JwkRsa[];
  try { chaves = await buscaJwks(); } catch (e) { return { erro: `JWKS indisponível: ${e instanceof Error ? e.message : String(e)}` }; }
  const jwk = chaves.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (jwk === undefined) return { erro: `kid ${String(header.kid).slice(0, 20)} não está no JWKS` };
  let ok = false;
  try { ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await chaveDoJwk(jwk), sig, new TextEncoder().encode(`${h}.${p}`)); } catch { ok = false; }
  if (!ok) return { erro: "assinatura não confere" };
  return validaClaimsFirebase(claims, projectId, agoraS);
}

/** O JWKS do Google pelo `fetch` do Worker, com cache de 1 h na borda (a resposta deles já vem com Cache-Control). */
export async function buscaJwksGoogle(): Promise<JwkRsa[]> {
  const r = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { keys?: unknown };
  if (!Array.isArray(j.keys)) throw new Error("sem keys");
  return j.keys.filter((k): k is JwkRsa => k !== null && typeof k === "object" && typeof (k as JwkRsa).kid === "string" && typeof (k as JwkRsa).n === "string" && typeof (k as JwkRsa).e === "string");
}
