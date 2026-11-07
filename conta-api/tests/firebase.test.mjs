// Verificação do ID token do Firebase sem Admin SDK: assinatura RS256 contra o JWKS, e as claims do projeto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { provedoresDasClaims, validaClaimsFirebase, verificarIdToken } from "../dist/firebase.js";
import { b64url } from "../dist/sessao-core.js";

const PROJ = "meu-bot-conta";
const AGORA = 1_800_000_000;
const enc = new TextEncoder();
const claimsOk = () => ({ iss: `https://securetoken.google.com/${PROJ}`, aud: PROJ, sub: "uid-1", exp: AGORA + 3600, iat: AGORA - 10, auth_time: AGORA - 10, email: "Ana@Exemplo.com", email_verified: true, name: "Ana", picture: "https://foto/x.png" });

test("validaClaimsFirebase: aceita o token do projeto; e-mail normalizado; recusa iss/aud/exp/sub errados", () => {
  const u = validaClaimsFirebase(claimsOk(), PROJ, AGORA);
  assert.deepEqual(u, { uid: "uid-1", email: "ana@exemplo.com", emailVerificado: true, nome: "Ana", foto: "https://foto/x.png", provedores: [] });
  assert.match(validaClaimsFirebase({ ...claimsOk(), iss: "https://securetoken.google.com/outro" }, PROJ, AGORA).erro, /iss/);
  assert.match(validaClaimsFirebase({ ...claimsOk(), aud: "outro" }, PROJ, AGORA).erro, /aud/);
  assert.match(validaClaimsFirebase({ ...claimsOk(), exp: AGORA - 1 }, PROJ, AGORA).erro, /vencido/);
  assert.match(validaClaimsFirebase({ ...claimsOk(), iat: AGORA + 3600 }, PROJ, AGORA).erro, /iat/);
  assert.match(validaClaimsFirebase({ ...claimsOk(), sub: "" }, PROJ, AGORA).erro, /sub/);
  assert.match(validaClaimsFirebase({ ...claimsOk(), email: "semarroba" }, PROJ, AGORA).erro, /e-mail/);
  assert.equal(validaClaimsFirebase({ ...claimsOk(), email_verified: false }, PROJ, AGORA).emailVerificado, false);
  assert.equal(validaClaimsFirebase({ ...claimsOk(), picture: "http://inseguro" }, PROJ, AGORA).foto, null);
});

test("provedoresDasClaims: sign_in_provider e identities, só google.com e password, sem repetir", () => {
  assert.deepEqual(provedoresDasClaims({ firebase: { sign_in_provider: "google.com", identities: { "google.com": ["1"], email: ["a@b.c"] } } }), ["google.com"]);
  assert.deepEqual(provedoresDasClaims({ firebase: { sign_in_provider: "password", identities: { "google.com": ["1"], email: ["a@b.c"] } } }), ["google.com", "password"]);
  assert.deepEqual(provedoresDasClaims({ firebase: { sign_in_provider: "facebook.com", identities: { "lixo; DROP": [] } } }), [], "provedor fora da lista cai");
  assert.deepEqual(provedoresDasClaims({ firebase: "x" }), []); assert.deepEqual(provedoresDasClaims({}), []);
  assert.deepEqual(validaClaimsFirebase({ ...claimsOk(), firebase: { sign_in_provider: "google.com" } }, PROJ, AGORA).provedores, ["google.com"]);
});

test("verificarIdToken: assinado pela chave do JWKS passa; outra chave, kid desconhecido ou payload mexido não", async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = async () => [{ kid: "k1", kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }];
  const assinar = async (header, claims, chave = privateKey) => {
    const corpo = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`;
    return `${corpo}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, enc.encode(corpo)))}`;
  };
  const bom = await assinar({ alg: "RS256", typ: "JWT", kid: "k1" }, claimsOk());
  const u = await verificarIdToken(bom, PROJ, jwks, AGORA);
  assert.equal(u.uid, "uid-1"); assert.equal(u.email, "ana@exemplo.com");

  assert.match((await verificarIdToken(await assinar({ alg: "RS256", kid: "k2" }, claimsOk()), PROJ, jwks, AGORA)).erro, /kid/);
  assert.match((await verificarIdToken(await assinar({ alg: "HS256", kid: "k1" }, claimsOk()), PROJ, jwks, AGORA)).erro, /RS256/);
  const outra = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  assert.match((await verificarIdToken(await assinar({ alg: "RS256", kid: "k1" }, claimsOk(), outra.privateKey), PROJ, jwks, AGORA)).erro, /assinatura/);
  const [h, p, s] = bom.split(".");
  const mexido = `${h}.${b64url(enc.encode(JSON.stringify({ ...claimsOk(), email: "outra@exemplo.com" })))}.${s}`;
  assert.match((await verificarIdToken(mexido, PROJ, jwks, AGORA)).erro, /assinatura/);
  assert.match((await verificarIdToken(bom, "outro-projeto", jwks, AGORA)).erro, /iss/);
  assert.match((await verificarIdToken(bom, PROJ, async () => { throw new Error("rede"); }, AGORA)).erro, /JWKS/);
  assert.match((await verificarIdToken("nao.e", PROJ, jwks, AGORA)).erro, /JWT/);
});
