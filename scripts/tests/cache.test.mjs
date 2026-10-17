import { test } from "node:test";
import assert from "node:assert/strict";
import { readCache, writeCache, dropCache, clearCache, cacheKey, cacheAgeText } from "../../dist/renderer/lib/cache.js";

/** localStorage de mentira: só o que o módulo usa. */
function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}

test("grava e lê com a hora; chave por máquina", () => {
  const s = fakeStore();
  writeCache(s, "colima", "waChats", [{ number: "1" }], 1000);
  assert.equal(cacheKey("colima", "waChats"), "cache:colima:waChats");
  assert.deepEqual(readCache(s, "colima", "waChats"), { value: [{ number: "1" }], at: 1000 });
  assert.equal(readCache(s, "outra", "waChats"), null);
  assert.equal(readCache(s, "colima", "outro"), null);
});

test("validade: passou de maxAgeMs vira null; sem limite sempre volta", () => {
  const s = fakeStore();
  writeCache(s, "h", "x", 1, 1000);
  assert.equal(readCache(s, "h", "x", 500, 2000), null);
  assert.deepEqual(readCache(s, "h", "x", 5000, 2000), { value: 1, at: 1000 });
  assert.deepEqual(readCache(s, "h", "x", undefined, 99_999_999), { value: 1, at: 1000 });
});

test("lixo no armazenamento e envelope errado viram 'sem cache'; host vazio nunca grava nem lê", () => {
  const s = fakeStore();
  s.setItem(cacheKey("h", "a"), "{nao é json");
  s.setItem(cacheKey("h", "b"), JSON.stringify({ v: 1 }));
  s.setItem(cacheKey("h", "c"), JSON.stringify({ at: "ontem", v: 1 }));
  assert.equal(readCache(s, "h", "a"), null);
  assert.equal(readCache(s, "h", "b"), null);
  assert.equal(readCache(s, "h", "c"), null);
  writeCache(s, "", "a", 1);
  assert.equal(s._m.has("cache::a"), false);
  assert.equal(readCache(s, "", "a"), null);
});

test("armazenamento que estoura não derruba", () => {
  const s = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("cota"); }, removeItem: () => { throw new Error("x"); }, key: () => { throw new Error("x"); }, length: 1 };
  assert.doesNotThrow(() => writeCache(s, "h", "a", 1));
  assert.equal(readCache(s, "h", "a"), null);
  assert.doesNotThrow(() => dropCache(s, "h", "a"));
  assert.equal(clearCache(s, "h"), 0);
});

test("dropCache tira um; clearCache tira só os da máquina", () => {
  const s = fakeStore();
  writeCache(s, "h", "a", 1); writeCache(s, "h", "b", 2); writeCache(s, "h2", "a", 3); s.setItem("sidebarShown", "1");
  dropCache(s, "h", "a");
  assert.equal(readCache(s, "h", "a"), null);
  assert.equal(clearCache(s, "h"), 1);
  assert.deepEqual([...s._m.keys()].sort(), ["cache:h2:a", "sidebarShown"]);
});

test("cacheAgeText", () => {
  const now = 10_000_000;
  assert.equal(cacheAgeText(now - 10_000, now), "agora há pouco");
  assert.equal(cacheAgeText(now - 120_000, now), "há 2 min");
  assert.equal(cacheAgeText(now - 3 * 3_600_000, now), "há 3 h");
  assert.equal(cacheAgeText(now - 26 * 3_600_000, now), "ontem");
  assert.equal(cacheAgeText(now - 3 * 86_400_000, now), "há 3 dias");
});
