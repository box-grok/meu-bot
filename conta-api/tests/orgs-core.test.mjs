// Organizações, a parte pura: slug, reservados, nova organização, patch, convite, domínio, assentos, host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assentosLivres, emailNoDominio, slugDoHost, slugDoNome, validaAssentos, validaConvite, validaNovaOrg, validaPapelOrg, validaPatchOrg, validaSlug } from "../dist/sessao-core.js";

test("validaSlug: minúsculas, dígitos e hífen no meio, 2 a 40; reservados e lixo dão null", () => {
  assert.equal(validaSlug("coflow"), "coflow");
  assert.equal(validaSlug("agentes-integrados-2"), "agentes-integrados-2");
  assert.equal(validaSlug("a"), null);
  assert.equal(validaSlug("-coflow"), null);
  assert.equal(validaSlug("coflow-"), null);
  assert.equal(validaSlug("Coflow"), null);
  assert.equal(validaSlug("co flow"), null);
  assert.equal(validaSlug("a".repeat(41)), null);
  assert.equal(validaSlug("a".repeat(40)), "a".repeat(40));
  for (const r of ["auth", "console", "www", "api", "staging", "console-staging", "organizations", "new"]) assert.equal(validaSlug(r), null, r);
  assert.equal(validaSlug(42), null);
});

test("slugDoNome: tira acentos, espaços e símbolos; o resultado ainda passa por validaSlug", () => {
  assert.equal(slugDoNome("Coflow Tecnologia"), "coflow-tecnologia");
  assert.equal(slugDoNome("  Agentes Integrados! "), "agentes-integrados");
  assert.equal(slugDoNome("Ação & Reação"), "acao-reacao");
  assert.equal(slugDoNome("!!!"), "");
  assert.equal(slugDoNome("x".repeat(60)).length, 40);
});

test("validaNovaOrg: nome 2 a 80 e slug válido; reservado tem mensagem própria", () => {
  assert.deepEqual(validaNovaOrg({ nome: " Coflow ", slug: "coflow" }), { nome: "Coflow", slug: "coflow" });
  assert.match(validaNovaOrg({ nome: "C", slug: "coflow" }).erro, /nome/);
  assert.match(validaNovaOrg({ nome: "Coflow", slug: "auth" }).erro, /reservado/);
  assert.match(validaNovaOrg({ nome: "Coflow", slug: "Co Flow" }).erro, /endereço/);
  assert.match(validaNovaOrg(null).erro, /corpo/);
});

test("validaPatchOrg: nome e domínio (normalizado, @ tirado, null limpa); vazio recusa", () => {
  assert.deepEqual(validaPatchOrg({ nome: "Nova" }), { nome: "Nova" });
  assert.deepEqual(validaPatchOrg({ dominioEmail: "@Coflow.com.BR " }), { dominioEmail: "coflow.com.br" });
  assert.deepEqual(validaPatchOrg({ dominioEmail: "" }), { dominioEmail: null });
  assert.deepEqual(validaPatchOrg({ dominioEmail: null }), { dominioEmail: null });
  assert.match(validaPatchOrg({ dominioEmail: "semponto" }).erro, /dominioEmail/);
  assert.match(validaPatchOrg({}).erro, /nada/);
});

test("validaConvite e validaPapelOrg: e-mail em minúsculas, papel admin|membro (membro por padrão); dona não entra por convite", () => {
  assert.deepEqual(validaConvite({ email: "Ana@Coflow.com" }), { email: "ana@coflow.com", papel: "membro" });
  assert.deepEqual(validaConvite({ email: "ana@coflow.com", papel: "admin" }), { email: "ana@coflow.com", papel: "admin" });
  assert.match(validaConvite({ email: "ana@coflow.com", papel: "dona" }).erro, /papel/);
  assert.match(validaConvite({ email: "ana" }).erro, /e-mail/);
  assert.equal(validaPapelOrg("dona"), "dona"); assert.equal(validaPapelOrg("chefe"), null);
});

test("emailNoDominio, assentosLivres, validaAssentos", () => {
  assert.equal(emailNoDominio("ana@coflow.com", null), true);
  assert.equal(emailNoDominio("ana@coflow.com", "coflow.com"), true);
  assert.equal(emailNoDominio("ana@mail.coflow.com", "coflow.com"), false);
  assert.equal(emailNoDominio("ana@gmail.com", "coflow.com"), false);
  assert.equal(assentosLivres(5, 3), 2); assert.equal(assentosLivres(5, 7), 0);
  assert.equal(validaAssentos(10), 10); assert.equal(validaAssentos(0), null); assert.equal(validaAssentos(1001), null); assert.equal(validaAssentos("5"), null);
});

test("slugDoHost: só um nível abaixo do domínio do site, fora dos hosts nossos", () => {
  assert.equal(slugDoHost("coflow.agentesgrok.com", "https://agentesgrok.com"), "coflow");
  assert.equal(slugDoHost("COFLOW.agentesgrok.com:443", "agentesgrok.com"), "coflow");
  assert.equal(slugDoHost("auth.agentesgrok.com", "agentesgrok.com"), null);
  assert.equal(slugDoHost("console-staging.agentesgrok.com", "agentesgrok.com"), null);
  assert.equal(slugDoHost("a.b.agentesgrok.com", "agentesgrok.com"), null);
  assert.equal(slugDoHost("agentesgrok.com", "agentesgrok.com"), null);
  assert.equal(slugDoHost("coflow.outro.com", "agentesgrok.com"), null);
});
