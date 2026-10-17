import { test } from "node:test";
import assert from "node:assert/strict";
import { updateStateText } from "../../dist/renderer/lib/update-text.js";

const base = { current: "0.1.0", available: null, ready: null, checking: false, error: null, checkedAt: null };
const NOW = Date.parse("2026-10-17T05:00:00Z");

test("cada fase vira uma frase, como no Rambox", () => {
  assert.deepEqual(updateStateText({ ...base, phase: "idle" }, "meu-bot", NOW), { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false });
  assert.equal(updateStateText({ ...base, phase: "checking", checking: true }, "meu-bot", NOW).text, "Verificando atualizações…");
  assert.deepEqual(updateStateText({ ...base, phase: "up-to-date", checkedAt: "2026-10-17T04:58:00Z" }, "meu-bot", NOW), { text: "Você está na versão mais recente (conferido há 2 min).", kind: "ok", showApply: false });
  assert.equal(updateStateText({ ...base, phase: "up-to-date", checkedAt: "2026-10-17T04:59:50Z" }, "meu-bot", NOW).text, "Você está na versão mais recente (conferido agora).");
  assert.equal(updateStateText({ ...base, phase: "up-to-date" }, "meu-bot", NOW).text, "Você está na versão mais recente.");
  assert.deepEqual(updateStateText({ ...base, phase: "available", available: "0.2.0" }, "meu-bot", NOW), { text: "Nova versão 0.2.0 disponível, baixando…", kind: "warn", showApply: false });
  assert.deepEqual(updateStateText({ ...base, phase: "ready", available: "0.2.0", ready: "0.2.0" }, "meu-bot-admin", NOW), { text: "meu-bot-admin 0.2.0 pronta para instalar.", kind: "warn", showApply: true });
  assert.deepEqual(updateStateText({ ...base, phase: "error", error: "GitHub respondeu 503" }, "meu-bot", NOW), { text: "Não consegui verificar atualizações: GitHub respondeu 503.", kind: "bad", showApply: false });
  assert.deepEqual(updateStateText({ ...base, phase: "error", error: "sem internet" }, "meu-bot", NOW), { text: "Sem internet; verifico as atualizações de novo quando a conexão voltar.", kind: "warn", showApply: false });
});
