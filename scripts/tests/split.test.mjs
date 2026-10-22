import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSplitRatio, maxColunas, minDireita, parseSplitPref, splitAdd, splitLabel, splitLayout, splitPrefPageIds, MAX_SPLIT } from "../../dist/renderer/lib/split.js";

test("clampSplitRatio: mínimos dos dois lados; sem largura para os dois, null", () => {
  assert.equal(clampSplitRatio(0.55, 1000), 0.55);
  assert.ok(Math.abs(clampSplitRatio(0.1, 1000) - 0.32) < 1e-9);
  assert.ok(Math.abs(clampSplitRatio(0.95, 1000) - 0.68) < 1e-9);
  assert.equal(clampSplitRatio(NaN, 1000), 0.55);
  assert.equal(clampSplitRatio(0.5, 600), null);
});
test("várias colunas: a direita precisa de 260 px por coluna; sem espaço, null", () => {
  assert.equal(minDireita(1), 320); assert.equal(minDireita(3), 780);
  assert.equal(clampSplitRatio(0.55, 1000, 320, minDireita(3)), null);
  assert.ok(Math.abs(clampSplitRatio(0.55, 1400, 320, minDireita(3)) - (1 - 780 / 1400)) < 1e-9);
});
test("splitAdd: já aberta fica; com espaço entra no fim; cheia substitui a última", () => {
  assert.deepEqual(splitAdd([], "navegador"), ["navegador"]);
  assert.deepEqual(splitAdd(["navegador"], "term-1"), ["navegador", "term-1"]);
  assert.deepEqual(splitAdd(["navegador", "term-1"], "navegador"), ["navegador", "term-1"]);
  assert.deepEqual(splitAdd(["a", "b", "c"], "d", 3), ["a", "b", "d"]);
  assert.deepEqual(splitAdd(["a", "b", "c"], "d", 5), ["a", "b", "c", "d"]);
});
test("maxColunas: quantas cabem pela largura (260 px cada + a conversa), entre 1 e o teto", () => {
  assert.equal(maxColunas(700), 1); assert.equal(maxColunas(1200), 3); assert.equal(maxColunas(1920), 6);
  assert.equal(maxColunas(10_000), MAX_SPLIT); assert.equal(maxColunas(NaN), 1);
});
test("splitLayout: recolhe abaixo de 760", () => { assert.equal(splitLayout(759), "collapsed"); assert.equal(splitLayout(760), "split"); });
test("parseSplitPref: só páginas conhecidas, sem repetir, até o teto; formato antigo aceito; lixo é null", () => {
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageId: "navegador", ratio: 0.4 })), { pageIds: ["navegador"], ratio: 0.4 });
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageIds: ["term-1", "navegador", "term-1", "../x", "acervo", "tutoriais"], ratio: 5 })), { pageIds: ["term-1", "navegador", "acervo", "tutoriais"], ratio: 0.55 });
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageId: "tut-claude-login" })), { pageIds: ["tut-claude-login"], ratio: 0.55 });
  for (const v of [null, "", "x", JSON.stringify({ pageId: "../etc" }), JSON.stringify({ pageId: 3 }), JSON.stringify({ pageIds: [] })]) assert.equal(parseSplitPref(v), null, String(v));
  assert.deepEqual(splitPrefPageIds(["term-7", "navegador", "term-9"]), ["term-1", "navegador", "term-2"]);
});
test("splitLabel", () => {
  assert.equal(splitLabel("Navegador", null), "Sair do modo dividido");
  assert.equal(splitLabel(null, "Terminal 1"), "Dividir a tela com Terminal 1");
  assert.match(splitLabel(null, null), /^Dividir a tela/);
});
