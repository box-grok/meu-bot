import assert from "node:assert/strict";
import { test } from "node:test";
import { GRUPOS_AVISO, GRUPOS_QUEM_NOTA, grupoAlvo, nomeDoGrupo, quemEscolhido, quemResumo } from "../../dist/renderer/lib/whatsapp-grupos.js";

const G1 = { jid: "111@g.us", nome: "Família", apelido: null, agente: "desligado", participantes: 3 };
const G2 = { jid: "222@g.us", nome: "Trabalho", apelido: "Time", agente: "chamado", participantes: 5 };
const ligado = { grupos: [G1, G2], quemAciona: ["5511999998888"], quemAcionaHerdado: false, todosAdmitidos: false, cacheEm: null, skill: true, self: null };

test("grupos: alvo é o escolhido se existe, senão o primeiro com o agente ligado; nome = apelido, nome ou jid", () => {
  assert.match(GRUPOS_AVISO, /Nunca ligue o agente num grupo com clientes/);
  assert.equal(grupoAlvo(ligado, null).jid, G2.jid);
  assert.equal(grupoAlvo(ligado, "999999999999@g.us").jid, G2.jid);
  assert.equal(grupoAlvo(ligado, G1.jid).jid, G1.jid);
  assert.equal(grupoAlvo(null, G1.jid), null);
  assert.equal(nomeDoGrupo(G1), "Família"); assert.equal(nomeDoGrupo(G2), "Time"); assert.equal(nomeDoGrupo({ ...G1, nome: null, apelido: null }), "111");
  assert.match(GRUPOS_QUEM_NOTA, /não responde a essa pessoa/);
});

test("quem aciona: herdado das diretas não conta como escolha; resumo conta os outros além de você", () => {
  assert.equal(quemEscolhido({ ...ligado, quemAcionaHerdado: true }), false);
  assert.equal(quemEscolhido({ ...ligado, quemAciona: [] }), false);
  assert.equal(quemEscolhido(ligado), true); assert.equal(quemEscolhido({ ...ligado, quemAciona: "todos" }), true);
  assert.equal(quemResumo(null), null); assert.equal(quemResumo({ ...ligado, quemAcionaHerdado: true }), null);
  assert.equal(quemResumo({ ...ligado, self: "5511999998888" }), "Quem chama: só você");
  assert.equal(quemResumo({ ...ligado, quemAciona: ["5511999998888", "5521", "5531"], self: "5511999998888" }), "Quem chama: você + 1", "o número do agente não conta; você é um dos outros dois");
  assert.equal(quemResumo({ ...ligado, quemAciona: "todos" }), "Quem chama: todo mundo do grupo");
});
