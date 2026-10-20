import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { pickUpdate, compareVersions, assetName, UPDATE_REPO, deveAtualizar, releasesUrl } = createRequire(import.meta.url)("../../dist/main/updater-core.js");

const release = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets, ...extra });
const asset = (name) => ({ name, browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/v0.2.0/${name}`, size: 123 });

test("pickUpdate: só versão mais nova, só o asset deste app e arquitetura", () => {
  const r = release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip"), asset("meu-bot-admin-0.2.0-arm64.zip")]);
  const c = pickUpdate(r, { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(c.version, "0.2.0"); assert.equal(c.asset.name, "meu-bot-0.2.0-arm64.zip"); assert.equal(c.asset.size, 123);
  assert.equal(pickUpdate(r, { app: "meu-bot-admin", arch: "arm64", current: "0.1.0" }).asset.name, "meu-bot-admin-0.2.0-arm64.zip");
  assert.equal(pickUpdate(r, { app: "meu-bot", arch: "x64", current: "0.1.0" }), null, "sem asset para a arquitetura");
  assert.equal(pickUpdate(r, { app: "meu-bot", arch: "arm64", current: "0.2.0" }), null, "já está nela");
  assert.equal(pickUpdate(r, { app: "meu-bot", arch: "arm64", current: "0.3.0" }), null, "à frente");
  assert.equal(pickUpdate(release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")], { prerelease: true }), { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null, "pré-release não conta");
  assert.equal(pickUpdate(release("0.2.0", [asset("meu-bot-0.2.0-arm64.zip")]), { app: "meu-bot", arch: "arm64", current: "0.1.0" }).version, "0.2.0", "tag sem v vale");
  assert.equal(pickUpdate(release("v0.2.0", [{ name: "meu-bot-0.2.0-arm64.zip", browser_download_url: "http://x/evil.zip", size: 1 }]), { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null, "só https");
  assert.equal(pickUpdate({ message: "Not Found" }, { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null);
  assert.equal(pickUpdate(null, { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null);
});

test("compareVersions e assetName", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
  assert.equal(assetName("meu-bot-admin", "0.2.0", "x64"), "meu-bot-admin-0.2.0-x64.zip");
});

test("compareVersions: ordem do semver com pre-release (staging)", () => {
  assert.equal(compareVersions("0.2.0-staging.3", "0.2.0-staging.10"), -1);
  assert.equal(compareVersions("0.2.0-staging.10", "0.2.0"), -1, "a estável vence o staging dela");
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.3.0-staging.1", "0.2.0"), 1, "staging da próxima é mais novo que a estável atual");
  assert.equal(compareVersions("v0.2.0-staging.2", "0.2.0-staging.2"), 0);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1, "número < texto");
});

test("pickUpdate por canal: o estável ignora staging; o staging pega a maior pre-release com o asset dele", () => {
  const rel = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: /staging/.test(tag), assets: assets.map((n) => ({ name: n, browser_download_url: `https://x/${n}`, size: 1 })), ...extra });
  const lista = [
    rel("v0.2.0-staging.2", ["meu-bot-staging-0.2.0-staging.2-arm64.zip"]),
    rel("v0.2.0-staging.10", ["meu-bot-staging-0.2.0-staging.10-arm64.zip", "meu-bot-crm-staging-0.2.0-staging.10-arm64.zip"]),
    rel("v0.2.0-staging.11", ["meu-bot-crm-staging-0.2.0-staging.11-arm64.zip"]),
    rel("v0.2.0-beta.1", ["meu-bot-staging-0.2.0-beta.1-arm64.zip"], { prerelease: true }),
    rel("v0.1.0", ["meu-bot-0.1.0-arm64.zip"]),
  ];
  const st = pickUpdate(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.2.0-staging.1", canal: "staging" });
  assert.equal(st.version, "0.2.0-staging.10", "a .11 não tem o asset do meu-bot-staging; a beta não é tag de staging");
  assert.equal(pickUpdate(lista, { app: "meu-bot-crm-staging", arch: "arm64", current: "0.2.0-staging.1", canal: "staging" }).version, "0.2.0-staging.11");
  assert.equal(pickUpdate(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.2.0-staging.10", canal: "staging" }), null, "já está na maior");
  assert.equal(pickUpdate(rel("v0.2.0-staging.3", ["meu-bot-0.2.0-staging.3-arm64.zip"]), { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null, "o estável ignora pre-release");
  assert.equal(pickUpdate(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.1.0" }), null, "o estável não lê a lista");
  assert.match(releasesUrl("staging"), /\/releases\?per_page=30$/); assert.match(releasesUrl("estavel"), /\/releases\/latest$/);
});

test("deveAtualizar: o componente da máquina só sobe de versão (estável e staging não se rebaixam)", () => {
  assert.equal(deveAtualizar("1.1.0", "1.2.0"), true);
  assert.equal(deveAtualizar("1.2.0", "1.1.0"), false, "o app mais velho não rebaixa");
  assert.equal(deveAtualizar("1.1.0", "1.1.0"), false);
  assert.equal(deveAtualizar(null, "1.1.0"), true, "instalada sem versão");
  assert.equal(deveAtualizar("1.1.0", null), false);
});
