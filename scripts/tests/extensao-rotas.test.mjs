import { test } from "node:test";
import assert from "node:assert/strict";
import { keyValida, normThreadId, parseHash, threadIdValido } from "../../extensao-crm/src/rotas.ts";

test("keyValida/threadIdValido/normThreadId", () => {
  assert.equal(keyValida("p_Tm-IraN9rl2k"), true); assert.equal(keyValida("abc"), false); assert.equal(keyValida("a/b"), false); assert.equal(keyValida(1), false);
  assert.equal(threadIdValido("1A1544925ACE5958"), true); assert.equal(threadIdValido("xyz"), false); assert.equal(threadIdValido(null), false);
  assert.equal(normThreadId(" 1A15 ".trim()), "1a15");
});
test("parseHash: #meu-bot-crm/home, /pipeline/<key>, /caixa/<key>; os antigos #crm/… também; o resto é null", () => {
  assert.deepEqual(parseHash("#meu-bot-crm/home"), { tipo: "inicio" }); assert.deepEqual(parseHash("#crm/inicio"), { tipo: "inicio" });
  assert.deepEqual(parseHash("#meu-bot-crm/pipeline/p_abcd1234"), { tipo: "pipeline", key: "p_abcd1234" });
  assert.deepEqual(parseHash("#crm/pipeline/p_abcd1234"), { tipo: "pipeline", key: "p_abcd1234" });
  assert.deepEqual(parseHash("meu-bot-crm/caixa/b_x1y2z3w4"), { tipo: "caixa", key: "b_x1y2z3w4" });
  assert.equal(parseHash("#crm/pipeline/../x"), null); assert.equal(parseHash("#inbox"), null); assert.equal(parseHash(""), null);
});
