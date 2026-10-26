import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// memory.js importa "electron"; em Node puro substituímos por um stub.
const Module = require("node:module");
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === "electron" ? { app: { getPath: () => "/tmp" } } : origLoad.call(this, req, ...rest); };
const { applyOps, parseOps } = require("../../dist/main/conversa/memory.js");

test("applyOps adiciona, não duplica e respeita o limite", () => {
  const caps = { notas: 40, perfil: 40 };
  const r1 = applyOps({ notas: "", perfil: "" }, [{ alvo: "notas", op: "add", texto: "usa zsh" }, { alvo: "notas", op: "add", texto: "Usa ZSH" }], caps);
  assert.equal(r1.notas, "- usa zsh");
  assert.equal(r1.applied, 1);
  const r2 = applyOps(r1, [{ alvo: "notas", op: "add", texto: "x".repeat(50) }], caps);
  assert.equal(r2.applied, 0);
});

test("applyOps remove por conteúdo normalizado", () => {
  const r = applyOps({ notas: "- Prefere café\n- usa zsh", perfil: "" }, [{ alvo: "notas", op: "remove", texto: "prefere cafe" }]);
  assert.equal(r.notas, "- usa zsh");
  assert.equal(r.applied, 1);
});

test("parseOps tolera prosa em volta e descarta inválidos", () => {
  const ops = parseOps('Aqui está: {"ops":[{"alvo":"perfil","op":"add","texto":"Nome: Diego"},{"alvo":"x","op":"add","texto":"n"}]} fim');
  assert.deepEqual(ops, [{ alvo: "perfil", op: "add", texto: "Nome: Diego" }]);
  assert.deepEqual(parseOps("nada"), []);
});
