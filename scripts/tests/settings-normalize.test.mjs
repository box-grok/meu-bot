import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { normalizeSettings, defaultSettings } = createRequire(import.meta.url)("../../dist/main/settings-normalize.js");

test("arquivo v2 migra sshHost para lastHost e descarta sshHost", () => {
  const s = normalizeSettings({ version: 1, sshHost: "colima", backendModel: "rene-dm", backendPort: 8080 });
  assert.equal(s.lastHost, "colima");
  assert.equal("sshHost" in s, false);
  assert.equal(s.backendModel, "rene-dm");
});

test("lastHost explícito vence sshHost; inválido vira null", () => {
  assert.equal(normalizeSettings({ lastHost: "local", sshHost: "colima" }).lastHost, "local");
  assert.equal(normalizeSettings({ sshHost: "bad host!" }).lastHost, null);
  assert.equal(normalizeSettings(null).lastHost, null);
});

test("defaults, modelo por máquina e bounds validados", () => {
  const s = normalizeSettings({ defaultModelByHost: { colima: "agente", "x y": "agente", local: "nope" }, windowBounds: { colima: { x: 1, y: 2, width: 800, height: 600 }, local: { x: 0, y: 0, width: 10, height: 10 } } });
  assert.deepEqual(s.defaultModelByHost, { colima: "agente" });
  assert.deepEqual(Object.keys(s.windowBounds), ["colima"]);
  assert.deepEqual(normalizeSettings({}), defaultSettings());
});

test("onboarding: pendente por padrão, inválido vira pendente, done/skipped ficam", () => {
  assert.equal(normalizeSettings({}).onboarding, "pending");
  assert.equal(normalizeSettings({ onboarding: "x" }).onboarding, "pending");
  assert.equal(normalizeSettings({ onboarding: "done" }).onboarding, "done");
  assert.equal(normalizeSettings({ onboarding: "skipped" }).onboarding, "skipped");
});

test("openDirect: true por padrão, respeita false", () => {
  assert.equal(normalizeSettings({}).openDirect, true);
  assert.equal(normalizeSettings({ openDirect: false }).openDirect, false);
  assert.equal(normalizeSettings({ openDirect: "x" }).openDirect, true);
});

test("hostNames: apelidos válidos por host; lixo fora", async () => {
  const { normalizeHostNames } = await import("../../dist/main/settings-normalize.js");
  assert.deepEqual(normalizeHostNames({ colima: "  VM de  teste ", "a b": "x", agente: "", n: 3 }), { colima: "VM de teste" });
  assert.deepEqual(normalizeHostNames(["colima"]), {});
  assert.equal(normalizeHostNames({ vm: "x".repeat(80) }).vm.length, 40);
  assert.deepEqual(normalizeSettings({}).hostNames, {});
});

test("navFavoritos: por máquina válida; url http(s), título ≤ 60, url repetida fica com a primeira, id ruim ganha outro", () => {
  const s = normalizeSettings({ navFavoritos: { colima: [
    { id: "ok1", titulo: "  Pipeline   X ", url: "https://a.com/p" },
    { id: "ok2", titulo: "repetido", url: "https://a.com/p" },
    { id: "bad id!", titulo: "x".repeat(80), url: "http://b.com" },
    { id: "ok3", titulo: "sem esquema", url: "ftp://c" },
  ], "x y": [{ id: "z", titulo: "", url: "https://d.com" }] } });
  assert.deepEqual(Object.keys(s.navFavoritos), ["colima"]);
  assert.equal(s.navFavoritos.colima.length, 2);
  assert.deepEqual(s.navFavoritos.colima[0], { id: "ok1", titulo: "Pipeline X", url: "https://a.com/p" });
  assert.equal(s.navFavoritos.colima[1].titulo.length, 60);
  assert.notEqual(s.navFavoritos.colima[1].id, "bad id!");
  assert.deepEqual(normalizeSettings({ navFavoritos: [] }).navFavoritos, {});
});
