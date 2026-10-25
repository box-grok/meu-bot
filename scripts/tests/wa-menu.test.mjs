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
  // Excluir da lista só com o agente desligado: ligado some da lista enquanto o agente responde nele seria armadilha.
  assert.deepEqual(acts("desligado"), ["group-on", "group-who", "group-copy-id", "group-clear", "group-delete", "groups-refresh"]);
  assert.deepEqual(acts("mencao"), ["group-off", "group-who", "group-copy-id", "group-clear", "groups-refresh"]);
  assert.equal(waGroupAgente({ state: { agente: "sempre" } }), "sempre");
  assert.equal(waGroupAgente({ state: { agente: "x" } }), "desligado");
  assert.equal(waGroupAgente(null), "desligado");
});

test("grupo excluído da lista: só Restaurar, Copiar ID e reler a lista, em qualquer gateway", async () => {
  const { waGroupMenuTemplate, waGroupDeleted } = await import("../../dist/main/wa-menu.js");
  const acts = (a, gw) => waGroupMenuTemplate(a, gw, true).filter((e) => !("separator" in e)).map((e) => e.action);
  assert.deepEqual(acts("desligado", "openclaw"), ["group-restore", "group-copy-id", "groups-refresh"]);
  assert.deepEqual(acts("mencao", "hermes"), ["group-restore", "group-copy-id", "groups-refresh"]);
  assert.equal(waGroupDeleted({ state: { deleted: true } }), true);
  assert.equal(waGroupDeleted({ state: { deleted: "sim" } }), false);
  assert.equal(waGroupDeleted(null), false);
});

test("reticências dizem se confirma: conversa pergunta, grupo limpa direto", async () => {
  const { waMenuTemplate, waGroupMenuTemplate } = await import("../../dist/main/wa-menu.js");
  const rotulo = (es, acao) => es.find((e) => "action" in e && e.action === acao)?.label;
  assert.equal(rotulo(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: false }), "clear"), "Limpar histórico…");
  assert.equal(rotulo(waGroupMenuTemplate("mencao"), "group-clear"), "Limpar histórico");
});

test("no Hermes: sem Pausar (não há pausa por contato), com Limpar histórico, conversar, exportar, apelido, arquivar e excluir", () => {
  const h = waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true }, "hermes");
  assert.deepEqual(labels(h), ["Conversar", "Exportar", "Copiar ID  ⓘ", "---", "Renomear", "Arquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(!actions(h).includes("pause") && actions(h).includes("clear"));
  const admin = waMenuTemplate({ archived: true, paused: false, deleted: false }, { manageWa: false }, "hermes");
  assert.deepEqual(labels(admin), ["Exportar", "Copiar ID  ⓘ", "Renomear", "Desarquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(labels(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true }, null)), labels(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true })), "sem gateway conhecido vale o menu do OpenClaw");
});

test("menu de grupo no Hermes: Copiar ID, Excluir da lista e reler a lista (ligar, quem aciona e limpar são do OpenClaw)", async () => {
  const { waGroupMenuTemplate } = await import("../../dist/main/wa-menu.js");
  const acts = waGroupMenuTemplate("sempre", "hermes").filter((e) => !("separator" in e)).map((e) => e.action);
  assert.deepEqual(acts, ["group-copy-id", "group-delete", "groups-refresh"]);
  assert.ok(waGroupMenuTemplate("sempre", null).some((e) => "action" in e && e.action === "group-off"), "sem gateway conhecido vale o menu do OpenClaw");
});
