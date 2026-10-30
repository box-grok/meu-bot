import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { waMenuTemplate, waMenuState } = createRequire(import.meta.url)("../../dist/main/whatsapp/wa-menu.js");
// O menu pergunta o que a máquina sabe fazer (whatsapp-capacidades.ts), não qual framework ela roda.
const HERMES = { pausar: false, pausaPrazo: false, limparHistorico: true, grupos: false };
const PICOCLAW = { pausar: false, pausaPrazo: false, limparHistorico: false, grupos: false };
// Hermes com o plugin meu-bot-pausa carregado: a pausa tem prazo.
const HERMES_PLUGIN = { pausar: true, pausaPrazo: true, limparHistorico: true, grupos: true };

const labels = (entries) => entries.map((e) => ("separator" in e ? "---" : e.label));
const actions = (entries) => entries.flatMap((e) => ("submenu" in e ? e.submenu.map((s) => s.action) : "action" in e ? [e.action] : []));

test("sem manageWa (admin): exportar, arquivar, pausar, limpar e excluir (sem conversar)", () => {
  const m = waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: false });
  assert.deepEqual(labels(m), ["Exportar", "Copiar ID  ⓘ", "Renomear", "Arquivar", "Pausar", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(actions(m), ["export-md", "export-json", "copy-ref", "rename", "archive", "pause", "clear", "delete"]);
  assert.equal(labels(waMenuTemplate({ archived: true, paused: false, deleted: false, pausaRotulo: null }, { manageWa: false }))[3], "Desarquivar");
  assert.ok(!actions(m).includes("talk"));
  assert.ok(labels(waMenuTemplate({ archived: false, paused: true, deleted: false, pausaRotulo: null }, { manageWa: false })).includes("Retomar"));
});

test("com manageWa (cliente): conversar, pausar/retomar, limpar e excluir", () => {
  const own = waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true });
  assert.deepEqual(labels(own), ["Conversar", "Exportar", "Copiar ID  ⓘ", "---", "Renomear", "Arquivar", "Pausar", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(actions(own).includes("pause") && actions(own).includes("clear") && actions(own).includes("talk"));
  const paused = waMenuTemplate({ archived: false, paused: true, deleted: false, pausaRotulo: null }, { manageWa: true });
  assert.ok(labels(paused).includes("Retomar"));
});

test("waMenuState saneia o payload", () => {
  assert.deepEqual(waMenuState({ state: { archived: true, paused: "sim" } }), { archived: true, paused: false, deleted: false, pausaRotulo: null });
  assert.deepEqual(waMenuState(null), { archived: false, paused: false, deleted: false, pausaRotulo: null });
  assert.equal(waMenuState({ state: { pausaRotulo: "até 14:30" } }).pausaRotulo, "até 14:30");
  assert.equal(waMenuState({ state: { pausaRotulo: "x".repeat(41) } }).pausaRotulo, null, "rótulo longo demais não entra no menu");
  assert.equal(waMenuState({ state: { pausaRotulo: "a\nb" } }).pausaRotulo, null);
  const del = waMenuTemplate({ archived: false, paused: false, deleted: true, pausaRotulo: null }, { manageWa: false });
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
  assert.equal(rotulo(waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: false }), "clear"), "Limpar histórico…");
  assert.equal(rotulo(waGroupMenuTemplate("mencao"), "group-clear"), "Limpar histórico");
});

test("com pausaPrazo (Hermes + plugin): submenu Pausar o agente › 2 h / 24 h / até eu retomar; pausado mostra até quando no Retomar", () => {
  const m = waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true }, HERMES_PLUGIN);
  assert.ok(labels(m).includes("Pausar o agente") && !labels(m).includes("Pausar"));
  const sub = m.find((e) => "submenu" in e && e.label === "Pausar o agente").submenu;
  assert.deepEqual(sub.map((e) => [e.label, e.action]), [["Por 2 horas", "pause-2h"], ["Por 24 horas", "pause-24h"], ["Até eu retomar", "pause"]]);
  const p = waMenuTemplate({ archived: false, paused: true, deleted: false, pausaRotulo: "volta às 14:30" }, { manageWa: false }, HERMES_PLUGIN);
  assert.ok(labels(p).includes("Retomar (volta às 14:30)") && actions(p).includes("resume"));
  assert.ok(labels(waMenuTemplate({ archived: false, paused: true, deleted: false, pausaRotulo: null }, { manageWa: false }, HERMES_PLUGIN)).includes("Retomar"));
  // Sem o prazo (OpenClaw, Hermes sem plugin, capacidade desconhecida): "Pausar" simples, que nunca falha por prazo.
  for (const cap of [{ ...HERMES_PLUGIN, pausaPrazo: false }, null]) assert.ok(labels(waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true }, cap)).includes("Pausar"));
});

test("sem a capacidade pausar (Hermes): sem Pausar, com Limpar histórico, conversar, exportar, apelido, arquivar e excluir", () => {
  const h = waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true }, HERMES);
  assert.deepEqual(labels(h), ["Conversar", "Exportar", "Copiar ID  ⓘ", "---", "Renomear", "Arquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.ok(!actions(h).includes("pause") && actions(h).includes("clear"));
  const admin = waMenuTemplate({ archived: true, paused: false, deleted: false, pausaRotulo: null }, { manageWa: false }, HERMES);
  assert.deepEqual(labels(admin), ["Exportar", "Copiar ID  ⓘ", "Renomear", "Desarquivar", "Limpar histórico…", "Excluir conversa"]);
  assert.deepEqual(labels(waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true }, null)), labels(waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true })), "capacidade desconhecida vale o menu completo");
  // Sem pausar nem limpar (PicoClaw): nada que mexa no agente; antes ele caía no menu completo e falhava ao clicar.
  const p = waMenuTemplate({ archived: false, paused: false, deleted: false, pausaRotulo: null }, { manageWa: true }, PICOCLAW);
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
