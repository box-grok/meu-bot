import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { CLOUD_STATUS_SH, cloudApiStatus, politicaCloud } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-cloud-core.js");

const kvDe = (out) => new Map(out.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

test("status (shell real num HOME de mentira): nunca imprime o valor do token nem do App Secret", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-cloud-st-"));
  fs.mkdirSync(path.join(home, ".local/share/meu-bot/backend"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local/share/meu-bot/backend/server.js"), "// meu-bot/hello\n");
  fs.writeFileSync(path.join(home, ".local/share/meu-bot/backend/wa-cloud.js"), "");
  fs.mkdirSync(path.join(home, ".config/meu-bot"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config/meu-bot/wa-cloud.env"), "WA_TOKEN=EAAsupersecreto\nWA_APP_SECRET=appsecretoxyz\nWA_PHONE_NUMBER_ID=123456\nWA_DISPLAY_PHONE=+55 11 4000-0000\nWA_VERIFIED_NAME=Loja da Ana\nWA_CLOUD_PORT=8090\n");
  fs.writeFileSync(path.join(home, ".local/share/meu-bot/wa-cloud.json"), JSON.stringify({ politica: "list", dono: "+5511999990000", lista: ["+5521988887777"] }));
  const out = execFileSync("bash", ["-c", CLOUD_STATUS_SH], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  fs.rmSync(home, { recursive: true, force: true });
  assert.ok(!out.includes("EAAsupersecreto") && !out.includes("appsecretoxyz"), "segredo vazou no status");
  const kv = kvDe(out);
  assert.equal(kv.get("gateway"), "cloud-api"); assert.equal(kv.get("files"), "1"); assert.equal(kv.get("tok"), "1"); assert.equal(kv.get("secret"), "1");
  assert.equal(kv.get("phoneid"), "123456"); assert.equal(kv.get("porta"), "8090");
});

const kvBase = (extra = {}) => new Map(Object.entries({ gateway: "cloud-api", present: "1", files: "1", tok: "1", secret: "1", phoneid: "123", display: "+55 11 4000-0000", nome: "Loja", porta: "8090", svc: "active", health: '{"ok":true,"configurado":true}', st: '{"verificadoEm":"2026-10-28T00:00:00Z","ultimaMensagem":"2026-10-28T01:00:00Z"}', estado: '{"politica":"self","dono":"+5511999990000"}', ...extra }));

test("cloudApiStatus: conectado só com credenciais, receptor ativo e respondendo; o resto explica o que falta", () => {
  const ok = cloudApiStatus(kvBase());
  assert.equal(ok.connected, true); assert.equal(ok.ready, true); assert.equal(ok.number, "551140000000"); assert.equal(ok.detail, "conectado");
  assert.equal(ok.gateway, "cloud-api"); assert.equal(ok.dmPolicy, "allowlist"); assert.deepEqual(ok.allowFrom, []);
  assert.match(cloudApiStatus(kvBase({ tok: "0" })).detail, /falta conectar à Meta/);
  assert.equal(cloudApiStatus(kvBase({ tok: "0" })).connected, false);
  assert.match(cloudApiStatus(kvBase({ svc: "inactive" })).detail, /receptor está parado/);
  assert.match(cloudApiStatus(kvBase({ st: "{}" })).detail, /Meta ainda não confirmou/);
  assert.match(cloudApiStatus(kvBase({ st: '{"verificadoEm":"x","erro":"Graph API 401"}' })).detail, /último problema: Graph API 401/);
  const velho = cloudApiStatus(kvBase({ files: "0" }));
  assert.equal(velho.ready, false); assert.match(velho.missing, /backend .* antigo/);
  assert.ok(!ok.channelConfig.includes("EAA"), "a configuração mostrada não tem segredo");
});

test("politicaCloud: só eu, todo mundo e lista no contrato das outras telas; pausados continuam na lista", () => {
  assert.deepEqual(politicaCloud({ politica: "self", dono: "+5511999990000" }), { dmPolicy: "allowlist", allowFrom: [], dono: "5511999990000", pausados: [] });
  assert.deepEqual(politicaCloud({ politica: "open" }).allowFrom, ["*"]);
  assert.deepEqual(politicaCloud({ politica: "list", lista: ["+5521988887777"], pausados: ["5531977776666"] }).allowFrom, ["+5521988887777", "+5531977776666"]);
  assert.equal(politicaCloud({ politica: "estranho" }).dmPolicy, "allowlist", "inválido = só o dono");
});
