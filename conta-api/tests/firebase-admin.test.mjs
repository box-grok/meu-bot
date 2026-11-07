// A conta de serviço: parse do JSON, PEM → DER, e o JWT RS256 que o Google troca por access token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarJwtServico, claimsServico, parseContaServico, pemParaDer } from "../dist/firebase-admin.js";
import { deB64url, parseJsonB64url } from "../dist/sessao-core.js";

test("parseContaServico e assinarJwtServico: só JSON de conta de serviço; o JWT sai assinado com a chave", async () => {
  assert.equal(parseContaServico({ client_email: "x@y.com", private_key: "k" }), null, "e-mail fora do domínio de contas de serviço");
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  assert.deepEqual(pemParaDer(pem), der);
  const sa = parseContaServico({ client_email: "w@p.iam.gserviceaccount.com", private_key: pem, type: "service_account" });
  assert.equal(sa.token_uri, "https://oauth2.googleapis.com/token");
  const jwt = await assinarJwtServico(sa, 1_800_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(parseJsonB64url(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(parseJsonB64url(p), claimsServico(sa, 1_800_000_000));
  assert.equal(parseJsonB64url(p).scope, "https://www.googleapis.com/auth/identitytoolkit");
  assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, deB64url(s), new TextEncoder().encode(`${h}.${p}`)), true);
});
