import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseCrmPatch, parseCrmInfo, parseStreakOut, setCrmSh, crmInfoSh, streakSh, motorEfetivo } = createRequire(import.meta.url)("../../dist/main/crm-core.js");

test("parseCrmPatch: chave válida, pipeline, silêncio 1–240, flag; recusa o resto", () => {
  assert.deepEqual(parseCrmPatch({ apiKey: "  abcdefghij1234567890  " }), { apiKey: "abcdefghij1234567890" });
  assert.throws(() => parseCrmPatch({ apiKey: "curta" }), /inválida/);
  assert.throws(() => parseCrmPatch({ apiKey: "tem espaco dentro 1234567890" }), /inválida/);
  assert.deepEqual(parseCrmPatch({ pipelineKey: "agxzfm1haWxmb29nYWVy", pipelineName: "  Parceiros   Grok " }), { pipelineKey: "agxzfm1haWxmb29nYWVy", pipelineName: "Parceiros Grok" });
  assert.deepEqual(parseCrmPatch({ pipelineKey: null }), { pipelineKey: null });
  assert.throws(() => parseCrmPatch({ pipelineKey: "x;rm" }), /pipeline inválido/);
  assert.deepEqual(parseCrmPatch({ silencioMin: 15, criarSemPerguntar: true }), { silencioMin: 15, criarSemPerguntar: true });
  assert.throws(() => parseCrmPatch({ silencioMin: 0 }), /1 a 240/);
  assert.throws(() => parseCrmPatch({}), /nada/);
});

test("setCrmSh: patch em base64 pelo stdin (a chave não aparece em claro), 0600, marcador; silêncio vai ao plugin", () => {
  const sh = setCrmSh({ apiKey: "segredo1234567890abc", silencioMin: 20 });
  assert.ok(!sh.includes("segredo1234567890abc"), "chave em claro no comando");
  assert.match(sh, /base64 -d \| python3/); assert.match(sh, /0o600/); assert.match(sh, /CRM=1/);
  assert.match(sh, /plugins\.entries\.meu-bot-crm\.config\.silencioMin 20/);
  assert.ok(!setCrmSh({ apiKey: "segredo1234567890abc" }).includes("openclaw config set"));
});

test("crmInfoSh/parseCrmInfo: configured sem a chave, instalado por I=", () => {
  assert.match(crmInfoSh(), /crm\.json/); assert.match(crmInfoSh(), /crm-job\.mjs/);
  const info = parseCrmInfo('C={"configured": true, "pipelineKey": "k1", "pipelineName": "P", "silencioMin": 7, "criarSemPerguntar": false, "savedAt": "2026-10-18T00:00:00Z"}\nI=1\n');
  assert.deepEqual(info, { installed: true, configured: true, streakKey: false, motor: null, pipelineKey: "k1", pipelineName: "P", silencioMin: 7, criarSemPerguntar: false, savedAt: "2026-10-18T00:00:00Z" });
  assert.deepEqual(parseCrmInfo("lixo"), { installed: false, configured: false, streakKey: false, motor: null, pipelineKey: null, pipelineName: null, silencioMin: 10, criarSemPerguntar: false, savedAt: null });
});

test("streakSh/parseStreakOut: só diag/pipelines; JSON ou erro claro", () => {
  assert.match(streakSh("diag"), /"\$CLI" diag/);
  assert.match(streakSh("diag"), /crm\.mjs/, "plano personalizado usa o crm.mjs"); assert.match(streakSh("pipelines"), /streak\.mjs/, "senão o streak.mjs");
  assert.deepEqual(parseStreakOut('S={"ok":true,"pipelines":[]}'), { ok: true, pipelines: [] });
  assert.match(String(parseStreakOut("S=").erro), /não respondeu/);
});

test("motor do CRM: patch aceita proprio/streak/null; a regra sem motor gravado segue a chave do Streak, depois a licença", () => {
  assert.deepEqual(parseCrmPatch({ motor: "proprio" }), { motor: "proprio" });
  assert.deepEqual(parseCrmPatch({ motor: null }), { motor: null });
  assert.throws(() => parseCrmPatch({ motor: "outro" }), /motor inválido/);
  assert.equal(motorEfetivo("streak", false, true), "streak", "gravado vence");
  assert.equal(motorEfetivo(null, true, true), "streak", "quem já tem a chave do Streak não muda em silêncio");
  assert.equal(motorEfetivo(null, false, true), "proprio");
  assert.equal(motorEfetivo(null, false, false), "streak");
  const info = parseCrmInfo('C={"motor":"proprio","streakKey":false,"configured":true}\nI=1');
  assert.equal(info.motor, "proprio"); assert.equal(info.streakKey, false);
  assert.match(streakSh("diag"), /c\.get\("motor"\)/, "a escolha do CLI na máquina olha o motor gravado");
});
