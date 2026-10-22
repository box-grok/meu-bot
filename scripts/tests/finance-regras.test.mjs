import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoDevido, ehChatDoDono, falaDeDinheiro, intencaoDono, textoLancado } from "../../backend-colima/finance/regras.mjs";

test("frases fechadas do dono viram lançamento (valor, favorecido, forma, data)", () => {
  const casos = [
    ["gastei 48 no mercado", { tipo: "gasto", valor: "48", favorecido: "mercado" }],
    ["Gastei R$ 12,50 na padaria do zé ontem", { tipo: "gasto", valor: "12,50", favorecido: "padaria do zé", data: "ontem" }],
    ["paguei 120 de luz no pix", { tipo: "gasto", valor: "120", favorecido: "luz", forma: "pix" }],
    ["comprei R$ 35 na farmácia no crédito.", { tipo: "gasto", valor: "35", favorecido: "farmácia", forma: "cartao" }],
    ["paguei 1.234,56 do aluguel dia 05/10", { tipo: "gasto", valor: "1.234,56", favorecido: "aluguel", data: "05/10" }],
    ["gastei 30 reais com uber em dinheiro", { tipo: "gasto", valor: "30", favorecido: "uber", forma: "dinheiro" }],
    ["recebi 3.000 do salário", { tipo: "renda", retorno: "direto", valor: "3.000", favorecido: "salário" }],
    ["caiu 1500 da freela dia 20/10", { tipo: "renda", retorno: "direto", valor: "1500", favorecido: "freela", data: "20/10" }],
    ["desfaz", { tipo: "desfazer" }], ["Errado", { tipo: "desfazer" }],
  ];
  for (const [f, esperado] of casos) assert.deepEqual(intencaoDono(f), esperado, f);
});

test("o que não é lançamento fechado fica com o agente", () => {
  for (const f of ["gastei muito tempo", "gastei 2 horas no trânsito", "paguei 3 vezes no cartão", "comprei 2 no mercado", "ganhei 2 dias de folga",
    "quanto gastei no mercado?", "gastei 48 no mercado e 20 na padaria", "gastei 48", "ok", "não", "gastaria 50 no cinema", "vou gastar 50 no cinema",
    "x".repeat(200), "gastei 48 no mercado\ne mais 10"]) assert.equal(intencaoDono(f), null, f);
});

test("chat do dono: só a sessão direta do próprio número; outros canais não", () => {
  assert.equal(ehChatDoDono({ sessionKey: "agent:main:whatsapp:direct:+5521999990000" }, "+5521999990000"), true);
  assert.equal(ehChatDoDono({ sessionKey: "agent:main:whatsapp:direct:+5521888880000" }, "+5521999990000"), false);
  assert.equal(ehChatDoDono({ channel: "telegram", sessionKey: "agent:main:whatsapp:direct:+5521999990000" }, "+5521999990000"), false);
  assert.equal(ehChatDoDono({ sessionKey: "x" }, null), false);
  assert.ok(falaDeDinheiro("qual meu saldo")); assert.ok(falaDeDinheiro("paguei o boleto")); assert.ok(!falaDeDinheiro("bom dia, tudo bem?"));
});

test("texto do lançado: pendente sugere categoria, duplicado avisa", () => {
  const l = { valorCent: -4800, status: "confirmado", categoriaNome: "Mercado" };
  assert.match(textoLancado({ lancamento: l, linha: "21/10 · Mercado · -R$ 48,00" }), /^Gasto lançado: 21\/10.*desfaz/);
  assert.match(textoLancado({ lancamento: { ...l, status: "pendente" }, linha: "x" }), /sugeri Mercado/);
  assert.match(textoLancado({ lancamento: l, linha: "x", suspeitoDe: { data: "2026-10-20", valor: "-R$ 48,00" } }), /repetido com 20\/10/);
});

test("cobrança diária: só 9h–21h, uma por dia, cada assunto no máximo a cada 3 dias", () => {
  const D = 86_400_000; const agora = Date.parse("2026-11-06T12:00:00Z");
  const estado = { pendencias: 4, checklist: [{ id: "pendencias", feito: false }, { id: "orcamento", feito: false }, { id: "dinheiro", feito: false }, { id: "fechar", titulo: "Fechar outubro de 2026", feito: false }] };
  const a = avisoDevido(estado, {}, agora, 10, 6);
  assert.deepEqual(a.assuntos, ["pendencias", "fechar", "orcamento"]); assert.match(a.texto, /^💰 Seu financeiro: 4 lançamentos.*fechar outubro de 2026.*quanto você quer gastar/);
  assert.equal(avisoDevido(estado, {}, agora, 8, 6), null, "cedo demais");
  assert.equal(avisoDevido(estado, { pendencias: agora - 2 * 3600_000 }, agora, 10, 6), null, "já avisou hoje");
  assert.deepEqual(avisoDevido(estado, { pendencias: agora - 2 * D, fechar: agora - 4 * D, orcamento: agora - 4 * D }, agora, 10, 6).assuntos, ["fechar", "orcamento"]);
  assert.equal(avisoDevido({ pendencias: 1, checklist: [] }, {}, agora, 10, 6), null, "uma pendência só não cobra");
  assert.equal(avisoDevido({ pendencias: 0, checklist: [{ id: "dinheiro", feito: false }] }, {}, agora, 10, 26).assuntos[0], "dinheiro");
});

test("orçamento: avisa uma vez ao passar de 80% e uma ao estourar, por mês", () => {
  const agora = Date.parse("2026-10-22T12:00:00Z");
  const est = (pct) => ({ mes: "2026-10", pendencias: 0, checklist: [{ id: "orcamento", feito: true }], resumo: { orcamento: { usadoPct: pct, valor: "R$ 3.000,00", restante: "R$ 300,00" } } });
  assert.equal(avisoDevido(est(50), {}, agora, 10, 22), null);
  assert.deepEqual(avisoDevido(est(90), {}, agora, 10, 22).assuntos, ["alerta80:2026-10"]);
  assert.equal(avisoDevido(est(90), { "alerta80:2026-10": agora - 30 * 3600_000 }, agora, 10, 22), null, "já avisou neste mês");
  assert.match(avisoDevido(est(110), { "alerta80:2026-10": agora - 30 * 3600_000 }, agora, 10, 22).texto, /estourou: 110%/);
});

test("ganhos pelo WhatsApp: vendi/fechei = direto, economizei = indireto; sem marca de dinheiro não vale", () => {
  assert.deepEqual(intencaoDono("vendi R$ 300 de consultoria"), { tipo: "renda", retorno: "direto", valor: "300", favorecido: "consultoria" });
  assert.deepEqual(intencaoDono("economizei R$ 200 com o agente"), { tipo: "renda", retorno: "indireto", valor: "200", favorecido: "o agente" });
  for (const f of ["vendi 3 de bolo", "economizei 3 horas no atendimento", "fechei 2 com o cliente"]) assert.equal(intencaoDono(f), null, f);
});
