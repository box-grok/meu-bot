import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { escolherRelease, candidataDe, motivoReleaseTexto, antigosDescartaveis, compareVersions, assetName, UPDATE_REPO, deveAtualizar, releasesUrl, precisaAtualizarBackend, verificaAssinatura, UPDATE_PUBLIC_KEYS, parsePendente, decideRollback, repararTroca, parsePreparada, proximaVerificacaoMs, CHECK_EVERY_MS, CHECK_JITTER_MS, feedAindaOferece, decideReinicioOcioso, parseVersaoMinima, abaixoDaMinima } = createRequire(import.meta.url)("../../dist/main/atualizacao/updater-core.js");
import { generateKeyPairSync, sign } from "node:crypto";

// Cada zip publicado vem com o .sig ao lado (o release assina); sem ele não há candidata (teste próprio abaixo).
const release = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: assets.flatMap((a) => (a.name.endsWith(".zip") ? [a, { ...a, name: `${a.name}.sig`, browser_download_url: `${a.browser_download_url}.sig`, size: 88 }] : [a])), ...extra });
const asset = (name) => ({ name, browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/v0.2.0/${name}`, size: 123 });

const escolher = (raw, want) => escolherRelease(raw, want);
const pega = (raw, want) => candidataDe(escolherRelease(raw, want));

test("escolherRelease: só versão mais nova, só o asset deste app e arquitetura", () => {
  const r = release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip"), asset("meu-bot-admin-0.2.0-arm64.zip")]);
  const c = pega(r, { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(c.version, "0.2.0"); assert.equal(c.asset.name, "meu-bot-0.2.0-arm64.zip"); assert.equal(c.asset.size, 123);
  assert.equal(pega(r, { app: "meu-bot-admin", arch: "arm64", current: "0.1.0" }).asset.name, "meu-bot-admin-0.2.0-arm64.zip");
  assert.equal(escolher(r, { app: "meu-bot", arch: "arm64", current: "0.2.0" }).tipo, "nada-novo", "já está nela");
  assert.equal(escolher(r, { app: "meu-bot", arch: "arm64", current: "0.3.0" }).tipo, "nada-novo", "à frente");
  assert.equal(escolher(release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")], { prerelease: true }), { app: "meu-bot", arch: "arm64", current: "0.1.0" }).tipo, "nada-novo", "pré-release não conta");
  assert.equal(pega(release("0.2.0", [asset("meu-bot-0.2.0-arm64.zip")]), { app: "meu-bot", arch: "arm64", current: "0.1.0" }).version, "0.2.0", "tag sem v vale");
});

test("escolherRelease: release que existe e não dá para usar nunca vira nada-novo", () => {
  // Era este o defeito: tudo abaixo devolvia null e o app anunciava "você está na versão mais recente",
  // parando de atualizar para sempre sem ninguém notar.
  const r = release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")]);
  const semArch = escolher(r, { app: "meu-bot", arch: "x64", current: "0.1.0" });
  assert.equal(semArch.tipo, "inutilizavel"); assert.equal(semArch.motivo, "sem-ativo"); assert.equal(semArch.versao, "0.2.0");

  const httpSimples = escolher(release("v0.2.0", [{ name: "meu-bot-0.2.0-arm64.zip", browser_download_url: "http://x/evil.zip", size: 1 }]), { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(httpSimples.tipo, "inutilizavel"); assert.equal(httpSimples.motivo, "sem-ativo", "asset só por http não conta como presente");

  const semSig = escolher({ tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "meu-bot-0.2.0-arm64.zip", browser_download_url: "https://x/z.zip", size: 5 }] }, { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(semSig.tipo, "inutilizavel"); assert.equal(semSig.motivo, "sem-assinatura");

  for (const corpo of [null, "texto", 42, { message: "Not Found" }, { tag_name: 7 }]) {
    assert.equal(escolher(corpo, { app: "meu-bot", arch: "arm64", current: "0.1.0" }).motivo, "corpo-inesperado", `corpo ${JSON.stringify(corpo)}`);
  }
  const tagEstranha = escolher({ tag_name: "release-final", draft: false, prerelease: false, assets: [] }, { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(tagEstranha.motivo, "tag-inesperada");

  const semAssets = escolher({ tag_name: "v0.2.0", draft: false, prerelease: false, assets: "nenhum" }, { app: "meu-bot", arch: "arm64", current: "0.1.0" });
  assert.equal(semAssets.motivo, "corpo-inesperado"); assert.equal(semAssets.versao, "0.2.0");

  // Rascunho é release não publicada: não é defeito, é "nada para mim".
  assert.equal(escolher(release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")], { draft: true }), { app: "meu-bot", arch: "arm64", current: "0.1.0" }).tipo, "nada-novo");
});

test("motivoReleaseTexto: frase para a tela, com e sem a versão", () => {
  assert.match(motivoReleaseTexto("0.9.0", "sem-ativo"), /0\.9\.0/);
  assert.match(motivoReleaseTexto(null, "corpo-inesperado"), /não consegui entender/);
  for (const m of ["corpo-inesperado", "tag-inesperada", "sem-ativo", "sem-assinatura"]) {
    assert.equal(typeof motivoReleaseTexto(null, m), "string"); assert.ok(motivoReleaseTexto(null, m).length > 10, m);
  }
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

test("escolherRelease por canal: o estável ignora staging; o staging pega a maior pre-release com o asset dele", () => {
  const rel = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: /staging/.test(tag), assets: assets.flatMap((n) => [n, `${n}.sig`]).map((n) => ({ name: n, browser_download_url: `https://x/${n}`, size: 1 })), ...extra });
  const lista = [
    rel("v0.2.0-staging.2", ["meu-bot-staging-0.2.0-staging.2-arm64.zip"]),
    rel("v0.2.0-staging.10", ["meu-bot-staging-0.2.0-staging.10-arm64.zip", "meu-bot-crm-staging-0.2.0-staging.10-arm64.zip"]),
    rel("v0.2.0-staging.11", ["meu-bot-crm-staging-0.2.0-staging.11-arm64.zip"]),
    rel("v0.2.0-beta.1", ["meu-bot-staging-0.2.0-beta.1-arm64.zip"], { prerelease: true }),
    rel("v0.1.0", ["meu-bot-0.1.0-arm64.zip"]),
  ];
  const st = pega(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.2.0-staging.1", canal: "staging" });
  assert.equal(st.version, "0.2.0-staging.10", "a .11 não tem o asset do meu-bot-staging; a beta não é tag de staging");
  assert.equal(pega(lista, { app: "meu-bot-crm-staging", arch: "arm64", current: "0.2.0-staging.1", canal: "staging" }).version, "0.2.0-staging.11");
  assert.equal(escolher(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.2.0-staging.10", canal: "staging" }).tipo, "nada-novo", "já está na maior");
  assert.equal(escolher(rel("v0.2.0-staging.3", ["meu-bot-0.2.0-staging.3-arm64.zip"]), { app: "meu-bot", arch: "arm64", current: "0.1.0" }).tipo, "nada-novo", "o estável ignora pre-release");
  assert.equal(escolher(lista, { app: "meu-bot-staging", arch: "arm64", current: "0.1.0" }).motivo, "corpo-inesperado", "o estável não lê a lista: uma lista onde se espera um objeto é corpo estranho");
  // Na lista do staging, uma candidata utilizável ganha de um problema em outra entrada.
  const comProblema = [rel("v0.3.0-staging.1", []), rel("v0.2.0-staging.2", ["meu-bot-staging-0.2.0-staging.2-arm64.zip"])];
  assert.equal(pega(comProblema, { app: "meu-bot-staging", arch: "arm64", current: "0.1.0", canal: "staging" }).version, "0.2.0-staging.2");
  // No staging publica-se um produto de cada vez: pre-release sem o arquivo deste app é normal, não defeito.
  assert.equal(escolher([rel("v0.3.0-staging.1", [])], { app: "meu-bot-staging", arch: "arm64", current: "0.1.0", canal: "staging" }).tipo, "nada-novo");
  // Já um zip publicado sem o .sig ao lado é defeito em qualquer canal, e tem que aparecer.
  const semSig = escolher([{ tag_name: "v0.3.0-staging.1", draft: false, prerelease: true, assets: [{ name: "meu-bot-staging-0.3.0-staging.1-arm64.zip", browser_download_url: "https://x/z.zip", size: 9 }] }], { app: "meu-bot-staging", arch: "arm64", current: "0.1.0", canal: "staging" });
  assert.equal(semSig.tipo, "inutilizavel"); assert.equal(semSig.motivo, "sem-assinatura"); assert.equal(semSig.versao, "0.3.0-staging.1");
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
  assert.equal(precisaAtualizarBackend(p({ backendInstalled: false, backendVersion: null }), "1.1.0"), "nao", "outro backend na pasta herdada (Hermes) não é instalado: nunca reinstalar por cima");
});

test("escolherRelease: zip sem o .sig ao lado não é candidata; com ele, a candidata traz os dois", () => {
  const sem = { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "meu-bot-0.2.0-arm64.zip", browser_download_url: "https://x/z.zip", size: 5 }] };
  assert.equal(candidataDe(escolherRelease(sem, { app: "meu-bot", arch: "arm64", current: "0.1.0" })), null);
  const c = pega(release("v0.2.0", [asset("meu-bot-0.2.0-arm64.zip")]), { app: "meu-bot", arch: "arm64", current: "0.1.0" });
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

test("rollback: a nova tem duas aberturas para ficar de pé; na terceira volta; reaberta na antiga, a troca não pegou; outra só limpa", () => {
  const p = (t) => ({ de: "0.1.0", para: "0.2.0", antigos: ["/Users/x/Applications/meu-bot.app.antigo"], tentativas: t, gatilho: "clique", pedidoEm: null, fase: "trocada" });
  assert.equal(decideRollback(p(0), "0.2.0"), "aguardar");
  assert.equal(decideRollback(p(1), "0.2.0"), "aguardar");
  assert.equal(decideRollback(p(2), "0.2.0"), "voltar");
  assert.equal(decideRollback(p(0), "0.1.0"), "nao-pegou", "reabriu na versão de antes da troca");
  assert.equal(decideRollback(p(0), "0.3.0"), "descartar", "outra instalada por fora");
  assert.equal(decideRollback({ ...p(0), para: "0.1.0" }, "0.1.0"), "aguardar", "de = para (reinstalou a mesma) não é 'não pegou'");
  // v1 (sem gatilho/fase) continua lido: conta como já trocada, só caminhos .app.antigo
  assert.deepEqual(parsePendente({ de: "0.1.0", para: "0.2.0", antigos: ["/a/meu-bot.app.antigo", "/etc/passwd", 3], tentativas: -1 }), { de: "0.1.0", para: "0.2.0", antigos: ["/a/meu-bot.app.antigo"], tentativas: 0, gatilho: null, pedidoEm: null, fase: "trocada" });
  assert.deepEqual(parsePendente({ de: "0.1.0", para: "0.2.0", antigos: [], tentativas: 1, gatilho: "ocioso", pedidoEm: "2026-10-24T12:00:00.000Z", fase: "pedida" }), { de: "0.1.0", para: "0.2.0", antigos: [], tentativas: 1, gatilho: "ocioso", pedidoEm: "2026-10-24T12:00:00.000Z", fase: "pedida" });
  assert.equal(parsePendente({ de: "0.1.0", para: "0.2.0", antigos: [], gatilho: "lixo", pedidoEm: "ontem" }).gatilho, null);
  assert.equal(parsePendente({ de: "0.1.0" }), null);
  assert.equal(parsePendente(null), null);
});

test("repararTroca: repõe só o .app que sumiu no meio da troca (o .antigo existe e o alvo não)", () => {
  const existe = (p) => ["/A/x.app.antigo", "/B/x.app.antigo", "/B/x.app"].includes(p);
  assert.deepEqual(repararTroca(["/A/x.app.antigo", "/B/x.app.antigo", "/C/x.app.antigo"], existe), [{ de: "/A/x.app.antigo", para: "/A/x.app" }]);
  assert.deepEqual(repararTroca([], existe), []);
});

test("parsePreparada: só o registro completo e bem formado da versão preparada em disco", () => {
  const ok = { versao: 1, para: "0.2.0", bundle: "/u/update/app/meu-bot.app", sha256: "a".repeat(64), em: "2026-10-24T12:00:00.000Z" };
  assert.deepEqual(parsePreparada(ok), ok);
  assert.equal(parsePreparada({ ...ok, versao: 2 }), null);
  assert.equal(parsePreparada({ ...ok, para: "v0.2.0" }), null, "versão com v não é a forma gravada");
  assert.equal(parsePreparada({ ...ok, bundle: "/u/update/app/meu-bot" }), null, "tem que ser um .app");
  assert.equal(parsePreparada({ ...ok, sha256: "zz" }), null);
  assert.equal(parsePreparada({ ...ok, em: "ontem" }), null);
  assert.equal(parsePreparada("lixo"), null);
  assert.equal(parsePreparada({ ...ok, para: "0.2.0-staging.3" }).para, "0.2.0-staging.3");
});

test("cadência: uma hora mais até 5 min de jitter", () => {
  assert.equal(proximaVerificacaoMs(() => 0), CHECK_EVERY_MS);
  assert.equal(proximaVerificacaoMs(() => 1), CHECK_EVERY_MS + CHECK_JITTER_MS);
  assert.equal(proximaVerificacaoMs(() => 0.5), CHECK_EVERY_MS + CHECK_JITTER_MS / 2);
  assert.equal(proximaVerificacaoMs(() => 7), CHECK_EVERY_MS + CHECK_JITTER_MS, "random fora de 0..1 não estoura");
  assert.equal(CHECK_EVERY_MS, 60 * 60_000); assert.equal(CHECK_JITTER_MS, 5 * 60_000);
});

test("feedAindaOferece: a release confirma a preparada (igual ou mais nova); nada ou uma anterior = retirada", () => {
  assert.equal(feedAindaOferece({ version: "0.2.0" }, "0.2.0"), true);
  assert.equal(feedAindaOferece({ version: "0.3.0" }, "0.2.0"), true, "uma mais nova não invalida a preparada");
  assert.equal(feedAindaOferece({ version: "0.1.5" }, "0.2.0"), false, "a release voltou atrás");
  assert.equal(feedAindaOferece(null, "0.2.0"), false, "nada mais novo que a instalada: a preparada foi retirada");
});

test("reinício ocioso: preferência ligada, versão pronta, Mac ocioso ou bloqueado, nada em andamento, nenhum terminal", () => {
  const base = { ligado: true, pronta: true, sistema: "idle", ocupado: false, terminais: 0 };
  assert.equal(decideReinicioOcioso(base), true);
  assert.equal(decideReinicioOcioso({ ...base, sistema: "locked" }), true);
  assert.equal(decideReinicioOcioso({ ...base, sistema: "active" }), false);
  assert.equal(decideReinicioOcioso({ ...base, sistema: "unknown" }), false, "sem saber, não mexe");
  assert.equal(decideReinicioOcioso({ ...base, ligado: false }), false);
  assert.equal(decideReinicioOcioso({ ...base, pronta: false }), false);
  assert.equal(decideReinicioOcioso({ ...base, ocupado: true }), false);
  assert.equal(decideReinicioOcioso({ ...base, terminais: 1 }), false, "um terminal aberto é uma sessão da pessoa");
});

test("versão mínima do backend: só uma versão válida conta; abaixo dela o app precisa atualizar", () => {
  assert.equal(parseVersaoMinima("0.3.0"), "0.3.0");
  assert.equal(parseVersaoMinima("0.3.0-staging.2"), "0.3.0-staging.2");
  assert.equal(parseVersaoMinima("v0.3.0"), null); assert.equal(parseVersaoMinima(3), null); assert.equal(parseVersaoMinima(undefined), null);
  assert.equal(abaixoDaMinima("0.2.9", "0.3.0"), true);
  assert.equal(abaixoDaMinima("0.3.0", "0.3.0"), false);
  assert.equal(abaixoDaMinima("0.4.0", "0.3.0"), false);
  assert.equal(abaixoDaMinima("0.1.0", null), false, "backend antigo não exige nada");
  assert.equal(abaixoDaMinima("0.3.0-staging.1", "0.3.0"), true, "o staging da 0.3.0 ainda é anterior à 0.3.0");
});

test("antigosDescartaveis: a cópia anterior só sai quando o app voltou ao lugar dela", () => {
  const existe = (p) => p === "/Applications/meu-bot.app";
  const antigos = ["/Applications/meu-bot.app.antigo", "/Users/x/Desktop/meu-bot.app.antigo"];
  // A da mesa ficou sem o .app no lugar (a troca morreu entre tirar o velho e pôr o novo): apagá-la sumiria
  // com aquela instalação. Era isso que acontecia 30 s depois de confirmar a versão nova.
  assert.deepEqual(antigosDescartaveis(antigos, existe), ["/Applications/meu-bot.app.antigo"]);
  assert.deepEqual(antigosDescartaveis(antigos, () => true), antigos, "com tudo no lugar, todas saem");
  assert.deepEqual(antigosDescartaveis(antigos, () => false), [], "nenhuma no lugar: não apaga nada");
  assert.deepEqual(antigosDescartaveis([], existe), []);
});
