import { test } from "node:test";
import assert from "node:assert/strict";
import { SONDAS, detalheSeguro, deveEmitirSonda, podar, resumoAcao } from "../../dist/main/app/depuracao-core.js";

test("resumo por rota: Navegador, Gmail, terminal, nota; erro vira ✗; rota desconhecida lista o pedido", () => {
  assert.equal(resumoAcao("navegador", "/abrir", { url: "https://dalefit.cloud/?v=x", nova: true }, { aba: 5 }, null), "https://dalefit.cloud/?v=x → aba 5 (nova)");
  assert.equal(resumoAcao("navegador", "/fechar", {}, { ok: true, fechada: 5, recarregadas: [4] }, null), "fechou a aba 5 → recarregou [4]");
  assert.equal(resumoAcao("navegador", "/fechar", {}, { ok: true, fechada: 5, recarregadas: [] }, null), "fechou a aba 5");
  assert.equal(resumoAcao("navegador", "/clicar", { texto: "Enviar" }, {}, null), 'clicou em "Enviar"');
  assert.equal(resumoAcao("navegador", "/digitar", { n: 3, texto: "olá mundo", enter: true }, {}, null), "digitou 9 caracteres no 3 + Enter");
  assert.equal(resumoAcao("navegador", "/ler", {}, { aba: 4, title: "DaleFit", elements: [1, 2] }, null), "aba 4: DaleFit · 2 elementos");
  assert.equal(resumoAcao("gmail", "/listar", { busca: "from:ana" }, { mensagens: [1, 2, 3] }, null), 'busca "from:ana" → 3 mensagens');
  assert.equal(resumoAcao("gmail", "/listar", {}, { mensagens: [] }, null), "caixa de entrada → 0 mensagens");
  assert.equal(resumoAcao("gmail", "/apagar", { id: "abc" }, { assunto: "Fatura" }, null), "lixeira: Fatura");
  assert.equal(resumoAcao("terminal", "/abrir", {}, { terminal: 2, maquina: "meu-root-root" }, null), "terminal 2 em meu-root-root");
  assert.equal(resumoAcao("terminal", "/digitar", { id: "t1", texto: "ls -la", enter: true }, { ok: true }, null), "digitou 6 caracteres no t1 + Enter");
  assert.equal(resumoAcao("terminal", "/nota", { texto: "vou pedir ao agente para acrescentar uma linha" }, { ok: true }, null), "vou pedir ao agente para acrescentar uma linha");
  assert.equal(resumoAcao("navegador", "/abrir", { url: "x" }, null, "url precisa começar com http"), "url precisa começar com http", "a faixa já põe o ✗ na linha");
  assert.equal(resumoAcao("navegador", "/favoritar", { url: "https://a.b", titulo: "A" }, {}, null), "url=https://a.b titulo=A");
  assert.equal(resumoAcao("navegador", "/x", {}, {}, null), "ok");
});

test("detalhe seguro: corta textos longos, ignora undefined e deixa /ler e /print sem payload", () => {
  const longo = "a".repeat(250);
  assert.deepEqual(detalheSeguro("/js", { codigo: longo, aba: 4, x: undefined }), { codigo: `${"a".repeat(200)}… (250 caracteres)`, aba: 4 });
  assert.equal(detalheSeguro("/ler", { aba: 4 }), null);
  assert.equal(detalheSeguro("/print", {}), null);
});

test("sondas: /abas, /terminais, /status e /diag só entram no fluxo a cada 30 s; o anel poda por tamanho e por idade", () => {
  assert.ok(SONDAS.has("/abas") && SONDAS.has("/status") && !SONDAS.has("/abrir"));
  assert.equal(deveEmitirSonda(null, 1000), true);
  assert.equal(deveEmitirSonda(1000, 20_000), false);
  assert.equal(deveEmitirSonda(1000, 31_000), true);
  const ev = Array.from({ length: 310 }, (_, i) => ({ em: 1_000_000 + i * 1000 }));
  assert.equal(podar(ev, 1_000_000 + 310_000).length, 300, "tamanho");
  const velhos = [{ em: 0 }, { em: 1 }, { em: 10_000_000 }];
  assert.deepEqual(podar(velhos, 10_000_000 + 60_000), [{ em: 10_000_000 }], "idade");
});
