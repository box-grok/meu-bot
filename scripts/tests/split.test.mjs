import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSplitRatio, parseSplitPref, splitLabel, splitLayout, splitPrefPageId } from "../../dist/renderer/lib/split.js";

test("clampSplitRatio: mínimos dos dois lados; sem largura para os dois, null", () => {
  assert.equal(clampSplitRatio(0.55, 1000), 0.55);
  assert.equal(clampSplitRatio(0.1, 1000), 0.32);
  assert.equal(clampSplitRatio(0.95, 1000), 0.68);
  assert.equal(clampSplitRatio(NaN, 1000), 0.55);
  assert.equal(clampSplitRatio(0.5, 600), null);
});
test("splitLayout: recolhe abaixo de 760", () => { assert.equal(splitLayout(759), "collapsed"); assert.equal(splitLayout(760), "split"); });
test("parseSplitPref: só páginas conhecidas; proporção fora da faixa vira 0.55; lixo é null", () => {
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageId: "navegador", ratio: 0.4 })), { pageId: "navegador", ratio: 0.4 });
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageId: "term-1", ratio: 5 })), { pageId: "term-1", ratio: 0.55 });
  assert.deepEqual(parseSplitPref(JSON.stringify({ pageId: "tut-claude-login" })), { pageId: "tut-claude-login", ratio: 0.55 });
  for (const v of [null, "", "x", JSON.stringify({ pageId: "../etc" }), JSON.stringify({ pageId: 3 })]) assert.equal(parseSplitPref(v), null, String(v));
  assert.equal(splitPrefPageId("term-7"), "term-1"); assert.equal(splitPrefPageId("navegador"), "navegador");
});
test("splitLabel", () => {
  assert.equal(splitLabel("Navegador", null), "Sair do modo dividido");
  assert.equal(splitLabel(null, "Terminal 1"), "Dividir a tela com Terminal 1");
  assert.match(splitLabel(null, null), /^Dividir a tela/);
});
