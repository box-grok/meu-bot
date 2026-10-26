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

test("moeda: parseValor detecta guaraní/real/dólar, casas por moeda; formatMoeda com símbolo e casas certas", () => {
  assert.deepEqual(m.parseValor("R$ 48,90"), { valorCent: 4890, moeda: "BRL" });
  assert.deepEqual(m.parseValor("US$ 20"), { valorCent: 2000, moeda: "USD" });
  assert.deepEqual(m.parseValor("20 dólares"), { valorCent: 2000, moeda: "USD" });
  assert.deepEqual(m.parseValor("₲ 10.000.000"), { valorCent: 10000000, moeda: "PYG" });
  assert.deepEqual(m.parseValor("10.000.000 guaranis"), { valorCent: 10000000, moeda: "PYG" });
  assert.equal(m.parseValor("₲ 10,5"), null); // guaraní não tem centavos
  assert.deepEqual(m.parseValor("50000", "PYG"), { valorCent: 50000, moeda: "PYG" }); // sem marca usa o padrão
  assert.equal(m.formatMoeda(10000000, "PYG"), "₲ 10.000.000");
  assert.equal(m.formatMoeda(4890, "BRL"), "R$ 48,90");
  assert.equal(m.formatMoeda(-2000, "USD"), "-US$ 20,00");
});

test("moeda: paraExib converte pela taxa (unidades por US$); mesma moeda não mexe", () => {
  const t = m.TAXAS_PADRAO; // USD:1, BRL:5, PYG:7300
  assert.equal(m.paraExib(500000, "BRL", t, "USD"), 100000); // R$ 5.000 → US$ 1.000
  assert.equal(m.paraExib(7300000, "PYG", t, "USD"), 100000); // ₲ 7.300.000 → US$ 1.000
  assert.equal(m.paraExib(2000, "USD", t, "USD"), 2000);
  assert.equal(m.paraExib(100000, "USD", t, "BRL"), 500000); // US$ 1.000 → R$ 5.000
});

test("moeda: conta em guaraní; falar em outra moeda converte e guarda o original; resumo consolida em dólar", () => {
  const c = base();
  const py = m.novaConta({ nome: "Caixa Guaraní", moeda: "PYG" }, c.contas, 1, rnd);
  assert.equal(py.moeda, "PYG");
  c.contas.push(py);
  const g = m.novoLancamento({ valor: "₲ 7.300.000", favorecido: "Mídia paga", categoria: "lazer", conta: py.key }, c);
  assert.equal(g.moeda, "PYG"); assert.equal(g.valorCent, -7300000); assert.equal(g.moedaOriginal, undefined);
  // falar em real numa conta guaraní: converte para guaraní e guarda o original
  const r = m.novoLancamento({ valor: "R$ 50", favorecido: "x", categoria: "lazer", conta: py.key }, c);
  assert.equal(r.moeda, "PYG"); assert.equal(r.moedaOriginal, "BRL"); assert.equal(r.valorOriginalCent, 5000);
  assert.equal(r.valorCent, -73000); // R$ 50 = US$ 10 = ₲ 73.000
  const conv = { taxas: m.TAXAS_PADRAO, moedaExib: "USD" };
  const s = m.resumoMes([g, r], c.categorias, "2026-10", conv);
  assert.equal(s.gastosCent, 101000); // US$ 1.000 + US$ 10 = US$ 1.010
});

test("curvaABC: compras e vendas separadas, agrupa por favorecido (sem caixa/acento) ou categoria, A até cruzar 80%, B até 95%", () => {
  const L = (valorCent, favorecido, categoria, data = "2026-10-10") => ({ valorCent, favorecido, categoria, data });
  const lanc = [
    L(-50000, "Meta Ads", "midia-paga"), L(-20000, "meta ads", "midia-paga", "2026-10-20"),   // 700,00
    L(-15000, "Fornecedor X", "estoque"), L(-8000, "Correios", "frete"), L(-4000, "Uber", "transporte"),
    L(-2000, "Padaria", "mercado"), L(-1000, "Banca", "mercado"),
    L(30000, "Cliente Ana", "vendas"), L(10000, "Cliente Bia", "vendas"), L(5000, "cliente ana", "vendas"),
  ];
  const c = m.curvaABC(lanc, { lado: "compra" });
  assert.equal(c.totalCent, 100000);
  assert.deepEqual(c.itens.map((i) => [i.nome, i.cent, i.qtd, i.classe]), [
    ["Meta ads", 70000, 2, "A"], ["Fornecedor X", 15000, 1, "A"], ["Correios", 8000, 1, "B"], ["Uber", 4000, 1, "B"], ["Padaria", 2000, 1, "C"], ["Banca", 1000, 1, "C"],
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(c.classes).map(([k, v]) => [k, [v.itens, v.cent]])), { A: [2, 85000], B: [2, 12000], C: [2, 3000] });
  assert.equal(c.itens.at(-1).acumPct, 1);
  const v = m.curvaABC(lanc, { lado: "venda" });
  assert.deepEqual(v.itens.map((i) => [i.nome, i.cent, i.classe]), [["Cliente Ana", 35000, "A"], ["Cliente Bia", 10000, "A"]]);
  const cat = m.curvaABC(lanc, { lado: "compra", por: "categoria", nomeCat: (k) => k.toUpperCase() });
  assert.deepEqual(cat.itens.map((i) => [i.key, i.nome, i.cent]).slice(0, 2), [["midia-paga", "MIDIA-PAGA", 70000], ["estoque", "ESTOQUE", 15000]]);
  assert.deepEqual(m.curvaABC([], { lado: "venda" }).itens, []);
  assert.throws(() => m.curvaABC(lanc, { lado: "outro" }), /lado inválido/);
  assert.throws(() => m.curvaABC(lanc, { por: "conta" }), /agrupamento inválido/);
});

test("linhasDePlanilha: acha o cabeçalho (com título acima), pula vazias, erra sem campo, tipo por coluna e ref estável", () => {
  const v = [["Compras do Junior"], ["Data", "Fornecedor", "Valor", "Categoria", "Tipo"],
    ["01/10/2026", "Bella Lingerie", "R$ 1.200,00", "", ""], ["", "", "", "", ""], ["02/10/2026", "", "300", "", ""],
    ["03/10/2026", "Cliente Ana", "450", "", "venda"], ["01/10/2026", "Bella Lingerie", "R$ 1.200,00", "", ""]];
  const r = m.linhasDePlanilha(v, { fonte: "sheet1" });
  assert.equal(r.cabecalho, 2);
  assert.deepEqual(r.linhas.map((l) => [l.linha, l.favorecido, l.tipo]), [[3, "Bella Lingerie", "gasto"], [6, "Cliente Ana", "renda"], [7, "Bella Lingerie", "gasto"]]);
  assert.deepEqual(r.erros, [{ linha: 5, motivo: "falta fornecedor" }]);
  assert.notEqual(r.linhas[0].ref, r.linhas[2].ref, "duas linhas iguais são duas compras");
  assert.equal(m.linhasDePlanilha(v, { fonte: "sheet1" }).linhas[2].ref, r.linhas[2].ref, "ref estável entre leituras");
  assert.throws(() => m.linhasDePlanilha([["a", "b"], ["1", "2"]]), /cabeçalho/);
});

test("curvaABC por produto: agrupa sem caixa/acento, soma peças, deixa de fora (e conta) o que não tem produto", () => {
  const L = (valorCent, produto, qtd, data = "2026-10-01") => ({ valorCent, favorecido: "x", produto, qtd, data });
  const r = m.curvaABC([L(5000, "Sutiã Renda Preto", 2), L(3000, "sutia renda preto", 1, "2026-10-05"), L(1500, "Calcinha Fio", 3), L(400, "Body Tule", 1), L(1000, undefined, undefined)], { lado: "venda", por: "produto" });
  assert.deepEqual(r.itens.map((i) => [i.key, i.cent, i.unidades, i.qtd, i.classe]), [["sutia-renda-preto", 8000, 3, 2, "A"], ["calcinha-fio", 1500, 3, 1, "B"], ["body-tule", 400, 1, 1, "C"]]);
  assert.equal(r.itens[0].nome, "sutia renda preto", "nome do lançamento mais recente");
  assert.deepEqual(r.semProduto, { cent: 1000, lancamentos: 1 });
  assert.equal(m.curvaABC([], { lado: "venda" }).por, "favorecido", "padrão do modelo continua favorecido");
});

test("planilha com Produto e Quantidade: viram produto e qtd; ref muda por produto", () => {
  const r = m.linhasDePlanilha([["Data", "Cliente", "Produto", "Qtd", "Valor"], ["01/10/2026", "Ana", "Sutiã renda", "2", "R$ 180,00"], ["01/10/2026", "Ana", "Calcinha", "2", "R$ 180,00"]], { fonte: "s", tipoPadrao: "renda" });
  assert.deepEqual(r.linhas.map((l) => [l.produto, l.qtd, l.tipo]), [["Sutiã renda", "2", "renda"], ["Calcinha", "2", "renda"]]);
  assert.notEqual(r.linhas[0].ref, r.linhas[1].ref);
  assert.equal(m.qtdDe("1.200"), 1200); assert.equal(m.qtdDe("2,5"), 2.5); assert.equal(m.qtdDe("0"), null); assert.equal(m.qtdDe("abc"), null);
});
