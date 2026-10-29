import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseWaMarks, applyWaMarks, applyWaGroupMarks, parseWaMarkPatches, waMarkSh, WA_MARKS_FILE } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-marks.js");

const chat = (number, updatedAt, name = null) => ({ number, name, alias: null, isSelf: false, sessionKeys: [], sessionIds: {}, ownSession: true, paused: false, updatedAt, archived: false, deleted: false });

test("parseWaMarks: só números de 8 a 15 dígitos com hora válida; lixo vira vazio", () => {
  const m = parseWaMarks({ archived: { "5511999990000": "2026-10-17T02:10:00Z", "abc": "2026-10-17T02:10:00Z", "5511999990001": "ontem" }, deleted: { "5521988880000": "2026-10-17T02:12:00Z" }, outro: 1 });
  assert.deepEqual(m, { archived: { "5511999990000": "2026-10-17T02:10:00Z" }, deleted: { "5521988880000": "2026-10-17T02:12:00Z" }, names: {}, groupsDeleted: {}, groupNames: {}, paused: {} });
  assert.deepEqual(parseWaMarks(null), { archived: {}, deleted: {}, names: {}, groupsDeleted: {}, groupNames: {}, paused: {} });
  assert.deepEqual(parseWaMarks("x"), { archived: {}, deleted: {}, names: {}, groupsDeleted: {}, groupNames: {}, paused: {} });
  assert.deepEqual(parseWaMarks({ archived: [1] }), { archived: {}, deleted: {}, names: {}, groupsDeleted: {}, groupNames: {}, paused: {} });
  // grupos excluídos: só jid de grupo com hora válida
  assert.deepEqual(parseWaMarks({ groupsDeleted: { "120363427290582156@g.us": "2026-10-25T03:40:00Z", "5511999990000": "2026-10-25T03:40:00Z", "1203@g.us": "ontem" } }).groupsDeleted, { "120363427290582156@g.us": "2026-10-25T03:40:00Z" });
});

test("applyWaGroupMarks: excluído até o agente receber mensagem nova; sem sessão continua excluído; só a vista", () => {
  const grupo = (jid, updatedAt, agente = "desligado") => ({ jid, nome: null, membros: null, participantes: [], agente, sessionKey: updatedAt === null ? null : `agent:main:whatsapp:group:${jid}`, sessionId: null, transcript: null, updatedAt, agenteRespondeu: false, deleted: false });
  const marks = { archived: {}, deleted: {}, names: {}, groupsDeleted: { "120363427290582156@g.us": "2026-10-25T03:40:00.000Z", "120363000000000001@g.us": "2026-10-25T03:40:00.000Z" }, groupNames: { "120363000000000002@g.us": { alias: "MPT Diego", at: "2026-10-25T03:40:00.000Z" } } };
  const out = applyWaGroupMarks([grupo("120363427290582156@g.us", null), grupo("120363000000000001@g.us", "2026-10-25T03:41:00.000Z", "mencao"), grupo("120363000000000002@g.us", "2026-10-25T03:00:00.000Z")], marks);
  assert.deepEqual(out.map((g) => [g.deleted, g.agente]), [[true, "desligado"], [false, "mencao"], [false, "desligado"]]);
  assert.equal(applyWaGroupMarks([grupo("120363000000000001@g.us", "2026-10-25T03:40:00.000Z")], marks)[0].deleted, true, "na mesma hora ainda conta como excluído");
  assert.deepEqual(out.map((g) => g.apelido), [null, null, "MPT Diego"], "o apelido vem da marca groupNames");
});

test("apelido de grupo: parse saneia, waMarkSh grava/apaga de verdade (python local) e recusa apelido inválido", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const path = await import("node:path"); const os = await import("node:os");
  const J = "120363000000000002@g.us";
  assert.deepEqual(parseWaMarks({ groupNames: { [J]: { alias: "  MPT   Diego ", at: "2026-10-25T03:40:00.000Z" }, "5511999990000": { alias: "x" }, [`${J}x`]: { alias: "y" }, "120363000000000003@g.us": { alias: "" } } }).groupNames, { [J]: { alias: "MPT Diego", at: "2026-10-25T03:40:00.000Z" } });
  assert.throws(() => waMarkSh([{ jid: J, alias: "a".repeat(81) }]), /apelido inválido/);
  assert.throws(() => waMarkSh([{ jid: J, alias: "linha\nquebrada" }]), /apelido inválido/);
  const home = mkdtempSync(path.join(os.tmpdir(), "meu-bot-marks-"));
  try {
    const roda = (patches) => execSync("bash", { input: waMarkSh(patches), env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.match(roda([{ jid: J, alias: "MPT Diego" }, { jid: "120363000000000001@g.us", deleted: true }]), /MARKS=1/);
    const f = path.join(home, ".local", "share", "meu-bot", "whatsapp-lista.json");
    let m = parseWaMarks(JSON.parse(readFileSync(f, "utf8")));
    assert.equal(m.groupNames[J].alias, "MPT Diego"); assert.ok(m.groupsDeleted["120363000000000001@g.us"]);
    roda([{ jid: J, alias: "" }]);
    m = parseWaMarks(JSON.parse(readFileSync(f, "utf8")));
    assert.deepEqual(m.groupNames, {}, "apelido vazio apaga"); assert.ok(m.groupsDeleted["120363000000000001@g.us"], "a exclusão do outro grupo fica");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("waMarkSh: marca de grupo vai no mesmo script (groupsDeleted) e recusa jid inválido", () => {
  const sh = waMarkSh([{ jid: "120363427290582156@g.us", deleted: true }]);
  assert.ok(sh.includes("groupsDeleted") && sh.includes("MARKS=1"));
  assert.throws(() => waMarkSh([{ jid: "5511999990000", deleted: true }]), /grupo inválido/);
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


test("paused (Hermes): lê o formato antigo (string) e o novo ({desde, ate}); só números válidos; vencida não conta", () => {
  const { pausaVigente, pausadosDe, PAUSA_HORAS } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-marks.js");
  const p = parseWaMarks({ paused: {
    "5522925501274": "2026-10-25T06:00:00Z",
    "5521923670743": { desde: "2026-10-29T13:00:00Z", ate: "2026-10-29T15:00:00Z", por: "contato" },
    "5511999990000": { desde: "2026-10-29T13:00:00Z", ate: null },
    "5511888880000": { ate: "2026-10-29T15:00:00Z" },
    "abc": "2026-10-25T06:00:00Z",
  } }).paused;
  assert.deepEqual(p, {
    "5522925501274": { desde: "2026-10-25T06:00:00Z", ate: null },
    "5521923670743": { desde: "2026-10-29T13:00:00Z", ate: "2026-10-29T15:00:00Z" },
    "5511999990000": { desde: "2026-10-29T13:00:00Z", ate: null },
  }, "sem `desde` não vale; `por` é do plugin, a tela não precisa");
  const marks = { ...parseWaMarks(null), paused: p };
  const antes = Date.parse("2026-10-29T14:00:00Z"), depois = Date.parse("2026-10-29T15:00:00Z");
  assert.deepEqual(pausaVigente(marks, "5521923670743", antes), { desde: "2026-10-29T13:00:00Z", ate: "2026-10-29T15:00:00Z" });
  assert.equal(pausaVigente(marks, "5521923670743", depois), null, "no instante do fim já venceu");
  assert.deepEqual(pausadosDe(marks, antes).sort(), ["5511999990000", "5521923670743", "5522925501274"]);
  assert.deepEqual(pausadosDe(marks, depois).sort(), ["5511999990000", "5522925501274"]);
  assert.deepEqual([...PAUSA_HORAS], [2, 24]);
});

test("paused (Hermes): waMarkSh grava {desde, ate} com o prazo calculado na máquina, migra as strings antigas e só aceita 2 ou 24 h", () => {
  const sh = waMarkSh([{ number: "5522925501274", paused: true, pausaHoras: 2 }]);
  assert.ok(sh.includes('"pausaHoras"') && sh.includes('"ate": iso(time.time() + h * 3600)'));
  assert.ok(sh.includes('if isinstance(v, str): paus[k] = {"desde": v, "ate": None'), "string antiga vira objeto ao regravar");
  assert.ok(waMarkSh([{ number: "5522925501274", paused: false }]).includes("paus.pop(n, None)"));
  assert.throws(() => waMarkSh([{ number: "5522925501274", paused: true, pausaHoras: 3 }]), /prazo de pausa inválido/);
});
