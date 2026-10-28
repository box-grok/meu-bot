import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const w = createRequire(import.meta.url)("../../backend-colima/wa-cloud-core.js");

test("webhook GET: só devolve o desafio com modo subscribe e o verify token certo", () => {
  const q = { "hub.mode": "subscribe", "hub.verify_token": "segredo-123", "hub.challenge": "42" };
  assert.equal(w.verificarDesafio(q, "segredo-123"), "42");
  assert.equal(w.verificarDesafio({ ...q, "hub.verify_token": "outro" }, "segredo-123"), null);
  assert.equal(w.verificarDesafio({ ...q, "hub.mode": "unsubscribe" }, "segredo-123"), null);
  assert.equal(w.verificarDesafio(q, ""), null, "sem verify token configurado ninguém passa");
});

test("assinatura: HMAC-SHA256 do corpo BRUTO com o App Secret; reserializar o JSON não passa", () => {
  const bruto = Buffer.from('{"entry": [ {"id":"1"} ],"x":"\\u00e9"}', "utf8");
  const sig = `sha256=${crypto.createHmac("sha256", "app-secret").update(bruto).digest("hex")}`;
  assert.equal(w.assinaturaOk(bruto, sig, "app-secret"), true);
  assert.equal(w.assinaturaOk(bruto, sig.toUpperCase().replace("SHA256=", "sha256="), "app-secret"), true, "hex maiúsculo vale");
  assert.equal(w.assinaturaOk(Buffer.from(JSON.stringify(JSON.parse(bruto.toString()))), sig, "app-secret"), false);
  assert.equal(w.assinaturaOk(bruto, sig, "outro-secret"), false);
  assert.equal(w.assinaturaOk(bruto, "sha1=abc", "app-secret"), false);
  assert.equal(w.assinaturaOk(bruto, undefined, "app-secret"), false);
  assert.equal(w.assinaturaOk(bruto, sig, ""), false);
});

const corpo = (mensagens, phoneNumberId = "PNID") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: "5511999990000", profile: { name: "Ana" } }], messages: mensagens } }] }],
});

test("lerMensagens: texto, botão, interativo e mídia normalizados; status e outro número ignorados", () => {
  const ms = w.lerMensagens(corpo([
    { from: "5511999990000", id: "wamid.1", timestamp: "1730000000", type: "text", text: { body: "oi" } },
    { from: "5511999990000", id: "wamid.2", timestamp: "1730000001", type: "audio", audio: { id: "MID", mime_type: "audio/ogg; codecs=opus" } },
    { from: "5511999990000", id: "wamid.3", timestamp: "1730000002", type: "interactive", interactive: { button_reply: { title: "Sim" } } },
    { from: "abc", id: "wamid.4", type: "text", text: { body: "x" } },
  ]), "PNID");
  assert.deepEqual(ms.map((m) => [m.id, m.de, m.nome, m.tipo, m.texto]), [["wamid.1", "+5511999990000", "Ana", "text", "oi"], ["wamid.2", "+5511999990000", "Ana", "audio", ""], ["wamid.3", "+5511999990000", "Ana", "interactive", "Sim"]]);
  assert.equal(ms[1].midiaId, "MID");
  assert.equal(ms[0].em, new Date(1730000000 * 1000).toISOString());
  assert.deepEqual(w.lerMensagens(corpo([{ from: "5511999990000", id: "x", type: "text", text: { body: "oi" } }]), "OUTRO"), []);
  const status = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, statuses: [{ id: "wamid.1", status: "read" }] } }] }] };
  assert.deepEqual(w.lerMensagens(status, "PNID"), []);
  assert.deepEqual(w.lerMensagens(null, "PNID"), []);
});

test("duplicatas: o mesmo id só passa uma vez e a memória é limitada", () => {
  const d = w.criarDuplicatas(2);
  assert.equal(d.novo("a"), true); assert.equal(d.novo("a"), false);
  d.novo("b"); d.novo("c");
  assert.equal(d.novo("a"), true, "o mais antigo saiu da memória");
});

test("política: só o dono, todo mundo ou lista; pausado vence; estado inválido cai no mais fechado", () => {
  const e = w.lerEstado({ politica: "self", dono: "55 11 99999-0000", lista: ["+5521988887777", "lixo"], pausados: [] });
  assert.deepEqual(e, { politica: "self", dono: "+5511999990000", lista: ["+5521988887777"], pausados: [] });
  assert.deepEqual(w.decidir("+5511999990000", e), { acao: "responder", papel: "dono" });
  assert.equal(w.decidir("+5521988887777", e).acao, "ignorar");
  assert.deepEqual(w.decidir("+5521988887777", { ...e, politica: "list" }), { acao: "responder", papel: "cliente" });
  assert.deepEqual(w.decidir("+5531977776666", { ...e, politica: "open" }), { acao: "responder", papel: "cliente" });
  assert.deepEqual(w.decidir("+5511999990000", { ...e, pausados: ["+5511999990000"] }), { acao: "ignorar", motivo: "pausado" });
  assert.equal(w.lerEstado({ politica: "qualquer" }).politica, "self");
  assert.equal(w.decidir("+5511999990000", w.lerEstado({})).acao, "ignorar", "sem dono definido, 'só o dono' não responde ninguém");
});

test("envio: texto em partes de até 4096, número sem '+', e marcar como lido", () => {
  const longo = `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`;
  assert.deepEqual(w.partes(longo).map((p) => p.length), [3000, 3000]);
  assert.ok(w.partes("x".repeat(9000)).every((p) => p.length <= w.TEXTO_MAX));
  assert.deepEqual(w.partes("   "), []);
  const e = w.envioTexto("PNID", "+5511999990000", "oi");
  assert.equal(e.url, `https://graph.facebook.com/${w.GRAPH_VERSAO}/PNID/messages`);
  assert.deepEqual(e.corpo, { messaging_product: "whatsapp", recipient_type: "individual", to: "5511999990000", type: "text", text: { preview_url: false, body: "oi" } });
  assert.deepEqual(w.envioLido("PNID", "wamid.1").corpo, { messaging_product: "whatsapp", status: "read", message_id: "wamid.1" });
  assert.match(w.textoParaAgente({ texto: "", tipo: "audio", midiaId: "M" }), /áudio/);
  assert.equal(w.textoParaAgente({ texto: "", tipo: "location" }), "");
});
