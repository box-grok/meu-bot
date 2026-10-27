import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { posicaoNoCanto } = createRequire(import.meta.url)("../../dist/main/app/janela-core.js");

const AREA = { x: 0, y: 33, width: 1470, height: 829 }; // MacBook: barra de menus em cima, Dock embaixo

test("janela nasce bem colada à direita, de cima até o Dock, na largura mínima", () => {
  assert.deepEqual(posicaoNoCanto(AREA, 640), { x: 830, y: 33, width: 640, height: 829 });
});

test("canto ocupado: a próxima cola à esquerda; a terceira, à esquerda das duas; nunca passa da borda", () => {
  const a = posicaoNoCanto(AREA, 640);
  const b = posicaoNoCanto(AREA, 640, [a]);
  assert.equal(b.x, 190);
  assert.equal(posicaoNoCanto(AREA, 640, [a, b]).x, 0, "sem espaço: encosta na borda esquerda");
  assert.equal(posicaoNoCanto(AREA, 640, [{ ...a, x: a.x + 5 }]).x, 190, "alguns pixels de diferença ainda é o mesmo lugar");
  assert.equal(posicaoNoCanto(AREA, 640, [{ x: 400, y: 33, width: 640, height: 829 }]).x, 830, "janela em outro lugar não empurra");
});

test("outra tela não conta; tela estreita: a janela cabe nela", () => {
  const a = posicaoNoCanto(AREA, 640);
  assert.equal(posicaoNoCanto({ ...AREA, x: 1470 }, 640, [a]).x, 1470 + 830, "a janela do monitor ao lado não ocupa este canto");
  assert.deepEqual(posicaoNoCanto({ x: 0, y: 0, width: 500, height: 700 }, 640), { x: 0, y: 0, width: 500, height: 700 });
});
