import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createAutenticador, totp, base32, parseEntrada } = createRequire(import.meta.url)("../../backend-colima/autenticador.js");

const raiz = mkdtempSync(join(tmpdir(), "autenticador-"));
after(() => rmSync(raiz, { recursive: true, force: true }));
const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890" (RFC 6238, apêndice B)

test("totp: vetores da RFC 6238 (SHA1, 8 dígitos)", () => {
  const s = base32(RFC);
  assert.equal(s.toString("ascii"), "12345678901234567890");
  for (const [t, esperado] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [20000000000, "65353130"]]) assert.equal(totp(s, { digitos: 8 }, t * 1000), esperado);
  assert.equal(totp(s, {}, 59_000), "287082");
});

test("base32: aceita espaços/minúsculas, recusa lixo e segredo curto", () => {
  assert.notEqual(base32("gezd gnbv gy3t qojq"), null);
  assert.equal(base32("1234!"), null);
  assert.equal(base32("GEZDGNBV"), null);
});

test("parseEntrada: otpauth com emissor no rótulo e no issuer; recusa HOTP e outro esquema", () => {
  const e = parseEntrada({ uri: `otpauth://totp/Google:lucas%40ex.com?secret=${RFC}&issuer=Google&digits=6&period=30` });
  assert.equal(e.emissor, "Google"); assert.equal(e.conta, "lucas@ex.com"); assert.equal(e.digitos, 6);
  assert.throws(() => parseEntrada({ uri: `otpauth://hotp/x?secret=${RFC}&counter=1` }), /HOTP/);
  assert.throws(() => parseEntrada({ uri: "https://exemplo.com" }), /otpauth/);
  assert.throws(() => parseEntrada({ segredo: RFC }), /nome/);
  assert.equal(parseEntrada({ segredo: RFC, emissor: "Banco" }).emissor, "Banco");
});

test("contas: segredo cifrado e nunca devolvido; agente só vê as liberadas; auditoria", () => {
  const dir = join(raiz, "db"); const chaveFile = join(raiz, "autenticador.chave");
  let agora = 59_000;
  const a = createAutenticador({ dir, chaveFile, now: () => agora });
  const r = a.criar({ uri: `otpauth://totp/Google:lucas%40ex.com?secret=${RFC}` }, "extensao");
  const key = r.conta.key;
  assert.equal(JSON.stringify(r).includes(RFC), false);
  const gravado = readFileSync(join(dir, "autenticador.json"), "utf8");
  assert.equal(gravado.includes(RFC), false); assert.equal(gravado.includes("12345678901234567890"), false);
  assert.equal(statSync(chaveFile).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, "autenticador.chave")), false, "a chave fica fora do db/");

  const c = a.codigos("extensao");
  assert.equal(c.contas[0].codigo, "287082"); assert.equal(c.contas[0].restante, 1);
  assert.equal(JSON.stringify(c).includes("segredo"), false);
  assert.throws(() => a.criar({ uri: `otpauth://totp/Google:lucas%40ex.com?secret=${RFC}` }, "extensao"), /já existe/);

  // Agente: não vê nem gera código de conta não liberada; não muda contas.
  assert.equal(a.codigos("agente").contas.length, 0);
  assert.throws(() => a.codigo(key, "agente"), /não existe/);
  assert.throws(() => a.editar(key, { agente: true }, "agente"), /só a extensão/);
  a.editar(key, { agente: true }, "extensao");
  agora = 1111111109_000;
  assert.equal(a.codigo(key, "agente").codigo, "081804");
  const uso = readFileSync(join(dir, "autenticador-uso.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(uso.map((u) => [u.por, u.acao]), [["extensao", "criar"], ["extensao", "editar"], ["agente", "codigo"]]);

  // Outra instância (o server reiniciou) lê com a mesma chave; sem a chave, recusa em vez de criar outra.
  assert.equal(createAutenticador({ dir, chaveFile, now: () => 59_000 }).codigos("extensao").contas[0].codigo, "287082");
  assert.throws(() => createAutenticador({ dir, chaveFile: join(raiz, "outra.chave") }).codigos("extensao"), /chave do autenticador sumiu/);
  a.apagar(key, "extensao");
  assert.equal(a.listar("extensao").contas.length, 0);
});
