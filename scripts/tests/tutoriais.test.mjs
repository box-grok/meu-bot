import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLY_OPTIONS, TUTORIAIS, emptyFlags, guideTabTitle, guideView, replyChoiceOf, tutorialBadge } from "../../dist/renderer/lib/tutoriais.js";

const wa = (over = {}) => ({ present: true, gateway: "openclaw", agent: "OpenClaw", ready: false, missing: null, connected: false, state: "", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null, audioIn: false, audioOut: null, ...over });
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
  assert.equal(tutorialBadge(t), "Próximo · 5 passos · 4 min");
  assert.equal(tutorialBadge({ ...t, minutes: 1, steps: [t.steps[0]] }, false), "1 passo · 1 min");
});

test("guia do WhatsApp: o estado real marca os passos; QR já lido pula direto para a escolha", () => {
  assert.deepEqual(guideView(t, null, emptyFlags()), { done: [false, false, false, false, false], current: 0, finished: false });
  assert.equal(guideView(t, wa({ ready: true }), emptyFlags()).current, 1);
  const v = guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), emptyFlags());
  assert.deepEqual(v.done, [true, true, false, false, false]);
  assert.equal(v.current, 2, "o padrão gravado sozinho não conta como escolha");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "open" }), emptyFlags()).current, 3, "open é escolha explícita");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), { policyChosen: true, tested: false }).current, 3, "sem transcrição, o passo do áudio");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist", audioIn: true }), { policyChosen: true, tested: false }).current, 4, "transcrição ligada: falta o teste");
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist", audioIn: true }), { policyChosen: true, tested: true }).finished, true);
  assert.equal(guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), { policyChosen: true, tested: true }).finished, false, "testar não pula a transcrição");
});

test("título da aba do guia: progresso, e ✓ quando termina", () => {
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true }), emptyFlags())), "WhatsApp 2/5");
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true, dmPolicy: "open", audioIn: true }), { policyChosen: true, tested: true })), "WhatsApp ✓");
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
  assert.deepEqual(v.done, [true, false, false, false, false]);
  assert.equal(v.current, 1);
  assert.equal(guideTabTitle(t, v), "WhatsApp 1/5");
});

test("tutorial do suporte: some sem o pacote; passos pelo estado real; conclui quando a entrega chega", async () => {
  const { visibleTutorials } = await import("../../dist/renderer/lib/tutoriais.js");
  const sup = TUTORIAIS.find((x) => x.id === "suporte");
  const idx = TUTORIAIS.indexOf(sup);
  assert.equal(TUTORIAIS[idx - 1].id, "whatsapp-openclaw", "depois do WhatsApp");
  const s = (over) => ({ support: { available: true, admin: "Lucas", on: false, name: "", log: [], deliveredAt: null, ...over }, statusLine: { installed: null, limits: false, segments: null } });
  assert.ok(!visibleTutorials({ support: null, statusLine: { installed: null, limits: false, segments: null } }).includes(sup));
  assert.ok(!visibleTutorials(s({ available: false })).includes(sup));
  assert.ok(visibleTutorials(s({})).includes(sup));
  const wa0 = wa();
  assert.equal(guideView(sup, wa0, emptyFlags(), s({})).current, 0);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia" })).current, 1);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true })).current, 2, "ligado, falta a entrega");
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true, deliveredAt: "2026-10-16T12:00:00Z" })).finished, true);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: false, deliveredAt: "2026-10-16T12:00:00Z" })).current, 1, "desligado volta");
  for (const st of sup.steps) assert.doesNotMatch(`${st.title} ${st.text}`, /Lucas|\{admin\}/, "sem o nome de quem dá o suporte");
});

test("tutorial da status line: sempre visível; instalar, depois os limites no rodapé", async () => {
  const { visibleTutorials, emptyContext } = await import("../../dist/renderer/lib/tutoriais.js");
  const sl = TUTORIAIS.find((x) => x.id === "statusline");
  assert.equal(TUTORIAIS[TUTORIAIS.indexOf(sl) - 1].id, "suporte", "depois do suporte");
  assert.ok(visibleTutorials(emptyContext()).includes(sl));
  const ALL = { model: true, ctx: true, account: true, session: true, weekly: true };
  const c = (installed, limits, segments = null) => ({ ...emptyContext(), statusLine: { installed, limits, segments } });
  assert.equal(guideView(sl, null, emptyFlags(), c(null, false)).current, 0, "ainda não consultado");
  assert.equal(guideView(sl, null, emptyFlags(), c(false, true)).current, 0);
  assert.equal(guideView(sl, null, emptyFlags(), c(true, false)).current, 1, "instalada: falta escolher o que aparece");
  assert.equal(guideView(sl, null, emptyFlags(), c(true, false, ALL)).current, 2, "escolheu: falta conferir no terminal");
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, false, ALL)).current, 3, "conferiu: faltam os limites");
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, true, ALL)).finished, true);
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, true)).current, 1, "sem escolher não pula");
  const { GUIDE_ACTION_LABEL } = await import("../../dist/renderer/lib/tutoriais.js");
  assert.equal(sl.steps.at(-1).target, "chat", "o último passo leva à conversa, onde a status line aparece");
  assert.equal(GUIDE_ACTION_LABEL.chat, "Ir para a conversa");
});
