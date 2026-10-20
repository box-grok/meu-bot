import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarVista, parseVista, textoFiltro, valoresDaColuna } from "../../extensao-crm/src/planilha.ts";

const linhas = [{ nome: "Zeca", pls: [] }, { nome: "Ana", pls: ["Parceiros Grok"] }, { nome: "bruno", pls: ["Clientes", "Parceiros Grok"] }, { nome: "", pls: ["Clientes"] }];
const val = (l, c) => (c === "nome" ? [l.nome] : l.pls);

test("filtro: só com pipeline, ordem A→Z (acento/caixa não importam; vazios por último)", () => {
  const r = aplicarVista(linhas, val, { ordem: { col: "nome", dir: "asc" }, filtros: { pipelines: { tipo: "preenchido" } } });
  assert.deepEqual(r.map((l) => l.nome), ["Ana", "bruno", ""]);
  assert.deepEqual(aplicarVista(linhas, val, { ordem: null, filtros: { pipelines: { tipo: "vazio" } } }).map((l) => l.nome), ["Zeca"]);
  assert.deepEqual(aplicarVista(linhas, val, { ordem: { col: "nome", dir: "desc" }, filtros: { pipelines: { tipo: "valor", valor: "parceiros grok" } } }).map((l) => l.nome), ["bruno", "Ana"]);
});

test("valores da coluna com contagem; vista guardada tolerante; texto do chip", () => {
  assert.deepEqual(valoresDaColuna(linhas, val, "pipelines"), [{ valor: "Clientes", n: 2 }, { valor: "Parceiros Grok", n: 2 }]);
  assert.deepEqual(parseVista('{"ordem":{"col":"nome","dir":"asc"},"filtros":{"pipelines":{"tipo":"preenchido"},"x":{"tipo":"lixo"}}}'), { ordem: { col: "nome", dir: "asc" }, filtros: { pipelines: { tipo: "preenchido" } } });
  assert.deepEqual(parseVista("{quebrado"), { ordem: null, filtros: {} });
  assert.equal(textoFiltro({ tipo: "valor", valor: "Clientes" }), "= Clientes");
});
