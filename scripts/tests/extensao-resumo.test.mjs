import { test } from "node:test";
import assert from "node:assert/strict";
import { diasDesde, haQuanto, proximoPasso, resumoDaCaixa } from "../../extensao-crm/src/resumo.ts";
const T = Date.parse("2026-10-19T12:00:00.000Z");

test("haQuanto e diasDesde em português", () => {
  assert.equal(haQuanto("2026-10-19T11:59:40.000Z", T), "agora"); assert.equal(haQuanto("2026-10-19T11:55", T), "há 5 min");
  assert.equal(haQuanto("2026-10-19T09:00:00Z", T), "há 3 h"); assert.equal(haQuanto("2026-10-18T12:00:00Z", T), "há 1 dia"); assert.equal(haQuanto("2026-07-19T12:00:00Z", T), "há 3 meses");
  assert.equal(haQuanto(undefined, T), ""); assert.equal(diasDesde("2026-10-16T13:00:00Z", T), 2); assert.equal(diasDesde("lixo", T), null);
});
test("resumoDaCaixa: etapa e tempo nela, último registro e o próximo passo das anotações", () => {
  const f = { box: { stage: "Prospecção", etapaDesde: "2026-10-17T12:00:00Z" }, comentarios: [{ em: "2026-10-19T04:00", texto: "foi cobrado o chip a preço de custo" }], notes: "Dono de loja.\nPróximo passo: aguardar a contratação do Kommo.", threads: [], contatos: [] };
  assert.equal(resumoDaCaixa(f, T), 'Em Prospecção há 2 dias · último registro há 8 h: "foi cobrado o chip a preço de custo" · próximo passo: aguardar a contratação do Kommo.');
  assert.equal(resumoDaCaixa({ ...f, comentarios: [], notes: "", box: { stage: "Lead", etapaDesde: "2026-10-19T08:00:00Z" } }, T), "Em Lead desde hoje · nenhum registro ainda");
  assert.equal(proximoPasso("x\nproximo passo:  ligar segunda "), "ligar segunda"); assert.equal(proximoPasso("nada"), null);
});
