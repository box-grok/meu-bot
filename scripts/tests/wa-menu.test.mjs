import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { waMenuTemplate, waMenuState } = createRequire(import.meta.url)("../../dist/main/wa-menu.js");

const labels = (entries) => entries.map((e) => ("separator" in e ? "---" : e.label));
const actions = (entries) => entries.flatMap((e) => ("submenu" in e ? e.submenu.map((s) => s.action) : "action" in e ? [e.action] : []));

test("sem manageWa (admin): exportar, arquivar, pausar, limpar e excluir (sem conversar)", () => {
  const m = waMenuTemplate({ archived: false, paused: false, ownSession: true }, { manageWa: false });
  assert.deepEqual(labels(m), ["Exportar", "Copiar ID", "Renomear", "Arquivar", "Pausar o agente para esta pessoa", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(actions(m), ["export-md", "export-json", "copy-ref", "rename", "archive", "pause", "clear", "delete"]);
  assert.equal(labels(waMenuTemplate({ archived: true, paused: false, ownSession: false }, { manageWa: false }))[3], "Desarquivar");
  assert.ok(!actions(m).includes("talk"));
  assert.ok(labels(waMenuTemplate({ archived: false, paused: true, ownSession: true }, { manageWa: false })).includes("Retomar"));
});

test("com manageWa (cliente): conversar, pausar/retomar, limpar e excluir", () => {
  const own = waMenuTemplate({ archived: false, paused: false, ownSession: true }, { manageWa: true });
  assert.deepEqual(labels(own), ["Conversar com o meu-bot sobre isto", "Exportar", "Copiar ID", "---", "Renomear", "Arquivar", "Pausar o agente para esta pessoa", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(actions(own).includes("pause") && actions(own).includes("clear") && actions(own).includes("talk"));
  const paused = waMenuTemplate({ archived: false, paused: true, ownSession: true }, { manageWa: true });
  assert.ok(labels(paused).includes("Retomar"));
  const noSession = waMenuTemplate({ archived: false, paused: false, ownSession: false }, { manageWa: true });
  const disabled = noSession.find((e) => "enabled" in e && !e.enabled);
  assert.ok(disabled !== undefined && disabled.action === null, "pausar sem sessão própria fica desabilitado");
});

test("waMenuState saneia o payload", () => {
  assert.deepEqual(waMenuState({ state: { archived: true, paused: "sim", ownSession: 1 } }), { archived: true, paused: false, ownSession: false });
  assert.deepEqual(waMenuState(null), { archived: false, paused: false, ownSession: false });
});
