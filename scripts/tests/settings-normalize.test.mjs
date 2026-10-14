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
