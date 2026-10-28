import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../backend-colima/fala-texto.py", import.meta.url));
const semPython = spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false;
const falar = (texto) => {
  const r = spawnSync("python3", [SCRIPT], { input: texto, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\n$/, "");
};

test("números por extenso do jeito falado (não 'mil e duzentos e trinta e quatro')", { skip: semPython }, () => {
  assert.equal(falar("1234 2500 100 101 1001 1100 21 0"), "mil duzentos e trinta e quatro dois mil e quinhentos cem cento e um mil e um mil e cem vinte e um zero");
  assert.equal(falar("1.000.000 de pessoas, 3,05 metros, -3 graus"), "um milhão de pessoas, três vírgula zero cinco metros, menos três graus");
  assert.equal(falar("21 horas, 2 pessoas, 1 vez"), "vinte e uma horas, duas pessoas, uma vez");
  assert.equal(falar("de 2 a 5 dias, 4G e v2"), "de dois a cinco dias, 4G e v2");
});

test("dinheiro, porcentagem, hora, data e ordinal", { skip: semPython }, () => {
  assert.equal(falar("Custa R$ 1.234,50 até 14h30."), "Custa mil duzentos e trinta e quatro reais e cinquenta centavos até catorze e trinta.");
  assert.equal(falar("R$ 1 e R$ 0,50 e R$ 60 mil e R$ 1,5 milhão"), "um real e cinquenta centavos e sessenta mil reais e um vírgula cinco milhão de reais");
  assert.equal(falar("15% e 2,5%"), "quinze por cento e dois vírgula cinco por cento");
  assert.equal(falar("12/03/2026 às 9:05, 1/4 às 13h, 1h"), "doze de março de dois mil e vinte e seis às nove e cinco, primeiro de abril às treze horas, uma hora");
  assert.equal(falar("1º lugar, 2ª vez"), "primeiro lugar, segunda vez");
});

test("telefone, CPF e CEP são lidos dígito a dígito, nunca apagados", { skip: semPython }, () => {
  assert.equal(falar("Liga no +55 11 98765-4321, ok"), "Liga no cinco cinco, um um, nove oito sete seis cinco, quatro três dois um, ok");
  assert.equal(falar("CPF 123.456.789-00"), "CPF um dois três, quatro cinco seis, sete oito nove, zero zero");
  assert.equal(falar("CEP 01310-100"), "CEP zero um três um zero, um zero zero");
});

test("links, código, markdown e emoji não são lidos ao pé da letra", { skip: semPython }, () => {
  assert.equal(falar("**Atenção**: acesse https://exemplo.com/x?a=1 🚀"), "Atenção: acesse o link que mandei por escrito");
  assert.equal(falar("veja https://a.com e https://b.c, depois [o site](https://x.y/z)."), "veja os links que mandei por escrito, depois o site.");
  assert.equal(falar("```js\nconsole.log(1)\n```\n# Pronto\n- item _um_"), "o código está na mensagem escrita.\nPronto\nitem um");
  assert.equal(falar("email lucas@empresa.com.br"), "email lucas arroba empresa ponto com ponto br");
});

test("entrada vazia não quebra (sai vazio; o meu-bot-falar então fala o original)", { skip: semPython }, () => {
  assert.equal(falar(""), "");
});
