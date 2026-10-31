import test from "node:test";
import assert from "node:assert/strict";
import { NAV_BARRA_COMPACTA_PX, barraCompacta } from "../../dist/renderer/lib/nav-barra-core.js";

test("barraCompacta: estreita abaixo do limite; 0 (escondida) não conta", () => {
  assert.equal(barraCompacta(640), true); // janela em meia tela
  assert.equal(barraCompacta(NAV_BARRA_COMPACTA_PX), false);
  assert.equal(barraCompacta(1200), false);
  assert.equal(barraCompacta(0), false);
});
