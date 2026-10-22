import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { resolveVariant, capsFor, titleFor, userDataNameFor, PRODUTOS, produtoDe } = createRequire(import.meta.url)("../../dist/main/variant-core.js");

test("resolveVariant: em dev manda a variável de ambiente; empacotado manda o variant.json", () => {
  assert.equal(resolveVariant({ packaged: false, env: "admin", variantJson: undefined }), "admin");
  assert.equal(resolveVariant({ packaged: false, env: undefined, variantJson: undefined }), "client");
  assert.equal(resolveVariant({ packaged: false, env: "qualquer", variantJson: { variant: "admin" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: "admin", variantJson: undefined }), "client", "empacotado ignora o ambiente");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "admin" } }), "admin");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "client" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: "lixo" }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: null }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: 1 } }), "client");
  assert.equal(resolveVariant({ packaged: false, env: "crm", variantJson: undefined }), "crm", "dev: MEU_BOT_VARIANT=crm");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "crm" } }), "crm");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "vendas" } }), "client", "produto que não está na tabela cai no cliente");
});

const BOOLS = ["chat", "pair", "login", "manageWa", "tunnel", "install", "supportClient", "supportAdmin", "navegador"];

test("capsFor: o admin só tem supportAdmin; o cliente tem tudo menos isso (o CRM próprio é pela licença, não por caps)", () => {
  const admin = capsFor("admin");
  const client = capsFor("client");
  assert.equal(admin.variant, "admin");
  assert.equal(client.variant, "client");
  for (const k of BOOLS) {
    assert.equal(admin[k], k === "supportAdmin", `admin.${k}`);
    assert.equal(client[k], k !== "supportAdmin", `client.${k}`);
  }
  assert.equal(client.planoExigido, "free"); assert.equal(admin.planoExigido, "free");
  assert.equal(client.produto, "meu-bot"); assert.equal(admin.produto, "meu-bot-admin");
  assert.deepEqual(Object.keys(admin).sort(), Object.keys(client).sort());
});

test("meu-bot traz as duas extensões e funde a pasta do antigo meu-bot-crm; o crm está encerrado (sem extensões, sem herança)", () => {
  const client = produtoDe("client"), crm = produtoDe("crm");
  assert.deepEqual(client.extensoes, ["extensao-crm", "extensao-autenticador"]);
  assert.equal(client.fundeDe, "meu-bot-crm"); assert.equal(client.encerrado, false);
  assert.equal(crm.encerrado, true); assert.deepEqual(crm.extensoes, []); assert.equal(crm.herdaDe, null); assert.equal(crm.fundeDe, null);
  assert.equal(capsFor("crm").produto, "meu-bot-crm", "a licença antiga continua identificável");
  assert.equal(capsFor("crm").planoExigido, "free");
  for (const p of PRODUTOS) if (p.variant !== "crm") assert.equal(p.encerrado, false, `${p.nome} em uso`);
});

test("titleFor e userDataNameFor", () => {
  assert.equal(titleFor("admin"), "meu-bot-admin");
  assert.equal(titleFor("client"), "meu-bot");
  assert.equal(titleFor("crm"), "meu-bot-crm");
  assert.equal(userDataNameFor("client"), null, "o meu-bot fica na pasta padrão do Electron");
  assert.equal(userDataNameFor("admin"), "meu-bot-admin");
  assert.equal(userDataNameFor("crm"), "meu-bot-crm");
});

test("PRODUTOS: ids, nomes e bundle ids únicos; bundle id = local.<nome>; ícone .icns", () => {
  const ids = PRODUTOS.map((p) => p.variant), nomes = PRODUTOS.map((p) => p.nome), bundles = PRODUTOS.map((p) => p.bundleId);
  assert.equal(new Set(ids).size, ids.length); assert.equal(new Set(nomes).size, nomes.length); assert.equal(new Set(bundles).size, bundles.length);
  for (const p of PRODUTOS) {
    assert.equal(p.bundleId, p.canal === "staging" ? `local.${p.nome.replace(/-staging$/, "")}.staging` : `local.${p.nome}`);
    assert.match(p.icone, /^assets\/icon(-[a-z]+)*\.icns$/);
    for (const e of p.extensoes) assert.doesNotMatch(e, /[\/]/, "pasta da extensão sem barras");
    assert.equal(produtoDe(p.variant), p);
  }
  assert.throws(() => produtoDe("vendas"));
});

test("canal staging: as linhas saem da estável (nome, bundle, ícone, dados, porta, herança, licença)", () => {
  const st = produtoDe("client-staging");
  assert.deepEqual([st.nome, st.bundleId, st.icone, st.userData, st.herdaDe, st.portaLocal, st.licenca, st.canal], ["meu-bot-staging", "local.meu-bot.staging", "assets/icon-staging.icns", "meu-bot-staging", "meu-bot", 8791, "meu-bot", "staging"]);
  assert.deepEqual(st.extensoes, produtoDe("client").extensoes, "as extensões do estável");
  assert.equal(st.fundeDe, "meu-bot-crm-staging", "funde a pasta do antigo crm-staging");
  assert.equal(PRODUTOS.some((p) => p.variant === "crm-staging"), false, "o crm encerrado não tem staging");
  assert.equal(PRODUTOS.some((p) => p.variant === "admin-staging"), false, "o admin é só estável");
  // A licença libera pelo produto do estável; o nome do app e o título são outros.
  const c = capsFor("client-staging", "0.2.0-staging.3");
  assert.deepEqual([c.produto, c.canal, c.nome, c.titulo], ["meu-bot", "staging", "meu-bot-staging", "meu-bot-staging 0.2.0-staging.3"]);
  assert.equal(capsFor("client", "0.2.0").titulo, "meu-bot", "o estável não mostra a versão no título");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "crm-staging" } }), "client", "variante que saiu da tabela cai no cliente");
  assert.equal(resolveVariant({ packaged: false, env: "client-staging", variantJson: undefined }), "client-staging");
  // Portas: os apps que podem abrir juntos com o estável não dividem a dele.
  assert.notEqual(st.portaLocal, produtoDe("client").portaLocal);
});
