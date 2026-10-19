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

test("porta por máquina: só hosts válidos com porta válida; padrão continua a global", () => {
  const s = normalizeSettings({ backendPort: 8080, backendPortByHost: { "agente-openclaw": 8081, "x y": 8082, colima: 0, vm: "8083", outra: 70000 } });
  assert.deepEqual(s.backendPortByHost, { "agente-openclaw": 8081 });
  assert.equal(s.backendPort, 8080);
  assert.deepEqual(normalizeSettings({ backendPortByHost: "nope" }).backendPortByHost, {});
  assert.deepEqual(defaultSettings().backendPortByHost, {});
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

test("navNotify: padrão desligado (o tutorial liga) com a instrução padrão; patch parcial mantém o resto; hosts limpos; modo validado", () => {
  const { normalizeNavNotify, NAV_NOTIFY_DEFAULT_INSTRUCTION } = createRequire(import.meta.url)("../../dist/main/settings-normalize.js");
  const d = normalizeSettings({}).navNotify;
  assert.deepEqual(d, { enabled: false, instruction: NAV_NOTIFY_DEFAULT_INSTRUCTION, hosts: [], mode: "site", avisar: "tratado" });
  const s = normalizeSettings({ navNotify: { enabled: false, instruction: "  Resuma.  ", hosts: ["Mail.Google.com", "bad host!", "mail.google.com"], mode: "each" } }).navNotify;
  assert.deepEqual(s, { enabled: false, instruction: "Resuma.", hosts: ["mail.google.com"], mode: "each", avisar: "tratado" });
  assert.equal(normalizeNavNotify({ avisar: "nunca" }, s).avisar, "nunca");
  assert.equal(normalizeNavNotify({ avisar: "x" }, s).avisar, "tratado");
  assert.deepEqual(normalizeNavNotify({ mode: "x", instruction: "" }, s), { ...s, instruction: NAV_NOTIFY_DEFAULT_INSTRUCTION }, "patch: modo inválido e instrução vazia caem no que havia / padrão");
  assert.equal(normalizeNavNotify({ hosts: "nope" }, s).hosts, s.hosts);
});

test("navEspacos: ids e nomes válidos, urls http(s), ícone http(s)/data, ativo existente; lixo cai fora", () => {
  const { normalizeNavWorkspaces } = createRequire(import.meta.url)("../../dist/main/settings-normalize.js");
  const w = normalizeNavWorkspaces({ ativo: "nope", lista: [
    { id: "w1", nome: "  ACME  ", servicos: [{ id: "s1", nome: "", url: "https://mail.google.com/", icone: "javascript:x" }, { id: "s1", nome: "dup", url: "https://a.com" }, { id: "s2", nome: "ftp", url: "ftp://x" }] },
    { id: "bad id!", nome: "x", servicos: [] },
    { id: "w2", nome: "", servicos: [] },
  ] });
  assert.deepEqual(w, { ativo: "w1", lista: [{ id: "w1", nome: "ACME", servicos: [{ id: "s1", nome: "mail.google.com", url: "https://mail.google.com/", icone: null }] }] });
  assert.deepEqual(normalizeNavWorkspaces("nope"), { ativo: null, lista: [] });
  const s = normalizeSettings({ navEspacos: { colima: { ativo: "a", lista: [{ id: "a", nome: "Site", servicos: [] }] }, "x y": { lista: [] }, vazio: { lista: [] } } });
  assert.deepEqual(Object.keys(s.navEspacos), ["colima"]);
  assert.equal(s.navEspacos.colima.ativo, "a");
  // Oculto: fica na lista (nada se apaga), mas nunca é o ativo; sem visível, ativo é null.
  const h = normalizeNavWorkspaces({ ativo: "x", lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }, { id: "y", nome: "Vivo", servicos: [] }] });
  assert.deepEqual(h, { ativo: "y", lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }, { id: "y", nome: "Vivo", servicos: [] }] });
  assert.equal(normalizeNavWorkspaces({ lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }] }).ativo, null);
});
