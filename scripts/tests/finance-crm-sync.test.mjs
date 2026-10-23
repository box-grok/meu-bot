import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const require = createRequire(import.meta.url);
const { createFinanceApi } = require("../../backend-colima/finance-api.js");
const { createCrmApi } = require("../../backend-colima/crm-api.js");
const { sincronizarInvestimentos, PIPELINE_KEY } = require("../../backend-colima/finance-crm-sync.js");

const dir = mkdtempSync(join(tmpdir(), "fin-crm-"));
const noop = () => {};
const json = () => {}; const readBody = async () => "";
const readJson = (f, fb) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fb; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const finance = createFinanceApi({ dir: join(dir, "fin"), licenseOk: () => true, json, readBody, log: noop });
const crm = createCrmApi({ dir: join(dir, "crm"), configFile: join(dir, "crm.json"), licenseOk: () => true, readJson, writeJson, json, readBody, log: noop, iaTexto: async () => "", semearIndicacao: false });

test("sync financeiro→CRM: cria o pipeline 'Investimentos & ROI' com cartões; idempotente (não duplica)", async () => {
  // exibição em dólar + taxa; e uma frente de investimento (linha da DRE) com valor previsto
  await finance.store.setConfig({ moedaExibicao: "USD", taxas: { PYG: 7300 } }, "teste");
  const lista = finance.store.list("linhas");
  assert.ok(lista.length > 0, "o financeiro já nasce com linhas padrão da DRE");

  const r1 = await sincronizarInvestimentos(finance, crm, "teste");
  assert.equal(r1.pipeline.key, PIPELINE_KEY);
  const pl = crm.store.getPipeline(PIPELINE_KEY);
  assert.ok(pl, "pipeline criado");
  assert.equal(pl.name, "Investimentos & ROI");
  assert.deepEqual(pl.stages.map((s) => s.name), ["Planejado", "Ativo", "Em análise", "Encerrado"]);
  const boxes1 = crm.store.listBoxes(PIPELINE_KEY);
  const nBoxes = boxes1.length;
  assert.ok(nBoxes >= 2, `tem cartões (linhas + resumo): ${nBoxes}`);
  // o cartão-resumo existe e mostra a moeda de exibição
  const resumo = boxes1.find((b) => b.key === "inv_resumo");
  assert.ok(resumo, "cartão-resumo criado");
  const fmoeda = pl.fields.find((f) => f.name === "Moeda");
  assert.equal(resumo.fields[fmoeda.key], "USD");

  // rodar de novo não duplica (upsert por chave estável)
  const r2 = await sincronizarInvestimentos(finance, crm, "teste");
  assert.equal(r2.boxes.novos, 0, "nada novo no segundo sync");
  assert.equal(crm.store.listBoxes(PIPELINE_KEY).length, nBoxes, "mesmo número de cartões");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
