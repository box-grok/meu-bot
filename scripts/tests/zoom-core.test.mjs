import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomFactor, zoomPercent, zoomState, applyZoomAction, parseZoomAction, isZoomLevel } = createRequire(import.meta.url)("../../dist/main/app/zoom-core.js");

test("faixa -8..8, fator 1.2^nível e percentual arredondado (como o Chromium)", () => {
  assert.equal(ZOOM_MIN, -8); assert.equal(ZOOM_MAX, 8);
  assert.equal(zoomFactor(0), 1);
  assert.ok(Math.abs(zoomFactor(1) - 1.2) < 1e-9);
  assert.equal(zoomPercent(1), 120); assert.equal(zoomPercent(2), 144); assert.equal(zoomPercent(3), 173);
  assert.equal(zoomPercent(-1), 83); assert.equal(zoomPercent(-8), 23); assert.equal(zoomPercent(8), 430);
  assert.deepEqual(zoomState(0), { level: 0, factor: 1, percent: 100 });
});

test("clampZoom arredonda, prende à faixa e trata NaN", () => {
  assert.equal(clampZoom(1.4), 1); assert.equal(clampZoom(1.6), 2);
  assert.equal(clampZoom(99), 8); assert.equal(clampZoom(-99), -8);
  assert.equal(clampZoom(Number.NaN), 0); assert.equal(clampZoom(Number.POSITIVE_INFINITY), 0);
  assert.ok(isZoomLevel(3) && isZoomLevel(-8) && isZoomLevel(8));
  assert.ok(!isZoomLevel(9) && !isZoomLevel(1.5) && !isZoomLevel("2") && !isZoomLevel(null));
});

test("ações: passo satura nas bordas, set prende, reset volta a 0", () => {
  assert.equal(applyZoomAction(0, { action: "step", delta: 1 }), 1);
  assert.equal(applyZoomAction(8, { action: "step", delta: 1 }), 8);
  assert.equal(applyZoomAction(-8, { action: "step", delta: -1 }), -8);
  assert.equal(applyZoomAction(5, { action: "set", level: 20 }), 8);
  assert.equal(applyZoomAction(5, { action: "set", level: 2.4 }), 2);
  assert.equal(applyZoomAction(5, { action: "reset" }), 0);
  // nível atual corrompido (fora da faixa) não escapa
  assert.equal(applyZoomAction(50, { action: "step", delta: -1 }), 7);
});

test("parseZoomAction só aceita o contrato", () => {
  assert.deepEqual(parseZoomAction({ action: "reset" }), { action: "reset" });
  assert.deepEqual(parseZoomAction({ action: "step", delta: -1 }), { action: "step", delta: -1 });
  assert.deepEqual(parseZoomAction({ action: "set", level: 3 }), { action: "set", level: 3 });
  for (const bad of [null, "step", {}, { action: "step" }, { action: "step", delta: 2 }, { action: "set", level: "3" }, { action: "set", level: Number.NaN }, { action: "zoom" }]) assert.equal(parseZoomAction(bad), null);
});
