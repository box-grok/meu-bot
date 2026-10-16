import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLY_OPTIONS, TUTORIAIS, emptyFlags, guideTabTitle, guideView, replyChoiceOf, tutorialBadge } from "../../dist/renderer/lib/tutoriais.js";

const wa = (over = {}) => ({ present: true, gateway: "openclaw", agent: "OpenClaw", ready: false, missing: null, connected: false, state: "", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null, ...over });
const t = TUTORIAIS[0];

test("tutoriais: ids únicos e cada passo com título, texto, alvo e regra de conclusão", () => {
  for (const tut of TUTORIAIS) {
    assert.match(tut.id, /^[a-z0-9-]+$/);
    assert.ok(tut.title && tut.short && tut.summary && tut.minutes > 0 && tut.steps.length > 0);
    for (const s of tut.steps) assert.ok(s.id && s.title && s.target && typeof s.done === "function" && (tut.comingSoon === true || s.text));
  }
  assert.equal(new Set(TUTORIAIS.map((x) => x.id)).size, TUTORIAIS.length);
});

test("selo: badge, passos e minutos; sem badge, só os dois", () => {
  assert.equal(tutorialBadge(t), "Comece por aqui · 4 passos · 3 min");
  assert.equal(tutorialBadge({ ...t, minutes: 1, steps: [t.steps[0]] }, false), "1 passo · 1 min");
});

test("guia do WhatsApp: o estado real marca os passos; QR já lido pula direto para a escolha", () => {
  assert.deepEqual(guideView(t, null, emptyFlags()), { done: [false, false, false, false], current: 0, finished: false });
  assert.equal(guideView(t, wa({ ready: true }), emptyFlags()).current, 1);
  const v = guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), emptyFlags());
  assert.deepEqual(v.done, [true, true, false, false]);
  assert.equal(v.current, 2, "o padrão gravado sozinho não conta como escolha");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "open" }), emptyFlags()).current, 3, "open é escolha explícita");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), { policyChosen: true, tested: false }).current, 3);
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), { policyChosen: true, tested: true }).finished, true);
});

test("título da aba do guia: progresso, e ✓ quando termina", () => {
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true }), emptyFlags())), "WhatsApp 2/4");
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true, dmPolicy: "open" }), { policyChosen: true, tested: true })), "WhatsApp ✓");
});

test("cartões de quem responder: só você é o padrão; a política gravada marca o cartão certo", () => {
  assert.deepEqual(REPLY_OPTIONS.map((o) => [o.id, o.isDefault]), [["self", true], ["open", false]]);
  assert.equal(replyChoiceOf("allowlist"), "self");
  assert.equal(replyChoiceOf("open"), "open");
  assert.equal(replyChoiceOf("pairing"), null);
  assert.equal(replyChoiceOf("disabled"), null);
});

test("guia é sequencial: marcações antigas não acendem passos à frente de um pendente", () => {
  const v = guideView(t, wa({ ready: true, connected: false }), { policyChosen: true, tested: true });
  assert.deepEqual(v.done, [true, false, false, false]);
  assert.equal(v.current, 1);
  assert.equal(guideTabTitle(t, v), "WhatsApp 1/4");
});
