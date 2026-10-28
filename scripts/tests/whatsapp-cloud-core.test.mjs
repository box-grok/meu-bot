import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { CLOUD_STATUS_SH, cloudApiStatus, politicaCloud, validarCredenciais, envSetSh, envUnsetSh, estadoPatchSh, lerInstalacao, CLOUD_LIST_PY, chatsFromCloud, cloudThreadSh, threadFromCloud, cloudLimparSh, cloudPausarSh, isCloudKey } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-cloud-core.js");

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

const CRED = { token: "EAAG" + "x".repeat(40), phoneNumberId: "123456789012345", wabaId: "987654321098765", appSecret: "0123456789abcdef0123456789abcdef", dono: "+55 (11) 99999-0000" };

test("validarCredenciais: formatos da Meta e o dono com DDI; mensagens dizem onde achar cada um", () => {
  const ok = validarCredenciais(CRED);
  assert.equal(ok.ok, true); assert.equal(ok.c.dono, "5511999990000");
  assert.match(validarCredenciais({ ...CRED, token: "curto" }).erro, /Usuários do sistema/);
  assert.match(validarCredenciais({ ...CRED, phoneNumberId: "12a" }).erro, /ID do número/);
  assert.match(validarCredenciais({ ...CRED, appSecret: "x".repeat(32) }).erro, /App Secret/);
  assert.match(validarCredenciais({ ...CRED, dono: "9999" }).erro, /DDI e DDD/);
  assert.equal(validarCredenciais(null).ok, false);
});

test("envSetSh/envUnsetSh/estadoPatchSh (python real): 0600, mantém as outras chaves, recusa chave estranha", { skip: execFileSync("bash", ["-c", "command -v python3 || true"], { encoding: "utf8" }).trim() === "" ? "sem python3" : false }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-cloud-env-"));
  const env = path.join(home, ".config/meu-bot/wa-cloud.env");
  fs.mkdirSync(path.dirname(env), { recursive: true });
  fs.writeFileSync(env, "WA_VERIFY_TOKEN=abc\nWA_CLOUD_PORT=8090\nWA_TOKEN=velho\n");
  const run = (sh) => execFileSync("bash", ["-c", sh], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  assert.match(run(envSetSh({ WA_TOKEN: "novo-token", WA_APP_SECRET: "seg" })), /ENV=ok/);
  assert.deepEqual(fs.readFileSync(env, "utf8").trim().split("\n").sort(), ["WA_APP_SECRET=seg", "WA_CLOUD_PORT=8090", "WA_TOKEN=novo-token", "WA_VERIFY_TOKEN=abc"]);
  assert.equal(fs.statSync(env).mode & 0o777, 0o600);
  run(envUnsetSh(["WA_TOKEN", "WA_APP_SECRET"]));
  assert.deepEqual(fs.readFileSync(env, "utf8").trim().split("\n").sort(), ["WA_CLOUD_PORT=8090", "WA_VERIFY_TOKEN=abc"]);
  run(estadoPatchSh({ dono: "+5511999990000" })); run(estadoPatchSh({ politica: "list", lista: ["+5521988887777"] }));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, ".local/share/meu-bot/wa-cloud.json"), "utf8")), { dono: "+5511999990000", politica: "list", lista: ["+5521988887777"] });
  assert.throws(() => envSetSh({ PATH: "/tmp" }), /chave inválida/);
  assert.throws(() => envSetSh({ WA_TOKEN: "a\nWA_APP_SECRET=b" }), /chave inválida/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("lerInstalacao: porta e verify token, ou o erro do instalador", () => {
  assert.deepEqual(lerInstalacao("…\nPORTA=8090\nVERIFY_TOKEN=0123456789abcdef0123\nWA_CLOUD=ok\n"), { ok: true, porta: 8090, verifyToken: "0123456789abcdef0123" });
  assert.deepEqual(lerInstalacao("ERRO=backend antigo, sem o receptor da API oficial: atualize o backend antes\n"), { ok: false, erro: "backend antigo, sem o receptor da API oficial: atualize o backend antes" });
  assert.equal(lerInstalacao("PORTA=8090\n").ok, false);
});

test("espelho da API oficial (shell/python reais): lista, conversa, pausar e limpar pelo histórico do receptor", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-cloud-esp-"));
  const hist = path.join(home, ".local/share/meu-bot/wa-cloud");
  fs.mkdirSync(hist, { recursive: true });
  const linhas = (xs) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
  fs.writeFileSync(path.join(hist, "5511999990000.jsonl"), linhas([{ em: "2026-10-28T10:00:00Z", quem: "pessoa", id: "a", nome: "Eu", tipo: "text", texto: "oi" }, { em: "2026-10-28T10:00:05Z", quem: "agente", id: "b", texto: "olá!" }]));
  fs.writeFileSync(path.join(hist, "5521988887777.jsonl"), linhas([{ em: "2026-10-28T11:00:00Z", quem: "pessoa", id: "c", nome: "Bia", tipo: "audio", texto: "", midiaId: "M" }, { em: "2026-10-28T11:00:00Z", quem: "pessoa", id: "c#desc", texto: "[a pessoa mandou um áudio…]" }]));
  fs.writeFileSync(path.join(hist, "lixo.jsonl"), "x\n");
  const run = (sh) => execFileSync("bash", ["-c", sh], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  const estado = { politica: "self", dono: "+5511999990000", pausados: ["+5521988887777"] };
  const chats = chatsFromCloud(JSON.parse(run(CLOUD_LIST_PY)), estado);
  assert.deepEqual(chats.map((c) => [c.number, c.name, c.isSelf, c.paused]), [["5521988887777", "Bia", false, true], ["5511999990000", "Eu", true, false]]);
  assert.deepEqual(chats[0].sessionKeys, ["wa-cloud:5521988887777"]); assert.ok(isCloudKey(chats[0].sessionKeys[0]));
  assert.equal(chats[0].sessionIds["wa-cloud:5521988887777"], "wa-5521988887777", "Copiar ID aponta para a conversa do backend");
  assert.deepEqual(threadFromCloud(run(cloudThreadSh("5521988887777", 50))), [{ role: "contact", text: "[audio]", at: "2026-10-28T11:00:00Z" }], "a descrição gerada para o agente não aparece");
  assert.deepEqual(threadFromCloud(run(cloudThreadSh("5511999990000", 1))).map((m) => m.text), ["olá!"], "limite = as últimas");
  run(cloudPausarSh("5511999990000", true)); run(cloudPausarSh("5511999990000", true));
  const e = JSON.parse(fs.readFileSync(path.join(home, ".local/share/meu-bot/wa-cloud.json"), "utf8"));
  assert.deepEqual(e.pausados, ["+5511999990000"], "pausar duas vezes não duplica");
  run(cloudPausarSh("5511999990000", false));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, ".local/share/meu-bot/wa-cloud.json"), "utf8")).pausados, []);
  assert.match(run(cloudLimparSh(["5521988887777"])), /LIMPO=ok/);
  assert.ok(!fs.existsSync(path.join(hist, "5521988887777.jsonl")) && fs.existsSync(path.join(hist, "5511999990000.jsonl")));
  assert.throws(() => cloudThreadSh("../etc", 1), /número inválido/);
  assert.throws(() => cloudLimparSh(["x"]), /não há histórico/);
  fs.rmSync(home, { recursive: true, force: true });
});
