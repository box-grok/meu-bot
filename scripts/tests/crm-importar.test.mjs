import { test } from "node:test";
import assert from "node:assert/strict";
import { mapearTipo, normalizarStreak } from "../../backend-colima/crm/importar-streak.mjs";

const pipeline = { key: "agxzPipe", name: "Parceiros", stageOrder: ["5002", "5001"], stages: { 5001: { name: "Acordo" }, 5002: { name: "Prospecção" } },
  fields: [{ key: "1001", name: "Origem", type: "DROPDOWN", dropdownSettings: { items: [{ key: "9001", name: "Site" }] } }, { key: "1002", name: "Tags", type: "TAG", tagSettings: { tags: [{ key: "t1", name: "Quente" }] } }, { key: "1003", name: "Valor", type: "NUMBER" }, { key: "1004", name: "Dono", type: "PERSON" }, { key: "1005", name: "Fecha", type: "DATE" }] };
const boxes = [{ boxKey: "bxA", name: "Maria", stageKey: "5002", notes: "n", lastUpdatedTimestamp: 1700, fields: { 1001: "9001", 1002: ["t1"], 1003: "12.5", 1004: { email: "x@y" }, 1005: 1699 }, contacts: [{ key: "ctA" }, { key: "ctSem" }] }, { boxKey: "bxB", name: "Sem nada", stageKey: "5001" }];

test("mapearTipo: tipos conhecidos passam; desconhecido vira TEXT com aviso", () => {
  assert.deepEqual(mapearTipo("DROPDOWN"), { type: "DROPDOWN", aviso: null });
  assert.equal(mapearTipo("TEXT_INPUT").type, "TEXT");
  assert.match(mapearTipo("FORMULA").aviso, /FORMULA virou texto/);
});

test("normalizarStreak: etapas na ordem do stageOrder, campos com opções, valores por tipo, contatos, comentários e threads por box", () => {
  const b = normalizarStreak({ pipeline, boxes, comentariosPorBox: { bxA: [{ key: "cm1", timestamp: 1500, message: "oi" }, { key: "cm2", message: "  " }] }, threadsPorBox: { bxA: [{ threadGmailId: "1A1544925ACE5958", subject: "T", emailAddresses: ["a@b.c"], numberOfEmails: 3, lastUpdatedTimestamp: 1600 }, { threadGmailId: "lixo" }] }, contatos: { ctA: { givenName: "Maria", familyName: "Lima", emailAddresses: ["m@x.com"], phoneNumbers: ["+5511999990000"] } } });
  assert.equal(b.pipeline.key, "agxzPipe"); assert.deepEqual(b.pipeline.stages.map((s) => s.name), ["Prospecção", "Acordo"]);
  assert.equal(b.pipeline.fields[0].options[0].name, "Site"); assert.equal(b.pipeline.fields[1].options[0].key, "t1"); assert.equal(b.pipeline.fields[3].type, "TEXT");
  assert.deepEqual(b.avisos, ["Dono: campo do tipo PERSON virou texto"]);
  const a = b.boxes[0];
  assert.equal(a.key, "bxA"); assert.equal(a.stageKey, "5002"); assert.equal(a.updatedAt, 1700); assert.deepEqual(a.origem, { streak: "bxA" });
  assert.deepEqual(a.fields, { 1001: "9001", 1002: ["t1"], 1003: 12.5, 1004: '{"email":"x@y"}', 1005: 1699 });
  assert.deepEqual(a.contatoKeys, ["ctA"], "contato sem ficha não entra");
  assert.deepEqual(a.comentarios, [{ key: "cm1", at: 1500, autor: "streak", texto: "oi" }], "comentário vazio some");
  assert.equal(a.threads.length, 1); assert.equal(a.threads[0].threadGmailId, "1a1544925ace5958"); assert.equal(a.threads[0].mensagens, 3);
  assert.deepEqual(b.contatos, [{ key: "ctA", nome: "Maria Lima", emails: ["m@x.com"], telefones: ["+5511999990000"], origem: { streak: "ctA" } }]);
  assert.deepEqual(b.boxes[1].fields, {}); assert.deepEqual(b.boxes[1].comentarios, []);
});
