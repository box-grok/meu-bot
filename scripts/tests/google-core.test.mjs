import { test } from "node:test";
import assert from "node:assert/strict";
import { achaSegredo, slugMaquina, chaveTelefone, emailDePessoaEu, faltantesNoGoogle, parseClienteOAuth, pessoaDoWhatsapp, temEscrita, pessoaParaContato, pkce, urlDeAutorizacao, parseIdToken, temEscopo, temTodosEscopos, ESCOPOS_CONTA, gmailMensagemDeRaw, agendaEventoDeRaw, planilhaValoresDeRaw , CONJUNTOS_DADOS, caminhoDadosNoDrive, pacotesDadosAApagar, pacoteDadosRe, corpoUploadBinario, consultaFilhos } from "../../src/main/google/google-core.ts";

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
  // Desde 23/10 a conta tambem pede drive.file (copia do CRM e do financeiro no Drive): quem conectou antes
  // tem tudo menos esse, e por isso aparece como "precisa reconectar" ate autorizar uma vez.
  assert.ok(!temTodosEscopos(comoOGoogleVolta, ESCOPOS_CONTA), "sem drive.file: precisa reconectar");
  assert.ok(temTodosEscopos(`${comoOGoogleVolta} https://www.googleapis.com/auth/drive.file`, ESCOPOS_CONTA), "com drive.file: completo");
  assert.ok(ESCOPOS_CONTA.includes("https://www.googleapis.com/auth/drive.file"), "drive.file faz parte da conta");
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


test("caminhoDadosNoDrive: uma pasta por maquina e por conjunto; o nome leva a data", () => {
  const quando = Date.parse("2026-10-23T12:00:00-03:00");
  const crm = CONJUNTOS_DADOS.find((c) => c.id === "crm");
  const fin = CONJUNTOS_DADOS.find((c) => c.id === "financeiro");
  assert.deepEqual(caminhoDadosNoDrive("agente-box-lv", crm, quando), { pastas: ["meu-bot", "agente-box-lv", "CRM"], arquivo: "crm-agente-box-lv-2026-10-23.tar.gz.age" });
  assert.deepEqual(caminhoDadosNoDrive("agente-box-lv", fin, quando), { pastas: ["meu-bot", "agente-box-lv", "Financeiro"], arquivo: "financeiro-agente-box-lv-2026-10-23.tar.gz" });
  // Pastas diferentes: zerar o financeiro no Drive nao encosta no CRM.
  assert.notDeepEqual(caminhoDadosNoDrive("m", crm, quando).pastas, caminhoDadosNoDrive("m", fin, quando).pastas);
  // Barra no nome da maquina nao vira pasta nova.
  assert.ok(!caminhoDadosNoDrive("a/b", crm, quando).pastas.some((p) => p.includes("/")));
});

test("pacotesDadosAApagar: retencao de uma copia so, sem encostar no que nao e nosso", () => {
  const lista = [
    { id: "novo", name: "crm-agente-box-lv-2026-10-23.tar.gz" },
    { id: "velho", name: "crm-agente-box-lv-2026-10-22.tar.gz" },
    { id: "outra-maquina", name: "crm-grokbot-1-2026-10-22.tar.gz" },
    { id: "outro-conjunto", name: "financeiro-agente-box-lv-2026-10-22.tar.gz" },
    { id: "de-terceiro", name: "planilha-da-pessoa.xlsx" },
    { id: "parecido", name: "crm-backup-manual.tar.gz" },
    { semId: true, name: "crm-agente-box-lv-2026-10-20.tar.gz" },
  ];
  // So o pacote antigo do mesmo conjunto sai; o novo, o do outro conjunto e os de terceiro ficam.
  const M = "agente-box-lv";
  // So o pacote antigo do mesmo conjunto E da mesma maquina sai; o resto fica.
  assert.deepEqual(pacotesDadosAApagar(lista, "novo", "crm", M), ["velho"]);
  assert.deepEqual(pacotesDadosAApagar(lista, "novo", "financeiro", M), ["outro-conjunto"]);
  assert.ok(!pacotesDadosAApagar(lista, "novo", "crm", M).includes("outra-maquina"), "nao apaga a copia de outra maquina");
  assert.deepEqual(pacotesDadosAApagar([], "novo", "crm", M), [], "pasta vazia: nada a apagar");
  assert.deepEqual(pacotesDadosAApagar([{ id: "novo", name: `crm-${M}-2026-10-23.tar.gz` }], "novo", "crm", M), [], "so o novo: nada a apagar");
});

test("corpoUploadBinario: bytes sobrevivem (o .tar.gz nao passa por string) e consultaFilhos escapa", () => {
  const dados = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x7f]);
  const corpo = corpoUploadBinario({ name: "crm-agente-box-lv-2026-10-23.tar.gz" }, dados, "B", "application/gzip");
  assert.ok(Buffer.isBuffer(corpo));
  assert.ok(corpo.includes(dados), "os bytes do pacote saem intactos");
  assert.match(corpo.toString("latin1"), /Content-Type: application\/gzip/);
  assert.match(corpo.toString("latin1"), /\r\n--B--$/);
  assert.equal(consultaFilhos("pa'i"), "'pa\\'i' in parents and trashed = false");
});

test("CONJUNTOS_DADOS: caminhos e exclusoes no formato que o tar casa", () => {
  const ids = CONJUNTOS_DADOS.map((c) => c.id);
  assert.deepEqual(ids, ["crm", "financeiro", "agente", "trabalho", "credenciais"]);
  assert.equal(new Set(CONJUNTOS_DADOS.map((c) => c.pasta)).size, ids.length, "uma pasta por conjunto");
  assert.equal(new Set(CONJUNTOS_DADOS.map((c) => c.prefixo)).size, ids.length, "um prefixo por conjunto");

  for (const c of CONJUNTOS_DADOS) {
    assert.ok(c.dirs.length > 0, `${c.id}: sem caminho nenhum`);
    for (const d of [...c.dirs, ...c.excluir]) {
      // Regressao: com "./" na frente o padrao nao casa com o membro que o tar gera e o excluido entra em silencio.
      assert.ok(!d.startsWith("./"), `${c.id}: "${d}" com ./ nao casa`);
      assert.ok(!d.startsWith("/"), `${c.id}: "${d}" tem que ser relativo ao $HOME`);
    }
  }

  const por = (id) => CONJUNTOS_DADOS.find((c) => c.id === id);
  // A copia diaria local de cada store nao entra no pacote: copia dentro de copia.
  assert.ok(por("crm").excluir.some((e) => e.endsWith("/crm/db/backup")));
  assert.ok(por("financeiro").excluir.some((e) => e.endsWith("/finance/db/backup")));
  // Segredos TOTP tem a chave fora do db/: fora da maquina nao abrem, entao nao viajam.
  assert.ok(por("crm").excluir.some((e) => e.includes("autenticador")));
  // O clone da Cloudflare volta com git clone; as skills escritas aqui, nao.
  assert.ok(por("agente").excluir.includes(".claude/skills/skills-cloudflare"));
  // 183 dos 208 MB do .openclaw sao cache, temporarios e extensoes.
  for (const x of ["cache", "tmp", "extensions", "logs"]) {
    assert.ok(por("credenciais").excluir.includes(`.openclaw/${x}`), `.openclaw/${x} tem que ficar de fora`);
  }
});

test("o que carrega segredo e cifrado, e o nome do arquivo denuncia isso", () => {
  const cifrados = CONJUNTOS_DADOS.filter((c) => c.cifrar === true).map((c) => c.id);
  // 24/10: transcripts e conversas arquivadas tambem carregavam token (9 e 1 JWT), entao passaram a cifrados.
  assert.deepEqual(cifrados, ["crm", "agente", "credenciais"], "o que carrega segredo vai cifrado");

  const q = Date.parse("2026-10-23T12:00:00-03:00");
  const cred = CONJUNTOS_DADOS.find((c) => c.id === "credenciais");
  const crm = CONJUNTOS_DADOS.find((c) => c.id === "crm");
  assert.equal(caminhoDadosNoDrive("agente-box-lv", cred, q).arquivo, "credenciais-agente-box-lv-2026-10-23.tar.gz.age");
  assert.equal(caminhoDadosNoDrive("agente-box-lv", crm, q).arquivo, "crm-agente-box-lv-2026-10-23.tar.gz.age", "CRM cifrado desde 24/10");
  const fin = CONJUNTOS_DADOS.find((c) => c.id === "financeiro");
  assert.equal(caminhoDadosNoDrive("agente-box-lv", fin, q).arquivo, "financeiro-agente-box-lv-2026-10-23.tar.gz", "financeiro segue sem cifra");

  // A poda precisa reconhecer o cifrado, senao ele acumula no Drive para sempre.
  const re = pacoteDadosRe("credenciais", "agente-box-lv");
  assert.ok(re.test("credenciais-agente-box-lv-2026-10-22.tar.gz.age"));
  assert.ok(re.test("credenciais-agente-box-lv-2026-10-22.tar.gz"), "aceita tambem o sem sufixo");
  assert.ok(!re.test("credenciais-outra-maquina-2026-10-22.tar.gz.age"), "nao apaga o de outra maquina");

  // O pacote sem cifra nunca pode carregar segredo do .hermes: eles moram no conjunto cifrado.
  const trab = CONJUNTOS_DADOS.find((c) => c.id === "trabalho");
  assert.ok(trab.cifrar !== true);
  assert.ok(trab.excluir.includes(".hermes/auth.json"), "auth.json sai do pacote sem cifra");
  assert.ok(trab.excluir.some((e) => e.endsWith(".env")), "os .env saem do pacote sem cifra");
  assert.ok(cred.dirs.includes(".hermes/auth.json"), "e entram no cifrado");
});

test("slugMaquina: a maquina no nome do arquivo sobrevive a baixar fora da pasta", () => {
  assert.equal(slugMaquina("agente-box-lv"), "agente-box-lv");
  assert.equal(slugMaquina("Maquina Da Loja"), "maquina-da-loja");
  assert.equal(slugMaquina("  a/b c  "), "a-b-c");
  assert.equal(slugMaquina("!!!"), "maquina", "nome impossivel ainda da um slug usavel");
  assert.ok(slugMaquina("x".repeat(99)).length <= 40);
  // Dois pacotes do mesmo dia, maquinas diferentes, nao colidem ao caírem na mesma pasta de Downloads.
  const crm = CONJUNTOS_DADOS.find((c) => c.id === "crm");
  const q = Date.parse("2026-10-23T12:00:00-03:00");
  assert.notEqual(caminhoDadosNoDrive("agente-box-lv", crm, q).arquivo, caminhoDadosNoDrive("grokbot-1", crm, q).arquivo);
});

test("achaSegredo: o que nao pode subir sem cifra", () => {
  assert.equal(achaSegredo("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc"), "token JWT");
  assert.equal(achaSegredo("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "token do GitHub");
  assert.equal(achaSegredo("sk-abcdefghijklmnopqrstuvwxyz0123456789"), "chave de API (sk-…)");
  assert.equal(achaSegredo("AKIAIOSFODNN7EXAMPLE"), "chave da AWS");
  // Texto comum, data ISO e um "eyJ" solto nao sao segredo: a varredura nao pode bloquear o financeiro por nada.
  assert.equal(achaSegredo("lancamento de 2026-10-24T12:00:00-03:00 no valor de 1.200,00"), null);
  assert.equal(achaSegredo("eyJ curto"), null);
  assert.equal(achaSegredo(""), null);
});

test("trabalho (sem cifra) nunca leva segredo nem lixo do Hermes; credenciais leva o .env e a sessão viva do WhatsApp do Hermes", async () => {
  const { CONJUNTOS_DADOS } = await import("../../dist/main/google/google-core.js");
  const por = (id) => CONJUNTOS_DADOS.find((c) => c.id === id);
  for (const x of [".hermes/.env", ".hermes/.env.bak-*", ".hermes/whatsapp/session", ".hermes/whatsapp/session.loggedout-*", "node_modules", ".hermes/venv-whisper", ".hermes/cache"]) {
    assert.ok(por("trabalho").excluir.includes(x), `${x} tem que ficar fora do trabalho`);
  }
  for (const x of [".hermes/.env", ".hermes/whatsapp/session", ".hermes/auth.json"]) assert.ok(por("credenciais").dirs.includes(x), `${x} vai cifrado em credenciais`);
  assert.ok(!por("credenciais").dirs.some((d) => d.includes("loggedout")), "sessões antigas não vão nem cifradas");
});
