import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { resolveVariant, capsFor, titleFor } = createRequire(import.meta.url)("../../dist/main/variant-core.js");

test("resolveVariant: em dev manda a variável de ambiente; empacotado manda o variant.json", () => {
  assert.equal(resolveVariant({ packaged: false, env: "admin", variantJson: undefined }), "admin");
  assert.equal(resolveVariant({ packaged: false, env: undefined, variantJson: undefined }), "client");
  assert.equal(resolveVariant({ packaged: false, env: "qualquer", variantJson: { variant: "admin" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: "admin", variantJson: undefined }), "client", "empacotado ignora o ambiente");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "admin" } }), "admin");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "client" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: "lixo" }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: null }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: 1 } }), "client");
});

test("capsFor: o admin só tem supportAdmin; o cliente tem tudo menos isso", () => {
  const admin = capsFor("admin");
  const client = capsFor("client");
  assert.equal(admin.variant, "admin");
  assert.equal(client.variant, "client");
  for (const [k, v] of Object.entries(admin)) {
    if (k === "variant") continue;
    assert.equal(v, k === "supportAdmin", `admin.${k}`);
    assert.equal(client[k], k !== "supportAdmin", `client.${k}`);
  }
  assert.deepEqual(Object.keys(admin).sort(), Object.keys(client).sort());
});

test("titleFor", () => {
  assert.equal(titleFor("admin"), "meu-bot-admin");
  assert.equal(titleFor("client"), "meu-bot");
});
