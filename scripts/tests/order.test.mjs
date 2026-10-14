import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { reorderWithin, nextOrderAmong } = createRequire(import.meta.url)("../../dist/main/order.js");

const items = [
  { id: "a", host: "colima", order: 0 }, { id: "b", host: "colima", order: 1 }, { id: "c", host: "colima", order: 2 },
  { id: "x", host: "local", order: 0 }, { id: "y", host: "local", order: 1 },
];

test("reorderWithin só renumera a máquina pedida", () => {
  const out = reorderWithin(items, ["c", "a"], "colima");
  assert.deepEqual([...out.entries()], [["c", 0], ["a", 1], ["b", 2]]);
  assert.equal(out.has("x"), false);
});

test("reorderWithin ignora ids desconhecidas e de outra máquina, sem repetir", () => {
  const out = reorderWithin(items, ["zzz", "x", "b", "b"], "colima");
  assert.deepEqual([...out.entries()], [["b", 0], ["a", 1], ["c", 2]]);
});

test("nextOrderAmong", () => {
  assert.equal(nextOrderAmong([]), 0);
  assert.equal(nextOrderAmong([3, 1, 2]), 4);
});
