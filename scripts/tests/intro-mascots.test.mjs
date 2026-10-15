import { test } from "node:test";
import assert from "node:assert/strict";
import { MASCOT_HUES, planMascots } from "../../dist/renderer/lib/intro-mascots.js";

/** Gerador determinístico (LCG) para o teste não depender do Math.random. */
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

test("mascotes ficam no arco superior, dentro da elipse, com cores e sementes próprias", () => {
  const m = planMascots(5, lcg(7));
  assert.equal(m.length, 5);
  for (const x of m) {
    assert.ok(x.y < 0, `acima do nome (y=${x.y})`);
    assert.ok(Math.abs(x.x) <= 170 && Math.abs(x.y) <= 78, "dentro da elipse");
    assert.ok(x.size >= 26 && x.size <= 34, `tamanho ${x.size}`);
    assert.ok(x.seed >= 0 && x.seed < 1, "semente em [0,1)");
  }
  assert.deepEqual(m.map((x) => x.hue), [...MASCOT_HUES]);
  assert.deepEqual(m.map((x) => x.delayMs), [120, 190, 260, 330, 400], "entrada escalonada de 70 ms");
  assert.ok(m[0].x < 0 && m[4].x > 0 && Math.abs(m[2].x) < 30, "da esquerda para a direita, o do meio no topo");
  assert.ok(new Set(m.map((x) => x.seed)).size === 5, "sementes distintas");
});

test("determinístico com a mesma semente; um só mascote vai para o topo", () => {
  assert.deepEqual(planMascots(5, lcg(1)), planMascots(5, lcg(1)));
  const [um] = planMascots(1, lcg(3));
  assert.ok(Math.abs(um.x) < 30 && um.y < -60, "sozinho, no topo");
});
