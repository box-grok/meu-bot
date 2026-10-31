import assert from "node:assert/strict";
import { test } from "node:test";
import { DONO_HINT, REPLY_AVISO_SELF_CHAT, REPLY_OPTIONS, donoLinhaTexto, listedNumbers, parseWaNumbers, replyChoiceOf, replySelfTextoDono } from "../../dist/renderer/lib/whatsapp-resposta.js";

test("cartões de quem responder: só você é o padrão; a política gravada marca o cartão certo", () => {
  assert.deepEqual(REPLY_OPTIONS.map((o) => [o.id, o.isDefault]), [["self", true], ["open", false], ["list", false]]);
  assert.equal(replyChoiceOf("allowlist"), "self");
  assert.equal(replyChoiceOf("open"), "open");
  assert.equal(replyChoiceOf("pairing"), null);
  assert.equal(replyChoiceOf("disabled"), null);
  // allowlist com alguém além do dono = "Só alguns contatos"; só o dono (ou vazio, ou "*") continua "self".
  assert.equal(replyChoiceOf("allowlist", ["+5547999990000"], "5547999990000"), "self");
  assert.equal(replyChoiceOf("allowlist", ["+5547999990000", "+5511988887777"], "5547999990000"), "list");
  assert.equal(replyChoiceOf("allowlist", ["+5511988887777"], null), "list");
  assert.equal(replyChoiceOf("allowlist", ["*"], null), "self");
  assert.deepEqual(listedNumbers(["+5547999990000", "+5511988887777", "5511988887777", "*"], "5547999990000"), ["5511988887777"]);
  assert.deepEqual(listedNumbers(undefined, null), []);
});

test("parseWaNumbers: um por linha ou vírgula; sem + e com 10/11 dígitos ganha o 55; lixo vai para bad", () => {
  assert.deepEqual(parseWaNumbers("11 99999-9999\n+1 212 555 0100, (47) 3333-2222; +5547999990000\n\n"), { ok: ["5511999999999", "12125550100", "554733332222", "5547999990000"], bad: [] });
  assert.deepEqual(parseWaNumbers("abc\n123\n+5511999999999"), { ok: ["5511999999999"], bad: ["abc", "123"] });
  assert.deepEqual(parseWaNumbers("5511999999999\n+5511999999999"), { ok: ["5511999999999"], bad: [] }, "repetido entra uma vez");
  assert.deepEqual(parseWaNumbers("  "), { ok: [], bad: [] });
});

test("listedNumbers/replyChoiceOf com dono de fora: o aparelho e o dono não contam como \"listados\"", () => {
  assert.deepEqual(listedNumbers(["+595986120831", "+5521923670743", "+5511999990000"], "595986120831", "5521923670743"), ["5511999990000"]);
  assert.equal(replyChoiceOf("allowlist", ["+595986120831", "+5521923670743"], "595986120831", "5521923670743"), "self", "só os dois = só eu");
  assert.equal(replyChoiceOf("allowlist", ["+595986120831", "+5521923670743", "+5511999990000"], "595986120831", "5521923670743"), "list");
  assert.equal(replyChoiceOf("allowlist", ["+595986120831", "+5521923670743"], "595986120831"), "list", "sem saber do dono, o segundo número parece listado (jeito antigo)");
});

test("linha Dono e textos dos cartões com dono de fora", () => {
  const fmt = (n) => `+${n}`;
  assert.equal(donoLinhaTexto({ numero: "595986120831", souEu: true }, null, fmt), "+595986120831 · você (este número)");
  assert.equal(donoLinhaTexto({ numero: "5521923670743", souEu: false }, "595986120831", fmt), "+5521923670743 · você, do seu celular (o agente atende em +595986120831)");
  assert.equal(replySelfTextoDono("+5521923670743"), "O agente só responde ao dono (+5521923670743). Ninguém mais recebe resposta nem código de pareamento.");
  assert.match(REPLY_AVISO_SELF_CHAT, /número dedicado/); assert.match(DONO_HINT, /nunca é pausado/);
});
