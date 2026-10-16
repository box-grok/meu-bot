import { test } from "node:test";
import assert from "node:assert/strict";
import { ipcErrorText } from "../../dist/renderer/lib/ipc-error.js";

test("ipcErrorText tira o prefixo do Electron, com e sem o 'Error:'", () => {
  assert.equal(ipcErrorText(new Error("Error invoking remote method 'chat:send': Error: origem inválida")), "origem inválida");
  assert.equal(ipcErrorText(new Error("Error invoking remote method 'picker:probe': sem rede")), "sem rede");
  assert.equal(ipcErrorText(new Error("erro comum")), "erro comum");
  assert.equal(ipcErrorText("texto"), "texto");
  assert.equal(ipcErrorText(42), "42");
});
