import { test } from "node:test";
import assert from "node:assert/strict";
import { componentesSemVersao, lerVersao, produtosDoCanal, proximaStaging, recusaPromocao } from "../release-core.mjs";

test("release staging: o próximo N sai das tags dessa versão", () => {
  assert.equal(proximaStaging("0.2.0", []), 1);
  assert.equal(proximaStaging("0.2.0", ["v0.1.0", "v0.2.0-staging.1", "v0.2.0-staging.9", "v0.3.0-staging.20", "v0.2.0-staging.x", ""]), 10);
});

test("promoção: só num commit publicado como staging da mesma versão", () => {
  assert.match(recusaPromocao("0.2.0", []), /não foi publicado como staging/);
  assert.match(recusaPromocao("0.2.0", ["v0.1.0"]), /não foi publicado como staging/);
  assert.match(recusaPromocao("0.2.0", ["v0.1.0-staging.4"]), /outra versão/);
  assert.equal(recusaPromocao("0.2.0", ["v0.2.0-staging.3"]), null);
});

test("cada canal publica os seus produtos (o admin só no estável)", () => {
  const P = [{ nome: "meu-bot", canal: "estavel" }, { nome: "meu-bot-admin", canal: "estavel" }, { nome: "meu-bot-staging", canal: "staging" }];
  assert.deepEqual(produtosDoCanal(P, "staging").map((p) => p.nome), ["meu-bot-staging"]);
  assert.deepEqual(produtosDoCanal(P, "estavel").map((p) => p.nome), ["meu-bot", "meu-bot-admin"]);
});

test("app com módulos de repositório privado (meu-bot-diego) não vai para a release pública", () => {
  const P = [{ nome: "meu-bot", canal: "estavel", caps: { modulos: null } }, { nome: "meu-bot-diego", canal: "estavel", caps: { modulos: "meu-bot-diego" } }, { nome: "meu-bot-diego-staging", canal: "staging", caps: { modulos: "meu-bot-diego" } }];
  assert.deepEqual(produtosDoCanal(P, "estavel").map((p) => p.nome), ["meu-bot"]);
  assert.deepEqual(produtosDoCanal(P, "staging").map((p) => p.nome), []);
});

test("componentesSemVersao: componente que mudou exige versão nova; o que não mudou passa", () => {
  const C = [
    { nome: "backend", arquivos: ["backend-colima/server.js", "backend-colima/finance-api.js"], versao: "backend-colima/VERSION" },
    { nome: "financeiro", arquivos: ["backend-colima/finance/index.js"], versao: "backend-colima/finance/package.json" },
  ];
  const r = componentesSemVersao(C, ["backend-colima/finance-api.js", "src/main/x.ts"], { backend: { antes: "1.0.0", agora: "1.0.0" } });
  assert.equal(r.length, 1); assert.match(r[0], /^backend: mudou \(backend-colima\/finance-api\.js\).*1\.0\.0; suba a versão/);
  assert.deepEqual(componentesSemVersao(C, ["backend-colima/finance-api.js"], { backend: { antes: "1.0.0", agora: "1.1.0" } }), [], "subiu: passa");
  assert.deepEqual(componentesSemVersao(C, ["src/main/x.ts", ""], {}), [], "nada de componente mudou");
  assert.match(componentesSemVersao(C, ["backend-colima/finance/index.js"], { financeiro: { antes: null, agora: null } })[0], /sem versão/);
  assert.deepEqual(componentesSemVersao(C, ["backend-colima/finance/index.js"], { financeiro: { antes: null, agora: "1.0.0" } }), [], "componente novo, com versão");
});

test("lerVersao: VERSION em texto, package.json pelo campo version", () => {
  assert.equal(lerVersao("backend-colima/VERSION", "1.2.0\n"), "1.2.0");
  assert.equal(lerVersao("backend-colima/VERSION", "  \n"), null);
  assert.equal(lerVersao("x/package.json", '{"name":"a","version":"2.0.1"}'), "2.0.1");
  assert.equal(lerVersao("x/package.json", "lixo"), null);
  assert.equal(lerVersao("x/package.json", null), null);
  assert.equal(lerVersao("x/plugin.yaml", 'name: a\nversion: "1.2.3"\n'), "1.2.3", "plugin do Hermes: a linha version do yaml");
  assert.equal(lerVersao("x/plugin.yaml", "name: a\n"), null);
});
