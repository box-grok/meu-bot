import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ZOOM_STEPS, caberAuto, larguraMinima, zoomParaCaber } from "../../dist/renderer/lib/nav-caber-core.js";

test("caberAuto: só o Gmail (host exato)", () => {
  assert.equal(caberAuto("mail.google.com"), true);
  assert.equal(caberAuto("docs.google.com"), false);
  assert.equal(caberAuto("mail.google.com.evil.example"), false);
  assert.equal(caberAuto(null), false);
});

test("larguraMinima: estouro vira mínimo; sem estouro fica a anterior; só cresce", () => {
  assert.equal(larguraMinima(null, 640, 640), null); // coube: nada a dizer
  assert.equal(larguraMinima(null, 643, 640), null); // folga: barra de rolagem não é estouro
  assert.equal(larguraMinima(null, 760.4, 640), 760); // estourou: mínimo conhecido
  assert.equal(larguraMinima(760, 700, 640), 760); // estouro menor não encolhe o mínimo
  assert.equal(larguraMinima(760, 800, 640), 800); // estouro maior cresce
  assert.equal(larguraMinima(760, 640, 640), 760); // coube (já com zoom): mantém
  assert.equal(larguraMinima(null, 5000, 640), null); // medida absurda (página montando): ignorada
  assert.equal(larguraMinima(700, NaN, 640), 700);
  assert.equal(larguraMinima(700, 900, 0), 700);
});

test("zoomParaCaber: o maior degrau em que a página cabe, nunca acima de 100%", () => {
  assert.equal(zoomParaCaber(637, null), 1); // sem mínimo conhecido: 100%
  assert.equal(zoomParaCaber(637, 760), 0.8); // 637/760 = 0,838 → 80%
  assert.equal(zoomParaCaber(637, 700), 0.9);
  assert.equal(zoomParaCaber(1200, 760), 1); // cabe folgado: 100%, não amplia
  assert.equal(zoomParaCaber(300, 760), NAV_ZOOM_STEPS[0]); // estreito demais: para no menor degrau
  assert.equal(zoomParaCaber(760, 760), 1); // exato cabe
  assert.equal(zoomParaCaber(0, 760), 1); // área ainda sem medida (escondida)
});

test("zoomParaCaber: converge (no zoom escolhido a página passa a caber)", () => {
  const minimo = 760; const largura = 637;
  const z = zoomParaCaber(largura, minimo);
  const innerWidth = largura / z; // px CSS que a página ganha nesse zoom
  assert.ok(innerWidth >= minimo, `${innerWidth} >= ${minimo}`);
  assert.equal(larguraMinima(minimo, minimo, innerWidth), minimo); // sem novo estouro: o zoom fica
});
