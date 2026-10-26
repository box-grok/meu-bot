import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { BACKEND_DIR_SH, BACKEND_DIR_CANONICAL, BACKEND_DIR_LEGACY } = createRequire(import.meta.url)("../../dist/main/maquina/backend-dir-core.js");

/** Roda o trecho num HOME de mentira e devolve BD e FOREIGN como o shell os deixou. */
function resolve(home) {
  const out = execFileSync("bash", ["-c", `${BACKEND_DIR_SH}; printf '%s\\n%s' "$BD" "$FOREIGN"`], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  const [bd, foreign] = out.split("\n");
  return { bd: bd.replace(home, "$HOME"), foreign };
}
const legacy = (home) => join(home, ".hermes/agente-rene/backend-sdk-claude");
const canon = (home) => join(home, ".local/share/meu-bot/backend");

test("sem backend nenhum: a pasta própria (onde instalar), nada estranho", () => {
  const home = mkdtempSync(join(tmpdir(), "bd-"));
  try { assert.deepEqual(resolve(home), { bd: BACKEND_DIR_CANONICAL, foreign: "0" }); } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a herdada com o NOSSO server.js (tem meu-bot/hello) continua valendo", () => {
  const home = mkdtempSync(join(tmpdir(), "bd-"));
  try {
    mkdirSync(legacy(home), { recursive: true }); writeFileSync(join(legacy(home), "server.js"), "if (url.pathname === '/v1/meu-bot/hello') {}");
    assert.deepEqual(resolve(home), { bd: BACKEND_DIR_LEGACY, foreign: "0" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a herdada com OUTRO backend (o do Hermes): foreign, e o nosso vai para a pasta própria", () => {
  const home = mkdtempSync(join(tmpdir(), "bd-"));
  try {
    mkdirSync(legacy(home), { recursive: true }); writeFileSync(join(legacy(home), "server.js"), "require('dotenv').config(); // backend do Hermes"); writeFileSync(join(legacy(home), ".env"), "PORT=8080\n");
    assert.deepEqual(resolve(home), { bd: BACKEND_DIR_CANONICAL, foreign: "1" });
    // Instalado o nosso na própria, ela vence e o estranho deixa de importar.
    mkdirSync(canon(home), { recursive: true }); writeFileSync(join(canon(home), "server.js"), "meu-bot/hello");
    assert.deepEqual(resolve(home), { bd: BACKEND_DIR_CANONICAL, foreign: "0" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
