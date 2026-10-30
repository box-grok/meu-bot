import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
const { pickClienteAsset, deveBuscar, motivoSemCliente, CLIENTES_GOOGLE, PASTA_BAIXADOS, MAX_CLIENTE_BYTES, REBUSCA_MS } = createRequire(import.meta.url)("../../dist/main/google/cliente-release-core.js");
const { verificaAssinatura } = createRequire(import.meta.url)("../../dist/main/atualizacao/updater-core.js");
const { clientesGoogleParaPublicar, CLIENTES_GOOGLE: NA_RELEASE } = await import("../release-core.mjs");

const asset = (name, size = 420) => ({ name, browser_download_url: `https://github.com/diegofornalha/meu-bot/releases/download/v0.4.0/${name}`, size });
const release = (assets, extra = {}) => ({ tag_name: "v0.4.0", draft: false, prerelease: false, assets, ...extra });

test("client do Google: pega o asset e o .sig da release; sem .sig, sem https, grande demais ou draft não há candidato", () => {
  const r = release([asset("google-conta-oauth.json"), asset("google-conta-oauth.json.sig", 89), asset("google-oauth.json"), asset("meu-bot-0.4.0-arm64.zip", 1e8)]);
  const c = pickClienteAsset(r, "google-conta-oauth.json");
  assert.equal(c.tag, "v0.4.0"); assert.equal(c.asset.name, "google-conta-oauth.json"); assert.equal(c.sig.name, "google-conta-oauth.json.sig"); assert.equal(c.asset.size, 420);
  assert.equal(pickClienteAsset(r, "google-oauth.json"), null, "sem o .sig ao lado");
  assert.equal(pickClienteAsset(release([{ ...asset("google-oauth.json"), browser_download_url: "http://x/google-oauth.json" }, asset("google-oauth.json.sig")]), "google-oauth.json"), null, "só https");
  assert.equal(pickClienteAsset(release([asset("google-oauth.json", MAX_CLIENTE_BYTES + 1), asset("google-oauth.json.sig")]), "google-oauth.json"), null, "grande demais");
  assert.equal(pickClienteAsset(release([asset("google-oauth.json"), asset("google-oauth.json.sig")], { draft: true }), "google-oauth.json"), null, "draft");
  assert.equal(pickClienteAsset(null, "google-oauth.json"), null); assert.equal(pickClienteAsset({ assets: "x" }, "google-oauth.json"), null);
});

test("client do Google: a assinatura do JSON confere com a mesma função das atualizações; um byte trocado derruba", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const json = Buffer.from('{"installed":{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"s"}}');
  const sig = sign(null, json, privateKey).toString("base64");
  assert.equal(verificaAssinatura(json, sig, pub), true);
  assert.equal(verificaAssinatura(Buffer.from(json.toString().replace("123", "124")), sig, pub), false);
});

test("client do Google: busca de novo só depois de 6 h ou a pedido; o motivo para a tela", () => {
  assert.equal(deveBuscar(null, 1000, false), true); assert.equal(deveBuscar(1000, 1000 + REBUSCA_MS - 1, false), false); assert.equal(deveBuscar(1000, 1000 + REBUSCA_MS, false), true); assert.equal(deveBuscar(1000, 1001, true), true);
  assert.equal(motivoSemCliente({ tag: "v0.4.0", faltam: [], erro: null }), null);
  assert.equal(motivoSemCliente({ tag: "v0.4.0", faltam: ["google-conta-oauth.json"], erro: null }), "a release v0.4.0 não traz google-conta-oauth.json");
  assert.equal(motivoSemCliente({ tag: null, faltam: ["a", "b"], erro: null }), "nenhuma release publicada ainda");
  assert.match(motivoSemCliente({ tag: null, faltam: ["a"], erro: "sem internet" }), /não consegui consultar a release: sem internet/);
  assert.deepEqual([...CLIENTES_GOOGLE], ["google-oauth.json", "google-conta-oauth.json"]); assert.equal(PASTA_BAIXADOS, "google-cliente-baixado");
});

test("release: publica como asset só os clients que existem em config/ (a mesma lista do app)", () => {
  assert.deepEqual(NA_RELEASE, [...CLIENTES_GOOGLE]);
  assert.deepEqual(clientesGoogleParaPublicar(() => false), []);
  assert.deepEqual(clientesGoogleParaPublicar((p) => p === "config/google-conta-oauth.json"), ["google-conta-oauth.json"]);
});
