import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPalette, scoreItem } from "../../dist/renderer/lib/palette-rank.js";

const items = [
  { id: "cfg", kind: "setting", label: "Configurações" },
  { id: "c1", kind: "conversation", label: "falando de configuracoes do servidor", recency: 2 },
  { id: "new", kind: "action", label: "Nova conversa" },
  { id: "c2", kind: "conversation", label: "Receita de bolo", keywords: ["chocolate", "forno"], recency: 1 },
];

test("prefixo vence substring, sem acento", () => {
  const r = rankPalette(items, "config").map((i) => i.id);
  assert.equal(r[0], "cfg");
  assert.equal(r[1], "c1");
});

test("keyword só entra em último", () => {
  assert.equal(scoreItem(items[3], "chocolate"), 0.4);
  assert.equal(rankPalette(items, "chocolate").map((i) => i.id)[0], "c2");
});

test("AND entre termos e limite", () => {
  assert.equal(rankPalette(items, "receita bolo").length, 1);
  assert.equal(rankPalette(items, "", 2).length, 2);
});

test("vazio lista ações primeiro, depois conversas por recência", () => {
  assert.deepEqual(rankPalette(items, "").map((i) => i.id), ["new", "c1", "c2", "cfg"]);
});
