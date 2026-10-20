import test from "node:test";
import assert from "node:assert/strict";
import { SilenceTracker, buildPrompt, confirmIndex, isConfirm, isDirectWhatsapp, isReject, lastTimestamp, mergeEstado, normalizePhone, ownerCommand, ownerMessage, parseCrmJson, phoneOfSessionKey, threadFromHistory } from "../../backend-colima/crm/regras.mjs";

test("chave de sessão → telefone; só diretas do WhatsApp", () => {
  assert.equal(phoneOfSessionKey("agent:main:whatsapp:direct:+595994402904"), "+595994402904");
  assert.equal(phoneOfSessionKey("agent:main:whatsapp:conta2:direct:5511999"), "+5511999");
  assert.equal(phoneOfSessionKey("agent:main:main"), null);
  assert.equal(isDirectWhatsapp("agent:main:whatsapp:direct:+1"), true);
  assert.equal(isDirectWhatsapp("agent:main:telegram:direct:+1"), false);
  assert.equal(normalizePhone("5521923670743:19@s.whatsapp.net"), "+5521923670743");
  assert.equal(normalizePhone(""), null);
});

test("comandos do dono: anota no CRM / crm:, confirmações e descartes", () => {
  assert.equal(ownerCommand("Anota no CRM: Junior fechou o Kommo"), "Junior fechou o Kommo");
  assert.equal(ownerCommand("crm Junior quer reunião terça"), "Junior quer reunião terça");
  assert.equal(ownerCommand("anotar no crm"), "");
  assert.equal(ownerCommand("bom dia"), null);
  assert.equal(isConfirm("ok"), true); assert.equal(isConfirm("OK crm!"), true); assert.equal(isConfirm("ok 2"), false);
  assert.equal(confirmIndex("ok 2"), 2); assert.equal(confirmIndex("ok"), null);
  assert.equal(isReject("não"), true); assert.equal(isReject("nao crm"), true); assert.equal(isReject("não sei"), false);
});

test("SilenceTracker: vence depois do silêncio e esquece; serializa", () => {
  const t = new SilenceTracker({ a: 1000 });
  t.touch("b", 5000);
  assert.deepEqual(t.due(5000 + 10 * 60_000 - 1, 10 * 60_000), ["a"]);
  assert.deepEqual(t.due(5000 + 10 * 60_000, 10 * 60_000), ["b"]);
  assert.deepEqual(t.due(10 ** 12), []);
  t.touch("c", 1); assert.deepEqual(t.toJSON(), { c: 1 });
});

test("threadFromHistory: só depois da marca, papéis e texto das partes; avisos fora", () => {
  const h = { messages: [
    { role: "system", content: [{ type: "text", text: "Reset" }], timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "Oi" }], timestamp: 10 },
    { role: "assistant", content: "Olá!", timestamp: 20 },
    { role: "user", content: "Nota do meu-bot: pausa encerrada", timestamp: 30 },
    { role: "assistant", content: "NO_REPLY", timestamp: 35 },
    { role: "user", content: [{ type: "text", text: "Fechei o Kommo" }], timestamp: 40 },
  ] };
  const all = threadFromHistory(h, 0);
  assert.deepEqual(all.map((m) => [m.role, m.text]), [["contato", "Oi"], ["agente", "Olá!"], ["contato", "Fechei o Kommo"]]);
  assert.deepEqual(threadFromHistory(h, 20).map((m) => m.text), ["Fechei o Kommo"]);
  assert.equal(lastTimestamp(all), 40);
  assert.deepEqual(threadFromHistory({}, 0), []);
});

test("parseCrmJson: bloco válido, ações permitidas, limites; lixo vira null", () => {
  const txt = "Fiz isso.\n```crm-json\n{\"aplicado\":[\"comentei\"],\"propostas\":[{\"acao\":\"box-update\",\"args\":[\"k\",\"--stage\",\"Acordo\"],\"texto\":\"mover\"},{\"acao\":\"rm -rf\",\"args\":[],\"texto\":\"x\"}],\"resumo\":\"ok\"}\n```";
  const p = parseCrmJson(txt);
  assert.deepEqual(p.aplicado, ["comentei"]);
  assert.equal(p.propostas.length, 1); assert.equal(p.propostas[0].acao, "box-update");
  assert.equal(parseCrmJson("sem bloco"), null);
  assert.equal(parseCrmJson("```crm-json\n{nope\n```"), null);
});

test("ownerMessage: resumo, aplicados e propostas numeradas com instrução", () => {
  const m = ownerMessage("Junior", { aplicado: ["comentário: fechou o Kommo"], propostas: [{ acao: "box-update", args: [], texto: "mover para Acordo" }], resumo: "Fechou o Kommo." });
  assert.match(m, /📇 CRM · Junior/); assert.match(m, /✓ comentário/); assert.match(m, /1\. mover para Acordo/); assert.match(m, /"ok"/);
  const m2 = ownerMessage("Junior", { aplicado: [], propostas: [{ acao: "comment", args: [], texto: "a" }, { acao: "comment", args: [], texto: "b" }], resumo: "" });
  assert.match(m2, /ok 2/);
});

test("buildPrompt: traz etapas, campos, conversa, pedido do dono e o contrato crm-json", () => {
  const p = buildPrompt({ phone: "+595994402904", contactName: "Junior", pipeline: { name: "Parceiros", stages: [{ name: "Prospecção" }], fields: [{ name: "Origem", type: "DROPDOWN", options: ["Redes sociais", "Indicação"] }] }, delta: [{ role: "contato", at: 1792280349869, text: "Isso é o futuro" }], command: "anota que fechou", allowCreate: false, streakCli: "node /x/streak.mjs", knownBox: { name: "Junior Rezende", key: "k1", stage: "Prospecção" } });
  assert.match(p, /Junior \(\+595994402904\)/); assert.match(p, /- Prospecção/); assert.match(p, /Origem \[DROPDOWN\]: Redes sociais \| Indicação/);
  assert.match(p, /Isso é o futuro/); assert.match(p, /Pedido do dono agora: "anota que fechou"/); assert.match(p, /NÃO faça; proponha/); assert.match(p, /```crm-json/);
  assert.match(buildPrompt({ phone: "+1", contactName: null, pipeline: null, delta: [], command: null, allowCreate: true, streakCli: "s", knownBox: null }), /pode fazer sozinho quando a conversa justificar/);
});

test("mergeEstado: por telefone, sem perder o resto", () => {
  const e = mergeEstado({ "+1": { marca: 5 }, ultimaProposta: "+1" }, "+1", { propostas: [] });
  assert.deepEqual(e, { "+1": { marca: 5, propostas: [] }, ultimaProposta: "+1" });
  assert.deepEqual(mergeEstado(null, "+2", { marca: 1 }), { "+2": { marca: 1 } });
});

test("recuperarDesde: número que estava sem caixa e ganhou caixa relê 7 dias; o resto segue a marca", async () => {
  const { recuperarDesde, JANELA_RECUPERAR_MS } = await import("../../backend-colima/crm/regras.mjs");
  const agora = 1_800_000_000_000;
  assert.equal(recuperarDesde({ marca: agora - 1000, semBox: true }, true, agora), agora - JANELA_RECUPERAR_MS);
  assert.equal(recuperarDesde({ marca: agora - 1000, semBox: true }, false, agora), agora - 1000);
  assert.equal(recuperarDesde({ marca: agora - 1000 }, true, agora), agora - 1000);
  assert.equal(recuperarDesde({ marca: agora - 30 * 86_400_000, semBox: true }, true, agora), agora - 30 * 86_400_000);
  assert.equal(recuperarDesde({}, true, agora), 0);
});

test("crm-job.mjs sobe (sem erro de inicialização) e, sem licença, só registra no log", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "crm-job-"));
  try {
    execFileSync(process.execPath, [new URL("../../backend-colima/crm/crm-job.mjs", import.meta.url).pathname], { env: { ...process.env, HOME: home }, stdio: "pipe" });
    assert.match(readFileSync(join(home, ".local/share/meu-bot/crm/crm.log"), "utf8"), /sem plano pro\/personalizado/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("parseCrmJson lê resumoConversa (opcional)", async () => {
  const { parseCrmJson } = await import("../../backend-colima/crm/regras.mjs");
  assert.equal(parseCrmJson('```crm-json\n{"aplicado":[],"propostas":[],"resumo":"r","resumoConversa":"tudo"}\n```').resumoConversa, "tudo");
  assert.equal(parseCrmJson('```crm-json\n{"aplicado":[],"propostas":[],"resumo":"r"}\n```').resumoConversa, "");
});

test("deveInjetarContexto: só conversa direta do WhatsApp com quem não é o dono", async () => {
  const { deveInjetarContexto } = await import("../../backend-colima/crm/regras.mjs");
  const dono = "+5521923670743";
  assert.equal(deveInjetarContexto({ channelId: "whatsapp", sessionKey: "agent:main:whatsapp:direct:+5511988698139" }, dono), "+5511988698139");
  assert.equal(deveInjetarContexto({ sessionKey: "agent:main:whatsapp:direct:+5511988698139" }, dono), "+5511988698139");
  assert.equal(deveInjetarContexto({ channelId: "whatsapp", sessionKey: `agent:main:whatsapp:direct:${dono}` }, dono), null);
  assert.equal(deveInjetarContexto({ channelId: "whatsapp", sessionKey: "agent:main:whatsapp:group:123@g.us" }, dono), null);
  assert.equal(deveInjetarContexto({ channel: "telegram", sessionKey: "agent:main:whatsapp:direct:+5511988698139" }, dono), null);
  // como o OpenClaw manda de verdade nos hooks do agente: channelId = id da conversa
  assert.equal(deveInjetarContexto({ channelId: "5511988698139@s.whatsapp.net", channel: "whatsapp", messageProvider: "whatsapp", sessionKey: "agent:main:whatsapp:direct:+5511988698139" }, dono), "+5511988698139");
  assert.equal(deveInjetarContexto({}, dono), null);
});

test("plugin: before_prompt_build busca o contexto no backend, põe em prependContext e usa cache; backend fora → nada", async () => {
  const http = await import("node:http"); const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  let pedidos = 0; let resposta = { texto: "Contexto interno do CRM: caixa X" };
  const srv = http.createServer((req, res) => { pedidos++; assert.match(req.url, /^\/v1\/crm\/contexto\?phone=%2B5511988698139$/); assert.equal(req.headers.authorization, "Bearer chave-teste"); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(resposta)); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const d = mkdtempSync(join(tmpdir(), "crm-plugin-")); const env = join(d, ".env");
  writeFileSync(env, `OPENAI_COMPAT_KEY=chave-teste\nPORT=${srv.address().port}\nHOST=127.0.0.1\n`);
  process.env.MEU_BOT_BACKEND_ENV = env;
  try {
    const plugin = (await import(`../../backend-colima/crm/index.js?t=${Date.now()}`)).default;
    const hooks = {}; const logs = [];
    plugin.register({ logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) }, pluginConfig: {}, on: (nome, fn) => { hooks[nome] = fn; } });
    const ctx = { channelId: "whatsapp", sessionKey: "agent:main:whatsapp:direct:+5511988698139" };
    assert.deepEqual(await hooks.before_prompt_build({}, ctx), { prependContext: "Contexto interno do CRM: caixa X" });
    await hooks.before_prompt_build({}, ctx); assert.equal(pedidos, 1); // cache
    assert.equal(await hooks.before_prompt_build({}, { channelId: "whatsapp", sessionKey: "agent:main:whatsapp:group:1@g.us" }), undefined);
    assert.ok(logs.some((l) => /contexto CRM para \+5511988698139/.test(l)));
    srv.close(); writeFileSync(env, "OPENAI_COMPAT_KEY=chave-teste\nPORT=1\nHOST=127.0.0.1\n");
    const plugin2 = (await import(`../../backend-colima/crm/index.js?t=${Date.now()}b`)).default; const h2 = {};
    plugin2.register({ logger: { info() {}, warn() {} }, pluginConfig: {}, on: (n, fn) => { h2[n] = fn; } });
    assert.equal(await h2.before_prompt_build({}, ctx), undefined);
  } finally { delete process.env.MEU_BOT_BACKEND_ENV; srv.close(); rmSync(d, { recursive: true, force: true }); }
});

test("avisoDevido: no máximo um aviso a cada 24 h", async () => {
  const { avisoDevido } = await import("../../backend-colima/crm/regras.mjs");
  const t = 1_800_000_000_000;
  assert.equal(avisoDevido(undefined, t), true); assert.equal(avisoDevido(t - 3_600_000, t), false); assert.equal(avisoDevido(t - 25 * 3_600_000, t), true);
});

test("contatos do WhatsApp: mesclar guarda nome e datas; número inválido/teste fica fora; nome do histórico", async () => {
  const { mesclarContatoWhatsapp, nomeDoHistorico } = await import("../../backend-colima/crm/regras.mjs");
  let l = mesclarContatoWhatsapp({}, { telefone: "+5511988698139", em: 100 });
  l = mesclarContatoWhatsapp(l, { telefone: "5511988698139", nome: "Manager Martins", em: 300 });
  l = mesclarContatoWhatsapp(l, { telefone: "+5511988698139", nome: "+55 11 98869", em: 200 });
  assert.deepEqual(l, { "+5511988698139": { nome: "Manager Martins", primeiraEm: 100, ultimaEm: 300 } });
  assert.deepEqual(mesclarContatoWhatsapp({}, { telefone: "+5500000000001" }), {});
  assert.deepEqual(mesclarContatoWhatsapp({}, { telefone: "123" }), {});
  assert.equal(nomeDoHistorico({ messages: [{ role: "assistant" }, { role: "user", __openclaw: { senderName: "Manager Martins" } }] }), "Manager Martins");
  assert.equal(nomeDoHistorico({ messages: [{ role: "user", __openclaw: { senderName: "+55 11 9" } }] }), "");
});

test("classificação: prompt leva pipelines/exemplos/mensagens; resposta só vale com key existente e confiança alta", async () => {
  const { promptClassificacao, parseClassificacao } = await import("../../backend-colima/crm/regras.mjs");
  const p = promptClassificacao({ pipelines: [{ key: "p_carro", name: "Aluguel de Carro - Assunção", stages: ["Proposta", "Fechado"], exemplos: ["VIALIX Renta Car"] }], nome: "Rent a Car Py", telefone: "+595981000000", mensagens: [{ papel: "contato", texto: "Hola, alquilamos autos" }] });
  assert.match(p, /key=p_carro/); assert.match(p, /VIALIX Renta Car/); assert.match(p, /alquilamos autos/); assert.match(p, /Rent a Car Py/);
  assert.deepEqual(parseClassificacao('ok {"pipeline":"p_carro","confianca":0.92,"motivo":"é locadora","nome":"Rent a Car - WM"}', ["p_carro"]), { key: "p_carro", confianca: 0.92, motivo: "é locadora", nome: "Rent a Car - WM" });
  assert.equal(parseClassificacao('{"pipeline":"p_carro","confianca":0.5}', ["p_carro"]), null);
  assert.equal(parseClassificacao('{"pipeline":"p_inventado","confianca":0.99}', ["p_carro"]), null);
  assert.equal(parseClassificacao('{"pipeline":null,"confianca":0.9}', ["p_carro"]), null);
  assert.equal(parseClassificacao("sem json", ["p_carro"]), null);
});
