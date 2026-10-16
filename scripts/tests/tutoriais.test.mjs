import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLY_OPTIONS, TUTORIAIS, emptyContext, emptyFlags, guideTabTitle, guideView, replyChoiceOf, sidebarBadge, tutorialBadge, tutorialNumber, visibleTutorials } from "../../dist/renderer/lib/tutoriais.js";

const wa = (over = {}) => ({ present: true, gateway: "openclaw", agent: "OpenClaw", ready: false, missing: null, connected: false, state: "", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null, audioIn: false, audioOut: null, ...over });
const t = TUTORIAIS.find((x) => x.id === "whatsapp-openclaw");
const byId = (id) => TUTORIAIS.find((x) => x.id === id);

test("tutoriais: ids únicos e cada passo com título, texto, alvo e regra de conclusão", () => {
  for (const tut of TUTORIAIS) {
    assert.match(tut.id, /^[a-z0-9-]+$/);
    assert.ok(tut.title && tut.short && tut.summary && tut.minutes > 0 && tut.steps.length > 0);
    for (const s of tut.steps) assert.ok(s.id && s.title && s.target && typeof s.done === "function" && (tut.comingSoon === true || s.text));
  }
  assert.equal(new Set(TUTORIAIS.map((x) => x.id)).size, TUTORIAIS.length);
});

test("selo: número, passos e minutos; sem número, só os dois", () => {
  assert.equal(tutorialBadge(t), "Tutorial 2 · 5 passos · 4 min");
  assert.equal(tutorialBadge({ ...t, minutes: 1, steps: [t.steps[0]] }, false), "1 passo · 1 min");
  assert.equal(tutorialBadge(byId("statusline")), "Tutorial 3 · 4 passos · 3 min");
});

test("trilha numerada: números 1..N únicos na ordem; `after` aponta para um tutorial anterior; só o suporte exige o pacote", () => {
  assert.deepEqual(TUTORIAIS.map((x) => x.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(TUTORIAIS.slice(0, 6).map((x) => x.id), ["claude-login", "whatsapp-openclaw", "statusline", "xai-login", "fallback-contas", "suporte"]);
  for (const x of TUTORIAIS) if (x.after !== undefined) { const prev = byId(x.after); assert.ok(prev && prev.number < x.number, `${x.id} depois de ${x.after}`); }
  assert.deepEqual(TUTORIAIS.filter((x) => x.needsSupport).map((x) => x.id), ["suporte"]);
  assert.equal(tutorialNumber("statusline"), 3); assert.equal(tutorialNumber("nada"), null);
});

test("visibleTutorials: 3 e 4 só depois do 1 concluído; 5 só depois do 4; sem pré-requisito, some em vez de ir para arquivados", () => {
  const ids = (finished) => visibleTutorials(emptyContext(), finished).map((x) => x.id);
  assert.deepEqual(ids(() => false), ["claude-login", "whatsapp-openclaw", "whatsapp-objetivo"]);
  assert.deepEqual(ids((x) => x.id === "claude-login"), ["claude-login", "whatsapp-openclaw", "statusline", "xai-login", "whatsapp-objetivo"]);
  assert.ok(ids((x) => x.id === "claude-login" || x.id === "xai-login").includes("fallback-contas"));
  assert.deepEqual(ids(), ids(() => false), "sem `finished`, nada da trilha destravado");
});

test("tutorial 1 · Entrar no Claude Code: login → e-mail (ou \"Vi minha conta\") → primeira resposta; sequencial", () => {
  const t1 = byId("claude-login");
  const c = (claude) => ({ ...emptyContext(), claude: { loggedIn: null, email: null, firstReply: false, ...claude } });
  assert.equal(guideView(t1, null, emptyFlags(), c({})).current, 0, "não consultado ainda");
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: false })).current, 0);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true })).current, 1, "logado sem e-mail: conferir");
  assert.equal(guideView(t1, null, { ...emptyFlags(), claudeSeen: true }, c({ loggedIn: true })).current, 2, "\"Vi minha conta\" destrava");
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b" })).current, 2);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b", firstReply: true })).finished, true);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: false, email: "a@b", firstReply: true })).current, 0, "deslogou: volta ao passo 1");
  assert.equal(t1.steps[0].body, "claude-login"); assert.equal(t1.steps[2].target, "chat");
  assert.equal(guideTabTitle(t1, guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b" }))), "1 · Claude 2/3");
});

test("selo da lateral: número = pendências (interruptor desliga); pulso = novidade (não obedece ao interruptor)", () => {
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 0, avisar: true }), { text: "3", pulse: false });
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 2, avisar: true }), { text: "3", pulse: true });
  assert.equal(sidebarBadge({ todo: 3, novos: 0, avisar: false }), null);
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 2, avisar: false }), { text: "2", pulse: true });
  assert.equal(sidebarBadge({ todo: 0, novos: 0, avisar: true }), null);
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
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true }), emptyFlags())), "2 · WhatsApp 2/5");
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true, dmPolicy: "open", audioIn: true }), { policyChosen: true, tested: true })), "2 · WhatsApp ✓");
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
  assert.equal(guideTabTitle(t, v), "2 · WhatsApp 1/5");
});

test("tutorial do suporte: some sem o pacote; passos pelo estado real; conclui quando a entrega chega", async () => {

  const sup = TUTORIAIS.find((x) => x.id === "suporte");
  assert.equal(sup.number, 6, "por último na trilha: o buraco de quem não tem o pacote fica no fim");
  const s = (over) => ({ ...emptyContext(), support: { available: true, admin: "Lucas", on: false, name: "", log: [], deliveredAt: null, ...over } });
  assert.ok(!visibleTutorials(emptyContext()).includes(sup));
  assert.ok(!visibleTutorials(s({ available: false })).includes(sup));
  assert.ok(visibleTutorials(s({})).includes(sup));
  const wa0 = wa();
  // Dois passos: "Dizer seu nome" (salvar liga; só o admin desliga) e "O que o admin recebe" (conclui com a entrega).
  assert.equal(sup.steps.length, 2);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({})).current, 0);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia" })).current, 0, "nome sem suporte ligado ainda é o passo 1");
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true })).current, 1, "ligado, falta a entrega");
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true, deliveredAt: "2026-10-16T12:00:00Z" })).finished, true);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: false, deliveredAt: "2026-10-16T12:00:00Z" })).current, 0, "desligado pelo admin volta ao começo");
  for (const st of sup.steps) assert.doesNotMatch(`${st.title} ${st.text}`, /Lucas|\{admin\}/, "sem o nome de quem dá o suporte");
});

test("tutorial da status line: sempre visível; instalar, depois os limites no rodapé", async () => {

  const sl = TUTORIAIS.find((x) => x.id === "statusline");
  assert.equal(sl.number, 3);
  assert.ok(!visibleTutorials(emptyContext()).includes(sl), "sem o 1 concluído não aparece");
  assert.ok(visibleTutorials(emptyContext(), (x) => x.id === "claude-login").includes(sl));
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
