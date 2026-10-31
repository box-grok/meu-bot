import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_PRIMARIES, fallbackOrderText, fallbackReserve } from "../../dist/renderer/lib/fallback.js";

test("fallback: a reserva é quem mais está disponível na corrente; a frase explica primário, reserva e corrente ausente", () => {
  const chain = [{ name: "agente", available: true }, { name: "grok-4", available: true }];
  assert.deepEqual(FALLBACK_PRIMARIES, ["agente", "grok-4"]);
  assert.deepEqual(fallbackReserve("agente", chain), ["grok-4"]);
  assert.deepEqual(fallbackReserve("agente", [{ name: "agente", available: true }, { name: "grok-4", available: false }]), []);
  assert.match(fallbackOrderText("agente", null), /ainda não informa/);
  assert.match(fallbackOrderText("claudecode", chain), /fora da corrente/);
  assert.match(fallbackOrderText("agente", [{ name: "agente", available: true }]), /Sem reserva/);
  assert.equal(fallbackOrderText("agente", chain), "Primário: agente. Reserva: grok-4, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
});
