import { test } from "node:test";
import assert from "node:assert/strict";
import { providerLabel } from "../../dist/renderer/lib/provider-label.js";

test("providerLabel: vazio sem provedor; o nome quando bate; fallback explícito", () => {
  assert.equal(providerLabel("grok-4", undefined), "");
  assert.equal(providerLabel("grok-4", ""), "");
  assert.equal(providerLabel("grok-4", "grok-4"), "grok-4");
  assert.equal(providerLabel("agente", "agente"), "agente");
  assert.equal(providerLabel("agente", "grok-4"), "respondeu grok-4 (fallback de agente)");
  assert.equal(providerLabel("agente", "grok-4", "agente falhou (timeout); respondendo com grok-4"), "respondeu grok-4 (fallback de agente) ⚠");
});
