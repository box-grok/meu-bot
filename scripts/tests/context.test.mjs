import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planContext, validateSummary, buildSummaryRequest, estimateTokens, toWire } = require("../../dist/main/context.js");

const msg = (role, n) => ({ role, content: "x".repeat(n) });
const convo = (turns, size) => Array.from({ length: turns * 2 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", size));

test("abaixo do orçamento envia tudo", () => {
  const p = planContext(convo(3, 100), undefined, 10000);
  assert.equal(p.mode, "full");
  assert.equal(p.outgoing.length, 6);
  assert.equal(p.needsSummary, false);
});

test("acima do orçamento: cabeça 2 + cauda com 2 turnos de usuário, começando em user", () => {
  const messages = convo(10, 400); // 20 msgs, ~104 tokens cada ≈ 2080
  const p = planContext(messages, undefined, 800);
  assert.equal(p.mode, "truncated");
  assert.equal(p.outgoing[0].content, messages[0].content);
  const tailFirst = p.outgoing[2];
  assert.equal(tailFirst.role, "user");
  const userTurnsInTail = p.outgoing.slice(2).filter((m) => m.role === "user").length;
  assert.ok(userTurnsInTail >= 2);
  assert.equal(p.needsSummary, true);
  assert.deepEqual(p.summarizeRange, [2, p.tailStart]);
});

test("resumo válido entra no lugar do meio", () => {
  const messages = convo(10, 400);
  const first = planContext(messages, undefined, 800);
  const summary = { text: "## Tarefa atual\nx", coveredUntil: first.tailStart, updatedAt: "" };
  const p = planContext(messages, summary, 800);
  assert.equal(p.mode, "summary");
  assert.ok(p.outgoing[2].content.startsWith("[RESUMO DE CONTEXTO"));
  assert.equal(p.needsSummary, false);
});

test("validateSummary exige 4 seções e corta no limite", () => {
  assert.equal(validateSummary("oi"), null);
  const ok = "## Tarefa atual\na\n## Objetivo\nb\n## Decisões\nc\n## Contexto crítico\nd";
  assert.equal(validateSummary(ok), ok);
  assert.ok(validateSummary(ok + "\n" + "y".repeat(7000)).length <= 6010);
});

test("pedido incremental inclui o resumo anterior", () => {
  const req = buildSummaryRequest("RESUMO X", [msg("user", 5)], "14/10/2026");
  assert.equal(req.length, 1);
  assert.ok(req[0].content.includes("RESUMO ANTERIOR"));
  assert.ok(req[0].content.includes("RESUMO X"));
  assert.equal(estimateTokens("abcd"), 1);
});

test("alreadySeenPrefix: prefixo conhecido só quando o resto é todo novo", () => {
  const { alreadySeenPrefix, planContext: plan } = require("../../dist/main/context.js");
  const msgs = convo(3, 10); // 6 msgs
  const full = plan(msgs, undefined, 10000);
  assert.equal(alreadySeenPrefix(full.outgoing, 4), 4);
  assert.equal(alreadySeenPrefix(full.outgoing, 0), 0);
  // com resumo no meio, o prefixo quebra → 0 (servidor achata)
  const long = convo(10, 400);
  const first = plan(long, undefined, 800);
  const withSummary = plan(long, { text: "## Tarefa atual\nx", coveredUntil: first.tailStart, updatedAt: "" }, 800);
  assert.equal(alreadySeenPrefix(withSummary.outgoing, 2), 0);
});

test("toWire põe a nota do app antes do conteúdo e planContext a preserva", () => {
  const msgs = [{ role: "user", content: "oi" }, { role: "assistant", content: "olá" }, { role: "user", content: "qual modelo?", note: "[nota]" }];
  const plan = planContext(msgs, undefined, 100000);
  const wire = toWire(plan.outgoing);
  assert.equal(wire[2].content, "[nota]\n\nqual modelo?");
  assert.equal(wire[0].content, "oi");
  assert.equal("note" in wire[2], false);
});
