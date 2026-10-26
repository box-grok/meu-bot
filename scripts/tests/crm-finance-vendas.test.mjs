import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const require = createRequire(import.meta.url);
const { createFinanceApi } = require("../../backend-colima/finance-api.js");
const { createCrmApi } = require("../../backend-colima/crm-api.js");
const { sincronizarVendas, mapaVendas, PIPELINE_VENDAS } = require("../../backend-colima/crm-finance-vendas.js");

const dir = mkdtempSync(join(tmpdir(), "crm-vendas-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const noop = () => {};
const readJson = (f, fb) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fb; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const finance = createFinanceApi({ dir: join(dir, "fin"), licenseOk: () => true, json: noop, readBody: async () => "", log: noop });
const crm = createCrmApi({ dir: join(dir, "crm"), configFile: join(dir, "crm.json"), licenseOk: () => true, readJson, writeJson, json: noop, readBody: async () => "", log: noop, iaTexto: async () => "", semearIndicacao: false });
const vendas = () => finance.store.listLanc().filter((l) => (l.ref ?? "").startsWith("crm:"));
const box = (key, stageKey, fields, name = "Pedido") => crm.importar({ pipeline: { key: PIPELINE_VENDAS.key }, forcar: true, boxes: [{ key, name, stageKey, fields, updatedAt: Date.now() }] }, "teste");

test("mapaVendas: precisa de Produto, Valor e uma etapa de venda concluída", () => {
  assert.ok(mapaVendas({ ...PIPELINE_VENDAS }));
  assert.equal(mapaVendas({ fields: [{ key: "a", name: "Produto" }], stages: [{ key: "s", name: "Vendido" }] }), null, "sem Valor");
  assert.equal(mapaVendas({ fields: [{ key: "a", name: "Produto" }, { key: "b", name: "Valor" }], stages: [{ key: "s", name: "Contato" }] }), null, "sem etapa de venda");
  assert.ok(mapaVendas({ fields: [{ key: "a", name: "SKU" }, { key: "b", name: "Total" }], stages: [{ key: "s", name: "Ganho" }] }));
});

test("CRM → financeiro: cria o pipeline Vendas; Vendido vira entrada com produto e peças; idempotente; muda e sai junto", async () => {
  const r0 = await sincronizarVendas(crm, finance, "teste");
  assert.equal(r0.pipelineCriado, "p_vendas");
  assert.deepEqual(crm.store.getPipeline("p_vendas").fields.map((f) => f.name), ["Cliente", "Produto", "Quantidade", "Valor", "Data da venda"]);
  assert.equal((await sincronizarVendas(crm, finance, "teste")).pipelineCriado, null, "não recria");

  await box("b_maria", "s_vendido", { Cliente: "Maria", Produto: "Sutiã renda preto", Quantidade: 2, Valor: "R$ 180,00", "Data da venda": "08/10/2026" });
  await box("b_ana", "s_negociando", { Cliente: "Ana", Produto: "Calcinha fio", Quantidade: 5, Valor: "100" });
  const r1 = await sincronizarVendas(crm, finance, "teste");
  assert.equal(r1.criados, 1);
  const [l] = vendas();
  assert.deepEqual([l.favorecido, l.produto, l.qtd, l.valorCent, l.data, l.origem, l.status], ["Maria", "Sutiã renda preto", 2, 18000, "2026-10-08", "crm", "confirmado"]);
  assert.equal(finance.store.get("categorias", l.categoria).nome, "Vendas");

  const seq = finance.store.meta().seq;
  const r2 = await sincronizarVendas(crm, finance, "teste");
  assert.deepEqual([r2.criados, r2.atualizados, r2.removidos, r2.iguais], [0, 0, 0, 1]);
  assert.equal(finance.store.meta().seq, seq, "sem diferença, não grava");

  await box("b_maria", "s_vendido", { Valor: "R$ 200,00" });
  await box("b_ana", "s_vendido", {});
  const r3 = await sincronizarVendas(crm, finance, "teste");
  assert.deepEqual([r3.criados, r3.atualizados], [1, 1]);
  assert.equal(vendas().find((x) => x.ref === "crm:b_maria").valorCent, 20000);
  assert.equal(vendas().find((x) => x.ref === "crm:b_maria").id, l.id, "mesmo lançamento, regravado");

  await box("b_maria", "s_perdido", {});
  const r4 = await sincronizarVendas(crm, finance, "teste");
  assert.equal(r4.removidos, 1);
  assert.deepEqual(vendas().map((x) => x.produto), ["Calcinha fio"]);
});
