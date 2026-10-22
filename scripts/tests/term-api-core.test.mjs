import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { textoDoTerminal, entradaDigitar, TECLAS, MAX_ENTRADA } = createRequire(import.meta.url)("../../dist/main/term-api-core.js");
const b = (s) => new TextEncoder().encode(s);

test("ler: tira cores, título e cursor; \\r recomeça a linha; últimas N linhas", () => {
  assert.equal(textoDoTerminal(b("\x1b]0;box@vm: ~\x07\x1b[01;32mbox@vm\x1b[00m:~$ ls\r\na  b\r\n")), "box@vm:~$ ls\na  b");
  assert.equal(textoDoTerminal(b("baixando 10%\rbaixando 100%\n")), "baixando 100%");
  assert.equal(textoDoTerminal(b("1\n2\n3\n4\n"), 2), "3\n4");
  assert.equal(textoDoTerminal(b("\x1b[?2004hprompt$ \x1b[K")), "prompt$");
});

test("digitar: texto (com enter opcional), teclas conhecidas, recusa vazio, desconhecida e longo", () => {
  assert.deepEqual(entradaDigitar({ texto: "ls", enter: true }), { dados: "ls\r" });
  assert.deepEqual(entradaDigitar({ texto: "ls" }), { dados: "ls" });
  assert.deepEqual(entradaDigitar({ tecla: "Ctrl+C" }), { dados: TECLAS["ctrl+c"] });
  assert.ok("erro" in entradaDigitar({ tecla: "f13" }));
  assert.ok("erro" in entradaDigitar({}));
  assert.ok("erro" in entradaDigitar({ texto: "x".repeat(MAX_ENTRADA + 1) }));
});
