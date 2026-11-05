import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarProgresso, aplicarRestauro, fmtBytes, rotuloEtapa, rotuloRestauro, terminou, textoAndamento, textoRestauro } from "../../dist/renderer/conta-google/backup-andamento.js";

const p = (conjunto, indice, etapa, extra = {}) => ({ conjunto, nome: conjunto.toUpperCase(), etapa, indice, total: 3, bytes: null, detalhe: null, ...extra });

test("fmtBytes: KB abaixo de 1 MB, MB com uma casa acima", () => {
  assert.equal(fmtBytes(1182), "1 KB");
  assert.equal(fmtBytes(6282615), "6.0 MB");
});

test("aplicarProgresso: guarda o mais novo de cada conjunto; o primeiro 'enviando' zera a lista", () => {
  let l = aplicarProgresso([], p("crm", 1, "enviando"));
  l = aplicarProgresso(l, p("crm", 1, "enviado", { bytes: 1182 }));
  l = aplicarProgresso(l, p("agente", 2, "enviando"));
  assert.deepEqual(l.map((x) => `${x.conjunto}:${x.etapa}`), ["crm:enviado", "agente:enviando"]);
  const nova = aplicarProgresso(l, p("crm", 1, "enviando"));
  assert.deepEqual(nova.map((x) => x.conjunto), ["crm"]);
});

test("rotuloEtapa: cada etapa tem a sua cara", () => {
  assert.equal(rotuloEtapa(p("crm", 1, "enviando")), "enviando…");
  assert.equal(rotuloEtapa(p("crm", 1, "enviado", { bytes: 1182 })), "✓ 1 KB");
  assert.equal(rotuloEtapa(p("crm", 1, "enviado")), "✓");
  assert.equal(rotuloEtapa(p("credenciais", 3, "pulado", { detalhe: "sem senha de backup" })), "pulado (sem senha de backup)");
  assert.equal(rotuloEtapa(p("financeiro", 2, "ausente")), "não há nesta máquina");
  assert.equal(rotuloEtapa(p("trabalho", 2, "erro", { detalhe: "token" })), "✗ erro");
});

test("textoAndamento: vazio sem etapa; depois 'n de total' e os conjuntos na ordem", () => {
  assert.equal(textoAndamento([]), "");
  const l = [p("crm", 1, "enviado", { bytes: 1182 }), p("agente", 2, "enviando")];
  assert.equal(textoAndamento(l), "2 de 3 · CRM ✓ 1 KB · AGENTE enviando…");
});

test("terminou: só quando o último conjunto saiu do 'enviando'", () => {
  assert.equal(terminou([]), false);
  assert.equal(terminou([p("crm", 1, "enviado")]), false);
  assert.equal(terminou([p("crm", 1, "enviado"), p("x", 3, "enviando")]), false);
  assert.equal(terminou([p("crm", 1, "enviado"), p("x", 3, "erro")]), true);
  assert.equal(terminou([p("x", 3, "ausente")]), true);
});

test("restauração: o primeiro evento do conjunto 1 zera a lista; as etapas seguintes do mesmo conjunto só o atualizam", () => {
  const r = (conjunto, indice, etapa, detalhe = null) => ({ conjunto, nome: conjunto.toUpperCase(), etapa, indice, total: 2, detalhe });
  let l = aplicarRestauro([r("x", 1, "restaurado"), r("y", 2, "erro")], r("agente", 1, "baixando"));
  assert.deepEqual(l.map((p) => p.conjunto), ["agente"], "restauração nova");
  l = aplicarRestauro(l, r("agente", 1, "decifrando"));
  assert.deepEqual(l.map((p) => p.etapa), ["decifrando"], "a etapa 'decifrando' do conjunto 1 nao zera");
  l = aplicarRestauro(l, r("agente", 1, "restaurado", "2 guardado(s)"));
  l = aplicarRestauro(l, r("trabalho", 2, "restaurando"));
  assert.equal(textoRestauro(l), "2 de 2 · AGENTE ✓ (2 guardado(s)) · TRABALHO restaurando…");
  assert.equal(rotuloRestauro(r("a", 1, "baixando")), "baixando do Drive…");
  assert.equal(rotuloRestauro(r("a", 1, "erro", "senha")), "✗ erro");
  assert.equal(textoRestauro([]), "");
});
