import { test } from "node:test";
import assert from "node:assert/strict";
import { pendenteUnico } from "../../dist/main/maquina/pendente-core.js";

test("pendenteUnico: caminho sem await não deixa a promessa presa", async () => {
  const dono = { pending: undefined };
  let chamadas = 0;
  assert.equal(await pendenteUnico(dono, async () => ++chamadas), 1);
  assert.equal(dono.pending, undefined);
  assert.equal(await pendenteUnico(dono, async () => ++chamadas), 2, "a segunda chamada roda de novo, não recebe o valor antigo");
});

test("pendenteUnico: quem chega durante a operação recebe a mesma promessa", async () => {
  const dono = { pending: undefined };
  let soltar;
  const a = pendenteUnico(dono, () => new Promise((r) => { soltar = r; }));
  const b = pendenteUnico(dono, async () => "outra");
  assert.equal(a, b);
  soltar("x");
  assert.equal(await b, "x");
  assert.equal(dono.pending, undefined);
});

test("pendenteUnico: falha também solta a vaga", async () => {
  const dono = { pending: undefined };
  await assert.rejects(pendenteUnico(dono, async () => { throw new Error("caiu"); }), /caiu/);
  assert.equal(dono.pending, undefined);
});
