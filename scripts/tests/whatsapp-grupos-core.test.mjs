import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { JID_RE, groupOfSessionKey, gruposDaMaquina, patchGrupo, aplicarPatch, estadoDoGrupo, threadDoGrupo, normalizarQuem, quemAcionaDe } = createRequire(import.meta.url)("../../dist/main/whatsapp-grupos-core.js");

// Formato real do OpenClaw 2026.9.9 (box-lv, 21/10), números e jids trocados.
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const DONO = "+5511999998888";
const SELF = "5521900000001";
const wa = (id) => ({ identity: { pluginId: "whatsapp", id } });
const list = { sessions: [
  { key: `agent:main:whatsapp:group:${G1}`, subject: "Time de casa", displayName: "Time de casa", chatType: "group", updatedAt: 5000, participants: [wa(DONO)], sessionId: "abc-12345" },
  { key: "agent:main:whatsapp:direct:+5511900000003", updatedAt: 9000 },
] };
const cache = { atualizadoEm: "2026-10-21T02:00:00Z", conta: SELF, grupos: [
  { jid: G1, nome: "Time de casa", membros: 2, participantes: [{ jid: "x@lid", phone: "5511999998888@s.whatsapp.net" }, { jid: "5521900000001@s.whatsapp.net", phone: null }] },
  { jid: G2, nome: "Clientes VIP", membros: 6, participantes: [] },
  { jid: "lixo", nome: "?" },
] };
const ligado = { dmPolicy: "open", allowFrom: ["*"], groupPolicy: "allowlist", groups: { [G1]: { requireMention: true } }, groupAllowFrom: [DONO] };

test("jid de grupo e chave de sessão de grupo", () => {
  assert.ok(JID_RE.test(G1));
  assert.ok(JID_RE.test("5511999998888-1600000000@g.us"));
  for (const bad of ["5511999998888@s.whatsapp.net", "abc@g.us", "120363000000000001@g.us; rm -rf", ""]) assert.ok(!JID_RE.test(bad), bad);
  assert.equal(groupOfSessionKey(`agent:main:whatsapp:group:${G1}`), G1);
  assert.equal(groupOfSessionKey(`agent:main:whatsapp:default:group:${G1}`), G1);
  assert.equal(groupOfSessionKey("agent:main:whatsapp:direct:+5511999998888"), null);
});

test("junta sessão, config e cache; ligado primeiro; quem aciona sai do groupAllowFrom", () => {
  const r = gruposDaMaquina(list, ligado, cache, `${SELF}:1@s.whatsapp.net`);
  assert.deepEqual(r.grupos.map((g) => [g.jid, g.nome, g.membros, g.agente]), [[G1, "Time de casa", 2, "mencao"], [G2, "Clientes VIP", 6, "desligado"]]);
  assert.equal(r.grupos[0].sessionKey, `agent:main:whatsapp:group:${G1}`);
  assert.deepEqual(r.grupos[0].participantes, ["5511999998888", "5521900000001"]);
  assert.deepEqual(r.quemAciona, ["5511999998888"]);
  assert.equal(r.quemAcionaHerdado, false);
  assert.equal(r.todosAdmitidos, false);
  assert.equal(r.cacheEm, "2026-10-21T02:00:00Z");
  assert.equal(r.self, SELF);
});

test("sem cache, o nome vem da sessão; grupo só na config também aparece", () => {
  const r = gruposDaMaquina(list, { ...ligado, groups: { [G1]: { requireMention: false }, [G2]: {} } }, null);
  assert.deepEqual(r.grupos.map((g) => [g.nome, g.agente]), [["Time de casa", "sempre"], [null, "mencao"]]);
  assert.equal(r.cacheEm, null);
});

test("armadilhas: groups vazio ou '*' com a política ligada admite todos; sem groupAllowFrom herda o allowFrom ['*']", () => {
  const r = gruposDaMaquina(list, { groupPolicy: "allowlist", allowFrom: ["*"] }, cache);
  assert.equal(r.todosAdmitidos, true);
  assert.ok(r.grupos.every((g) => g.agente === "mencao"));
  assert.equal(r.quemAciona, "todos");
  assert.equal(r.quemAcionaHerdado, true);
  assert.equal(gruposDaMaquina(list, { groupPolicy: "allowlist", groups: { "*": {} }, groupAllowFrom: [DONO] }, cache).todosAdmitidos, true);
  assert.equal(gruposDaMaquina(list, { groupPolicy: "disabled" }, cache).todosAdmitidos, false);
  assert.equal(quemAcionaDe({ groupPolicy: "open", groupAllowFrom: [DONO] }).quem, "todos");
});

test("ligar: allowlist + groups[jid]; sem quem acionar recusa; com a lista grava só o dono", () => {
  assert.throws(() => patchGrupo({ dmPolicy: "open", allowFrom: ["*"] }, G2, { agente: "mencao" }), /quem pode conversar/);
  const p = patchGrupo({ dmPolicy: "open", allowFrom: ["*"], groupPolicy: "disabled" }, G2, { agente: "mencao", quemAciona: [DONO] }, SELF);
  assert.deepEqual(p, { channels: { whatsapp: { groups: { [G2]: { requireMention: true } }, groupPolicy: "allowlist", groupAllowFrom: [DONO] } } });
  // Já com lista própria: ligar outro grupo só acrescenta o grupo.
  assert.deepEqual(patchGrupo(ligado, G2, { agente: "sempre" }), { channels: { whatsapp: { groups: { [G2]: { requireMention: false } } } } });
  // Mesmo estado: nada a gravar.
  assert.equal(patchGrupo(ligado, G1, { agente: "mencao" }), null);
});

test("desligar o último grupo fecha o canal de grupos (groups vazio admitiria todos)", () => {
  assert.deepEqual(patchGrupo(ligado, G1, { agente: "desligado" }), { channels: { whatsapp: { groups: null, groupPolicy: "disabled" } } });
  const dois = { ...ligado, groups: { [G1]: { requireMention: true }, [G2]: { requireMention: true } } };
  assert.deepEqual(patchGrupo(dois, G1, { agente: "desligado" }), { channels: { whatsapp: { groups: { [G1]: null } } } });
  // Admitido só por groups vazio: desligar fecha tudo.
  assert.deepEqual(patchGrupo({ groupPolicy: "allowlist" }, G1, { agente: "desligado" }), { channels: { whatsapp: { groups: null, groupPolicy: "disabled" } } });
  assert.equal(patchGrupo({ groupPolicy: "disabled" }, G1, { agente: "desligado" }), null);
});

test("quem aciona: nunca vazio, nunca '*', sem o próprio agente; 'todos' é groupPolicy open", () => {
  assert.throws(() => patchGrupo(ligado, G1, { quemAciona: [] }), /pelo menos uma/);
  assert.throws(() => patchGrupo(ligado, G1, { quemAciona: ["*"] }), /todos do grupo/);
  assert.throws(() => patchGrupo(ligado, G1, { quemAciona: ["123"] }), /número inválido/);
  assert.throws(() => patchGrupo(ligado, G1, { quemAciona: [`+${SELF}`] }, SELF), /pelo menos uma/);
  assert.deepEqual(normalizarQuem(["+55 (11) 99999-8888", "5511999998888", `+${SELF}`], SELF), ["5511999998888"]);
  assert.deepEqual(patchGrupo(ligado, G1, { quemAciona: [DONO, "+5511988887777"] }), { channels: { whatsapp: { groupAllowFrom: [DONO, "+5511988887777"] } } });
  assert.equal(patchGrupo(ligado, G1, { quemAciona: [DONO] }), null);
  assert.deepEqual(patchGrupo(ligado, G1, { quemAciona: "todos" }), { channels: { whatsapp: { groupPolicy: "open" } } });
  // Voltar de "todos" para a lista: allowlist de novo.
  assert.deepEqual(patchGrupo({ ...ligado, groupPolicy: "open" }, G1, { quemAciona: [DONO] }), { channels: { whatsapp: { groupPolicy: "allowlist" } } });
  assert.throws(() => patchGrupo(ligado, G1, { agente: "desligado", quemAciona: "todos" }), /agente ligado/);
  assert.throws(() => patchGrupo(ligado, "abc@g.us", { agente: "mencao" }), /grupo inválido/);
});

test("conferência: aplicar o patch dá o estado pedido", () => {
  const base = { dmPolicy: "open", allowFrom: ["*"], groupPolicy: "disabled" };
  const depois = aplicarPatch(base, patchGrupo(base, G2, { agente: "mencao", quemAciona: [DONO] }));
  assert.equal(estadoDoGrupo(depois, G2), "mencao|5511999998888||allowlist");
  assert.equal(depois.dmPolicy, "open");
  const fechado = aplicarPatch(ligado, patchGrupo(ligado, G1, { agente: "desligado" }));
  assert.equal(fechado.groups, undefined);
  assert.equal(estadoDoGrupo(fechado, G1).split("|")[0], "desligado");
});

test("conversa do grupo: autor pelo cache de nomes; senderName com o nome do grupo não vale; rascunho e NO_REPLY fora", () => {
  const user = (sender, name, content, ts) => ({ role: "user", content, timestamp: ts, __openclaw: { senderId: sender, senderName: name } });
  const history = { messages: [
    user(DONO, "Time de casa", "@agente oi", 1000),
    user("+5511988887777", "Bia", "bom dia", 1500),
    { role: "user", content: "aviso do sistema", timestamp: 1600, __openclaw: {} },
    { role: "assistant", content: [{ type: "text", text: "rascunho" }], timestamp: 1700, __openclaw: { importedFrom: "claude-cli" } },
    { role: "assistant", content: "NO_REPLY", timestamp: 1800, __openclaw: { runId: "r1" } },
    { role: "assistant", content: "Oi, estou aqui. Em que posso ajudar?", timestamp: 2000, __openclaw: { runId: "r2" } },
  ] };
  const t = threadDoGrupo(history, new Map([["5511999998888", "Lucas"]]), "Time de casa");
  assert.deepEqual(t.map((m) => [m.role, m.autor ?? null, m.text]), [
    ["contact", "Lucas", "@agente oi"], ["contact", "Bia", "bom dia"], ["agent", null, "Oi, estou aqui. Em que posso ajudar?"],
  ]);
  assert.equal(threadDoGrupo({ messages: [user(DONO, "Time de casa", "x", 1)] }, new Map(), "Time de casa")[0].autor, DONO);
});

test("banco do OpenClaw: UUID e .jsonl para o ID da aba; vale mesmo sem sessions.list (gateway ocupado)", () => {
  const banco = { [`agent:main:whatsapp:group:${G1}`]: { sessionId: "22bb9aae-56c4-46de-8a2c-34dcdb3bcc26", jsonl: "~/.claude/projects/-home-x--openclaw-workspace/e23e862d-7ca3-44bb-bd84-fcb0feab8721.jsonl", subject: "Time de casa", updatedAt: 7000, respondeu: true },
    [`agent:main:whatsapp:group:${G2}`]: { sessionId: "x; rm -rf", jsonl: "/etc/passwd", subject: "VIP", updatedAt: 1 } };
  const r = gruposDaMaquina({ ok: false }, ligado, null, null, banco);
  const g1 = r.grupos.find((g) => g.jid === G1);
  assert.equal(g1.sessionKey, `agent:main:whatsapp:group:${G1}`);
  assert.equal(g1.sessionId, "22bb9aae-56c4-46de-8a2c-34dcdb3bcc26");
  assert.match(g1.transcript, /e23e862d-7ca3-44bb-bd84-fcb0feab8721\.jsonl$/);
  assert.equal(g1.nome, "Time de casa");
  assert.equal(g1.agenteRespondeu, true); // o tutorial 12 sabe na mesma leitura, sem esperar a conversa do grupo
  const g2 = r.grupos.find((g) => g.jid === G2);
  assert.equal(g2.sessionId, null); // valores estranhos não passam
  assert.equal(g2.transcript, null);
  assert.equal(g2.nome, "VIP");
  assert.equal(g2.agenteRespondeu, false);
});

test("sem o channels.whatsapp (máquina sem OpenClaw, como a do Hermes, ou leitura falha): nunca \"todos admitidos\"", async () => {
  const { gruposDaMaquina } = await import("../../dist/main/whatsapp-grupos-core.js");
  assert.equal(gruposDaMaquina({ sessions: [] }, null, null).todosAdmitidos, false);
  assert.equal(gruposDaMaquina({ sessions: [] }, undefined, null).todosAdmitidos, false);
  assert.equal(gruposDaMaquina({ sessions: [] }, {}, null).todosAdmitidos, true, "configuração lida e vazia continua sendo o alerta real");
});
