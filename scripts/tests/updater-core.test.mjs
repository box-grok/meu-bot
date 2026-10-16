import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { pickUpdate, compareVersions, assetName, UPDATE_REPO } = createRequire(import.meta.url)("../../dist/main/updater-core.js");

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
