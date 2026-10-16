import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments, fmtK, timeUntil, ageText, thresholdToWarn, previewLine } from "../../dist/renderer/lib/status-line.js";

const NOW = 1_792_037_681_000; // 2026-10-15 ~01:14 BRT em ms
const account = { email: "m6@databutton.com.br", assento: "Premium", sessionPct: 37, weeklyPct: 37, sessionResets: 1_792_043_400, weeklyResets: 1_792_472_400, updated: 1_792_037_681, providers: [] };

test("fmtK, timeUntil e ageText seguem o statusline.sh", () => {
  assert.equal(fmtK(950), "950"); assert.equal(fmtK(3200), "3.2k"); assert.equal(fmtK(2_500_000), "2.5M");
  assert.equal(timeUntil(1_792_043_400, NOW), "1h35m");
  assert.equal(timeUntil(1_792_472_400, NOW), "5d0h");
  assert.equal(timeUntil(NOW / 1000 - 10, NOW), "now");
  assert.equal(ageText(1_792_037_681, NOW), "agora");
  assert.equal(ageText(1_792_037_681 - 720, NOW), "há 12 min");
  assert.equal(ageText(null, NOW), "");
});

test("segmentos para modelo Claude: modelo, ctx, turno, conta, sessão, semanal, idade", () => {
  const segs = buildSegments({ model: "agente", ctx: { tokens: 3200, budget: 24000 }, turn: { ms: 6300, completion: 258 }, account, nowMs: NOW });
  assert.deepEqual(segs.map((s) => s.kind), ["model", "ctx", "turn", "account", "session", "weekly", "age"]);
  assert.equal(segs[1].text, "Ctx: 13% · 3.2k/24.0k");
  assert.equal(segs[2].text, "6.3 s · 258 tok · 41 t/s");
  assert.equal(segs[3].text, "m6@databutton.com.br (Premium)");
  assert.equal(segs[4].text, "Sessão: 37% · 1h35m");
  assert.equal(segs[5].text, "Semanal: 37% · 5d0h");
});

test("grok-4 não mostra conta nem limites do Claude; sem dados, só o modelo", () => {
  const segs = buildSegments({ model: "grok-4", ctx: null, turn: null, account, nowMs: NOW });
  assert.deepEqual(segs.map((s) => s.kind), ["model"]);
  assert.deepEqual(buildSegments({ model: "agente", ctx: null, turn: null, account: null }).map((s) => s.kind), ["model"]);
});

test("thresholdToWarn avisa 80, 90 e 95 uma vez cada, na ordem", () => {
  assert.equal(thresholdToWarn(79, 0), null);
  assert.equal(thresholdToWarn(82, 0), 80);
  assert.equal(thresholdToWarn(82, 80), null);
  assert.equal(thresholdToWarn(96, 80), 95);
  assert.equal(thresholdToWarn(null, 0), null);
});

test("segmentos escolhidos filtram o rodapé (turno e idade ficam); prévia acompanha", () => {
  const base = { model: "agente", ctx: { tokens: 1000, budget: 24000 }, turn: { ms: 1500, completion: 300 }, account, nowMs: NOW };
  const all = buildSegments(base).map((s) => s.kind);
  assert.deepEqual(all, ["model", "ctx", "turn", "account", "session", "weekly", "age"]);
  const some = buildSegments({ ...base, segments: { model: true, ctx: false, account: false, session: true, weekly: false } }).map((s) => s.kind);
  assert.deepEqual(some, ["model", "turn", "session", "age"]);
  assert.equal(previewLine(null), "Opus 4.8 | Ctx: 12% · 24.0k/200.0k | você@exemplo.com (Premium) | Sessão: 57% · 1h4m | Semanal: 12% · 3d");
  assert.equal(previewLine({ model: true, ctx: false, account: false, session: false, weekly: true }), "Opus 4.8 | Semanal: 12% · 3d");
});
