import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { pickUpdate, compareVersions, assetName, UPDATE_REPO, deveAtualizar, releasesUrl, precisaAtualizarBackend, verificaAssinatura, UPDATE_PUBLIC_KEYS, parsePendente, decideRollback } = createRequire(import.meta.url)("../../dist/main/updater-core.js");
import { generateKeyPairSync, sign } from "node:crypto";

// Cada zip publicado vem com o .sig ao lado (o release assina); sem ele não há candidata (teste próprio abaixo).
const release = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: assets.flatMap((a) => (a.name.endsWith(".zip") ? [a, { ...a, name: `${a.name}.sig`, browser_download_url: `${a.browser_download_url}.sig`, size: 88 }] : [a])), ...extra });
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
  const rel = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: /staging/.test(tag), assets: assets.flatMap((n) => [n, `${n}.sig`]).map((n) => ({ name: n, browser_download_url: `https://x/${n}`, size: 1 })), ...extra });
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

test("precisaAtualizarBackend: só onde já está instalado, só para cima, só ocioso", () => {
  const p = (o) => ({ backendInstalled: true, backendVersion: "1.0.0", backendBusy: 0, ...o });
  assert.equal(precisaAtualizarBackend(p({}), "1.1.0"), "atualizar");
  assert.equal(precisaAtualizarBackend(p({ backendVersion: null }), "1.0.0"), "atualizar", "backend sem VERSION é anterior ao versionamento");
  assert.equal(precisaAtualizarBackend(p({}), "1.0.0"), "nao", "mesma versão");
  assert.equal(precisaAtualizarBackend(p({ backendVersion: "1.2.0" }), "1.1.0"), "nao", "nunca rebaixa (estável e staging dividem a máquina)");
  assert.equal(precisaAtualizarBackend(p({ backendInstalled: false }), "1.1.0"), "nao", "sem backend: instalar é o seletor, não a atualização");
  assert.equal(precisaAtualizarBackend(p({}), null), "nao", "app sem VERSION não decide nada");
  assert.equal(precisaAtualizarBackend(p({ backendBusy: 2 }), "1.1.0"), "ocupado");
  assert.equal(precisaAtualizarBackend(p({ backendBusy: null }), "1.1.0"), "atualizar", "backend antigo sem o contador conta como ocioso");
});

test("pickUpdate: zip sem o .sig ao lado não é candidata; com ele, a candidata traz os dois", () => {
  const sem = { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "meu-bot-0.2.0-arm64.zip", browser_download_url: "https://x/z.zip", size: 5 }] };
  assert.equal(pickUpdate(sem, { app: "meu-bot", arch: "arm64", current: "0.1.0" }), null);
  const c = pickUpdate(release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")]), { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(c.sig.name, "meu-bot-0.2.0-arm64.zip.sig"); assert.match(c.sig.url, /^https:\/\/.*\.sig$/);
});

test("verificaAssinatura: só o zip que a chave da release assinou", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const zip = Buffer.from("conteúdo do zip");
  const sig = sign(null, zip, privateKey).toString("base64");
  assert.equal(verificaAssinatura(zip, `${sig}\n`, pub), true);
  assert.equal(verificaAssinatura(Buffer.from("conteúdo do zap"), sig, pub), false, "zip adulterado");
  const outra = generateKeyPairSync("ed25519").privateKey;
  assert.equal(verificaAssinatura(zip, sign(null, zip, outra).toString("base64"), pub), false, "assinado por outra chave");
  assert.equal(verificaAssinatura(zip, "lixo", pub), false);
  assert.equal(verificaAssinatura(zip, "", pub), false);
  assert.equal(verificaAssinatura(zip, sig, "lixo"), false, "chave inválida não lança");
  assert.equal(verificaAssinatura(zip, sig), false, "a chave embutida não é a do teste");
  for (const k of UPDATE_PUBLIC_KEYS) assert.match(k.chave, /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/, `${k.id}: SPKI de uma chave Ed25519`);
});

test("verificaAssinatura com várias chaves: a principal ou a reserva servem; outra, não", () => {
  const par = () => { const { privateKey, publicKey } = generateKeyPairSync("ed25519"); return { priv: privateKey, pub: publicKey.export({ type: "spki", format: "der" }).toString("base64") }; };
  const principal = par(), reserva = par(), intrusa = par();
  const zip = Buffer.from("release");
  const assina = (k) => sign(null, zip, k.priv).toString("base64");
  const lista = [principal.pub, reserva.pub];
  assert.equal(verificaAssinatura(zip, assina(principal), lista), true);
  assert.equal(verificaAssinatura(zip, assina(reserva), lista), true, "a reserva vale (troca de chave sem reinstalar)");
  assert.equal(verificaAssinatura(zip, assina(intrusa), lista), false);
  assert.equal(verificaAssinatura(zip, assina(principal), []), false, "lista vazia não aceita nada");
  assert.equal(verificaAssinatura(zip, assina(reserva), ["lixo", reserva.pub]), true, "uma chave inválida na lista não derruba as outras");
  assert.deepEqual(UPDATE_PUBLIC_KEYS.map((k) => k.id), ["principal-2026-10", "reserva-2026-10"]);
  assert.equal(new Set(UPDATE_PUBLIC_KEYS.map((k) => k.chave)).size, UPDATE_PUBLIC_KEYS.length, "sem chave repetida");
});

test("rollback: a nova tem duas aberturas para ficar de pé; na terceira volta; outra versão só limpa", () => {
  const p = (t) => ({ de: "0.1.0", para: "0.2.0", antigos: ["/Users/x/Applications/meu-bot.app.antigo"], tentativas: t });
  assert.equal(decideRollback(p(0), "0.2.0"), "aguardar");
  assert.equal(decideRollback(p(1), "0.2.0"), "aguardar");
  assert.equal(decideRollback(p(2), "0.2.0"), "voltar");
  assert.equal(decideRollback(p(0), "0.1.0"), "descartar", "já voltou");
  assert.equal(decideRollback(p(0), "0.3.0"), "descartar", "outra instalada por fora");
  assert.deepEqual(parsePendente({ de: "0.1.0", para: "0.2.0", antigos: ["/a/meu-bot.app.antigo", "/etc/passwd", 3], tentativas: -1 }), { de: "0.1.0", para: "0.2.0", antigos: ["/a/meu-bot.app.antigo"], tentativas: 0 }, "só caminhos .app.antigo");
  assert.equal(parsePendente({ de: "0.1.0" }), null);
  assert.equal(parsePendente(null), null);
});
