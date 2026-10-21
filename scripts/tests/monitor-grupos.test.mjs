import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// monitor.py da skill whatsapp-grupos contra um banco do OpenClaw de exemplo (mesmo esquema do 2026.9.9), só leitura.
const MONITOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend-colima/skills/whatsapp-grupos/scripts/monitor.py");
const JID = "120363000000000001@g.us";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-"));
  const dir = path.join(home, ".openclaw/agents/main/agent");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(home, ".local/share/meu-bot"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local/share/meu-bot/whatsapp-lista.json"), JSON.stringify({ archived: {}, deleted: {}, names: { "5511999998888": { name: "Lucas", alias: null, at: "x" } } }));
  const ev = (seq, message) => [seq, JSON.stringify({ type: "message", id: `e${seq}`, timestamp: "2026-10-21T03:20:00.000Z", message })];
  const rows = [
    ev(1, { role: "user", content: "@agente oi", timestamp: 1792552800000, __openclaw: { senderId: "+5511999998888", senderName: "Time de casa" } }),
    ev(2, { role: "assistant", content: [{ type: "toolcall", name: "Bash", arguments: {} }], stopReason: "tool_use" }),
    ev(3, { role: "assistant", content: [{ type: "text", text: "Oi, estou aqui." }], stopReason: "stop", __openclaw: { runId: "r1" } }),
    ev(4, { role: "user", content: "bom dia", timestamp: 1792552900000, __openclaw: { senderId: "+5511988887777", senderName: "Time de casa" } }),
    ev(5, { role: "assistant", content: "NO_REPLY", stopReason: "stop", __openclaw: { runId: "r2" } }),
  ];
  const py = `
import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
c.execute("create table session_nodes(session_key text, current_session_id text, entry_json text)")
c.execute("create table transcript_events(session_id text, seq integer, event_json text, created_at integer, event_zstd blob)")
c.execute("insert into session_nodes values(?,?,?)",("agent:main:whatsapp:group:${JID}","s1",json.dumps({"subject":"Time de casa"})))
c.execute("insert into session_nodes values(?,?,?)",("agent:main:whatsapp:direct:+5511999998888","s2","{}"))
for seq,js in json.loads(sys.argv[2]): c.execute("insert into transcript_events values('s1',?,?,0,null)",(seq,js))
c.commit()`;
  execFileSync("python3", ["-c", py, path.join(dir, "openclaw-agent.sqlite"), JSON.stringify(rows)]);
  return home;
}
const run = (home, ...args) => execFileSync("python3", ["-I", MONITOR, ...args, "--uma-vez", "--sem-journal"], { env: { ...process.env, HOME: home }, encoding: "utf8" });

test("monitor: alvo pelo nome (assunto da sessão), autor pelo cache de nomes, rascunho e NO_REPLY fora", () => {
  const home = fixture();
  const out = run(home, "time de", "--ultimas", "10");
  const linhas = out.trim().split("\n");
  assert.match(linhas[0], /Time de casa \(120363000000000001@g\.us\)/);
  assert.match(linhas[1], /👤 Lucas \(\+5511999998888\): @agente oi/);
  assert.match(linhas[2], /🤖 agente: Oi, estou aqui\./);
  assert.match(linhas[3], /👤 \+5511988887777: bom dia/);
  assert.equal(linhas.length, 4);
  // --verbose mostra o interno; --so-humanos tira o agente; --json uma linha por evento.
  assert.match(run(home, JID, "--ultimas", "10", "--verbose"), /NO_REPLY/);
  assert.doesNotMatch(run(home, JID, "--ultimas", "10", "--so-humanos"), /🤖/);
  const js = run(home, JID, "--ultimas", "1", "--json").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(js, [{ em: js[0].em, tipo: "pessoa", autor: "+5511988887777", numero: "5511988887777", texto: "bom dia" }]);
  // Telefone vira a conversa direta; o banco nunca é alterado (aberto só leitura).
  assert.match(run(home, "+5511999998888"), /agent:main:whatsapp:direct:\+5511999998888/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("monitor: alvo que não casa com nada sai com erro, sem tocar no banco", () => {
  const home = fixture();
  assert.throws(() => run(home, "nenhum grupo assim"), /nenhum grupo casa/);
  fs.rmSync(home, { recursive: true, force: true });
});
