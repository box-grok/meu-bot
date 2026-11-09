// Analytics, a parte pura: lista de IDs, URL sem query/fragmento, caminho sem o slug da organização.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caminhoAnonimo, gaIds, paginaLimpa } from "../dist/analytics-core.js";

test("gaIds: lista separada por vírgula, aparada, sem lixo nem repetição; vazio dá []", () => {
  assert.deepEqual(gaIds("G-FCKW62SB1K"), ["G-FCKW62SB1K"]);
  assert.deepEqual(gaIds(" G-FCKW62SB1K , lixo,G-12CJ787RGJ,G-FCKW62SB1K"), ["G-FCKW62SB1K", "G-12CJ787RGJ"]);
  assert.deepEqual(gaIds("g-minusculo"), []);
  assert.deepEqual(gaIds(""), []); assert.deepEqual(gaIds(null), []); assert.deepEqual(gaIds(undefined), []);
});

test("paginaLimpa: tira query e fragmento (code, state, verifier nunca vão ao Google); URL ilegível dá null", () => {
  assert.equal(paginaLimpa("https://console-staging.agentesgrok.com/account/plan#code=abc&verifier=def"), "https://console-staging.agentesgrok.com/account/plan");
  assert.equal(paginaLimpa("https://auth-staging.agentesgrok.com/entrar?esquema=web&state=x&challenge=y"), "https://auth-staging.agentesgrok.com/entrar");
  assert.equal(paginaLimpa("https://agentesgrok.com/"), "https://agentesgrok.com/");
  assert.equal(paginaLimpa("lixo"), null);
});

test("caminhoAnonimo: o slug da organização vira _; /organizations/new e os caminhos da conta não mudam", () => {
  assert.equal(caminhoAnonimo("/organizations/coflow/members"), "/organizations/_/members");
  assert.equal(caminhoAnonimo("/organizations/coflow/settings"), "/organizations/_/settings");
  assert.equal(caminhoAnonimo("/organizations/coflow"), "/organizations/_");
  assert.equal(caminhoAnonimo("/organizations/new"), "/organizations/new");
  assert.equal(caminhoAnonimo("/enterprise/coflow"), "/enterprise/_");
  assert.equal(caminhoAnonimo("/account/plan"), "/account/plan");
});
