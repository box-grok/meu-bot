import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
// gmail-core.ts importa google-core sem extensao (como o resto do main): o teste le o compilado em dist/, como ipc-policy.test.
const { corpoDeMensagem, htmlParaTexto, linkDoGmail, mensagemDetalheDeRaw, validaBusca, validaId, validaMax, validaPagina, CORPO_MAX, LISTA_MAX } = createRequire(import.meta.url)("../../dist/main/google/gmail-core.js");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

test("limites do que a tela e o agente pedem: busca, max, id e página", () => {
  assert.equal(validaBusca("  from:ana is:unread  "), "from:ana is:unread");
  assert.equal(validaBusca("a\u0000b\nc"), "a b c");
  assert.equal(validaBusca("x".repeat(500)).length, 200);
  assert.equal(validaBusca(42), "");
  assert.equal(validaMax(undefined), 10); assert.equal(validaMax(7.9), 7); assert.equal(validaMax(0), 1); assert.equal(validaMax(999), LISTA_MAX); assert.equal(validaMax("5"), 10); assert.equal(validaMax(NaN, 3), 3);
  assert.equal(validaId("18f3a2b9c0d1e2f3"), "18f3a2b9c0d1e2f3"); assert.equal(validaId("../x"), null); assert.equal(validaId(""), null); assert.equal(validaId(3), null);
  assert.equal(validaPagina("ABC_def-123"), "ABC_def-123"); assert.equal(validaPagina(""), undefined); assert.equal(validaPagina("a b"), undefined);
  assert.equal(linkDoGmail("abc"), "https://mail.google.com/mail/u/0/#all/abc");
});

test("htmlParaTexto: tira estilo e script, quebra em p/br, decodifica entidades, colapsa espaços", () => {
  const html = "<html><head><style>p{color:red}</style></head><body><p>Ol&aacute;, <b>Ana</b>&nbsp;&amp; cia</p><script>x()</script><div>linha 2<br>linha   3</div>&#x1F600; &#65;</body></html>";
  assert.equal(htmlParaTexto(html), "Olá, Ana & cia\nlinha 2\nlinha 3\n😀 A");
  assert.equal(htmlParaTexto("Ol&Aacute; &ccedil;&atilde;o &hellip; &desconhecida;"), "OlÁ ção … &desconhecida;");
});

test("corpoDeMensagem: text/plain ganha; só html vira texto; anexos por nome; multipart aninhado; corte", () => {
  const simples = { mimeType: "text/plain", body: { data: b64("oi\r\ntudo bem?") } };
  assert.deepEqual(corpoDeMensagem(simples), { corpo: "oi\ntudo bem?", anexos: [], truncado: false });
  const alternativo = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("texto") } }, { mimeType: "text/html", body: { data: b64("<p>html</p>") } }] };
  assert.equal(corpoDeMensagem(alternativo).corpo, "texto");
  const soHtml = { mimeType: "text/html", body: { data: b64("<div>só <i>html</i></div>") } };
  assert.equal(corpoDeMensagem(soHtml).corpo, "só html");
  const misto = { mimeType: "multipart/mixed", parts: [
    { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("corpo") } }] },
    { mimeType: "application/pdf", filename: "nota.pdf", body: { size: 2048, attachmentId: "x" } },
    { mimeType: "image/png", filename: "foto.png", body: { size: 10 } },
  ] };
  assert.deepEqual(corpoDeMensagem(misto), { corpo: "corpo", anexos: [{ nome: "nota.pdf", tipo: "application/pdf", bytes: 2048 }, { nome: "foto.png", tipo: "image/png", bytes: 10 }], truncado: false });
  const longo = { mimeType: "text/plain", body: { data: b64("x".repeat(CORPO_MAX + 100)) } };
  const r = corpoDeMensagem(longo); assert.equal(r.truncado, true); assert.ok(r.corpo.endsWith("[…]")); assert.ok(r.corpo.length < CORPO_MAX + 10);
  assert.deepEqual(corpoDeMensagem(undefined), { corpo: "", anexos: [], truncado: false });
});

test("mensagemDetalheDeRaw: linha da lista + para, corpo e anexos", () => {
  const m = { snippet: "oi", labelIds: ["INBOX"], payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ana <a@b.com>" }, { name: "To", value: "eu@x.com" }, { name: "Subject", value: "Ola" }, { name: "Date", value: "Fri, 31 Oct 2026 10:00:00 -0300" }], body: { data: b64("conteudo") } } };
  assert.deepEqual(mensagemDetalheDeRaw("m1", m), { id: "m1", de: "Ana <a@b.com>", assunto: "Ola", data: "Fri, 31 Oct 2026 10:00:00 -0300", resumo: "oi", naoLida: false, para: "eu@x.com", corpo: "conteudo", anexos: [], truncado: false });
  assert.equal(mensagemDetalheDeRaw("m2", { payload: { headers: [] } }).assunto, "(sem assunto)");
});
