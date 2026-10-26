import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chatsFromSessions, threadFor, peerOfSessionKey, grupoToMarkdown, SAFE_KEY } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");

// Formato real do OpenClaw 2026.9.9 (sessions.list / chat.history), números trocados.
const SELF = "+5521900000001";
const ANA = "+5516900000002";
const BIA = "+5511900000003";
const wa = (id) => ({ identity: { type: "observation", pluginId: "whatsapp", accountId: "default", senderKind: "unknown", id } });
const list = {
  sessions: [
    { key: "agent:main:main", updatedAt: 1000, participants: [wa(SELF), wa(ANA)], kind: "direct" },
    { key: `agent:main:whatsapp:default:direct:${ANA}`, updatedAt: 5000, participants: [wa(ANA)], kind: "direct", sessionId: "5e6c65a1-1385-42a6-ac5c-065d3366f3e2" },
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
  // UUID da sessão por chave (para "Copiar ID"); sessão sem sessionId não entra.
  assert.deepEqual(ana.sessionIds, { [`agent:main:whatsapp:default:direct:${ANA}`]: "5e6c65a1-1385-42a6-ac5c-065d3366f3e2" });
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
  const { whatsappContextNote, CONTEXT_MAX_CHARS } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
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

test("limpar: separa as sessões do contato da principal; lê o resultado de cada reset", () => {
  const { ownSessionKeys, gatewayFailures } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
  const ana = chatsFromSessions(list, SELF).find((c) => c.number === ANA.slice(1));
  assert.deepEqual(ownSessionKeys(ANA, ana.sessionKeys), [`agent:main:whatsapp:default:direct:${ANA}`]);
  assert.deepEqual(ownSessionKeys(ANA, ["agent:main:main"]), []);
  const k = `agent:main:whatsapp:default:direct:${ANA}`;
  const ok = (key) => `R\t${key}\t${JSON.stringify({ ok: true, key })}`;
  assert.deepEqual(gatewayFailures(`${ok(k)}\n${ok("agent:main:main")}\n`, [k, "agent:main:main"]), []);
  assert.deepEqual(gatewayFailures(`${ok(k)}\nR\tagent:main:main\t\n`, [k, "agent:main:main"]), ["agent:main:main"]);
  assert.deepEqual(gatewayFailures("lixo", [k]), [k]);
});

test("exportar: Markdown com contato, máquina, período, dias e falas", () => {
  const { threadToMarkdown } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
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

test("chave por contato sem a conta (formato do OpenClaw 2026.9.9) também vale", () => {
  assert.equal(peerOfSessionKey("agent:main:whatsapp:direct:+5521900000004"), "5521900000004");
  const { ownSessionKeys } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
  assert.deepEqual(ownSessionKeys("+5521900000004", ["agent:main:main", "agent:main:whatsapp:direct:+5521900000004"]), ["agent:main:whatsapp:direct:+5521900000004"]);
});

test("rascunho interno do claude-cli (ferramentas, textos de meio de turno) não aparece nem vira [mídia]", () => {
  const key = "agent:main:whatsapp:direct:+5521900000004";
  const cli = (content, ts, extra = {}) => ({ role: "assistant", content, timestamp: ts, ...extra });
  const history = { messages: [
    user("+5521900000004", "Bia", "Sim", 1),
    cli([{ type: "toolcall", name: "Read", arguments: {} }], 2, { stopReason: "tool_use", __openclaw: { importedFrom: "claude-cli" } }),
    { role: "user", content: [{ type: "tool_result", content: "x" }], timestamp: 3, __openclaw: { importedFrom: "claude-cli" } },
    cli([{ type: "text", text: "No recommendations, removing the file." }], 4, { stopReason: "tool_use", __openclaw: { importedFrom: "claude-cli" } }),
    cli([{ type: "text", text: "Pronto! (rascunho final do CLI)" }], 5, { stopReason: "end_turn", __openclaw: { importedFrom: "claude-cli" } }),
    cli([{ type: "text", text: "Pronto! Agora eu sou a Nunu." }], 6, { stopReason: "stop", __openclaw: { importedFrom: "claude-cli", runId: "r1" } }),
    cli([{ type: "image", url: "x" }], 7, { stopReason: "stop" }),
  ] };
  const t = threadFor("5521900000004", [{ sessionKey: key, history }]);
  assert.deepEqual(t.messages.map((m) => [m.role, m.text]), [["contact", "Sim"], ["agent", "Pronto! Agora eu sou a Nunu."], ["agent", "[mídia]"]]);
});

test("resposta em voz (ferramenta tts do OpenClaw) aparece como fala do agente com 🎙️, mesmo com tool_use e sem runId", () => {
  const key = "agent:main:whatsapp:direct:+5516992294486";
  const cli = (content, ts, extra = {}) => ({ role: "assistant", content, timestamp: ts, ...extra });
  const meta = { stopReason: "tool_use", __openclaw: { importedFrom: "claude-cli", cliSessionId: "c1" } };
  const history = { messages: [
    user("+5516992294486", "Agentes Grok", "Eu decidi vou usar o kommo crm", 1),
    cli([
      { type: "toolcall", id: "t1", name: "mcp__openclaw__tts", caller: { type: "direct" }, arguments: { text: "Boa decisão, faz sentido ficar no Kommo.", channel: "whatsapp" } },
      { tool_use_id: "t1", type: "tool_result", content: [{ type: "text", text: "(spoken) Boa decisão, faz sentido ficar no Kommo." }] },
    ], 2, meta),
    user("+5516992294486", "Agentes Grok", "Sim", 3),
    // chamada de tts sem o "(spoken)" de volta: não saiu áudio; continua rascunho
    cli([{ type: "toolcall", id: "t2", name: "mcp__openclaw__tts", arguments: { text: "falha" } }, { tool_use_id: "t2", type: "tool_result", content: [{ type: "text", text: "Error: tts unavailable" }] }], 4, meta),
  ] };
  const t = threadFor("5516992294486", [{ sessionKey: key, history }]);
  assert.deepEqual(t.messages.map((m) => [m.role, m.text]), [["contact", "Eu decidi vou usar o kommo crm"], ["agent", "🎙️ Boa decisão, faz sentido ficar no Kommo."], ["contact", "Sim"]]);
});

test("pausa: envio negado na sessão do contato marca paused; a principal não conta", () => {
  const P = "+5521900000005";
  const sessions = { sessions: [
    { key: "agent:main:main", updatedAt: 1, participants: [wa(ANA), wa(P)], sendPolicy: "deny" },
    { key: `agent:main:whatsapp:direct:${P}`, updatedAt: 2, participants: [wa(P)], sendPolicy: "deny" },
  ] };
  const chats = chatsFromSessions(sessions, SELF);
  const p = chats.find((c) => c.number === P.slice(1));
  const ana = chats.find((c) => c.number === ANA.slice(1));
  assert.equal(p.paused, true); assert.equal(p.ownSession, true);
  assert.equal(ana.paused, false); assert.equal(ana.ownSession, false);
});

test("trava do dono: só o número pareado sem restrição; o resto sem gravar, editar nem rodar comandos", () => {
  const { ownerLockSh, NON_OWNER_DENY } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp.js");
  const sh = ownerLockSh("5521900000001");
  const lock = JSON.parse(/'(\{.*\})'/.exec(sh)[1]);
  assert.equal(lock["*"].deny.includes("navegador__abrir"), true); // o Navegador do dono nunca vale para "*"
  const { DESCONHECIDO_DENY } = createRequire(import.meta.url)("../../dist/main/navegador/navegador-whatsapp-core.js");
  assert.deepEqual(lock["*"].deny.filter((t) => !t.startsWith("navegador__")), [...NON_OWNER_DENY, ...DESCONHECIDO_DENY]); // desconhecido: nem ler, nem sessões, nem mensagem a terceiros
  assert.deepEqual(lock["e164:+5521900000001"], {});
  for (const t of ["write", "edit", "exec"]) assert.ok(NON_OWNER_DENY.includes(t));
  assert.match(sh, /\*unset\*\|\*apply_patch\*\)/, "só grava se vazio ou já for a do meu-bot");
});

test("chatsFromSessions: pausado pela lista durável conta mesmo sem a marca na sessão (depois de limpar)", () => {
  const { chatsFromSessions } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
  const list = { sessions: [{ key: "agent:main:whatsapp:direct:+554384114172", updatedAt: 1 }, { key: "agent:main:whatsapp:direct:+5516900000009", updatedAt: 2 }] };
  const chats = chatsFromSessions(list, null, new Map(), new Set(["554384114172"]));
  assert.equal(chats.find((c) => c.number === "554384114172").paused, true);
  assert.equal(chats.find((c) => c.number === "5516900000009").paused, false);
});

test("política gravada: open sem \"*\" é erro (descartaria tudo); a leitura vem da linha POLICY/ALLOW", () => {
  const { politicaGravada, politicaNaoBate } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-chats.js");
  const g = politicaGravada('Updated…\nPOLICY=open ALLOW=[]\n');
  assert.deepEqual(g, { dmPolicy: "open", allowFrom: [] });
  assert.match(politicaNaoBate("open", g), /descartadas/);
  assert.equal(politicaNaoBate("open", { dmPolicy: "open", allowFrom: ["*"] }), null);
  assert.equal(politicaNaoBate("self", { dmPolicy: "allowlist", allowFrom: ["+5521900000001"] }), null);
  assert.match(politicaNaoBate("list", { dmPolicy: "open", allowFrom: ["*"] }), /open/);
  assert.equal(politicaGravada("nada"), null);
});

test("sessão de grupo não entra na conversa de quem fala nela (Limpar histórico do contato não zera o grupo)", () => {
  const G = "120363000000000001@g.us";
  const l = { sessions: [
    { key: `agent:main:whatsapp:direct:${ANA}`, updatedAt: 5000, participants: [wa(ANA)] },
    { key: `agent:main:whatsapp:group:${G}`, chatType: "group", updatedAt: 9000, participants: [wa(ANA), wa(BIA)] },
  ] };
  const chats = chatsFromSessions(l, SELF);
  assert.deepEqual(chats.map((c) => c.number), [ANA.slice(1)]);
  assert.deepEqual(chats[0].sessionKeys, [`agent:main:whatsapp:direct:${ANA}`]);
});

test("grupoToMarkdown: identifica quem falou, lista os autores e separa por dia", () => {
  const msgs = [
    { role: "contact", text: "bom dia", at: "2026-10-21T12:00:00.000Z", autor: "Junior" },
    { role: "agent", text: "bom dia!", at: "2026-10-21T12:00:30.000Z" },
    { role: "contact", text: "e ai", at: "2026-10-22T15:00:00.000Z", autor: "+595994402904" },
  ];
  const md = grupoToMarkdown("(LV) - agente", "120363430052001678@g.us", "agente-box-lv", msgs, "2026-10-23T23:00:00.000Z");
  assert.match(md, /^# WhatsApp \(grupo\): \(LV\) - agente/);
  assert.match(md, /- Grupo: \(LV\) - agente \(120363430052001678@g\.us\)/);
  assert.match(md, /- Mensagens: 3/);
  // Autores: so quem nao e o agente, sem repetir.
  assert.match(md, /- Quem falou: Junior, \+595994402904/);
  assert.ok(md.includes("**Junior**") && md.includes("**Agente**") && md.includes("**+595994402904**"));
  // Dois dias distintos viram dois cabecalhos.
  assert.equal((md.match(/^## /gm) || []).length, 2);
});

test("grupoToMarkdown: sem mensagens nao inventa periodo nem autores", () => {
  const md = grupoToMarkdown("Vazio", "120363430052001678@g.us", "h", [], "2026-10-23T23:00:00.000Z");
  assert.match(md, /- Mensagens: 0/);
  assert.ok(!md.includes("Periodo:") && !md.includes("Período:"));
  assert.ok(!md.includes("Quem falou:"));
});

test("SAFE_KEY aceita chave de grupo (@g.us) e de contato, e barra o que quebraria o script remoto", () => {
  // Regressão: sem o "@" no conjunto, toda sessão de grupo era descartada e o app dizia
  // "o agente ainda não tem histórico neste grupo" mesmo com conversa gravada na máquina.
  assert.ok(SAFE_KEY.test("agent:main:whatsapp:group:120363431072131264@g.us"));
  assert.ok(SAFE_KEY.test("agent:main:whatsapp:direct:+595994402904"));
  assert.ok(SAFE_KEY.test("agent:main:main"));
  // As chaves vão dentro de aspas simples num JSON de --params: nada disso pode passar.
  const ruins = ["a'b", 'a"b', "a b", "a;rm -rf /", "a$(id)", "a`id`", "a|b", "a\nb", "a\\b", "a/b", ""];
  for (const r of ruins) assert.ok(!SAFE_KEY.test(r), `devia barrar: ${JSON.stringify(r)}`);
  assert.ok(!SAFE_KEY.test("a".repeat(201)));
});
