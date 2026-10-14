import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByDate, matches, normalize } from "../../dist/renderer/lib/sidebar.js";

test("normalize remove acento e caixa", () => {
  assert.equal(normalize("Configurações Ágil"), "configuracoes agil");
});

test("matches exige todos os termos, sem acento", () => {
  const conv = { id: "1", title: "Plano de férias", updatedAt: "", archived: false, text: "ir pra Bahia em janeiro" };
  assert.equal(matches(conv, "ferias bahia"), true);
  assert.equal(matches(conv, "ferias paris"), false);
  assert.equal(matches(conv, ""), true);
});

test("groupByDate: hoje, ontem, semana, antigas e cabeça Recentes", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0);
  const at = (minAgo) => new Date(now.getTime() - minAgo * 60000).toISOString();
  const convs = [
    { id: "a", updatedAt: at(1) }, { id: "b", updatedAt: at(5) }, { id: "c", updatedAt: at(10) },
    { id: "d", updatedAt: at(120) }, // intervalo > 30 min: fim da cabeça
    { id: "e", updatedAt: at(60 * 30) }, // ontem
    { id: "f", updatedAt: at(60 * 24 * 4) }, // esta semana
    { id: "g", updatedAt: at(60 * 24 * 20) }, // antigas
  ];
  const groups = groupByDate(convs, now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ["Recentes", ["a", "b", "c"]],
    ["Hoje", ["d"]],
    ["Ontem", ["e"]],
    ["Esta semana", ["f"]],
    ["Mais antigas", ["g"]],
  ]);
});

test("groupByDate: sem intervalo de 30 min não há cabeça; com intervalo, há", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0);
  const at = (minAgo) => new Date(now.getTime() - minAgo * 60000).toISOString();
  assert.deepEqual(groupByDate([{ id: "a", updatedAt: at(1) }, { id: "b", updatedAt: at(20) }], now).map((g) => g.label), ["Hoje"]);
  assert.deepEqual(groupByDate([{ id: "a", updatedAt: at(1) }, { id: "b", updatedAt: at(40) }], now).map((g) => g.label), ["Recentes", "Hoje"]);
});
