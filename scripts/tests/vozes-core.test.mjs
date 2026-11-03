import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { VOZES, isVozId } = createRequire(import.meta.url)("../../dist/main/whatsapp/vozes-core.js");
const root = join(import.meta.dirname, "..", "..");

test("vozes: catálogo do main, cópia do renderer e install-voz.sh conhecem os mesmos ids", () => {
  assert.deepEqual(VOZES.map((v) => v.id), ["faber", "dora", "alex"]);
  assert.equal(VOZES.filter((v) => v.padrao).map((v) => v.id).join(), "faber");
  assert.ok(isVozId("dora") && !isVozId("francisca") && !isVozId(undefined));
  const ui = readFileSync(join(root, "src/renderer/whatsapp/agente-whatsapp.ts"), "utf8");
  const bloco = /const VOZES_UI[\s\S]*?\];/.exec(ui)[0];
  assert.deepEqual([...bloco.matchAll(/id: "(\w+)", rotulo: "([^"]+)"/g)].map((m) => [m[1], m[2]]), VOZES.map((v) => [v.id, v.rotulo]));
  const sh = readFileSync(join(root, "backend-colima/install-voz.sh"), "utf8");
  assert.match(sh, /case "\$VOZ" in faber\|dora\|alex\)/);
  assert.match(sh, /pf_dora/); assert.match(sh, /pm_alex/);
});

test("ffmpeg que falta aponta o admin (Preparar máquina), não um apt que a box não consegue rodar", () => {
  for (const f of ["backend-colima/install-voz.sh", "backend-colima/install-transcricao.sh", "src/main/maquina/hostProbe.ts"]) {
    const s = readFileSync(join(root, f), "utf8");
    assert.match(s, /Preparar máquina › /, f);
    assert.doesNotMatch(s, /\(apt(-get)? install ffmpeg\)/, f);
  }
  for (const f of ["backend-colima/install-voz.sh", "backend-colima/install-transcricao.sh"]) {
    const s = readFileSync(join(root, f), "utf8");
    assert.match(s, /apt-get install -y -q ffmpeg/, f);
    assert.ok(s.indexOf("ffmpeg_ou_avisa()") < s.indexOf('ffmpeg_ou_avisa "'), `${f}: a função vem antes do uso`);
  }
});
