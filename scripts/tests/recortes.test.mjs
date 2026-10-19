import test from "node:test";
import assert from "node:assert/strict";
import { RECORTES, recortesPara, recorteOculto, parseRecortesPref, recorteTitulo } from "../../dist/renderer/lib/recortes.js";

test("recortesPara: só o host exato do site", () => {
  assert.deepEqual(recortesPara("https://mail.google.com/mail/u/0/#inbox").map((r) => r.id), ["gmail-painel", "gmail-menu", "gmail-topo", "gmail-gemini", "gmail-lateral"]);
  assert.deepEqual(recortesPara("https://docs.google.com/"), []);
  assert.deepEqual(recortesPara("não é url"), []);
  assert.deepEqual(recortesPara("https://evil.mail.google.com.example/"), []);
});

test("recorteOculto: padrão oculto, escolha salva manda", () => {
  const r = RECORTES[0];
  assert.equal(recorteOculto({}, r), true);
  assert.equal(recorteOculto({ [r.id]: false }, r), false);
  assert.equal(recorteOculto({ outro: false }, r), true);
});

test("parseRecortesPref: tolera lixo e descarta ids desconhecidos", () => {
  assert.deepEqual(parseRecortesPref(null), {});
  assert.deepEqual(parseRecortesPref("{"), {});
  assert.deepEqual(parseRecortesPref("[1]"), {});
  assert.deepEqual(parseRecortesPref(JSON.stringify({ "gmail-topo": false, "x": true, "gmail-menu": "sim" })), { "gmail-topo": false });
});

test("recorteTitulo: verbo acompanha o estado", () => {
  assert.match(recorteTitulo(RECORTES[2], true), /^Mostrar: /);
  assert.match(recorteTitulo(RECORTES[2], false), /^Ocultar: /);
});
