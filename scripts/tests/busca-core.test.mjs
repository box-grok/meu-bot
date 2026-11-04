import { test } from "node:test";
import assert from "node:assert/strict";
const { textoResultado, ATALHOS } = await import("../../dist/renderer/lib/busca-core.js");

test("textoResultado: o contador não mente enquanto o Chromium não respondeu", () => {
  assert.equal(textoResultado(null, ""), "", "campo vazio não mostra nada");
  assert.equal(textoResultado({ atual: 0, total: 0 }, ""), "", "campo vazio vence qualquer resultado velho");
  // Entre a tecla e a resposta, "nenhum resultado" piscaria em toda digitação: seria falso por um instante.
  assert.equal(textoResultado(null, "ab"), "procurando…");
  assert.equal(textoResultado({ atual: 0, total: 0 }, "ab"), "nenhum resultado");
  assert.equal(textoResultado({ atual: 1, total: 1 }, "ab"), "1 de 1");
  assert.equal(textoResultado({ atual: 3, total: 12 }, "ab"), "3 de 12");
});

test("folha de atalhos: nada repetido dentro de um grupo, e todo item diz o que faz", () => {
  assert.ok(ATALHOS.length >= 4);
  for (const g of ATALHOS) {
    assert.ok(g.titulo.length > 0, "grupo sem título");
    assert.ok(g.atalhos.length > 0, `grupo "${g.titulo}" vazio`);
    const teclas = g.atalhos.map((a) => a.teclas);
    assert.equal(new Set(teclas).size, teclas.length, `tecla repetida dentro de "${g.titulo}"`);
    for (const a of g.atalhos) {
      assert.ok(a.o_que.length > 0, `${a.teclas} sem descrição`);
      assert.match(a.teclas, /^[⌘⌥⇧⌃]/, `${a.teclas} deveria começar por um modificador`);
    }
  }
  // ⌘F aparece em mais de um grupo de propósito: ele muda de dono conforme o foco, e a folha diz isso.
  const comF = ATALHOS.filter((g) => g.atalhos.some((a) => a.teclas === "⌘F"));
  assert.ok(comF.length >= 2, "⌘F é sensível ao foco: a folha precisa explicar cada caso");
  for (const g of comF.slice(1)) assert.match(g.atalhos.find((a) => a.teclas === "⌘F").o_que, /foco/);
});
