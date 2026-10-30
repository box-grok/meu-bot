import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../dist/main/maquina/seletor-notificacao-core.js");

test("notificação: o activate que vem junto do clique não abre o seletor por 1,5 s; o seletor que abriu nesse meio tempo é fechado; o Dock continua abrindo", () => {
  const clique = 1_000_000;
  const ate = core.suprimirSeletorAte(clique);
  assert.equal(ate, clique + 1500);
  assert.equal(core.seletorPodeAbrir(ate, clique + 10), false, "activate logo depois do clique: ignorado");
  assert.equal(core.seletorPodeAbrir(ate, clique + 1499), false);
  assert.equal(core.seletorPodeAbrir(ate, clique + 1500), true, "passada a janela, o Dock volta a abrir o seletor");
  assert.equal(core.seletorPodeAbrir(0, clique), true, "sem clique nenhum, abre sempre");
  // activate antes do clique (a outra ordem): o seletor já abriu; o clique fecha porque ele é recém-aberto.
  assert.equal(core.seletorRecemAberto(clique - 200, clique), true);
  assert.equal(core.seletorRecemAberto(clique - 1500, clique), false, "seletor aberto pela pessoa há mais tempo fica");
  assert.equal(core.seletorRecemAberto(0, clique), false, "nunca mostrado");
});
