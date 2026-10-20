import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { autorizado, configJson, corsHeaders, hostOk, origemOk, rotaCrm } = createRequire(import.meta.url)("../../dist/main/extensao-gmail/extensao-api-core.js");

test("rotaCrm: só sob /v1/crm, sem .., sem //, sem espaços", () => {
  assert.equal(rotaCrm("/v1/crm/pipelines"), "/v1/crm/pipelines"); assert.equal(rotaCrm("/v1/crm/changes?since=3&wait=5"), "/v1/crm/changes?since=3&wait=5"); assert.equal(rotaCrm("/v1/crm"), "/v1/crm");
  assert.equal(rotaCrm("/v1/chat/completions"), null); assert.equal(rotaCrm("/v1/crm/../meu-bot/license"), null); assert.equal(rotaCrm("/v1/crm//x"), null); assert.equal(rotaCrm("/v1/crmx"), null); assert.equal(rotaCrm(undefined), null);
});
test("autorizado: Bearer exato em tempo constante", () => {
  const t = "a".repeat(48);
  assert.equal(autorizado(`Bearer ${t}`, t), true); assert.equal(autorizado(`Bearer ${t}x`, t), false); assert.equal(autorizado(`Bearer ${"b".repeat(48)}`, t), false); assert.equal(autorizado(undefined, t), false); assert.equal(autorizado("Basic x", t), false);
});
test("origemOk/hostOk: só a extensão, o Gmail ou sem Origin; host loopback com a porta", () => {
  const crm = "a".repeat(32), aut = "b".repeat(32), outra = "c".repeat(32);
  const ext = new Map([[crm, "/v1/crm"], [aut, "/v1/crm/autenticador"]]);
  assert.equal(origemOk(undefined, ext, "/v1/crm/status"), true); assert.equal(origemOk("https://mail.google.com", new Map(), "/v1/crm/status"), true);
  assert.equal(origemOk(`chrome-extension://${crm}`, ext, "/v1/crm/pipelines"), true);
  assert.equal(origemOk(`chrome-extension://${aut}`, ext, "/v1/crm/autenticador/codigos"), true);
  assert.equal(origemOk(`chrome-extension://${aut}`, ext, "/v1/crm/autenticador"), true);
  assert.equal(origemOk(`chrome-extension://${aut}`, ext, "/v1/crm/pipelines"), false, "o Autenticador não lê o CRM");
  assert.equal(origemOk(`chrome-extension://${aut}`, ext, "/v1/crm/autenticadorX"), false);
  assert.equal(origemOk(`chrome-extension://${outra}`, ext, "/v1/crm/status"), false); assert.equal(origemOk("https://evil.com", ext, "/v1/crm/status"), false); assert.equal(origemOk(`chrome-extension://${crm}`, new Map(), "/v1/crm/status"), false, "sem id conhecido, só o Gmail");
  assert.equal(hostOk("127.0.0.1:4321", 4321), true); assert.equal(hostOk("localhost:4321", 4321), true); assert.equal(hostOk("127.0.0.1:9999", 4321), false); assert.equal(hostOk("evil.com:4321", 4321), false);
});
test("corsHeaders e configJson", () => {
  const c = corsHeaders("chrome-extension://abc"); assert.equal(c["Access-Control-Allow-Origin"], "chrome-extension://abc"); assert.equal(c["Access-Control-Allow-Private-Network"], "true"); assert.match(c["Access-Control-Allow-Headers"], /authorization/);
  assert.equal(corsHeaders(undefined)["Access-Control-Allow-Origin"], "*");
  assert.deepEqual(JSON.parse(configJson({ porta: 4321, token: "t".repeat(48), host: "agente-box", app: "0.1.0" })), { porta: 4321, token: "t".repeat(48), host: "agente-box", app: "0.1.0" });
});
