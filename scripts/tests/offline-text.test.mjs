import { test } from "node:test";
import assert from "node:assert/strict";
import { offlineBarText } from "../../dist/renderer/lib/offline-text.js";

const NOW = Date.parse("2026-10-17T15:13:00Z");
const base = { localAddr: false, checking: false, since: null, checkedAt: null, manual: false, now: NOW };

test("faixa OFFLINE: a frase diz que o problema é na conexão, não no app", () => {
  assert.equal(offlineBarText(base), "OFFLINE · Você está sem internet. O problema é na sua conexão, não no app: a máquina e o Claude não respondem até ela voltar.");
  assert.equal(offlineBarText({ ...base, localAddr: true }), "OFFLINE · Você está sem internet. A máquina local responde, mas o Claude não, até a conexão voltar.");
});

test("faixa OFFLINE: há quanto tempo, verificando, e 'ainda sem internet' depois de Verificar agora", () => {
  assert.match(offlineBarText({ ...base, since: NOW - 30_000 }), /voltar\.$/, "menos de 1 min não aparece");
  assert.match(offlineBarText({ ...base, since: NOW - 2 * 60_000 }), / Sem internet há 2 min\.$/);
  assert.match(offlineBarText({ ...base, since: NOW - 3 * 3600_000 }), / Sem internet há 3 h\.$/);
  assert.equal(offlineBarText({ ...base, checking: true }), "OFFLINE · verificando a conexão…");
  assert.equal(offlineBarText({ ...base, manual: true, checkedAt: NOW - 2_000, since: NOW - 5 * 60_000 }), "OFFLINE · ainda sem internet (verificado agora). Sem internet há 5 min.");
  assert.match(offlineBarText({ ...base, manual: true, checkedAt: NOW - 60_000 }), /^OFFLINE · Você está sem internet/, "verificação antiga volta à frase normal");
});
