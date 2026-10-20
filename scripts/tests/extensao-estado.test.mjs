import { test } from "node:test";
import assert from "node:assert/strict";
import { criarEstado } from "../../extensao-crm/src/estado.ts";
import { ErroCrm } from "../../extensao-crm/src/api.ts";

function apiFake() {
  const log = []; const falhar = { v: false };
  const guard = async (nome, v) => { log.push(nome); if (falhar.v) throw new ErroCrm("proxy-fora", "fora"); return v; };
  const api = {
    status: () => guard("status", { seq: 1 }),
    pipelines: () => guard("pipelines", [{ key: "p_abcd1234", name: "P", boxes: 1, updatedAt: 1 }]),
    pipeline: (k) => guard(`pipeline:${k}`, { key: k, name: "P", stages: [{ key: "s_1", name: "A" }, { key: "s_2", name: "B" }], fields: [] }),
    caixas: () => guard("caixas", { boxes: [], total: 0, stages: [] }),
    caixa: (k) => guard(`caixa:${k}`, { box: { key: k, name: "Box", stage: "A", stageKey: "s_1", notes: "", fields: {}, contatos: [], threads: 0, lastUpdated: "" }, pipelineKey: "p_abcd1234", comentarios: [], threads: [], contatos: [], notes: "" }),
    criarCaixa: async (p, d) => { log.push("criar"); return { key: "b_novo1234", name: d.name, stage: "A", stageKey: "s_1", notes: "", fields: {}, contatos: [], threads: 0, lastUpdated: "" }; },
    atualizarCaixa: (k, patch) => guard(`patch:${k}:${JSON.stringify(patch)}`, { key: k, name: patch.name ?? "Box", stage: "B", stageKey: patch.stageKey ?? "s_1", notes: "", fields: {}, contatos: [], threads: 0, lastUpdated: "" }),
    comentar: async (k, texto) => { log.push("comentar"); return { key: "c_1", em: "2026-10-19T10:00", autor: "extensao", texto }; },
    vincularThread: async () => { log.push("vincular"); return []; },
    desvincularThread: async () => { log.push("desvincular"); },
    caixaDaThread: (g) => guard(`thread:${g}`, g === "aaaaaaaaaaaa" ? { box: { key: "b_x1", name: "Box", stage: "A", stageKey: "s_1", notes: "", fields: {}, contatos: [], threads: 1, lastUpdated: "" }, pipelineKey: "p_abcd1234" } : null),
    lookupThreads: (ids) => guard(`lookup:${ids.length}`, Object.fromEntries(ids.filter((g) => g.startsWith("a")).map((g) => [g, { key: "b_x1", name: "Box", stageKey: "s_1", stage: "A", pipelineKey: "p_abcd1234" }]))),
    mudancas: (since) => guard(`mudancas:${since}`, { seq: since + 1, mudancas: [{ seq: since + 1, at: 1, tipo: "box.update", box: "b_x1", pipeline: "p_abcd1234", por: "agente" }] }),
  };
  return { api, log, falhar };
}

test("cache e dedupe: pipeline/caixa pedidos uma vez; thread com TTL; lote de threads só pede o que falta", async () => {
  const { api, log } = apiFake(); let agora = 0;
  const e = criarEstado({ api, agora: () => agora, timer: () => () => {}, escondida: () => true });
  await Promise.all([e.pipeline("p_abcd1234"), e.pipeline("p_abcd1234")]);
  assert.deepEqual(log, ["pipeline:p_abcd1234"], "duas chamadas em voo viram uma");
  await e.pipeline("p_abcd1234"); assert.equal(log.length, 1, "cache");
  assert.equal((await e.caixaDaThread("aaaaaaaaaaaa")).key, "b_x1");
  assert.equal(await e.caixaDaThread("bbbbbbbbbbbb"), null);
  await e.caixaDaThread("bbbbbbbbbbbb"); assert.equal(log.filter((l) => l === "thread:bbbbbbbbbbbb").length, 1, "null também fica em cache");
  agora = 61_000; await e.caixaDaThread("bbbbbbbbbbbb"); assert.equal(log.filter((l) => l === "thread:bbbbbbbbbbbb").length, 2, "TTL vencido pede de novo");
  const r = await e.caixasDasThreads(["aaaa11111111", "bbbbbbbbbbbb", "cccccccccccc"]);
  assert.equal(r.get("aaaa11111111").key, "b_x1"); assert.equal(r.get("bbbbbbbbbbbb"), null); assert.equal(r.get("cccccccccccc"), null);
  assert.equal(log.at(-1), "lookup:2", "a thread b (null em cache fresco) não entra no lote");
});

test("aplicarMudancas: invalida só o afetado; reset limpa tudo e avisa; ouvintes recebem", async () => {
  const { api, log } = apiFake();
  const e = criarEstado({ api, timer: () => () => {}, escondida: () => true });
  await e.pipeline("p_abcd1234"); await e.caixa("b_x1"); await e.caixaDaThread("aaaaaaaaaaaa");
  const eventos = []; e.assinar((ev) => eventos.push(ev));
  e.aplicarMudancas({ seq: 5, mudancas: [{ seq: 5, at: 1, tipo: "box.comment", box: "b_x1", por: "agente" }] });
  assert.equal(e.seq, 5); assert.equal(eventos.length, 1); assert.equal(eventos[0].mudancas[0].tipo, "box.comment");
  const n = log.length; await e.caixa("b_x1"); assert.equal(log.length, n + 1, "a caixa foi invalidada"); await e.pipeline("p_abcd1234"); assert.equal(log.length, n + 1, "o pipeline não");
  e.aplicarMudancas({ seq: 9, mudancas: [], reset: true }); assert.equal(eventos.at(-1).reset, true); assert.equal(e.seq, 9);
  await e.pipeline("p_abcd1234"); assert.equal(log.at(-1), "pipeline:p_abcd1234", "reset limpou o pipeline");
});

test("polling: 5 s com visão aberta, 30 s sem; pausa escondida; recuo após falhas; conexão vai e volta", async () => {
  const { api, log, falhar } = apiFake(); const agendados = []; let escondida = false;
  const e = criarEstado({ api, timer: (fn, ms) => { agendados.push({ fn, ms }); return () => {}; }, escondida: () => escondida });
  const eventos = []; e.assinar((ev) => eventos.push(ev.conexao));
  e.iniciarPolling(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(log[0], "mudancas:0"); assert.equal(agendados[0].ms, 30_000); assert.equal(e.seq, 1);
  const fechar = e.abrirVisao(); await agendados[1 - 1].fn(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(agendados.at(-1).ms, 5000, "com visão aberta: 5 s"); assert.equal(eventos.at(-1), "ok");
  fechar(); falhar.v = true; await agendados.at(-1).fn(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(agendados.at(-1).ms, 10_000, "1ª falha: 10 s"); assert.equal(eventos.at(-1), "proxy-fora");
  await agendados.at(-1).fn(); await new Promise((r) => setTimeout(r, 0)); assert.equal(agendados.at(-1).ms, 20_000, "2ª falha: 20 s");
  escondida = true; const n = log.length; await agendados.at(-1).fn(); await new Promise((r) => setTimeout(r, 0)); assert.equal(log.length, n, "aba escondida não consulta");
  escondida = false; falhar.v = false; await agendados.at(-1).fn(); await new Promise((r) => setTimeout(r, 0)); assert.equal(eventos.at(-1), "ok", "voltou");
  e.pararPolling();
});

test("escrita otimista com rollback e vínculo de thread", async () => {
  const { api, log, falhar } = apiFake();
  const e = criarEstado({ api, timer: () => () => {}, escondida: () => true });
  await e.caixa("b_x1");
  const eventos = []; e.assinar((ev) => eventos.push(ev));
  const b = await e.atualizarCaixa("b_x1", { stageKey: "s_2" }, (f) => ({ ...f, box: { ...f.box, stageKey: "s_2" } }));
  assert.equal(b.stageKey, "s_2"); assert.equal(eventos.length, 1); assert.equal((await e.caixa("b_x1")).box.stageKey, "s_2", "cache atualizado sem nova leitura");
  falhar.v = true;
  await assert.rejects(e.atualizarCaixa("b_x1", { name: "Z" }, (f) => ({ ...f, box: { ...f.box, name: "Z" } })));
  assert.equal((await e.caixa("b_x1")).box.name, "Box", "rollback"); assert.equal(eventos.filter((ev) => ev.mudancas.length > 0).length, 3, "avisou a ida e a volta (o aviso de conexão é à parte)");
  falhar.v = false;
  await e.vincularThread("b_x1", { threadGmailId: "dddddddddddd" });
  assert.equal(log.at(-1), "vincular"); assert.equal((await e.caixaDaThread("dddddddddddd")).key, "b_x1", "a thread aponta para a caixa sem consultar o host");
  await e.comentar("b_x1", "oi"); assert.equal((await e.caixa("b_x1")).comentarios.length, 1);
});
