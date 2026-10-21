import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { VOZES, isVozId } = createRequire(import.meta.url)("../../dist/main/vozes-core.js");
const root = join(import.meta.dirname, "..", "..");

test("vozes: catálogo do main, cópia do renderer e install-voz.sh conhecem os mesmos ids", () => {
  assert.deepEqual(VOZES.map((v) => v.id), ["faber", "dora", "alex"]);
  assert.equal(VOZES.filter((v) => v.padrao).map((v) => v.id).join(), "faber");
  assert.ok(isVozId("dora") && !isVozId("francisca") && !isVozId(undefined));
  const ui = readFileSync(join(root, "src/renderer/renderer.ts"), "utf8");
  const bloco = /const VOZES_UI[\s\S]*?\];/.exec(ui)[0];
  assert.deepEqual([...bloco.matchAll(/id: "(\w+)", rotulo: "([^"]+)"/g)].map((m) => [m[1], m[2]]), VOZES.map((v) => [v.id, v.rotulo]));
  const sh = readFileSync(join(root, "backend-colima/install-voz.sh"), "utf8");
  assert.match(sh, /case "\$VOZ" in faber\|dora\|alex\)/);
  assert.match(sh, /pf_dora/); assert.match(sh, /pm_alex/);
});
