import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chatsFromSessions, threadFor, peerOfSessionKey } = createRequire(import.meta.url)("../../dist/main/whatsapp-chats.js");

// Formato real do OpenClaw 2026.9.9 (sessions.list / chat.history), números trocados.
const SELF = "+5521900000001";
const ANA = "+5516900000002";
const BIA = "+5511900000003";
const wa = (id) => ({ identity: { type: "observation", pluginId: "whatsapp", accountId: "default", senderKind: "unknown", id } });
const list = {
  sessions: [
    { key: "agent:main:main", updatedAt: 1000, participants: [wa(SELF), wa(ANA)], kind: "direct" },
    { key: `agent:main:whatsapp:default:direct:${ANA}`, updatedAt: 5000, participants: [wa(ANA)], kind: "direct" },
    { key: `agent:main:whatsapp:default:direct:${BIA}`, updatedAt: 3000, participants: [wa(BIA)], kind: "direct" },
    { key: "agent:main:telegram:x", updatedAt: 9000, participants: [{ identity: { pluginId: "telegram", id: "123" } }] },
  ],
};
const user = (sender, name, content, ts) => ({ role: "user", content, timestamp: ts, __openclaw: { senderId: sender, senderName: name, transport: { channel: "whatsapp" } } });
const sys = (content, ts) => ({ role: "user", content, timestamp: ts, __openclaw: { importedFrom: "claude-cli" } });
const bot = (content, ts) => ({ role: "assistant", content, timestamp: ts, stopReason: "stop" });

test("chave por contato: extrai o número; principal e outros canais não", () => {
  assert.equal(peerOfSessionKey(`agent:main:whatsapp:default:direct:${ANA}`), "5516900000002");
  assert.equal(peerOfSessionKey("agent:main:main"), null);
  assert.equal(peerOfSessionKey("agent:main:telegram:x"), null);
});

test("lista: junta a sessão principal e a por contato no mesmo número, mais recente primeiro; ignora outros canais", () => {
  const chats = chatsFromSessions(list, SELF, new Map([["5516900000002", "Ana"]]));
  // O próprio número só na sessão principal fica de fora (lá ele aparece sem mensagens).
  assert.deepEqual(chats.map((c) => c.number), ["5516900000002", "5511900000003"]);
  const ana = chats[0];
  assert.equal(ana.name, "Ana");
  assert.deepEqual(ana.sessionKeys, ["agent:main:main", `agent:main:whatsapp:default:direct:${ANA}`]);
  assert.equal(ana.updatedAt, new Date(5000).toISOString());
  const withSelf = chatsFromSessions({ sessions: [{ key: `agent:main:whatsapp:default:direct:${SELF}`, updatedAt: 7000 }] }, SELF);
  assert.equal(withSelf[0].isSelf, true, "conversa consigo mesmo, em sessão própria, aparece marcada");
  assert.equal(chats.find((c) => c.number === "5511900000003").name, null);
});

test("lista vazia ou malformada não quebra", () => {
  assert.deepEqual(chatsFromSessions(null, null), []);
  assert.deepEqual(chatsFromSessions({ sessions: [null, { key: 1 }] }, null), []);
});

test("conversa na sessão principal: só a Ana e as respostas logo depois dela; sem avisos de sistema, NO_REPLY e tool_use vazio", () => {
  const main = { messages: [
    sys("System: WhatsApp gateway connected as +5521900000001.\nIf nothing needs attention, reply NO_REPLY.", 100),
    bot("NO_REPLY", 110),
    user(ANA, "Ana", "Oi", 200),
    bot("", 205),
    bot("Oi! Como posso ajudar?", 210),
    user(SELF, "Eu", "nota pra mim", 300),
    bot("Anotado.", 310),
    user(ANA, "Ana Paula", [{ type: "text", text: "Pode traduzir?" }], 400),
    bot([{ type: "text", text: "Claro:" }, { type: "text", text: "Hola" }], 410),
    sys("System: WhatsApp gateway disconnected (status 503)", 500),
    bot("resposta ao sistema", 510),
  ] };
  const t = threadFor("5516900000002", [{ sessionKey: "agent:main:main", history: main }]);
  assert.deepEqual(t.messages.map((m) => [m.role, m.text]), [
    ["contact", "Oi"], ["agent", "Oi! Como posso ajudar?"], ["contact", "Pode traduzir?"], ["agent", "Claro:\nHola"],
  ]);
  assert.equal(t.name, "Ana Paula");
  assert.equal(t.messages[0].at, new Date(200).toISOString());
});

test("principal + por contato: une em ordem de hora, sem repetir; mídia sem texto vira [mídia]", () => {
  const main = { messages: [user(ANA, "Ana", "antes do isolamento", 100), bot("ok", 110)] };
  const peer = { messages: [
    sys("System: heartbeat", 150),
    user(ANA, "Ana", "depois", 200),
    bot("certo", 210),
    user(ANA, "Ana", [{ type: "image", url: "x" }], 300),
    user(ANA, "Ana", "antes do isolamento", 100), // repetida: não duplica
  ] };
  const t = threadFor("5516900000002", [
    { sessionKey: `agent:main:whatsapp:default:direct:${ANA}`, history: peer },
    { sessionKey: "agent:main:main", history: main },
  ]);
  assert.deepEqual(t.messages.map((m) => m.text), ["antes do isolamento", "ok", "depois", "certo", "[mídia]"]);
});

test("whatsappContextNote: trecho rotulado, contato e agente, e corta as mais antigas", () => {
  const { whatsappContextNote, CONTEXT_MAX_CHARS } = createRequire(import.meta.url)("../../dist/main/whatsapp-chats.js");
  const msgs = [
    { role: "contact", text: "oi, traduz pra espanhol?", at: "2026-10-15T12:00:00.000Z" },
    { role: "agent", text: "¡Hola!", at: "2026-10-15T12:00:05.000Z" },
  ];
  const c = whatsappContextNote("Ana", "5516900000002", msgs);
  assert.equal(c.count, 2); assert.equal(c.omitted, 0);
  assert.match(c.note, /não é fala do usuário/);
  assert.match(c.note, /Ana \(\+5516900000002\)/);
  assert.match(c.note, /\] Ana: oi, traduz pra espanhol\?\n\[.*\] Agente: ¡Hola!\n--- fim do trecho ---$/);
  const big = Array.from({ length: 100 }, (_, i) => ({ role: "contact", text: `${i} ${"x".repeat(999)}`, at: "2026-10-15T12:00:00.000Z" }));
  const cut = whatsappContextNote("Ana", "5516900000002", big);
  assert.ok(cut.omitted > 0 && cut.count + cut.omitted === 100);
  assert.match(cut.note, new RegExp(`\\(${cut.omitted} mensagens anteriores omitidas\\)`));
  assert.match(cut.note, /Ana: 99 x/);
  assert.ok(cut.note.length < CONTEXT_MAX_CHARS + 1000);
  // Uma mensagem sozinha maior que o teto entra cortada, nunca some.
  const huge = whatsappContextNote("Ana", "5516900000002", [{ role: "contact", text: "y".repeat(CONTEXT_MAX_CHARS * 2), at: "" }]);
  assert.equal(huge.count, 1); assert.ok(huge.note.length < CONTEXT_MAX_CHARS + 1000);
});

test("apagar: só sessões do próprio contato; a principal nunca; deletable acompanha", () => {
  const { ownSessionKeys, deleteFailures } = createRequire(import.meta.url)("../../dist/main/whatsapp-chats.js");
  const chats = chatsFromSessions(list, SELF);
  const ana = chats.find((c) => c.number === ANA.slice(1));
  assert.equal(ana.deletable, true);
  assert.deepEqual(ownSessionKeys(ANA, ana.sessionKeys), [`agent:main:whatsapp:default:direct:${ANA}`]);
  const soPrincipal = chatsFromSessions({ sessions: [list.sessions[0]] }, SELF);
  assert.equal(soPrincipal[0].deletable, false);
  assert.deepEqual(ownSessionKeys(ANA, ["agent:main:main"]), []);
  const k = `agent:main:whatsapp:default:direct:${ANA}`;
  assert.deepEqual(deleteFailures(`aviso\n${JSON.stringify({ ok: true, results: [{ key: k, ok: true }] })}`, [k]), []);
  assert.deepEqual(deleteFailures(JSON.stringify({ ok: false, results: [{ key: k, ok: false, status: "not_found" }] }), [k]), [k]);
  assert.deepEqual(deleteFailures("lixo", [k]), [k]);
});

test("exportar: Markdown com contato, máquina, período, dias e falas", () => {
  const { threadToMarkdown } = createRequire(import.meta.url)("../../dist/main/whatsapp-chats.js");
  const md = threadToMarkdown("Ana", "5516900000002", "agente-box", [
    { role: "contact", text: "oi", at: "2026-10-14T15:00:00.000Z" },
    { role: "agent", text: "olá!", at: "2026-10-15T15:00:00.000Z" },
  ], "2026-10-15T16:00:00.000Z");
  assert.match(md, /^# WhatsApp: Ana\n/);
  assert.match(md, /- Contato: Ana \(\+5516900000002\)\n- Máquina: agente-box\n- Mensagens: 2\n- Período: /);
  assert.equal((md.match(/^## /gm) ?? []).length, 2);
  assert.match(md, /\*\*Ana\*\* · \d\d:\d\d\n\noi\n/);
  assert.match(md, /\*\*Agente\*\* · \d\d:\d\d\n\nolá!\n$/);
});
