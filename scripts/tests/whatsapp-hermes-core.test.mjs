import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chatsFromHermes, threadFromHermes, hermesPeerOfKey, isHermesKey, HERMES_LIST_PY, HERMES_THREAD_PY, HERMES_SELF_SH } = createRequire(import.meta.url)("../../dist/main/whatsapp-hermes-core.js");

test("chaves do Hermes: contato pela chave dm; grupo e OpenClaw ficam de fora", () => {
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:dm:5522925501274"), "5522925501274");
  assert.equal(hermesPeerOfKey("agent:buffer:whatsapp:dm:+5521923670743"), "5521923670743");
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:group:120363410341886851@g.us:5521923670743"), null);
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:direct:+5521923670743"), null, "chave do OpenClaw");
  assert.equal(isHermesKey("agent:main:whatsapp:dm:5522925501274"), true);
  assert.equal(isHermesKey("agent:main:whatsapp:group:1203@g.us:55"), true);
  assert.equal(isHermesKey("agent:main:main"), false);
});

test("chatsFromHermes: uma conversa por contato, nome do display_name, próprio aparelho marcado, escondidas fora", () => {
  const list = { sessions: [
    { id: "20261024_175234_c37905b9", key: "agent:main:whatsapp:dm:5522925501274", name: "LV Lingerie", count: 21, started: 1792875154.8, last: 1792875611.9, archived: 0, hidden: 0 },
    { id: "20260908_061142_f8ec422a", key: "agent:main:whatsapp:dm:5516992294486", name: "L Santos", count: 217, started: 1789274383.7, last: 1789282125.5, archived: 0, hidden: 0 },
    { id: "20261013_135847_960a2e85", key: "agent:main:whatsapp:group:120363410341886851@g.us:5521923670743", name: "120363410341886851", started: 1791910727.4, last: null, hidden: 0 },
    { id: "20260101_000000_deadbeef", key: "agent:main:whatsapp:dm:5521983985713", name: "140029540204660@lid", started: 1791891091.3, last: null, hidden: 0 },
    { id: "20260102_000000_cafebabe", key: "agent:main:whatsapp:dm:5521936182339", name: "René", started: 1788850344.5, last: 1789260110.6, hidden: 1 },
    "lixo", { id: 3, key: "agent:main:whatsapp:dm:5500000000" },
  ] };
  const chats = chatsFromHermes(list, "5516992294486:36@s.whatsapp.net", new Map([["5521983985713", "Daniel"]]));
  assert.deepEqual(chats.map((c) => c.number), ["5522925501274", "5521983985713", "5516992294486"], "mais recente primeiro; grupo e escondida fora");
  const lv = chats[0];
  assert.equal(lv.name, "LV Lingerie"); assert.equal(lv.isSelf, false); assert.equal(lv.ownSession, true); assert.equal(lv.paused, false);
  assert.deepEqual(lv.sessionKeys, ["agent:main:whatsapp:dm:5522925501274"]); assert.deepEqual(lv.sessionIds, { "agent:main:whatsapp:dm:5522925501274": "20261024_175234_c37905b9" });
  assert.equal(lv.updatedAt, new Date(1792875611.9 * 1000).toISOString());
  assert.equal(chats[1].name, "Daniel", "id @lid não é nome: vale o cache do main");
  assert.equal(chats[2].isSelf, true);
  assert.deepEqual(chatsFromHermes(null, null), []);
});

test("threadFromHermes: contato e agente em ordem; ferramentas, vazias, NO_REPLY e hidden ficam de fora", () => {
  const t = threadFromHermes({ messages: [
    { sid: "a", role: "user", content: "Oi", ts: 1788847765.4, kind: null },
    { sid: "a", role: "assistant", content: "Oi, Diego! Como posso ajudar?", ts: 1788847779.6, kind: null },
    { sid: "a", role: "session_meta", content: null, ts: 1788847779.7, kind: null },
    { sid: "a", role: "assistant", content: "", ts: 1788847780, kind: null },
    { sid: "a", role: "assistant", content: "NO_REPLY", ts: 1788847781, kind: null },
    { sid: "a", role: "assistant", content: "aviso interno", ts: 1788847782, kind: "internal_notification" },
    { sid: "a", role: "user", content: "escondida", ts: 1788847783, kind: "hidden" },
    { sid: "a", role: "assistant", content: ".", ts: 1788847790, kind: null },
    { sid: "a", role: "user", content: "Oi", ts: 1788847765.4, kind: null },
  ] });
  assert.deepEqual(t.map((m) => [m.role, m.text]), [["contact", "Oi"], ["agent", "Oi, Diego! Como posso ajudar?"], ["agent", "."]]);
  assert.equal(t[0].at, new Date(1788847765.4 * 1000).toISOString());
  assert.deepEqual(threadFromHermes({}), []);
});

test("os programas remotos leem o state.db só em leitura e saem em uma linha", () => {
  for (const py of [HERMES_LIST_PY, HERMES_THREAD_PY]) { assert.match(py, /mode=ro/); assert.match(py, /json\.dumps/); assert.match(py, /~\/\.hermes\/state\.db/); }
  assert.match(HERMES_THREAD_PY, /role in \(\?, \?\)/); assert.match(HERMES_LIST_PY, /source = \? and chat_type = \?/);
  assert.match(HERMES_SELF_SH, /\.hermes\/whatsapp\/session\/creds\.json/);
});
