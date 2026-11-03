import assert from "node:assert/strict";
import { test } from "node:test";
import { abaDoPedido } from "../../dist/renderer/lib/whatsapp-preparar.js";
import { GUIDE_ACTION_LABEL } from "../../dist/renderer/lib/tutoriais.js";

// "Pedir ao agente para preparar" (passo wa-agent do tutorial do WhatsApp): clicar de novo volta à aba que já tem o
// pedido; só abre outra se aquela foi fechada. Em 3/11 cada clique abria mais uma conversa com o mesmo pedido.
test("abaDoPedido: reaproveita a aba anterior enquanto ela existe", () => {
  const abertas = new Set(["c1", "c2"]);
  assert.equal(abaDoPedido(null, (id) => abertas.has(id)), null, "sem pedido anterior: aba nova");
  assert.equal(abaDoPedido("c1", (id) => abertas.has(id)), "c1", "pedido anterior aberto: volta para ele");
  abertas.delete("c1");
  assert.equal(abaDoPedido("c1", (id) => abertas.has(id)), null, "aba fechada: aba nova");
});

test("rótulo do passo wa-agent diz o que o botão faz (não é o 'Abrir o WhatsApp' do passo seguinte)", () => {
  assert.equal(GUIDE_ACTION_LABEL["wa-agent"], "Pedir ao agente para preparar");
  assert.notEqual(GUIDE_ACTION_LABEL["wa-agent"], GUIDE_ACTION_LABEL["wa-line"]);
});
