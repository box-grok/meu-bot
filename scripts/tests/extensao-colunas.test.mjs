import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGURAS_PADRAO, LARGURA_MAX, LARGURA_MIN, aplicarOrdem, chaveLarguras, chaveOrdem, limparLargura, mesmoConjunto, moverColuna, parseLarguras, parseOrdem } from "../../extensao-crm/src/colunas.ts";

const campo = (key, name = key) => ({ key, name, type: "TEXT", options: [] });

test("moverColuna: leva para a direita, para a esquerda e mantém o resto na ordem", () => {
  const cols = ["a", "b", "c", "d"];
  assert.deepEqual(moverColuna(cols, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moverColuna(cols, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moverColuna(cols, 1, 2), ["a", "c", "b", "d"]);
  // Não muta a lista original (a tela redesenha a partir do retorno).
  assert.deepEqual(cols, ["a", "b", "c", "d"]);
});

test("moverColuna: soltar no mesmo lugar ou fora da faixa devolve a lista intacta", () => {
  const cols = ["a", "b", "c"];
  for (const [de, para] of [[1, 1], [-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [NaN, 0]]) {
    assert.deepEqual(moverColuna(cols, de, para), cols, `de=${de} para=${para}`);
  }
  assert.deepEqual(moverColuna([], 0, 0), []);
});

test("limparLargura: arredonda, prende à faixa e recusa o que não é número", () => {
  assert.equal(limparLargura(180.4), 180);
  assert.equal(limparLargura(10), LARGURA_MIN);
  assert.equal(limparLargura(5000), LARGURA_MAX);
  assert.equal(limparLargura(-300), LARGURA_MIN);
  assert.equal(limparLargura("240"), 240);
  for (const ruim of [null, undefined, "abc", NaN, Infinity, {}, []]) assert.equal(limparLargura(ruim), null, String(ruim));
});

test("parseLarguras: aceita o que é válido e descarta o lixo sem derrubar o resto", () => {
  assert.deepEqual(parseLarguras('{"f_1":240,"f_2":300}'), { f_1: 240, f_2: 300 });
  // Valor fora da faixa é preso, não descartado; o que não é número some e o resto sobrevive.
  assert.deepEqual(parseLarguras('{"f_1":5000,"f_2":"x","f_3":180}'), { f_1: LARGURA_MAX, f_3: 180 });
  assert.deepEqual(parseLarguras('{"":200,"f_1":200}'), { f_1: 200 });
});

test("parseLarguras: sem storage, JSON quebrado ou formato errado volta vazio", () => {
  for (const raw of [null, "", "{", "[]", '"texto"', "null", "123"]) {
    assert.deepEqual(parseLarguras(raw), {}, JSON.stringify(raw));
  }
});

test("chaveLarguras separa pipelines e LARGURAS_PADRAO cobre toda coluna da grade", () => {
  assert.notEqual(chaveLarguras("p_1"), chaveLarguras("p_2"));
  // Toda coluna que a pessoa arrasta tem padrão dentro da faixa (senão o primeiro arrasto daria um pulo).
  for (const col of ["nome", "etapa", "responsaveis", "contatos", "atualizado", "campo"]) {
    const l = LARGURAS_PADRAO[col];
    assert.equal(limparLargura(l), l, `o padrão de ${col} tem que estar dentro da faixa`);
  }
  // A coluna do "＋" é a exceção: estreita de propósito e não redimensionável.
  assert.ok(LARGURAS_PADRAO.add < LARGURA_MIN);
});

test("mesmoConjunto: a ordem não importa, mas adicionar ou remover campo importa", () => {
  const a = [campo("f_1"), campo("f_2"), campo("f_3")];
  assert.ok(mesmoConjunto(a, [campo("f_3"), campo("f_1"), campo("f_2")]), "só reordenado é o mesmo conjunto");
  assert.ok(mesmoConjunto([], []));
  // Esta é a trava que impede o salvamento da ordem de apagar coluna criada por outra pessoa.
  assert.ok(!mesmoConjunto(a, [campo("f_1"), campo("f_2")]), "campo removido por fora");
  assert.ok(!mesmoConjunto(a, [...a, campo("f_4")]), "campo adicionado por fora");
  assert.ok(!mesmoConjunto(a, [campo("f_1"), campo("f_2"), campo("f_9")]), "campo trocado por outro");
});

test("parseOrdem: lista de ids, sem repetição, tolerante a lixo", () => {
  assert.deepEqual(parseOrdem('["nome","f_1","atualizado"]'), ["nome", "f_1", "atualizado"]);
  assert.deepEqual(parseOrdem('["nome","nome","f_1"]'), ["nome", "f_1"], "id repetido entra uma vez só");
  assert.deepEqual(parseOrdem('["nome",1,null,"",{"a":1},"f_1"]'), ["nome", "f_1"]);
  for (const raw of [null, "", "{", '{"nome":1}', '"texto"', "null"]) assert.deepEqual(parseOrdem(raw), [], JSON.stringify(raw));
});

test("aplicarOrdem: respeita o que foi arrastado e ignora coluna que não existe mais", () => {
  const padrao = ["nome", "etapa", "f_1", "atualizado"];
  // Arrastado: Atualizado foi para a frente de f_1.
  assert.deepEqual(aplicarOrdem(padrao, ["nome", "etapa", "atualizado", "f_1"]), ["nome", "etapa", "atualizado", "f_1"]);
  // Campo apagado por outra pessoa some da ordem guardada, sem quebrar o resto.
  assert.deepEqual(aplicarOrdem(["nome", "etapa"], ["nome", "f_9", "etapa"]), ["nome", "etapa"]);
  // Sem nada guardado, vale o padrão.
  assert.deepEqual(aplicarOrdem(padrao, []), padrao);
});

test("aplicarOrdem: coluna nova entra na posição padrão, não no fim da tabela", () => {
  // f_2 nasceu entre f_1 e Atualizado; a ordem guardada é de antes dela existir.
  const padrao = ["nome", "etapa", "f_1", "f_2", "atualizado"];
  const guardada = ["etapa", "nome", "f_1", "atualizado"];
  const out = aplicarOrdem(padrao, guardada);
  assert.ok(out.includes("f_2"), "a coluna nova tem que aparecer");
  assert.ok(out.indexOf("f_2") < out.indexOf("atualizado"), "e não depois de Atualizado");
  assert.deepEqual(out.slice(0, 2), ["etapa", "nome"], "o que foi arrastado continua valendo");
  assert.equal(out.length, padrao.length);
});

test("chaveOrdem e chaveLarguras não colidem entre si nem entre pipelines", () => {
  assert.notEqual(chaveOrdem("p_1"), chaveLarguras("p_1"));
  assert.notEqual(chaveOrdem("p_1"), chaveOrdem("p_2"));
});
