import { test } from "node:test";
import assert from "node:assert/strict";
import { componentesSemVersao, faltasParaPublicar, lerVersao, notasDaRelease, produtosComInstalador, produtosDoCanal, proximaStaging, recusaPromocao } from "../release-core.mjs";

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

test("notasDaRelease: o corpo de \"Ainda não lançado\", que para na próxima seção", () => {
  const cl = `# Changelog\n\n> nota de numeração\n\n---\n\n## Ainda não lançado\n\n### Um título\n\n#### Novo\n\n- Uma coisa.\n- Outra.\n\n---\n\n## 4 de novembro de 2026\n\n### v0.78.4\n\n- Não entra.\n`;
  const n = notasDaRelease(cl);
  assert.match(n, /^### Um título/, "começa no título da leva, sem o cabeçalho do arquivo");
  assert.match(n, /- Outra\./);
  assert.doesNotMatch(n, /Não entra/, "para antes da entrada já publicada");
  assert.doesNotMatch(n, /numeração/, "não pega o que vem antes da seção");
  assert.equal(n, n.trim(), "sem espaço sobrando nas pontas");
});

test("notasDaRelease: sem a seção, ou com ela vazia, devolve null (o release cai no --generate-notes)", () => {
  assert.equal(notasDaRelease("# Changelog\n\n## 4 de novembro\n\n- algo\n"), null, "seção ausente");
  assert.equal(notasDaRelease("## Ainda não lançado\n\n   \n\n## 4 de novembro\n"), null, "só espaço");
  assert.equal(notasDaRelease("## Ainda não lançado\n"), null, "fim do arquivo logo depois");
  assert.equal(notasDaRelease(null), null, "sem changelog nenhum");
  assert.equal(notasDaRelease("## ainda não lançado\n\n- x\n"), null, "o título é exatamente esse, com maiúscula");
});

test("instalador .dmg: só o app das pessoas, nos dois canais (nem admin nem finance-staging)", async () => {
  const P = [{ nome: "meu-bot", canal: "estavel", instalador: true }, { nome: "meu-bot-admin", canal: "estavel", instalador: false }, { nome: "meu-bot-staging", canal: "staging", instalador: true }, { nome: "meu-bot-finance-staging", canal: "staging", instalador: false }, { nome: "sem-campo", canal: "estavel" }];
  assert.deepEqual(produtosComInstalador(P, "estavel").map((p) => p.nome), ["meu-bot"]);
  assert.deepEqual(produtosComInstalador(P, "staging").map((p) => p.nome), ["meu-bot-staging"]);
  // A tabela de verdade (dist/): o cliente e o staging dele levam; os admin e o financeiro, não.
  const { PRODUTOS } = await import("../produtos.mjs");
  assert.deepEqual(PRODUTOS.filter((p) => p.instalador).map((p) => p.variant).sort(), ["client", "client-staging"]);
});

test("faltasParaPublicar (--conferir): admin sem build/suporte para; notas vazias só avisam", () => {
  const admin = { nome: "meu-bot-admin-gestao", caps: { supportAdmin: true } };
  const app = { nome: "meu-bot", caps: { supportAdmin: false } };
  const nada = () => false;
  const comSuporte = (c) => c === "build/suporte/admins.json";
  assert.deepEqual(faltasParaPublicar({ produtos: [app, admin], existe: comSuporte, notas: "- algo" }), { erros: [], avisos: [] });
  assert.equal(faltasParaPublicar({ produtos: [app, admin], existe: nada, notas: "- algo" }).erros.length, 1);
  assert.deepEqual(faltasParaPublicar({ produtos: [app], existe: nada, notas: "- algo" }).erros, [], "staging não leva o admin: sem suporte tudo bem");
  const semNotas = faltasParaPublicar({ produtos: [app], existe: nada, notas: null });
  assert.equal(semNotas.erros.length, 0); assert.equal(semNotas.avisos.length, 1);
  assert.equal(faltasParaPublicar({ produtos: [], existe: nada, notas: "- x" }).erros.length, 1);
});
