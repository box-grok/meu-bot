import { test } from "node:test";
import assert from "node:assert/strict";
import { loginView, LOGIN_STEPS } from "../../dist/renderer/lib/login-steps.js";

const ctx = { machine: "agente-box", running: true };
const states = (v) => v.steps.map((s) => s.state);

test("xAI: a sequência real vira passos; o código fica em destaque; o ruído do SSH some", () => {
  const evs = [];
  const at = () => loginView("xai", evs, ctx);
  assert.equal(loginView("xai", [], { machine: "agente-box", running: false }).headline.startsWith("Abre o link da xAI"), true, "intro parada");
  assert.deepEqual(states(at()), ["active", "pending", "pending", "pending"]);
  evs.push({ kind: "log", text: "conectando a agente-box e pedindo o login da xAI ao Hermes" });
  assert.deepEqual(states(at()), ["done", "active", "pending", "pending"]); assert.equal(at().headline, "Pedindo o login à xAI…");
  evs.push({ kind: "url", url: "https://accounts.x.ai/device?code=VTSE-5Q48" }, { kind: "log", text: "código do dispositivo: VTSE-5Q48 (a página já vem com ele; confira e aprove)" });
  let v = at(); assert.deepEqual(states(v), ["done", "done", "active", "pending"]); assert.equal(v.code, "VTSE-5Q48"); assert.match(v.headline, /aprove o dispositivo/);
  evs.push({ kind: "log", text: "Waiting for approval (polling every 5s)..." });
  v = at(); assert.equal(v.steps[2].detail, "Esperando você aprovar na página…");
  evs.push({ kind: "log", text: 'Added xai-oauth OAuth credential #1: "xai-oauth-oauth-1"' }, { kind: "log", text: "Connection to 187.127.41.175 closed." });
  v = at(); assert.deepEqual(states(v), ["done", "done", "done", "active"]); assert.equal(v.headline, "Aprovado! Guardando a credencial…");
  assert.deepEqual(v.details, [], "nenhuma linha crua sobrou para a pessoa");
  evs.push({ kind: "done", ok: true, text: "xAI logada no Hermes desta máquina (xai-oauth-oauth-1); o grok-4 já usa a conta nova." });
  v = loginView("xai", evs, { ...ctx, running: false });
  assert.deepEqual(states(v), ["done", "done", "done", "done"]); assert.equal(v.result, "ok"); assert.equal(v.code, null); assert.match(v.headline, /^✓ xAI logada/);
});

test("xAI: falha marca o passo em andamento como falhou e guarda as linhas desconhecidas nos detalhes", () => {
  const v = loginView("xai", [
    { kind: "log", text: "conectando a colima e pedindo o login da xAI ao Hermes" },
    { kind: "log", text: "hermes: command not found" },
    { kind: "done", ok: false, text: "o login da xAI não concluiu (código 127)." },
  ], { machine: "colima", running: false });
  assert.deepEqual(states(v), ["done", "bad", "pending", "pending"]); assert.equal(v.result, "fail"); assert.deepEqual(v.details, ["hermes: command not found"]);
});

test("Claude: link → código → enviado → conferindo → logado", () => {
  const evs = [{ kind: "log", text: "conectando a colima e iniciando claude auth login" }, { kind: "url", url: "https://claude.ai/oauth/authorize?x" }];
  let v = loginView("claude", evs, { machine: "colima", running: true });
  assert.deepEqual(states(v), ["done", "done", "active", "pending"]); assert.match(v.headline, /cole aqui o código/);
  evs.push({ kind: "waiting-code" }); v = loginView("claude", evs, { machine: "colima", running: true });
  assert.equal(v.steps[2].detail, "Cole o código abaixo e envie.");
  v = loginView("claude", evs, { machine: "colima", running: true, codeSent: true });
  assert.deepEqual(states(v), ["done", "done", "done", "active"]); assert.equal(v.headline, "Código enviado; conferindo o login…");
  evs.push({ kind: "done", ok: true, text: "Claude Code logado nesta máquina." });
  v = loginView("claude", evs, { machine: "colima", running: false, codeSent: true });
  assert.deepEqual(states(v), ["done", "done", "done", "done"]);
  assert.equal(LOGIN_STEPS.claude.length, 4);
});
