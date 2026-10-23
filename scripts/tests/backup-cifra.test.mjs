import { test } from "node:test";
import assert from "node:assert/strict";
import { cifrarPacote, decifrarPacote } from "../../src/main/google/backup-cifra.ts";

test("cifra e decifra devolvem os bytes originais, inclusive binario", async () => {
  // Bytes de um .tar.gz de verdade (cabecalho gzip) mais bytes altos: nada disso sobrevive a uma volta por string.
  const original = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x7f, 0x80, 0xfe, 0x01]);
  const cifrado = await cifrarPacote(original, "senha-de-teste-123");
  assert.ok(!cifrado.equals(original), "o cifrado nao pode ser igual ao claro");
  assert.ok(!cifrado.includes(original), "os bytes originais nao aparecem no cifrado");
  const volta = await decifrarPacote(cifrado, "senha-de-teste-123");
  assert.ok(volta.equals(original), "o ciclo tem que devolver exatamente os mesmos bytes");
});

test("senha errada falha em vez de devolver lixo", async () => {
  const cifrado = await cifrarPacote(Buffer.from("conteudo secreto"), "senha-certa-123");
  await assert.rejects(() => decifrarPacote(cifrado, "senha-errada-123"));
});

test("sem senha nao cifra: credencial nunca sai em texto claro", async () => {
  await assert.rejects(() => cifrarPacote(Buffer.from("x"), ""), /sem senha/);
  await assert.rejects(() => cifrarPacote(Buffer.from("x"), "   "), /sem senha/);
});

test("o formato e o age padrao, entao o dono abre pela linha de comando sem o app", async () => {
  const cifrado = await cifrarPacote(Buffer.from("x"), "senha-de-teste-123");
  // Arquivo age binario comeca com "age-encryption.org/v1".
  assert.match(cifrado.subarray(0, 32).toString("latin1"), /^age-encryption\.org\/v1/);
});
