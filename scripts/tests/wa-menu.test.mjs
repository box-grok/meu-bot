import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { waMenuTemplate, waMenuState } = createRequire(import.meta.url)("../../dist/main/whatsapp/wa-menu.js");
// O menu pergunta o que a máquina sabe fazer (whatsapp-capacidades.ts), não qual framework ela roda.
const HERMES = { pausar: false, limparHistorico: true, grupos: false };
const PICOCLAW = { pausar: false, limparHistorico: false, grupos: false };

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
  const { waGroupMenuTemplate, waGroupAgente } = await import("../../dist/main/whatsapp/wa-menu.js");
  const acts = (a) => waGroupMenuTemplate(a).filter((e) => !("separator" in e)).map((e) => e.action);
  // Limpar e Excluir sempre, ligado ou não (pedido do dono, 25 out): excluir só tira da lista, o agente não muda.
  assert.deepEqual(acts("desligado"), ["group-on", "group-who", "group-copy-id", "group-rename", "group-clear", "group-delete", "groups-refresh"]);
  assert.deepEqual(acts("mencao"), ["group-off", "group-who", "group-copy-id", "group-rename", "group-clear", "group-delete", "groups-refresh"]);
  assert.equal(waGroupAgente({ state: { agente: "sempre" } }), "sempre");
  assert.equal(waGroupAgente({ state: { agente: "x" } }), "desligado");
  assert.equal(waGroupAgente(null), "desligado");
});

test("grupo excluído da lista: só Restaurar, Copiar ID e reler a lista, com qualquer capacidade", async () => {
  const { waGroupMenuTemplate, waGroupDeleted } = await import("../../dist/main/whatsapp/wa-menu.js");
  const acts = (a, cap) => waGroupMenuTemplate(a, cap, true).filter((e) => !("separator" in e)).map((e) => e.action);
  assert.deepEqual(acts("desligado", null), ["group-restore", "group-copy-id", "groups-refresh"]);
  assert.deepEqual(acts("mencao", HERMES), ["group-restore", "group-copy-id", "groups-refresh"]);
  assert.equal(waGroupDeleted({ state: { deleted: true } }), true);
  assert.equal(waGroupDeleted({ state: { deleted: "sim" } }), false);
  assert.equal(waGroupDeleted(null), false);
});

test("reticências dizem se confirma: conversa pergunta, grupo limpa direto", async () => {
  const { waMenuTemplate, waGroupMenuTemplate } = await import("../../dist/main/whatsapp/wa-menu.js");
  const rotulo = (es, acao) => es.find((e) => "action" in e && e.action === acao)?.label;
  assert.equal(rotulo(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: false }), "clear"), "Limpar histórico…");
  assert.equal(rotulo(waGroupMenuTemplate("mencao"), "group-clear"), "Limpar histórico");
});

test("sem a capacidade pausar (Hermes): sem Pausar, com Limpar histórico, conversar, exportar, apelido, arquivar e excluir", () => {
  const h = waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true }, HERMES);
  assert.deepEqual(labels(h), ["Conversar", "Exportar", "Copiar ID  ⓘ", "---", "Renomear", "Arquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(!actions(h).includes("pause") && actions(h).includes("clear"));
  const admin = waMenuTemplate({ archived: true, paused: false, deleted: false }, { manageWa: false }, HERMES);
  assert.deepEqual(labels(admin), ["Exportar", "Copiar ID  ⓘ", "Renomear", "Desarquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(labels(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true }, null)), labels(waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true })), "capacidade desconhecida vale o menu completo");
  // Sem pausar nem limpar (PicoClaw): nada que mexa no agente; antes ele caía no menu completo e falhava ao clicar.
  const p = waMenuTemplate({ archived: false, paused: false, deleted: false }, { manageWa: true }, PICOCLAW);
  assert.ok(!actions(p).includes("pause") && !actions(p).includes("clear") && actions(p).includes("delete"));
});

test("menu de grupo sem a capacidade grupos (Hermes): Copiar ID, Limpar histórico, Excluir da lista e reler a lista", async () => {
  const { waGroupMenuTemplate } = await import("../../dist/main/whatsapp/wa-menu.js");
  const acts = (cap) => waGroupMenuTemplate("sempre", cap).filter((e) => !("separator" in e)).map((e) => e.action);
  assert.deepEqual(acts(HERMES), ["group-copy-id", "group-rename", "group-clear", "group-delete", "groups-refresh"]);
  assert.deepEqual(acts(PICOCLAW), ["group-copy-id", "group-rename", "group-delete", "groups-refresh"]);
  // Quando o Hermes ganhar `grupos`, o menu passa a oferecer ligar/desligar e quem conversa sem mudar aqui.
  assert.deepEqual(acts({ ...HERMES, grupos: true }), ["group-off", "group-who", "group-copy-id", "group-rename", "group-clear", "group-delete", "groups-refresh"]);
  assert.ok(waGroupMenuTemplate("sempre", null).some((e) => "action" in e && e.action === "group-off"), "capacidade desconhecida vale o menu completo");
});
