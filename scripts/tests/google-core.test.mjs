import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveTelefone, emailDePessoaEu, faltantesNoGoogle, parseClienteOAuth, pessoaDoWhatsapp, temEscrita, pessoaParaContato, pkce, urlDeAutorizacao, parseIdToken, temEscopo, temTodosEscopos, ESCOPOS_CONTA, gmailMensagemDeRaw, agendaEventoDeRaw, planilhaValoresDeRaw } from "../../src/main/google/google-core.ts";

test("parseClienteOAuth: JSON baixado do Google Cloud (installed) ou simples; inválido → null", () => {
  assert.deepEqual(parseClienteOAuth({ installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-segredo1" } }), { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-segredo1" });
  assert.equal(parseClienteOAuth({ client_id: "nao-e-google", client_secret: "x" }), null);
  assert.equal(parseClienteOAuth(null), null);
});

test("PKCE S256 e endereço de autorização com loopback, offline e só leitura de contatos", () => {
  const { verifier, challenge } = pkce(); assert.ok(verifier.length >= 43); assert.notEqual(verifier, challenge);
  const u = new URL(urlDeAutorizacao({ clientId: "1.apps.googleusercontent.com", redirect: "http://127.0.0.1:5555/oauth", challenge, state: "st" }));
  assert.equal(u.searchParams.get("redirect_uri"), "http://127.0.0.1:5555/oauth"); assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("access_type"), "offline"); assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/drive.file");
});

test("emailDePessoaEu: e-mail principal de people/me; sem e-mail → null", () => {
  assert.equal(emailDePessoaEu({ emailAddresses: [{ value: "x@y.com" }, { value: "box@agentesgrok.com", metadata: { primary: true } }] }), "box@agentesgrok.com");
  assert.equal(emailDePessoaEu({}), null); assert.equal(emailDePessoaEu(null), null);
});

test("pessoaParaContato: como a API People devolve (Junior Rezende do print)", () => {
  const p = { resourceName: "people/c31759494540309252", names: [{ displayName: "Junior Rezende", metadata: { primary: true } }], phoneNumbers: [{ value: "+595 994 402904", canonicalForm: "+595994402904" }], urls: [{ value: "https://instagram.com/juniorrezende.br.py" }], organizations: [{ name: "LV Lingerie", title: "CEO" }] };
  assert.deepEqual(pessoaParaContato(p), { nome: "Junior Rezende", emails: [], telefones: ["+595994402904"], cargo: "CEO", empresa: "LV Lingerie", notas: "", instagram: "juniorrezende.br.py", linkedin: "", googleId: "people/c31759494540309252" });
  assert.equal(pessoaParaContato({ resourceName: "people/c1" }), null);
  assert.equal(pessoaParaContato({ resourceName: "../x", names: [{ displayName: "x" }] }), null);
});

test("WhatsApp → Google: só os que faltam (com ou sem +55), sem repetir; formato do contato; escopo de escrita", () => {
  assert.equal(chaveTelefone("+55 (11) 98869-8139"), chaveTelefone("11988698139"));
  const wa = [{ telefone: "+5511988698139", nome: "Manager Martins" }, { telefone: "+595994402904", nome: "" }, { telefone: "+5521900001111", nome: "Novo" }, { telefone: "+5521900001111", nome: "Novo de novo" }];
  assert.deepEqual(faltantesNoGoogle(wa, ["11 98869-8139"], ["+595994402904"]).map((c) => c.nome), ["Novo"]);
  assert.deepEqual(pessoaDoWhatsapp({ telefone: "+595994402904", nome: "" }, "contactGroups/abc"), { names: [{ givenName: "WhatsApp +595994402904" }], phoneNumbers: [{ value: "+595994402904", type: "mobile" }], memberships: [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/abc" } }] });
  assert.equal(temEscrita("https://www.googleapis.com/auth/contacts"), true); assert.equal(temEscrita("https://www.googleapis.com/auth/contacts.readonly"), false); assert.equal(temEscrita(undefined), false);
});

test("Drive: só drive.file; pasta por máquina e por contato; nomes seguros; busca com aspas escapadas", async () => {
  const g = await import("../../dist/main/google/google-core.js");
  assert.ok(g.ESCOPOS.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(!g.ESCOPOS.some((e) => /auth\/drive$/.test(e))); // nunca o Drive inteiro
  assert.equal(g.temDrive("https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/drive.file"), true);
  assert.equal(g.temDrive("https://www.googleapis.com/auth/contacts"), false);
  const t = new Date(2026, 9, 21, 15, 1).getTime();
  assert.deepEqual(g.caminhoNoDrive("agente-box-lv", "Agentes Grok", "5516992294486", t), { pastas: ["meu-bot", "agente-box-lv", "WhatsApp", "Agentes Grok (+5516992294486)"], arquivo: "conversa-whatsapp-2026-10-21-1501.md" });
  assert.equal(g.caminhoNoDrive("m", "+5516992294486", "5516992294486", t).pastas[3], "+5516992294486");
  assert.equal(g.caminhoNoDrive("a/b", "x/../y", "1", t).pastas[1], "a b");
  assert.equal(g.caminhoNoDrive("a", "x/../y", "1", t).pastas[3], "x .. y (+1)");
  assert.equal(g.consultaPasta("D'Ávila", "root"), "name = 'D\\'Ávila' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false");
  const corpo = g.corpoUpload({ name: "a.md" }, "oi", "B");
  assert.match(corpo, /^--B\r\nContent-Type: application\/json/);
  assert.match(corpo, /\r\n--B--$/);
});


test("parseIdToken: payload do JWT (sem verificar assinatura); invalido vira null", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `x.${b64({ sub: "123", email: "a@b.com", email_verified: true, name: "Ana", picture: "http://p" })}.y`;
  assert.deepEqual(parseIdToken(jwt), { sub: "123", email: "a@b.com", emailVerificado: true, nome: "Ana", foto: "http://p", fotoLocal: null });
  assert.equal(parseIdToken(`x.${b64({ email: "a@b.com" })}.y`), null, "sem sub nao vale");
  assert.equal(parseIdToken("abc"), null); assert.equal(parseIdToken(42), null);
  // fotoLocal so e preenchida depois, pelo download no main: o id_token nunca traz a imagem.
  assert.deepEqual(parseIdToken(`x.${b64({ sub: "9" })}.y`), { sub: "9", email: null, emailVerificado: false, nome: null, foto: null, fotoLocal: null });
});

test("escopos: temEscopo por token, temTodosEscopos para precisa reconectar, url com escopos da conta", () => {
  const g = ESCOPOS_CONTA.join(" ");
  assert.ok(temEscopo(g, "https://www.googleapis.com/auth/spreadsheets"));
  assert.ok(!temEscopo("openid email", "https://www.googleapis.com/auth/spreadsheets"));
  assert.ok(temTodosEscopos(g, ESCOPOS_CONTA));
  assert.ok(!temTodosEscopos("openid email profile", ESCOPOS_CONTA));
  // o Google devolve email/profile como as URLs de userinfo: não deve pedir "reconectar" por isso
  const comoOGoogleVolta = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.profile openid https://www.googleapis.com/auth/userinfo.email";
  assert.ok(temEscopo(comoOGoogleVolta, "email"));
  assert.ok(temEscopo(comoOGoogleVolta, "profile"));
  assert.ok(temTodosEscopos(comoOGoogleVolta, ESCOPOS_CONTA));
  const url = new URL(urlDeAutorizacao({ clientId: "c", redirect: "http://127.0.0.1:9/oauth", challenge: "ch", state: "st", scope: g }));
  assert.equal(url.searchParams.get("scope"), g);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
});

test("parse das respostas das APIs: Gmail, Agenda (dateTime/date), Sheets", () => {
  const m = gmailMensagemDeRaw("m1", { snippet: "oi", labelIds: ["INBOX", "UNREAD"], payload: { headers: [{ name: "From", value: "Ana <a@b.com>" }, { name: "Subject", value: "Ola" }, { name: "Date", value: "qua" }] } });
  assert.deepEqual(m, { id: "m1", de: "Ana <a@b.com>", assunto: "Ola", data: "qua", resumo: "oi", naoLida: true });
  assert.equal(gmailMensagemDeRaw("m2", { payload: { headers: [] } }).assunto, "(sem assunto)");
  assert.equal(agendaEventoDeRaw({ id: "e1", summary: "Reuniao", start: { dateTime: "2026-10-23T14:00:00Z" }, end: { dateTime: "2026-10-23T15:00:00Z" } }).inicio, "2026-10-23T14:00:00Z");
  assert.equal(agendaEventoDeRaw({ id: "e2", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } }).titulo, "(sem título)");
  assert.deepEqual(planilhaValoresDeRaw({ values: [["a", "b"], ["c"]] }), [["a", "b"], ["c"]]);
  assert.deepEqual(planilhaValoresDeRaw({}), []);
});
