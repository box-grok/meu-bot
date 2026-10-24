import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { run, runText, ProcError } = createRequire(import.meta.url)("../../dist/main/proc.js");

test("run: saída do comando; código ≠ 0 vira ProcError com a última linha do stderr", async () => {
  assert.equal(await runText("/bin/echo", ["olá"]), "olá");
  const r = await run("/bin/sh", ["-c", "echo fora; echo erro >&2; exit 0"]);
  assert.equal(r.code, 0); assert.equal(r.stdout, "fora\n"); assert.equal(r.stderr, "erro\n");
  await assert.rejects(run("/bin/sh", ["-c", "echo primeira >&2; echo última >&2; exit 3"]), (e) => e instanceof ProcError && e.code === 3 && /saiu com 3: última/.test(e.message));
});

test("run: passou do tempo → ProcError sem código; comando inexistente → Error comum", async () => {
  await assert.rejects(run("/bin/sh", ["-c", "sleep 5"], { timeoutMs: 100 }), (e) => e instanceof ProcError && e.code === null && /não terminou a tempo/.test(e.message));
  await assert.rejects(run("/nao/existe", []), (e) => !(e instanceof ProcError) && /ENOENT/.test(e.message));
});
