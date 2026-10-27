import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const a = createRequire(import.meta.url)("../../dist/main/conversa/apagadas-core.js");

const SESS = "0b6f7a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const CONV = "conv_abc12345";

test("parseApagadas: só ids válidos com data; corrompido ou sem `ids` = nenhum", () => {
  const m = a.parseApagadas(JSON.stringify({ ids: { [SESS]: "2026-10-26T20:00:00Z", [CONV]: "2026-10-26T21:00:00Z", "../etc": "2026-10-26T20:00:00Z", "abcdef12": "ontem" } }));
  assert.deepEqual([...m.keys()].sort(), [SESS, CONV].sort());
  assert.equal(a.parseApagadas("{nao é json").size, 0);
  assert.equal(a.parseApagadas(JSON.stringify({ ids: [SESS] })).size, 0);
  assert.equal(a.parseApagadas("").size, 0);
});

test("conversasApagadas: casa pela sessão do Claude Code ou pelo id da conversa; mexida depois da exclusão fica", () => {
  const apagadas = new Map([[SESS, "2026-10-26T20:00:00Z"], [CONV, "2026-10-26T20:00:00Z"]]);
  const convs = [
    { id: "c1", updatedAt: "2026-10-26T19:00:00Z", claude: { sessionId: SESS } },
    { id: CONV, updatedAt: "2026-10-26T19:30:00Z" },
    { id: "c3", updatedAt: "2026-10-26T21:00:00Z", claude: { sessionId: SESS } },
    { id: "c4", updatedAt: "2026-10-26T19:00:00Z", claude: { sessionId: "ffffffff-0000-0000-0000-000000000000" } },
    { id: "c5", updatedAt: "2026-10-26T19:00:00Z" },
  ];
  assert.deepEqual(a.conversasApagadas(convs, apagadas), ["c1", CONV]);
});

test("anotarApagadaSh: grava na máquina (0600), junta com o que havia e recusa id inválido", { skip: spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false }, () => {
  const home = mkdtempSync(join(tmpdir(), "apagadas-"));
  const dir = join(home, ".local", "share", "meu-bot");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "conversas-apagadas.json");
  writeFileSync(file, JSON.stringify({ ids: { [CONV]: "2026-10-25T10:00:00Z" } }));
  const run = (sh) => spawnSync("bash", ["-c", sh], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const r = run(a.anotarApagadaSh(SESS, "2026-10-26T20:00:00Z"));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ids: { [CONV]: "2026-10-25T10:00:00Z", [SESS]: "2026-10-26T20:00:00Z" } });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  writeFileSync(file, "{corrompido");
  assert.equal(run(a.anotarApagadaSh(SESS, "2026-10-26T20:00:00Z")).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ids: { [SESS]: "2026-10-26T20:00:00Z" } });
  assert.throws(() => a.anotarApagadaSh("x'; rm -rf ~; '", "2026-10-26T20:00:00Z"), /conversa inválida/);
  assert.throws(() => a.anotarApagadaSh(SESS, "ontem"), /conversa inválida/);
});
