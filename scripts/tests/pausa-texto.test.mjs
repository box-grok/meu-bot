import { test } from "node:test";
import assert from "node:assert/strict";
import { pausaAteTexto } from "../../dist/renderer/lib/pausa-texto.js";

test("pausaAteTexto: hoje só a hora; amanhã diz amanhã; depois a data; sem prazo ou inválido, vazio", () => {
  const agora = new Date(2026, 9, 29, 13, 0); // 29/10/2026 13:00, hora local
  assert.equal(pausaAteTexto(new Date(2026, 9, 29, 15, 0).toISOString(), agora), "até 15:00");
  assert.equal(pausaAteTexto(new Date(2026, 9, 30, 9, 5).toISOString(), agora), "até amanhã, 09:05");
  assert.equal(pausaAteTexto(new Date(2026, 9, 31, 14, 30).toISOString(), agora), "até 31/10, 14:30");
  assert.equal(pausaAteTexto(null, agora), "");
  assert.equal(pausaAteTexto(undefined, agora), "");
  assert.equal(pausaAteTexto("ontem", agora), "");
});
