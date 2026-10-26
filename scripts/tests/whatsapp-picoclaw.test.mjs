import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { picoclawStatus } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp.js");

/** O `chave=valor` que o STATUS_SCRIPT imprime numa máquina com PicoClaw (FlowBox-F1, Termux, 23 out). */
const kv = (over = {}) => new Map(Object.entries({
  gateway: "picoclaw", present: "1", bin: "/data/data/com.termux/files/usr/bin/picoclaw", ver: "picoclaw nightly-50-gbbf6893c",
  enabled: "1", type: "whatsapp_native", native: "1", selfchat: "1", allow: "108263945310425@lid,108263945310425", port: "18791",
  store: "1", channel: '{"enabled": true, "type": "whatsapp_native", "allow_from": ["108263945310425@lid"]}',
  me: "5516992294486:34@s.whatsapp.net", health: '{"status":"ok","uptime":"5m34s","pid":28925}', svc: "run: picoclaw: (pid 28925) 336s",
  ...over,
}));

test("picoclaw: pareado e gateway no ar = conectado, com número, só a dona e o bloco do canal", () => {
  const s = picoclawStatus(kv());
  assert.equal(s.gateway, "picoclaw");
  assert.equal(s.present, true);
  assert.equal(s.ready, true);
  assert.equal(s.connected, true);
  assert.equal(s.number, "5516992294486");
  assert.equal(s.dmPolicy, "allowlist");
  assert.deepEqual(s.allowFrom, ["108263945310425@lid", "108263945310425"]);
  assert.equal(s.agent, "PicoClaw nightly-50-gbbf6893c em /data/data/com.termux/files/usr/bin (só deste usuário)");
  assert.match(s.channelConfig, /"type": "whatsapp_native"/);
});

test("picoclaw: gateway parado ou fora do ar não é conectado, e diz o quê", () => {
  const parado = picoclawStatus(kv({ health: "", svc: "down: picoclaw: 12s" }));
  assert.equal(parado.connected, false);
  assert.equal(parado.state, "gateway parado");
  assert.match(parado.detail, /gateway parado/);
  const fora = picoclawStatus(kv({ health: "", svc: "" }));
  assert.equal(fora.state, "gateway fora do ar");
});

test("picoclaw: sem store.db é sem sessão (precisa parear), mesmo com o gateway no ar", () => {
  const s = picoclawStatus(kv({ store: "0", me: "" }));
  assert.equal(s.ready, true);
  assert.equal(s.connected, false);
  assert.equal(s.number, null);
  assert.equal(s.state, "sem sessão");
  assert.match(s.detail, /parear/);
});

test("picoclaw: canal desligado ou fora do modo nativo não está pronto e explica o que falta", () => {
  const off = picoclawStatus(kv({ enabled: "0" }));
  assert.equal(off.ready, false);
  assert.match(off.missing, /enabled/);
  const bridge = picoclawStatus(kv({ type: "whatsapp", native: "0" }));
  assert.equal(bridge.ready, false);
  assert.match(bridge.missing, /whatsapp_native/);
});

test("picoclaw: sem self_chat_only nem allow_from responde todo mundo", () => {
  const s = picoclawStatus(kv({ selfchat: "0", allow: "" }));
  assert.equal(s.dmPolicy, "open");
  assert.equal(s.allowFrom, undefined);
});
