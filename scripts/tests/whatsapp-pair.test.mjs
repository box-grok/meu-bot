import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parsePairLine } = createRequire(import.meta.url)("../../dist/main/whatsapp-pair-line.js");

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>').toString("base64");

test("passos do script", () => {
  assert.deepEqual(parsePairLine("passo: parar parando o hermes-gateway"), { kind: "step", step: "parar", state: "doing", text: "parando o hermes-gateway" });
  assert.equal(parsePairLine("passo: inventado algo"), null);
  assert.equal(parsePairLine("ponte: qualquer coisa"), null);
  assert.equal(parsePairLine("linha solta"), null);
});

test("QR só passa se for base64 de um svg", () => {
  assert.deepEqual(parsePairLine(`qr: ${svg}`), { kind: "qr", svgBase64: svg });
  assert.equal(parsePairLine(`qr: ${Buffer.from("<script>alert(1)</script>").toString("base64")}`), null);
  assert.equal(parsePairLine('qr: "><img onerror=x>'), null);
});

test("conectado, pronto, erro e já conectado", () => {
  assert.deepEqual(parsePairLine('conectado: {"id":"5516992294486:12@s.whatsapp.net","name":"René"}'), { kind: "paired", who: "René · +5516992294486" });
  assert.deepEqual(parsePairLine("conectado: não-json"), { kind: "paired", who: "" });
  assert.deepEqual(parsePairLine("pronto: WhatsApp do Hermes conectado"), { kind: "done", ok: true, text: "WhatsApp do Hermes conectado" });
  assert.deepEqual(parsePairLine("erro: ninguém leu o QR em 240 s"), { kind: "done", ok: false, text: "ninguém leu o QR em 240 s" });
  assert.deepEqual(parsePairLine("ja-conectado: nada a fazer"), { kind: "already", text: "nada a fazer" });
});
