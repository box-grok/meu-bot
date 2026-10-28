import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// O serviço lê HOME e os arquivos na carga: tudo num HOME temporário, com a Graph API e o backend simulados no fetch.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-cloud-"));
const backendDir = path.join(home, "backend");
const meuBot = path.join(home, ".local", "share", "meu-bot");
fs.mkdirSync(path.join(home, ".config", "meu-bot"), { recursive: true });
fs.mkdirSync(backendDir, { recursive: true });
fs.mkdirSync(meuBot, { recursive: true });
fs.writeFileSync(path.join(home, ".config", "meu-bot", "wa-cloud.env"), "WA_TOKEN=tok\nWA_APP_SECRET=sec\nWA_VERIFY_TOKEN=ver\nWA_PHONE_NUMBER_ID=PNID\nWA_WABA_ID=WABA\n");
fs.writeFileSync(path.join(backendDir, ".env"), "PORT=8099\nWA_CLOUD_KEY=chave-wa\n");
const licenca = (plan, status) => fs.writeFileSync(path.join(meuBot, "licenca.json"), JSON.stringify({ plan, status }));
const estado = (v) => fs.writeFileSync(path.join(meuBot, "wa-cloud.json"), JSON.stringify(v));
licenca("pro", "active");
process.env.HOME = home;
process.env.WA_CLOUD_BACKEND_DIR = backendDir;

const chamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://graph.facebook.com/") || u.startsWith("http://127.0.0.1:8099/")) {
    const corpo = JSON.parse(init.body);
    chamadas.push({ url: u, headers: init.headers, corpo });
    if (u.startsWith("http://127.0.0.1:8099/")) return new Response(JSON.stringify({ choices: [{ message: { content: `eco: ${corpo.messages.at(-1).content}` } }] }), { status: 200 });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${chamadas.length}` }] }), { status: 200 });
  }
  return fetchOriginal(url, init);
};
const { servidor } = createRequire(import.meta.url)("../../backend-colima/wa-cloud.js");
let base = "";
before(async () => { await new Promise((r) => servidor.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${servidor.address().port}`; });
after(() => { servidor.close(); globalThis.fetch = fetchOriginal; fs.rmSync(home, { recursive: true, force: true }); });

const msg = (from, id, body) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, contacts: [{ wa_id: from, profile: { name: "Ana" } }], messages: [{ from, id, timestamp: "1730000000", type: "text", text: { body } }] } }] }] });
async function postar(corpo, segredo = "sec") {
  const bruto = Buffer.from(JSON.stringify(corpo));
  const sig = `sha256=${crypto.createHmac("sha256", segredo).update(bruto).digest("hex")}`;
  return fetchOriginal(`${base}/webhook`, { method: "POST", headers: { "X-Hub-Signature-256": sig, "Content-Type": "application/json" }, body: bruto });
}
const esperar = async (cond, ms = 3000) => { const fim = Date.now() + ms; while (!cond()) { if (Date.now() > fim) throw new Error("tempo esgotado"); await new Promise((r) => setTimeout(r, 20)); } };
const enviadas = () => chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.corpo.type === "text");

test("GET de verificação e rotas: só /webhook e /health existem", async () => {
  assert.equal(await (await fetchOriginal(`${base}/webhook?hub.mode=subscribe&hub.verify_token=ver&hub.challenge=777`)).text(), "777");
  assert.equal((await fetchOriginal(`${base}/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 403);
  assert.equal((await fetchOriginal(`${base}/v1/chat/completions`)).status, 404);
  assert.deepEqual(await (await fetchOriginal(`${base}/health`)).json(), { ok: true, configurado: true });
});

test("assinatura errada: 401 e nada chega ao agente", async () => {
  const antes = chamadas.length;
  assert.equal((await postar(msg("5511999990000", "wamid.bad", "oi"), "outro")).status, 401);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(chamadas.length, antes);
});

test("dono escreve: o agente responde pelo modelo 'whatsapp', com a chave do wa-cloud, e o histórico guarda os dois lados", async () => {
  estado({ politica: "self", dono: "+5511999990000" });
  assert.equal((await postar(msg("5511999990000", "wamid.d1", "oi agente"))).status, 200);
  await esperar(() => enviadas().some((c) => c.corpo.text.body === "eco: oi agente"));
  const ag = chamadas.find((c) => c.url.startsWith("http://127.0.0.1:8099/"));
  assert.equal(ag.corpo.model, "whatsapp");
  assert.equal(ag.headers.Authorization, "Bearer chave-wa");
  assert.equal(ag.headers["X-Conversation-Id"], "wa-5511999990000");
  assert.equal(ag.headers["X-Conversation-Seen"], "0");
  const env = enviadas().find((c) => c.corpo.text.body === "eco: oi agente");
  assert.equal(env.corpo.to, "5511999990000");
  assert.equal(env.headers.Authorization, "Bearer tok");
  const hist = fs.readFileSync(path.join(meuBot, "wa-cloud", "5511999990000.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(hist.map((h) => [h.quem, h.texto]), [["pessoa", "oi agente"], ["agente", "eco: oi agente"]]);
  // Reenvio da Meta (mesmo id): não responde de novo.
  const n = enviadas().length;
  await postar(msg("5511999990000", "wamid.d1", "oi agente"));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(enviadas().length, n);
});

test("cliente com 'responde todo mundo': modelo 'whatsapp-cliente'; com 'só eu', ignorado; sem Pro, ninguém", async () => {
  estado({ politica: "open", dono: "+5511999990000" });
  await postar(msg("5521988887777", "wamid.c1", "quanto custa?"));
  await esperar(() => enviadas().some((c) => c.corpo.to === "5521988887777"));
  assert.equal(chamadas.filter((c) => c.url.startsWith("http://127.0.0.1:8099/")).at(-1).corpo.model, "whatsapp-cliente");
  estado({ politica: "self", dono: "+5511999990000" });
  const n = chamadas.length;
  await postar(msg("5521988887777", "wamid.c2", "alô?"));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(chamadas.length, n, "fora da política: nem o agente nem a Graph API");
  licenca("free", "free");
  await postar(msg("5511999990000", "wamid.d2", "e agora?"));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(chamadas.length, n, "sem Pro em vigor: não responde");
  assert.match(JSON.parse(fs.readFileSync(path.join(meuBot, "wa-cloud-status.json"), "utf8")).erro, /Pro/);
  licenca("pro", "active");
});
