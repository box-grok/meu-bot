// Identidade deste Mac como device da conta: alias legado = deviceId() do backend; device.json só com uuid v4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { aliasLegado, montarDevicePedido, novoDeviceJson, parseDeviceJson } = req("../../dist/main/conta/device-core.js");
const { UUID_RE } = req("../../dist/main/licenca/licenca.js");

test("aliasLegado: 12 hex de sha256(nome\\nusuário), sem o .local (igual a deviceId() em backend.ts)", () => {
  const esperado = createHash("sha256").update("cursor\nmeu-box").digest("hex").slice(0, 12);
  assert.equal(aliasLegado("cursor.local", "meu-box"), esperado);
  assert.equal(aliasLegado("cursor", "meu-box"), esperado);
});

test("device.json: novo tem uuid v4; parse recusa id fora do formato", () => {
  const d = novoDeviceJson(Date.parse("2026-11-07T12:00:00Z"));
  assert.match(d.id, UUID_RE); assert.equal(d.criadoEm, "2026-11-07T12:00:00.000Z");
  assert.deepEqual(parseDeviceJson(d), d);
  assert.equal(parseDeviceJson({ id: "0123456789ab" }), null, "alias antigo não é o device.json");
  assert.equal(parseDeviceJson("x"), null);
  assert.notEqual(novoDeviceJson().id, d.id);
});

test("montarDevicePedido: alias junto, nome sem .local e sem caracteres de controle", () => {
  const p = montarDevicePedido({ id: "33333333-3333-4333-8333-333333333333", hostname: "Mac da Ana.local", user: "ana\u0007", platform: "darwin", app: "meu-bot-staging", versao: "0.79.0" });
  assert.equal(p.alias, aliasLegado("Mac da Ana", "ana\u0007"));
  assert.equal(p.name, "Mac da Ana"); assert.equal(p.user, "ana"); assert.equal(p.app, "meu-bot-staging");
  const m = montarDevicePedido({ id: "33333333-3333-4333-8333-333333333333", hostname: "Mac da Ana.local", user: "ana", platform: "darwin", app: "meu-bot-staging", versao: "0.79.0" }, false);
  assert.deepEqual(m, { id: "33333333-3333-4333-8333-333333333333", alias: p.alias, name: "", user: "", platform: "", app: "meu-bot-staging", versao: "0.79.0" }, "dados de uso desligados: só id, alias, app e versão");
});
