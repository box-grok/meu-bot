import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("../../dist/main/support-code.js");

const HOSTKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOv9yqYd0Lr3Qk0eQ0g7cJm0kq4b8w3XHnS1fY0aZ1bC";
const ADMIN = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAdminAdminAdminAdminAdminAdminAdminAdminAd lucas@mac";
const code = { v: 1, name: "Bianca Alcântara", hostname: "203.0.113.7", user: "box", port: 22, hostKey: HOSTKEY, state: "on", at: "2026-10-16T12:00:00.000Z" };

test("código de suporte: ida e volta; alias estável pela máquina", () => {
  const txt = m.encodeSupportCode(code);
  assert.match(txt, /^MBS1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(m.decodeSupportCode(`  ${txt}\n`), { ok: true, code });
  assert.match(m.supportAlias(code), /^suporte-bianca-alcantara-[0-9a-f]{4}$/);
  assert.equal(m.supportAlias({ ...code, name: "Bia" }).slice(-4), m.supportAlias(code).slice(-4));
  assert.equal(m.machineId(HOSTKEY).length, 12);
});

test("código de suporte: recusa o que não é do formato (vem de fora)", () => {
  const enc = (o) => `MBS1.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
  for (const [bad, why] of [
    ["oi", /MBS1/], ["MBS1.@@@", /corrompido/], [enc([1]), /corrompido/],
    [enc({ ...code, v: 2 }), /versão/], [enc({ ...code, name: "" }), /nome/],
    [enc({ ...code, hostname: "-oProxyCommand=x" }), /endereço/], [enc({ ...code, hostname: "a b" }), /endereço/],
    [enc({ ...code, user: "root;rm" }), /usuário/], [enc({ ...code, port: 70000 }), /porta/],
    [enc({ ...code, hostKey: "ssh-ed25519 AAA\nHost x" }), /chave/], [enc({ ...code, state: "talvez" }), /estado/],
    [`MBS1.${"A".repeat(5000)}`, /grande/],
  ]) {
    const r = m.decodeSupportCode(bad);
    assert.equal(r.ok, false, bad.slice(0, 40)); assert.match(r.reason, why);
  }
});

test("authorized_keys: liga, religa sem duplicar, desliga sem tocar nas outras chaves", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-ak-"));
  mkdirSync(join(home, ".ssh"));
  const ak = join(home, ".ssh", "authorized_keys");
  writeFileSync(ak, "ssh-ed25519 AAAAdela bianca@mac\n");
  const run = (pub) => execFileSync("bash", ["-c", m.authorizedKeysScript(pub)], { env: { HOME: home, PATH: process.env.PATH } });
  run(ADMIN); run(ADMIN);
  const on = readFileSync(ak, "utf8").trim().split("\n");
  assert.equal(on.length, 2);
  assert.equal(on[1], `no-agent-forwarding,no-X11-forwarding ${ADMIN.split(" ").slice(0, 2).join(" ")} meu-bot-admin`);
  assert.equal((statSync(ak).mode & 0o777).toString(8), "600");
  run(null);
  assert.equal(readFileSync(ak, "utf8"), "ssh-ed25519 AAAAdela bianca@mac\n");
  assert.throws(() => m.authorizedKeysScript("não é chave"), /inválida/);
});

test("bloco do ~/.ssh/config e known_hosts do admin usam o alias", () => {
  const b = m.adminSshBlock(code, "~/.ssh/meu-bot-admin");
  assert.match(b, /^Host suporte-bianca-alcantara-[0-9a-f]{4}\n    HostName 203\.0\.113\.7\n    User box\n    Port 22\n    IdentityFile ~\/\.ssh\/meu-bot-admin\n    IdentitiesOnly yes\n    HostKeyAlias suporte-/);
  assert.equal(m.knownHostsLine(code), `${m.supportAlias(code)} ${HOSTKEY}`);
});

test("caixa de entrada: grava por máquina, substitui na reentrega, recusa lixo e enchente", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-inbox-"));
  const inbox = resolve("backend-colima/meu-bot-suporte-inbox");
  const send = (input) => spawnSync("sh", [inbox], { input, env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  const id = m.machineId(HOSTKEY);
  const txt = m.encodeSupportCode(code);
  assert.equal(send(`${id}\n${txt}\n`).status, 0);
  assert.equal(send(`${id}\n${m.encodeSupportCode({ ...code, state: "off" })}\n`).status, 0);
  const files = readdirSync(join(home, "suporte-inbox"));
  assert.deepEqual(files, [`${id}.code`]);
  assert.equal(m.decodeSupportCode(readFileSync(join(home, "suporte-inbox", files[0]), "utf8")).code.state, "off");
  assert.notEqual(send(`../../x\n${txt}\n`).status, 0, "id fora do formato");
  assert.notEqual(send(`${id}\nrm -rf /\n`).status, 0, "não é código");
  assert.notEqual(send(`${id}\nMBS1.${"A".repeat(5000)}\n`).status, 0, "grande demais");
  for (let i = 0; i < 25; i++) send(`${String(i).padStart(12, "0")}\n${txt}\n`);
  assert.equal(readdirSync(join(home, "suporte-inbox")).filter((f) => f.endsWith(".code")).length, 20, "caixa cheia em 20");
});

test("progresso nos tutoriais: aceita o formato e recusa o que não é", () => {
  const ok = { at: "2026-10-16T12:00:00.000Z", tour: "done", tutorials: [
    { id: "whatsapp-openclaw", title: "Conectar o WhatsApp ao agente", done: 3, total: 5, current: "Fazer o agente entender áudios", finished: false, comingSoon: false },
    { id: "whatsapp-objetivo", title: "O que você quer resolver pelo WhatsApp?", done: 0, total: 3, current: null, finished: false, comingSoon: true },
  ] };
  assert.deepEqual(m.parseSupportProgress(ok), ok);
  for (const bad of [null, [], { ...ok, at: "ontem" }, { ...ok, tour: "talvez" }, { ...ok, tutorials: "x" },
    { ...ok, tutorials: [{ ...ok.tutorials[0], done: 9 }] }, { ...ok, tutorials: [{ ...ok.tutorials[0], title: "x".repeat(500) }] },
    { ...ok, tutorials: Array(30).fill(ok.tutorials[0]) }]) assert.equal(m.parseSupportProgress(bad), null);
});

test("supportLogSh: linha no registro da pessoa, texto limpo e curto", () => {
  const sh = m.supportLogSh("Lucas", "reiniciou o backend; rm -rf / $(x) 'aspas'");
  assert.match(sh, /suporte\.log"$/);
  assert.ok(sh.includes("'Lucas'"));
  assert.ok(sh.includes("'reiniciou o backend rm -rf  (x) aspas'"), sh);
  assert.ok(!sh.includes("$(x)") && !sh.includes(";"), "sem $, ; nem aspas no texto");
  assert.ok(m.supportLogSh("a".repeat(300), "b").includes(`'${"a".repeat(120)}'`), "corta em 120");
});

test("código com o apelido da máquina (machine): vai e volta; inválido cai fora; antigo sem ele vale", () => {
  const d = m.decodeSupportCode(m.encodeSupportCode({ ...code, machine: "colima" }));
  assert.ok(d.ok); assert.equal(d.code.machine, "colima");
  const old = m.decodeSupportCode(m.encodeSupportCode(code));
  assert.ok(old.ok); assert.equal("machine" in old.code, false);
  const bad = m.decodeSupportCode(m.encodeSupportCode({ ...code, machine: "tem espaço; e ponto-e-vírgula" }));
  assert.ok(bad.ok); assert.equal("machine" in bad.code, false, "apelido inválido é ignorado, não derruba o código");
});

test("parseSupportShare: tudo compartilhado por padrão; só false desliga", () => {
  assert.deepEqual(m.parseSupportShare(undefined), { progress: true, whatsapp: true, logs: true });
  assert.deepEqual(m.parseSupportShare({ whatsapp: false }), { progress: true, whatsapp: false, logs: true });
  assert.deepEqual(m.parseSupportShare({ progress: "não", logs: 0 }), { progress: true, whatsapp: true, logs: true });
  assert.deepEqual(m.DEFAULT_SHARE, { progress: true, whatsapp: true, logs: true });
});
