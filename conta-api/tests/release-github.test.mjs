// Home: o asset do app da pessoa na release mais nova (meu-bot-<v>-arm64.zip), nunca o admin nem o .sig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escolherAsset, escolherStaging } from "../dist/release-github.js";

test("escolherAsset: pega meu-bot-<v>-arm64.zip e ignora admin, .sig e json", () => {
  const rel = { tag_name: "v0.78.4", published_at: "2026-11-05T01:05:09Z", assets: [
    { name: "google-oauth.json", browser_download_url: "u1", size: 335 },
    { name: "meu-bot-admin-0.78.4-arm64.zip", browser_download_url: "u2", size: 1 },
    { name: "meu-bot-0.78.4-arm64.zip.sig", browser_download_url: "u3", size: 89 },
    { name: "meu-bot-0.78.4-arm64.zip", browser_download_url: "https://github.com/x/meu-bot-0.78.4-arm64.zip", size: 133558683 },
  ] };
  assert.deepEqual(escolherAsset(rel), { versao: "0.78.4", url: "https://github.com/x/meu-bot-0.78.4-arm64.zip", tamanho: 133558683, publicadoEm: "2026-11-05T01:05:09Z", nome: "meu-bot-0.78.4-arm64.zip" });
  assert.equal(escolherAsset({ assets: [{ name: "meu-bot-admin-1.0.0-arm64.zip", browser_download_url: "u" }] }), null);
  assert.equal(escolherAsset(null), null);
  assert.equal(escolherAsset("x"), null);
});

test("escolherStaging: a pre-release de staging mais nova (app meu-bot-staging), pulando rascunho e release sem o asset", () => {
  const z = (name) => ({ name, browser_download_url: "https://github.com/x/" + name, size: 10 });
  const rels = [
    { draft: true, published_at: "d", assets: [z("meu-bot-staging-0.80.0-staging.1-arm64.zip")] },
    { tag_name: "v0.79.4", published_at: "a", assets: [z("meu-bot-0.79.4-arm64.zip")] },
    { tag_name: "v0.79.3-staging.1", published_at: "2026-11-09T16:31:22Z", assets: [z("meu-bot-finance-staging-0.79.3-staging.1-arm64.zip"), z("meu-bot-staging-0.79.3-staging.1-arm64.zip.sig"), z("meu-bot-staging-0.79.3-staging.1-arm64.zip")] },
  ];
  assert.deepEqual(escolherStaging(rels), { versao: "0.79.3-staging.1", url: "https://github.com/x/meu-bot-staging-0.79.3-staging.1-arm64.zip", tamanho: 10, publicadoEm: "2026-11-09T16:31:22Z", nome: "meu-bot-staging-0.79.3-staging.1-arm64.zip" });
  assert.equal(escolherStaging([{ assets: [z("meu-bot-0.78.4-arm64.zip")] }]), null);
  assert.equal(escolherStaging(null), null);
  // A estável continua ignorando o asset de staging.
  assert.equal(escolherAsset({ assets: [z("meu-bot-staging-0.79.3-staging.1-arm64.zip")] }), null);
});
