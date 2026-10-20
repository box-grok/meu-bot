import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../../extensao-crm/src/config.ts";
import { CORES_ETAPA, escuroPorCor, corDaEtapa } from "../../extensao-crm/src/tema.ts";
import { paraInputData, deInputData } from "../../extensao-crm/src/ui/campos.ts";
import { idDaChave } from "../../extensao-crm/scripts/id-da-extensao.mjs";
import { readFileSync } from "node:fs";

test("parseConfig: porta 1024–65535 e token 16–256 sem espaços; o resto é opcional", () => {
  assert.deepEqual(parseConfig({ porta: 43210, token: "a".repeat(32), host: "agente-box", app: "0.1.0" }), { porta: 43210, token: "a".repeat(32), host: "agente-box", app: "0.1.0" });
  assert.deepEqual(parseConfig({ porta: "43210", token: "a".repeat(16) }), { porta: 43210, token: "a".repeat(16), host: "", app: "" });
  assert.throws(() => parseConfig({ porta: 80, token: "a".repeat(32) }), /porta/);
  assert.throws(() => parseConfig({ porta: 43210, token: "curto" }), /token/);
  assert.throws(() => parseConfig({ porta: 43210, token: "a b".padEnd(20, "x") }), /token/);
  assert.throws(() => parseConfig(null), /porta/);
});
test("tema: luminância; paleta das etapas cíclica", () => {
  assert.equal(escuroPorCor("rgb(32, 33, 36)"), true); assert.equal(escuroPorCor("rgb(255,255,255)"), false); assert.equal(escuroPorCor("lixo"), false);
  assert.equal(corDaEtapa(0), corDaEtapa(CORES_ETAPA.length)); assert.notEqual(corDaEtapa(0), corDaEtapa(1)); assert.match(corDaEtapa(-1), /^#/);
});
test("datas do <input type=date>", () => {
  assert.equal(paraInputData("25/12/2026"), "2026-12-25"); assert.equal(paraInputData("2026-12-25"), "2026-12-25"); assert.equal(paraInputData("ontem"), "");
  assert.equal(deInputData("2026-12-25"), "25/12/2026"); assert.equal(deInputData("x"), "x");
});
test("id da extensão deriva do key do manifesto (32 chars a–p) e é estável", () => {
  const m = JSON.parse(readFileSync(new URL("../../extensao-crm/static/manifest.json", import.meta.url), "utf8"));
  const id = idDaChave(m.key);
  assert.match(id, /^[a-p]{32}$/); assert.equal(idDaChave(m.key), id);
  assert.equal(idDaChave(Buffer.from("teste").toString("base64")), "egahanelpjdeplanelagnjocmegodegj", "valor fixo: muda só se o algoritmo mudar");
});
