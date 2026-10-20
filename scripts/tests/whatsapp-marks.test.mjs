import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseWaMarks, applyWaMarks, parseWaMarkPatches, waMarkSh, WA_MARKS_FILE } = createRequire(import.meta.url)("../../dist/main/whatsapp-marks.js");

const chat = (number, updatedAt, name = null) => ({ number, name, alias: null, isSelf: false, sessionKeys: [], sessionIds: {}, ownSession: true, paused: false, updatedAt, archived: false, deleted: false });

test("parseWaMarks: só números de 8 a 15 dígitos com hora válida; lixo vira vazio", () => {
  const m = parseWaMarks({ archived: { "5511999990000": "2026-10-17T02:10:00Z", "abc": "2026-10-17T02:10:00Z", "5511999990001": "ontem" }, deleted: { "5521988880000": "2026-10-17T02:12:00Z" }, outro: 1 });
  assert.deepEqual(m, { archived: { "5511999990000": "2026-10-17T02:10:00Z" }, deleted: { "5521988880000": "2026-10-17T02:12:00Z" }, names: {} });
  assert.deepEqual(parseWaMarks(null), { archived: {}, deleted: {}, names: {} });
  assert.deepEqual(parseWaMarks("x"), { archived: {}, deleted: {}, names: {} });
  assert.deepEqual(parseWaMarks({ archived: [1] }), { archived: {}, deleted: {}, names: {} });
});

test("parseWaMarks: names com nome e/ou apelido saneados; entrada vazia ou lixo some", () => {
  const m = parseWaMarks({ names: {
    "595994402904": { name: "  Junior   Rezende ", alias: "Junior (cliente)", at: "2026-10-17T02:10:00Z" },
    "5511999990000": { alias: "Só apelido" },
    "5521988880000": { name: "", alias: null, at: "x" },
    "abc": { name: "x" },
    "5531977770000": { name: "a".repeat(81) },
  } });
  assert.deepEqual(m.names, {
    "595994402904": { name: "Junior Rezende", alias: "Junior (cliente)", at: "2026-10-17T02:10:00Z" },
    "5511999990000": { name: null, alias: "Só apelido", at: "" },
  });
});

test("applyWaMarks: nome do cache só quando a memória não tem; apelido sempre do arquivo", () => {
  const marks = { archived: {}, deleted: {}, names: { "595994402904": { name: "Junior Rezende", alias: "Junior (cliente)", at: "" }, "5511999990000": { name: "Do arquivo", alias: null, at: "" } } };
  const out = applyWaMarks([chat("595994402904", "2026-10-17T03:00:00.000Z"), chat("5511999990000", "2026-10-17T03:00:00.000Z", "Fresco da sessão"), chat("5531977770000", "2026-10-17T03:00:00.000Z")], marks);
  assert.deepEqual(out.map((c) => [c.name, c.alias]), [["Junior Rezende", "Junior (cliente)"], ["Fresco da sessão", null], [null, null]]);
});

test("applyWaMarks: arquivada marca; excluída só até chegar mensagem nova", () => {
  const marks = { archived: { "5511999990000": "2026-10-17T02:10:00Z" }, deleted: { "5521988880000": "2026-10-17T02:12:00.000Z" }, names: {} };
  const out = applyWaMarks([chat("5511999990000", "2026-10-17T03:00:00.000Z"), chat("5521988880000", "2026-10-17T02:00:00.000Z"), chat("5531977770000", "2026-10-17T02:00:00.000Z")], marks);
  assert.deepEqual(out.map((c) => [c.archived, c.deleted]), [[true, false], [false, true], [false, false]]);
  // mensagem depois da exclusão: volta
  const back = applyWaMarks([chat("5521988880000", "2026-10-17T02:12:01.000Z")], marks);
  assert.equal(back[0].deleted, false);
  // na mesma hora ainda conta como excluída
  assert.equal(applyWaMarks([chat("5521988880000", "2026-10-17T02:12:00.000Z")], marks)[0].deleted, true);
});

test("parseWaMarkPatches: saneia o payload da tela", () => {
  assert.deepEqual(parseWaMarkPatches({ marks: [{ number: "+55 11 99999-0000", archived: true }, { number: "5521988880000", deleted: true, at: "2026-10-17T02:12:00Z", archived: false }] }),
    [{ number: "5511999990000", archived: true }, { number: "5521988880000", archived: false, deleted: true, at: "2026-10-17T02:12:00Z" }]);
  assert.throws(() => parseWaMarkPatches({ marks: [] }), /inválidos/);
  assert.throws(() => parseWaMarkPatches({ marks: [{ number: "123", archived: true }] }), /número/);
  assert.throws(() => parseWaMarkPatches({ marks: [{ number: "5511999990000" }] }), /vazio/);
  assert.throws(() => parseWaMarkPatches({ marks: new Array(201).fill({ number: "5511999990000", archived: true }) }), /inválidos/);
  // "at" inválido é ignorado, não derruba
  assert.deepEqual(parseWaMarkPatches({ marks: [{ number: "5511999990000", archived: true, at: "ontem" }] }), [{ number: "5511999990000", archived: true }]);
  // nome e apelido: espaços colapsam, vazio = apagar, longo demais recusa
  assert.deepEqual(parseWaMarkPatches({ marks: [{ number: "595994402904", name: " Junior  Rezende " }, { number: "595994402904", alias: "" }] }), [{ number: "595994402904", name: "Junior Rezende" }, { number: "595994402904", alias: "" }]);
  assert.throws(() => parseWaMarkPatches({ marks: [{ number: "595994402904", alias: "a".repeat(81) }] }), /apelido longo/);
});

test("waMarkSh: embute os ajustes em base64, grava com tmp+mv e recusa número inválido", () => {
  const patches = [{ number: "5511999990000", archived: true }];
  const sh = waMarkSh(patches);
  assert.ok(sh.includes(Buffer.from(JSON.stringify(patches)).toString("base64")));
  assert.ok(sh.includes("base64 -d | python3 -c"));
  assert.ok(sh.includes(WA_MARKS_FILE) && sh.includes("os.replace(tmp, f)") && sh.includes('print("MARKS=1")'));
  assert.ok(sh.includes("python3 >/dev/null 2>&1 ||"), "avisa quando não há python3");
  assert.throws(() => waMarkSh([{ number: "x'; rm -rf /", archived: true }]), /número inválido/);
  const nomes = waMarkSh([{ number: "595994402904", name: "Junior Rezende", alias: "Junior (cliente)" }]);
  assert.ok(nomes.includes(Buffer.from(JSON.stringify([{ number: "595994402904", name: "Junior Rezende", alias: "Junior (cliente)" }])).toString("base64")));
  assert.ok(nomes.includes('"names": names') && nomes.includes("ensure_ascii=False"));
  assert.throws(() => waMarkSh([{ number: "595994402904", alias: "linha\nnova" }]), /nome inválido/);
});

