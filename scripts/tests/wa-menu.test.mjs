import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { waMenuTemplate, waMenuState } = createRequire(import.meta.url)("../../dist/main/wa-menu.js");

const labels = (entries) => entries.map((e) => ("separator" in e ? "---" : e.label));
const actions = (entries) => entries.flatMap((e) => ("submenu" in e ? e.submenu.map((s) => s.action) : "action" in e ? [e.action] : []));

test("sem manageWa (admin): exportar, arquivar, pausar, limpar e excluir (sem conversar)", () => {
  const m = waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: false });
  assert.deepEqual(labels(m), ["Exportar", "Copiar ID  ⓘ", "Renomear", "Arquivar", "Pausar", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(actions(m), ["export-md", "export-json", "copy-ref", "rename", "archive", "pause", "clear", "delete"]);
  assert.equal(labels(waMenuTemplate({ archived: true, paused: false, deleted: false }, { manageWa: false }))[3], "Desarquivar");
  assert.ok(!actions(m).includes("talk"));
  assert.ok(labels(waMenuTemplate({ archived: false, paused: true, deleted: false }, { manageWa: false })).includes("Retomar"));
});

test("com manageWa (cliente): conversar, pausar/retomar, limpar e excluir", () => {
  const own = waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true });
  assert.deepEqual(labels(own), ["Conversar", "Exportar", "Copiar ID  ⓘ", "---", "Renomear", "Arquivar", "Pausar", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(actions(own).includes("pause") && actions(own).includes("clear") && actions(own).includes("talk"));
  const paused = waMenuTemplate({ archived: false, paused: true, deleted: false }, { manageWa: true });
  assert.ok(labels(paused).includes("Retomar"));
});

test("waMenuState saneia o payload", () => {
  assert.deepEqual(waMenuState({ state: { archived: true, paused: "sim" } }), { archived: true, paused: false, deleted: false });
  assert.deepEqual(waMenuState(null), { archived: false, paused: false, deleted: false });
  const del = waMenuTemplate({ archived: false, paused: false, deleted: true }, { manageWa: false });
  assert.ok(del.some((e) => "action" in e && e.action === "restore") && !del.some((e) => "action" in e && (e.action === "clear" || e.action === "delete")));
});

test("menu do grupo: ligar (desligado) ou desligar, quem pode conversar, copiar ID e atualizar a lista", async () => {
  const { waGroupMenuTemplate, waGroupAgente } = await import("../../dist/main/wa-menu.js");
  const acts = (a) => waGroupMenuTemplate(a).filter((e) => !("separator" in e)).map((e) => e.action);
  assert.deepEqual(acts("desligado"), ["group-on", "group-who", "group-copy-id", "group-clear", "groups-refresh"]);
  assert.deepEqual(acts("mencao"), ["group-off", "group-who", "group-copy-id", "group-clear", "groups-refresh"]);
  assert.equal(waGroupAgente({ state: { agente: "sempre" } }), "sempre");
  assert.equal(waGroupAgente({ state: { agente: "x" } }), "desligado");
  assert.equal(waGroupAgente(null), "desligado");
});
