import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorEtapa, renomearEtapa, valorTexto } from "../../extensao-crm/src/grade.ts";
import { CORES_ETAPA, textoSobre } from "../../extensao-crm/src/tema.ts";

const etapas = [{ key: "s1", name: "Prospecção" }, { key: "s2", name: "Onboarding" }];
const cx = (key, name, stageKey) => ({ key, name, stageKey, updatedAt: 0, fields: {}, contatos: 0, threads: 0 });

test("valorTexto formata cada tipo como a ficha", () => {
  const drop = { key: "f1", name: "Tipo", type: "DROPDOWN", options: [{ key: "o1", name: "Indicador" }] };
  assert.equal(valorTexto(drop, "o1"), "Indicador"); assert.equal(valorTexto(drop, ""), "");
  assert.equal(valorTexto({ key: "f2", name: "T", type: "TAG", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }] }, ["a", "b"]), "A, B");
  assert.equal(valorTexto({ key: "f3", name: "D", type: "DATE", options: [] }, Date.UTC(2026, 9, 19)), "19/10/2026");
  assert.equal(valorTexto({ key: "f4", name: "C", type: "CHECKBOX", options: [] }, true), "sim");
  assert.equal(valorTexto({ key: "f4", name: "C", type: "CHECKBOX", options: [] }, false), "");
  assert.equal(valorTexto({ key: "f5", name: "N", type: "NUMBER", options: [] }, 12.5), "12.5");
});

test("agruparPorEtapa mantém todas as etapas, ordena por nome e manda órfãs para a primeira", () => {
  const g = agruparPorEtapa(etapas, [cx("b1", "Zeca", "s1"), cx("b2", "Ana", "s1"), cx("b3", "Órfã", "sumiu")]);
  assert.deepEqual([...g.keys()], ["s1", "s2"]);
  assert.deepEqual(g.get("s1").map((b) => b.name), ["Ana", "Órfã", "Zeca"]);
  assert.deepEqual(g.get("s2"), []);
});

test("renomearEtapa troca só o nome e preserva a chave", () => {
  assert.deepEqual(renomearEtapa(etapas, "s2", "Ativação"), [{ key: "s1", name: "Prospecção" }, { key: "s2", name: "Ativação" }]);
});

test("textoSobre: escuro nas cores claras da paleta, branco nas fortes", () => {
  assert.equal(textoSobre(CORES_ETAPA[0]), "#fff"); assert.equal(textoSobre(CORES_ETAPA[2]), "#202124"); assert.equal(textoSobre("#ffffff"), "#202124"); assert.equal(textoSobre("#000000"), "#fff");
});
