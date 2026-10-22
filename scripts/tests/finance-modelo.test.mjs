import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("../../backend-colima/finance-modelo.js");

let seq = 0;
const rnd = (n) => Buffer.alloc(n, ++seq);
const HOJE = "2026-10-22";
const base = () => ({ contas: [], categorias: m.CATEGORIAS_PADRAO.map((c) => ({ ...c })), favorecidos: [], now: 1, rnd, hoje: HOJE });

test("parseValorBRL: vírgula decimal, milhar com ponto, R$ e 'reais', sinal; lixo vira null", () => {
  const casos = { "R$ 1.234,56": 123456, "48": 4800, "12,5": 1250, "1234.56": 123456, "1.234": 123400, "48 reais": 4800, "-12,30": -1230, " R$ 0,99": 99, "10.000.000": 1000000000 };
  for (const [v, c] of Object.entries(casos)) assert.equal(m.parseValorBRL(v), c, v);
  for (const v of ["abc", "1.2.3", "", "12,345", "1,2,3", "R$"]) assert.equal(m.parseValorBRL(v), null, v);
  assert.equal(m.parseValorBRL(48.9), 4890);
  assert.equal(m.formatBRL(-123456), "-R$ 1.234,56"); assert.equal(m.formatBRL(5), "R$ 0,05");
});

test("parseData: hoje/ontem, dd/mm sem ano não cai no futuro, datas impossíveis viram null", () => {
  assert.equal(m.parseData("hoje", HOJE), HOJE); assert.equal(m.parseData("ontem", HOJE), "2026-10-21");
  assert.equal(m.parseData("21/10", HOJE), "2026-10-21"); assert.equal(m.parseData("25/12", HOJE), "2025-12-25");
  assert.equal(m.parseData("21/10/26", HOJE), "2026-10-21"); assert.equal(m.parseData("2026-10-01", HOJE), "2026-10-01");
  for (const d of ["31/02", "2026-02-30", "amanhã de manhã", "40/10"]) assert.equal(m.parseData(d, HOJE), null, d);
  assert.equal(m.mesAnterior("2026-01"), "2025-12"); assert.equal(m.mesPorExtenso("2026-10"), "outubro de 2026");
});

test("lançamento: gasto negativo, renda positiva; categoria pedida confirma, semente e nada ficam pendentes", () => {
  const c = base();
  const a = m.novoLancamento({ valor: "48", favorecido: "pão de açúcar", categoria: "mercado", origem: "whatsapp" }, c);
  assert.equal(a.valorCent, -4800); assert.equal(a.status, "confirmado"); assert.equal(a.favorecido, "Pão de açúcar"); assert.deepEqual(a.duvidas, []);
  const b = m.novoLancamento({ valor: "30", favorecido: "Uber" }, c);
  assert.equal(b.categoria, "transporte"); assert.equal(b.status, "pendente"); assert.deepEqual(b.duvidas, ["categoria"]);
  const d = m.novoLancamento({ valor: "17", favorecido: "Fulano" }, c);
  assert.equal(d.categoria, "outros"); assert.equal(d.status, "pendente");
  const r = m.novoLancamento({ valor: "3.000", tipo: "renda", favorecido: "Empresa", categoria: "salário" }, c);
  assert.equal(r.valorCent, 300000); assert.equal(r.categoria, "salario");
  const foto = m.novoLancamento({ valor: "87,90", favorecido: "Extra", categoria: "mercado", origem: "foto" }, c);
  assert.equal(foto.status, "pendente"); assert.ok(foto.duvidas.includes("valor"));
  assert.throws(() => m.novoLancamento({ valor: "0" }, c), /valor inválido/);
  assert.throws(() => m.novoLancamento({ valor: "10", categoria: "inexistente xyz" }, c), (e) => e.code === "nao_encontrado" && Array.isArray(e.categorias));
});

test("aprendizado: favorecido confirmado em uma categoria passa a confirmar sozinho", () => {
  const c = base();
  const f = m.aprender(c.favorecidos, "Padaria do Zé", "alimentacao-fora", 1);
  c.favorecidos.push(f);
  const l = m.novoLancamento({ valor: "12", favorecido: "padaria do ze" }, c);
  assert.equal(l.categoria, "alimentacao-fora"); assert.equal(l.status, "confirmado");
  assert.equal(m.categoriaAprendida(c.favorecidos, "Padaria do Zé Centro"), "alimentacao-fora");
});

test("conta: tipo pelo nome, a primeira é padrão, nome repetido é conflito; lançamento usa a padrão", () => {
  const c = base();
  const nu = m.novaConta({ nome: "Nubank", saldoInicial: "1.500,00" }, c.contas, 1, rnd);
  assert.equal(nu.tipo, "corrente"); assert.equal(nu.padrao, true); assert.equal(nu.saldoInicialCent, 150000);
  c.contas.push(nu);
  assert.equal(m.novaConta({ nome: "Carteira" }, c.contas, 1, rnd).tipo, "dinheiro");
  assert.equal(m.novaConta({ nome: "Cartão de crédito" }, c.contas, 1, rnd).tipo, "cartao");
  assert.throws(() => m.novaConta({ nome: "nubank" }, c.contas, 1, rnd), (e) => e.code === "conflito");
  const l = m.novoLancamento({ valor: "10", favorecido: "x", categoria: "lazer" }, c);
  assert.equal(l.conta, nu.key);
  assert.equal(m.saldoConta(nu, [l]), 149000);
});

test("duplicado: mesmo valor e favorecido até 2 dias; resumo do mês por categoria", () => {
  const c = base();
  const a = { ...m.novoLancamento({ valor: "48", favorecido: "Mercado X", categoria: "mercado", data: "20/10" }, c) };
  const b = m.novoLancamento({ valor: "48", favorecido: "mercado x", categoria: "mercado", data: "22/10" }, c);
  const longe = m.novoLancamento({ valor: "48", favorecido: "mercado x", categoria: "mercado", data: "01/10" }, c);
  assert.equal(m.duplicadoDe(b, [a]), a.id); assert.equal(m.duplicadoDe(longe, [a]), null);
  const r = m.novoLancamento({ valor: "2000", tipo: "renda", favorecido: "Empresa", categoria: "salario" }, c);
  const s = m.resumoMes([a, b, longe, r], c.categorias, "2026-10");
  assert.equal(s.gastosCent, 14400); assert.equal(s.rendaCent, 200000); assert.equal(s.saldoCent, 185600);
  assert.equal(s.porCategoria[0].key, "mercado"); assert.equal(s.total, 4);
  assert.match(m.linhaLancamento(a, c.categorias), /^20\/10 · Mercado · Mercado X · -R\$ 48,00$/);
});

test("forma de pagamento escolhe a conta do tipo (cartão, dinheiro); débito e pix ficam na padrão", () => {
  const c = base();
  for (const nome of ["Nubank", "Cartão Nubank", "Carteira"]) c.contas.push(m.novaConta({ nome }, c.contas, 1, rnd));
  const conta = (forma) => c.contas.find((x) => x.key === m.novoLancamento({ valor: "10", favorecido: "x", categoria: "lazer", formaPagamento: forma }, c).conta).nome;
  assert.equal(conta("cartao"), "Cartão Nubank"); assert.equal(conta("dinheiro"), "Carteira"); assert.equal(conta("pix"), "Nubank");
});

test("favorecido com o nome exato de uma categoria confirma sozinho e a linha não repete o nome", () => {
  const c = base();
  const l = m.novoLancamento({ valor: "48", favorecido: "mercado" }, c);
  assert.equal(l.categoria, "mercado"); assert.equal(l.status, "confirmado");
  assert.equal(m.linhaLancamento(l, c.categorias), "22/10 · Mercado · -R$ 48,00");
});

test("ROI: entradas como ganho direto (padrão) ou indireto; salário não conta; sem gasto, ROI null", () => {
  const c = base();
  const g = m.novoLancamento({ valor: "200", favorecido: "agente", categoria: "assinaturas" }, c);
  const d = m.novoLancamento({ valor: "500", tipo: "renda", favorecido: "cliente X" }, c);
  const i = m.novoLancamento({ valor: "100", tipo: "renda", retorno: "indireto", favorecido: "horas economizadas" }, c);
  const s = m.novoLancamento({ valor: "3000", tipo: "renda", favorecido: "Empresa", categoria: "salario" }, c);
  assert.equal(d.categoria, "ganho-direto"); assert.equal(i.categoria, "ganho-indireto");
  const r = m.resumoMes([g, d, i, s], c.categorias, "2026-10");
  assert.deepEqual([r.ganhoDiretoCent, r.ganhoIndiretoCent, r.roiDireto, r.roiTotal], [50000, 10000, 150, 200]);
  assert.equal(m.resumoMes([d], c.categorias, "2026-10").roiTotal, null);
});
