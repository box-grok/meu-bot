import { test } from "node:test";
import assert from "node:assert/strict";
import { ehNossoOrfao, pidsDoLsof } from "../../dist/main/maquina/backend-local-orfao-core.js";

const SERVER = "/Users/box/Library/Application Support/meu-bot-staging/backend-local/server.js";

test("o órfão da troca de versão é reconhecido pelo server.js desta pasta, com espaço no caminho", () => {
  assert.equal(ehNossoOrfao(`/opt/homebrew/bin/node ${SERVER}`, SERVER), true);
  assert.equal(ehNossoOrfao(`/opt/homebrew/bin/node ${SERVER}\n`, SERVER), true, "o ps termina com quebra de linha");
  assert.equal(ehNossoOrfao(`node ${SERVER} --inspect`, SERVER), true);
});

test("outro programa na porta, ou o backend de outra variante, não é tocado", () => {
  assert.equal(ehNossoOrfao("/usr/bin/python3 -m http.server 8791", SERVER), false);
  assert.equal(ehNossoOrfao(`/opt/homebrew/bin/node ${SERVER.replace("meu-bot-staging", "meu-bot")}`, SERVER), false, "o meu-bot normal tem a própria pasta");
  assert.equal(ehNossoOrfao(`/opt/homebrew/bin/node ${SERVER}.bak`, SERVER), false);
  assert.equal(ehNossoOrfao("", SERVER), false);
  assert.equal(ehNossoOrfao(`node ${SERVER}`, ""), false);
});

test("pids do lsof: um por linha, sem lixo nem o próprio processo", () => {
  assert.deepEqual(pidsDoLsof("54830\n", 999), [54830]);
  assert.deepEqual(pidsDoLsof("54830\n999\n\nabc\n1\n", 999), [54830]);
  assert.deepEqual(pidsDoLsof("", 999), []);
});
