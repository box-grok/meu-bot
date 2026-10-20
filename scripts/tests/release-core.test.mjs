import { test } from "node:test";
import assert from "node:assert/strict";
import { produtosDoCanal, proximaStaging, recusaPromocao } from "../release-core.mjs";

test("release staging: o próximo N sai das tags dessa versão", () => {
  assert.equal(proximaStaging("0.2.0", []), 1);
  assert.equal(proximaStaging("0.2.0", ["v0.1.0", "v0.2.0-staging.1", "v0.2.0-staging.9", "v0.3.0-staging.20", "v0.2.0-staging.x", ""]), 10);
});

test("promoção: só num commit publicado como staging da mesma versão", () => {
  assert.match(recusaPromocao("0.2.0", []), /não foi publicado como staging/);
  assert.match(recusaPromocao("0.2.0", ["v0.1.0"]), /não foi publicado como staging/);
  assert.match(recusaPromocao("0.2.0", ["v0.1.0-staging.4"]), /outra versão/);
  assert.equal(recusaPromocao("0.2.0", ["v0.2.0-staging.3"]), null);
});

test("cada canal publica os seus produtos (o admin só no estável)", () => {
  const P = [{ nome: "meu-bot", canal: "estavel" }, { nome: "meu-bot-admin", canal: "estavel" }, { nome: "meu-bot-staging", canal: "staging" }];
  assert.deepEqual(produtosDoCanal(P, "staging").map((p) => p.nome), ["meu-bot-staging"]);
  assert.deepEqual(produtosDoCanal(P, "estavel").map((p) => p.nome), ["meu-bot", "meu-bot-admin"]);
});
