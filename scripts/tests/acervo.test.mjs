import assert from "node:assert/strict";
import { test } from "node:test";
import { ACERVO_SKILLS, installPrompt } from "../../dist/renderer/lib/acervo.js";

test("o acervo começa vazio e cada skill terá id, nome, resumo, passos e conferência", () => {
  assert.ok(Array.isArray(ACERVO_SKILLS));
  for (const s of ACERVO_SKILLS) {
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(s.name && s.summary && s.check);
    assert.ok(s.install.length > 0);
  }
  assert.equal(new Set(ACERVO_SKILLS.map((s) => s.id)).size, ACERVO_SKILLS.length, "ids únicos");
});

test("o pedido ao agente numera os passos e proíbe extras", () => {
  const p = installPrompt({ id: "x", name: "Exemplo", summary: "faz algo", install: ["um", "dois"], check: "ls x" }, "agente-box");
  assert.match(p, /"Exemplo" nesta máquina \(agente-box\)/);
  assert.match(p, /\n1\. um\n2\. dois\n/);
  assert.match(p, /Confira: ls x/);
  assert.match(p, /Não instale nem atualize nada além do pedido/);
});
