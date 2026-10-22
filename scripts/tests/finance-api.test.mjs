import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createFinanceApi } = createRequire(import.meta.url)("../../backend-colima/finance-api.js");

const dir = mkdtempSync(join(tmpdir(), "fin-api-"));
let licenca = true;
let agora = new Date(2026, 9, 22, 12).getTime(); // 22/10/2026, fuso local
const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 1e6) => new Promise((resolve, reject) => { const c = []; let n = 0; req.on("data", (d) => { n += d.length; if (n > limit) { reject(new Error("grande")); req.destroy(); } c.push(d); }); req.on("end", () => resolve(Buffer.concat(c).toString("utf8"))); req.on("error", reject); });
const api = createFinanceApi({ dir: join(dir, "db"), licenseOk: () => licenca, json, readBody, log: () => {}, now: () => agora });
const server = http.createServer((req, res) => { const url = new URL(req.url, "http://x"); if (url.pathname.startsWith("/v1/finance")) api.handle(req, res, url); else json(res, 404, {}); });
let base = "";
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, por = "app") {
  const r = await fetch(`${base}/v1/finance${path}`, { method, headers: { "content-type": "application/json", "x-finance-por": por }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
}

test("sem o produto meu-bot-finance: 403 finance_license", async () => {
  licenca = false;
  const r = await call("GET", "/estado"); assert.equal(r.status, 403); assert.equal(r.j.error.code, "finance_license");
  licenca = true;
});

let nubank;
test("estado vazio pede o orçamento e o dinheiro; abrir conta", async () => {
  const e = await call("GET", "/estado");
  assert.equal(e.status, 200); assert.equal(e.j.mes, "2026-10"); assert.equal(e.j.pendencias, 0);
  assert.deepEqual(e.j.checklist.map((c) => [c.id, c.feito]), [["pendencias", true], ["orcamento", false], ["dinheiro", false]]);
  const c = await call("POST", "/contas", { nome: "Nubank", saldoInicial: "1.000,00" });
  assert.equal(c.status, 200); nubank = c.j.conta; assert.equal(nubank.saldo, "R$ 1.000,00"); assert.equal(nubank.padrao, true);
  assert.equal((await call("POST", "/contas", { nome: "nubank" })).status, 409);
});

let uber;
test("lançar pelo agente: confirmado com categoria; incerto fica pendente; confirmar ensina", async () => {
  const a = await call("POST", "/lancamentos", { valor: "48", favorecido: "Pão de Açúcar", categoria: "mercado", origem: "whatsapp" }, "whatsapp");
  assert.equal(a.status, 200); assert.equal(a.j.lancamento.status, "confirmado"); assert.equal(a.j.lancamento.contaNome, "Nubank");
  assert.match(a.j.linha, /Mercado · Pão de Açúcar · -R\$ 48,00 · Nubank/);
  const u = await call("POST", "/lancamentos", { valor: "30,50", favorecido: "Uber" }, "agente");
  uber = u.j.lancamento; assert.equal(uber.status, "pendente"); assert.equal(uber.categoriaNome, "Transporte");
  assert.equal((await call("GET", "/pendencias")).j.pendencias.length, 1);
  const c = await call("POST", `/lancamentos/${uber.id}/confirmar`, {});
  assert.equal(c.j.lancamento.status, "confirmado");
  const u2 = await call("POST", "/lancamentos", { valor: "22", favorecido: "uber" }, "agente");
  assert.equal(u2.j.lancamento.status, "confirmado", "Uber já foi ensinado");
  const fav = await call("GET", "/favorecidos"); assert.ok(fav.j.favorecidos.some((f) => f.nome === "Uber" && f.categoriaNome === "Transporte"));
});

test("duplicado fica pendente com o suspeito; descartar some; confirmar-todas pula duplicados", async () => {
  const d = await call("POST", "/lancamentos", { valor: "48", favorecido: "pão de açúcar", categoria: "mercado" });
  assert.equal(d.j.lancamento.status, "pendente"); assert.ok(d.j.lancamento.duvidas.includes("duplicado")); assert.ok(d.j.suspeitoDe);
  const t = await call("POST", "/pendencias/confirmar-todas", {}); assert.equal(t.j.confirmados, 0); assert.equal(t.j.restantes, 1);
  assert.equal((await call("POST", `/lancamentos/${d.j.lancamento.id}/descartar`, {})).status, 200);
  assert.equal((await call("GET", `/lancamentos/${d.j.lancamento.id}`)).status, 404);
});

test("renda, dinheiro informado e resumo do mês; corrigir valor mantém o sinal", async () => {
  const r = await call("POST", "/renda", { valor: "3.000", fonte: "Salário Empresa" });
  assert.equal(r.j.lancamento.categoria, "salario"); assert.equal(r.j.lancamento.valorCent, 300000);
  await call("PUT", "/meses/2026-10", { dinheiroInformado: true, orcamento: "200" });
  assert.equal((await call("PUT", "/meses/2026-10", { orcamento: "zero" })).status, 400);
  const fix = await call("PUT", `/lancamentos/${uber.id}`, { valor: "31,50" }); assert.equal(fix.j.lancamento.valorCent, -3150);
  const e = await call("GET", "/estado");
  assert.ok(e.j.checklist.every((c) => c.feito)); assert.equal(e.j.contas[0].saldo, "R$ 3.898,50");
  assert.deepEqual(e.j.resumo.orcamento, { cent: 20000, valor: "R$ 200,00", herdadoDe: null, restanteCent: 9850, restante: "R$ 98,50", usadoPct: 51 });
  assert.match((await call("GET", "/contexto")).j.texto, /Orçamento do mês: R\$ 200,00; já usou 51%, restam R\$ 98,50/);
  const s = await call("GET", "/resumo?mes=2026-10"); assert.equal(s.j.gastos, "R$ 101,50"); assert.equal(s.j.porCategoria[0].nome, "Transporte"); assert.equal(s.j.porCategoria[0].valor, "-R$ 53,50");
  const ctx = await call("GET", "/contexto"); assert.match(ctx.j.texto, /outubro de 2026/); assert.match(ctx.j.texto, /finance\.mjs/);
});

test("virar o mês: pede fechar o anterior; não fecha com pendência; lançar no mês fechado reabre", async () => {
  const p = await call("POST", "/lancamentos", { valor: "9", favorecido: "Fulano", data: "2026-10-30" });
  agora = new Date(2026, 10, 3, 12).getTime(); // 03/11/2026
  let e = await call("GET", "/estado");
  assert.equal(e.j.mes, "2026-11"); assert.deepEqual(e.j.checklist.find((c) => c.id === "fechar"), { id: "fechar", titulo: "Fechar outubro de 2026", feito: false });
  const orc = e.j.checklist.find((c) => c.id === "orcamento");
  assert.equal(orc.feito, true, "o orçamento passa sozinho para o mês novo"); assert.match(orc.titulo, /R\$ 200,00 \(o mesmo de outubro de 2026\)/);
  assert.equal(e.j.resumo.orcamento.herdadoDe, "2026-10"); assert.equal(e.j.resumo.orcamento.usadoPct, 0, "gastos do mês novo começam do zero");
  await call("PUT", "/meses/2026-11", { orcamento: "2.500" });
  assert.equal((await call("GET", "/estado")).j.resumo.orcamento.herdadoDe, null);
  const f1 = await call("POST", "/fechamento", { mes: "2026-10" }); assert.equal(f1.status, 409); assert.equal(f1.j.error.pendencias.length, 1);
  await call("POST", `/lancamentos/${p.j.lancamento.id}/confirmar`, { categoria: "outros" });
  assert.equal((await call("POST", "/fechamento", { mes: "2026-10" })).status, 200);
  e = await call("GET", "/estado"); assert.equal(e.j.anteriorFechado, true);
  await call("POST", "/lancamentos", { valor: "5", favorecido: "Esqueci", categoria: "outros", data: "2026-10-15" });
  e = await call("GET", "/estado"); assert.equal(e.j.anteriorFechado, false);
});

test("entrada inválida: 400 com mensagem em pt-BR; rota desconhecida 404; comprovante ida e volta", async () => {
  const v = await call("POST", "/lancamentos", { valor: "muito" }); assert.equal(v.status, 400); assert.match(v.j.error.message, /valor inválido/);
  assert.equal((await call("GET", "/nada")).status, 404);
  assert.equal((await call("GET", "/resumo?mes=2026-13x")).status, 400);
  const up = await call("POST", "/comprovantes", { base64: Buffer.from("jpeg").toString("base64") });
  assert.match(up.j.sha256, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from((await call("GET", `/comprovantes/${up.j.sha256}`)).j.base64, "base64").toString(), "jpeg");
});

test("ganhos e ROI no estado: mês e acumulado desde o início; categorias de retorno marcadas", async () => {
  await call("POST", "/renda", { valor: "1.000", fonte: "Consultoria", data: "2026-11-02" });
  await call("POST", "/renda", { valor: "300", fonte: "Horas economizadas", retorno: "indireto", data: "2026-11-02" });
  await call("POST", "/lancamentos", { valor: "100", favorecido: "Claude", categoria: "assinaturas", data: "2026-11-02" });
  const e = (await call("GET", "/estado")).j;
  assert.deepEqual([e.resumo.ganhoDiretoCent, e.resumo.ganhoIndiretoCent, e.resumo.roiDireto, e.resumo.roiTotal], [100000, 30000, 900, 1200]);
  assert.ok(e.acumulado.gastosCent > e.resumo.gastosCent, "acumulado soma os meses");
  const cats = (await call("GET", "/categorias")).j.categorias;
  assert.equal(cats.find((x) => x.key === "ganho-indireto").retorno, "indireto");
  assert.match((await call("GET", "/contexto")).j.texto, /ROI 900% \(só diretos\), 1200% \(com indiretos\)/);
});

test("ROI projetado: investimento = orçamento; ganhos no ritmo de hoje até o fim do mês; mês passado = real", async () => {
  // 03/11 (agora): orçamento 2.500 definido; ganhos de 1.300 em 3 dias → 13.000 em 30 dias.
  const r = (await call("GET", "/resumo?mes=2026-11")).j;
  assert.equal(r.projecao.base, "orcamento"); assert.equal(r.projecao.gastosCent, 250000); assert.equal(r.projecao.dia, 3); assert.equal(r.projecao.diasMes, 30);
  assert.equal(r.projecao.ganhosCent, 1300000); assert.equal(r.projecao.roiTotal, 420);
  const out = (await call("GET", "/resumo?mes=2026-10")).j;
  assert.equal(out.projecao.base, "real"); assert.equal(out.projecao.gastosCent, out.gastosCent);
});

test("meta de ganhos: puxa os ganhos projetados (nunca o realizado), é herdada e some com null", async () => {
  await call("PUT", "/meses/2026-11", { metaDireto: "20.000", metaIndireto: "1.500", metaNotas: "40 conversas × 30 min × R$ 75/h" });
  let r = (await call("GET", "/resumo?mes=2026-11")).j;
  assert.equal(r.meta.diretoCent, 2000000); assert.equal(r.meta.notas, "40 conversas × 30 min × R$ 75/h"); assert.equal(r.projecao.ganhosBase, "meta");
  assert.equal(r.projecao.ganhoDiretoCent, 2000000, "meta acima do ritmo manda"); assert.equal(r.projecao.ganhoIndiretoCent, 300000, "ritmo acima da meta manda");
  assert.equal(r.ganhoDiretoCent, 100000, "o realizado não muda");
  assert.equal((await call("PUT", "/meses/2026-11", { metaDireto: "muito" })).status, 400);
  await call("PUT", "/meses/2026-11", { metaDireto: null, metaIndireto: null });
  r = (await call("GET", "/resumo?mes=2026-11")).j; assert.equal(r.meta, null); assert.equal(r.projecao.ganhosBase, "ritmo");
});

test("DRE prevista: plano Claude Code nasce como custo a definir; linhas de ganho e custo puxam o projetado; lançamento ligado dá o realizado", async () => {
  let r = (await call("GET", "/resumo?mes=2026-11")).j;
  const plano = r.dre.linhas.find((x) => x.key === "plano-claude-code");
  assert.deepEqual([plano.tipo, plano.previsto], ["custo", "a definir"]); assert.ok(r.dre.aDefinir.includes(plano.nome));
  const chip = (await call("POST", "/linhas", { nome: "Chip do agente", tipo: "custo", valor: "97" })).j.linha;
  await call("POST", "/linhas", { nome: "Leona que não precisa contratar", tipo: "ganho-indireto", valor: "130", notas: "app de um número só" });
  assert.equal((await call("POST", "/linhas", { nome: "x", tipo: "lucro" })).status, 400);
  const l = (await call("POST", "/lancamentos", { valor: "68,84", favorecido: "Chip", categoria: "assinaturas", linha: "chip do agente", data: "2026-11-10" })).j.lancamento;
  assert.equal(l.linhaNome, "Chip do agente");
  r = (await call("GET", "/resumo?mes=2026-11")).j;
  const c = r.dre.linhas.find((x) => x.key === chip.key);
  assert.deepEqual([c.previstoCent, c.realizadoCent], [9700, 6884]);
  assert.equal(r.dre.ganhoIndiretoPrevistoCent, 13000);
  assert.ok(r.projecao.ganhoIndiretoCent >= 300000, "o maior entre ritmo, meta e linhas");
  await call("PUT", `/linhas/plano-claude-code`, { valor: "200" });
  r = (await call("GET", "/resumo?mes=2026-11")).j; assert.equal(r.dre.aDefinir.length, 0); assert.equal(r.dre.custoPrevistoCent, 9700 + 20000);
  await call("POST", `/linhas/${chip.key}/remover`, {});
  assert.equal((await call("GET", `/lancamentos/${l.id}`)).j.lancamento.linha, undefined, "lançamento sai da linha removida");
});
