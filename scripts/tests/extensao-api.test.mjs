import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroCrm, caminhoOk, criarApi, transporteAuto } from "../../extensao-crm/src/api.ts";

const fake = (respostas) => { const chamadas = []; const t = async (req) => { chamadas.push(req); const r = respostas.shift(); if (r instanceof Error) throw r; return r; }; return { t, chamadas }; };
const TOKEN = "segredo-que-nao-pode-vazar-12345";

test("caminhoOk: só caminhos sob a API, sem .., sem espaços", () => {
  assert.equal(caminhoOk("/pipelines"), true); assert.equal(caminhoOk("/boxes/b_x?comentarios=5"), true);
  assert.equal(caminhoOk("/../x"), false); assert.equal(caminhoOk("pipelines"), false); assert.equal(caminhoOk("/a b"), false);
});
test("criarApi: mapeia status → ErroCrm; caixaDaThread 404 vira null; mensagens não carregam o token", async () => {
  const { t, chamadas } = fake([{ status: 200, json: { pipelines: [{ key: "p_1", name: "P", boxes: 2, updatedAt: 1 }] } }, { status: 403, json: { error: { message: `sem assinatura ${TOKEN}`, code: "crm_license" } } }, { status: 404, json: { error: { message: "conversa sem box" } } }, { status: 409, json: { error: { message: "já está", box: { key: "b_1", name: "X" } } } }, { status: 502, json: { erro: "host fora" } }, new Error(`rede ${TOKEN}`)]);
  const api = criarApi(t);
  assert.deepEqual(await api.pipelines(), [{ key: "p_1", name: "P", boxes: 2, updatedAt: 1 }]);
  assert.equal(chamadas[0].caminho, "/pipelines");
  await assert.rejects(api.status(), (e) => e instanceof ErroCrm && e.tipo === "assinatura" && e.status === 403);
  assert.equal(await api.caixaDaThread("1a1544925ace5958"), null);
  assert.equal(chamadas[2].caminho, "/threads/1a1544925ace5958");
  await assert.rejects(api.vincularThread("b_2", { threadGmailId: "1a1544925ace5958" }), (e) => e instanceof ErroCrm && e.tipo === "conflito" && e.extra.key === "b_1");
  await assert.rejects(api.status(), (e) => e instanceof ErroCrm && e.tipo === "host-fora");
  await assert.rejects(api.status(), (e) => e instanceof ErroCrm && e.tipo === "proxy-fora");
  // A mensagem de erro vem do host como está (o host nunca manda o token); a extensão não acrescenta nada.
  await assert.rejects(criarApi(async () => { throw new Error("falhou"); }).status(), (e) => !String(e.message).includes(TOKEN));
  await assert.rejects(api.pipeline("../x"), /caminho inválido/);
  assert.equal(chamadas.length, 6);
});
test("transporteAuto: relay primeiro; worker sem resposta ou status 0 → direto por 60 s", async () => {
  let agora = 1_000_000; const usados = [];
  const relay = async () => { usados.push("relay"); return { status: 0, json: { erro: "fetch falhou no worker" } }; };
  const direto = async () => { usados.push("direto"); return { status: 200, json: { ok: true } }; };
  const t = transporteAuto(relay, direto, () => agora);
  assert.deepEqual(await t({ metodo: "GET", caminho: "/status" }), { status: 200, json: { ok: true } });
  assert.deepEqual(usados, ["relay", "direto"]);
  await t({ metodo: "GET", caminho: "/status" }); assert.deepEqual(usados, ["relay", "direto", "direto"], "dentro dos 60 s não tenta o relay");
  agora += 61_000; await t({ metodo: "GET", caminho: "/status" }); assert.equal(usados.at(-2), "relay", "depois volta a tentar o relay");
  const t2 = transporteAuto(async () => { throw new ErroCrm("proxy-fora", "sem worker"); }, direto, () => agora);
  assert.equal((await t2({ metodo: "GET", caminho: "/x" })).status, 200, "relay lançando também cai no direto");
  const t3 = transporteAuto(async () => ({ status: 200, json: 1 }), async () => { throw new Error("nunca"); }, () => agora);
  assert.equal((await t3({ metodo: "GET", caminho: "/x" })).json, 1, "relay ok não usa o direto");
});

test("transporteAuto: escrita que estourou o tempo no relay não é repetida pelo caminho direto", async () => {
  let diretas = 0;
  const t = transporteAuto(async () => { throw new ErroCrm("servidor", "demorou"); }, async () => { diretas++; return { status: 200, json: {} }; }, () => 0);
  await assert.rejects(t({ metodo: "POST", caminho: "/boxes/bx01/resumo" }), /demorou/);
  assert.equal(diretas, 0);
});
