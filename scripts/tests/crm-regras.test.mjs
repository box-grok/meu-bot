import test from "node:test";
import assert from "node:assert/strict";
import { SilenceTracker, buildPrompt, confirmIndex, isConfirm, isDirectWhatsapp, isReject, lastTimestamp, mergeEstado, normalizePhone, ownerCommand, ownerMessage, parseCrmJson, phoneOfSessionKey, threadFromHistory } from "../../backend-colima/crm/regras.mjs";

test("chave de sessão → telefone; só diretas do WhatsApp", () => {
  assert.equal(phoneOfSessionKey("agent:main:whatsapp:direct:+595994402904"), "+595994402904");
  assert.equal(phoneOfSessionKey("agent:main:whatsapp:conta2:direct:5511999"), "+5511999");
  assert.equal(phoneOfSessionKey("agent:main:main"), null);
  assert.equal(isDirectWhatsapp("agent:main:whatsapp:direct:+1"), true);
  assert.equal(isDirectWhatsapp("agent:main:telegram:direct:+1"), false);
  assert.equal(normalizePhone("5521923670743:19@s.whatsapp.net"), "+5521923670743");
  assert.equal(normalizePhone(""), null);
});

test("comandos do dono: anota no CRM / crm:, confirmações e descartes", () => {
  assert.equal(ownerCommand("Anota no CRM: Junior fechou o Kommo"), "Junior fechou o Kommo");
  assert.equal(ownerCommand("crm Junior quer reunião terça"), "Junior quer reunião terça");
  assert.equal(ownerCommand("anotar no crm"), "");
  assert.equal(ownerCommand("bom dia"), null);
  assert.equal(isConfirm("ok"), true); assert.equal(isConfirm("OK crm!"), true); assert.equal(isConfirm("ok 2"), false);
  assert.equal(confirmIndex("ok 2"), 2); assert.equal(confirmIndex("ok"), null);
  assert.equal(isReject("não"), true); assert.equal(isReject("nao crm"), true); assert.equal(isReject("não sei"), false);
});

test("SilenceTracker: vence depois do silêncio e esquece; serializa", () => {
  const t = new SilenceTracker({ a: 1000 });
  t.touch("b", 5000);
  assert.deepEqual(t.due(5000 + 10 * 60_000 - 1, 10 * 60_000), ["a"]);
  assert.deepEqual(t.due(5000 + 10 * 60_000, 10 * 60_000), ["b"]);
  assert.deepEqual(t.due(10 ** 12), []);
  t.touch("c", 1); assert.deepEqual(t.toJSON(), { c: 1 });
});

test("threadFromHistory: só depois da marca, papéis e texto das partes; avisos fora", () => {
  const h = { messages: [
    { role: "system", content: [{ type: "text", text: "Reset" }], timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "Oi" }], timestamp: 10 },
    { role: "assistant", content: "Olá!", timestamp: 20 },
    { role: "user", content: "Nota do meu-bot: pausa encerrada", timestamp: 30 },
    { role: "assistant", content: "NO_REPLY", timestamp: 35 },
    { role: "user", content: [{ type: "text", text: "Fechei o Kommo" }], timestamp: 40 },
  ] };
  const all = threadFromHistory(h, 0);
  assert.deepEqual(all.map((m) => [m.role, m.text]), [["contato", "Oi"], ["agente", "Olá!"], ["contato", "Fechei o Kommo"]]);
  assert.deepEqual(threadFromHistory(h, 20).map((m) => m.text), ["Fechei o Kommo"]);
  assert.equal(lastTimestamp(all), 40);
  assert.deepEqual(threadFromHistory({}, 0), []);
});

test("parseCrmJson: bloco válido, ações permitidas, limites; lixo vira null", () => {
  const txt = "Fiz isso.\n```crm-json\n{\"aplicado\":[\"comentei\"],\"propostas\":[{\"acao\":\"box-update\",\"args\":[\"k\",\"--stage\",\"Acordo\"],\"texto\":\"mover\"},{\"acao\":\"rm -rf\",\"args\":[],\"texto\":\"x\"}],\"resumo\":\"ok\"}\n```";
  const p = parseCrmJson(txt);
  assert.deepEqual(p.aplicado, ["comentei"]);
  assert.equal(p.propostas.length, 1); assert.equal(p.propostas[0].acao, "box-update");
  assert.equal(parseCrmJson("sem bloco"), null);
  assert.equal(parseCrmJson("```crm-json\n{nope\n```"), null);
});

test("ownerMessage: resumo, aplicados e propostas numeradas com instrução", () => {
  const m = ownerMessage("Junior", { aplicado: ["comentário: fechou o Kommo"], propostas: [{ acao: "box-update", args: [], texto: "mover para Acordo" }], resumo: "Fechou o Kommo." });
  assert.match(m, /📇 CRM · Junior/); assert.match(m, /✓ comentário/); assert.match(m, /1\. mover para Acordo/); assert.match(m, /"ok"/);
  const m2 = ownerMessage("Junior", { aplicado: [], propostas: [{ acao: "comment", args: [], texto: "a" }, { acao: "comment", args: [], texto: "b" }], resumo: "" });
  assert.match(m2, /ok 2/);
});

test("buildPrompt: traz etapas, campos, conversa, pedido do dono e o contrato crm-json", () => {
  const p = buildPrompt({ phone: "+595994402904", contactName: "Junior", pipeline: { name: "Parceiros", stages: [{ name: "Prospecção" }], fields: [{ name: "Origem", type: "DROPDOWN", options: ["Redes sociais", "Indicação"] }] }, delta: [{ role: "contato", at: 1792280349869, text: "Isso é o futuro" }], command: "anota que fechou", allowCreate: false, streakCli: "node /x/streak.mjs", knownBox: { name: "Junior Rezende", key: "k1", stage: "Prospecção" } });
  assert.match(p, /Junior \(\+595994402904\)/); assert.match(p, /- Prospecção/); assert.match(p, /Origem \[DROPDOWN\]: Redes sociais \| Indicação/);
  assert.match(p, /Isso é o futuro/); assert.match(p, /Pedido do dono agora: "anota que fechou"/); assert.match(p, /NÃO faça; proponha/); assert.match(p, /```crm-json/);
  assert.match(buildPrompt({ phone: "+1", contactName: null, pipeline: null, delta: [], command: null, allowCreate: true, streakCli: "s", knownBox: null }), /pode fazer sozinho quando a conversa justificar/);
});

test("mergeEstado: por telefone, sem perder o resto", () => {
  const e = mergeEstado({ "+1": { marca: 5 }, ultimaProposta: "+1" }, "+1", { propostas: [] });
  assert.deepEqual(e, { "+1": { marca: 5, propostas: [] }, ultimaProposta: "+1" });
  assert.deepEqual(mergeEstado(null, "+2", { marca: 1 }), { "+2": { marca: 1 } });
});
