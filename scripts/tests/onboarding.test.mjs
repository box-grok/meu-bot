import { test } from "node:test";
import assert from "node:assert/strict";
import { ONBOARD_STEPS, advanceOnboard, initialOnboardState, pickFeedback, welcomeMessage } from "../../dist/renderer/lib/onboarding.js";

test("só o evento do passo atual avança; os outros são ignorados", () => {
  let s = initialOnboardState();
  let r = advanceOnboard(s, "new-tab");
  assert.equal(r.advanced, false);
  assert.equal(r.state.step, 0);
  r = advanceOnboard(r.state, "sidebar");
  assert.equal(r.advanced, true);
  assert.equal(r.state.step, 1);
  assert.equal(r.finished, false);
});

test("fechar a paleta só conta depois de abrir", () => {
  const s = { step: 1, armed: false };
  assert.equal(advanceOnboard(s, "palette-close").advanced, false);
  const armed = advanceOnboard(s, "palette-open").state;
  assert.equal(armed.armed, true);
  const r = advanceOnboard(armed, "palette-close");
  assert.equal(r.advanced, true);
  assert.equal(r.state.step, 2);
  assert.equal(r.state.armed, false);
});

test("a sequência inteira termina em finished ao criar a primeira conversa", () => {
  let s = initialOnboardState();
  const seq = ["sidebar", "palette-open", "palette-close", "settings-closed", "new-tab"];
  let last;
  for (const ev of seq) { last = advanceOnboard(s, ev); s = last.state; }
  assert.equal(last.finished, true);
  assert.equal(s.step, ONBOARD_STEPS.length);
  assert.equal(advanceOnboard(s, "new-tab").finished, true);
  assert.equal(ONBOARD_STEPS.length, 4);
});

test("feedback varia conforme o sorteio e não repete o anterior", () => {
  const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  assert.equal(pickFeedback(seq(0.1, 0)).kind, "text");
  assert.equal(pickFeedback(seq(0.5, 0)).kind, "icon");
  assert.equal(pickFeedback(seq(0.9)).kind, "none");
  // dois "nada" seguidos viram ícone, para a sequência não ficar previsível
  assert.equal(pickFeedback(seq(0.9, 0), { kind: "none" }).kind, "icon");
  const first = pickFeedback(seq(0.1, 0));
  const second = pickFeedback(seq(0.1, 0), first);
  assert.notEqual(second.text, first.text);
});

test("boas-vindas: deslogado pede o login; logado ou desconhecido sugere o que fazer", () => {
  const off = welcomeMessage("agente-box", false);
  assert.match(off, /\*\*agente-box\*\*/);
  assert.match(off, /entrar no Claude Code/);
  assert.doesNotMatch(off, /ideias para começar/);
  for (const v of [true, null]) {
    const on = welcomeMessage("este Mac", v);
    assert.match(on, /ideias para começar/);
    assert.doesNotMatch(on, /falta \*\*entrar/);
  }
});
