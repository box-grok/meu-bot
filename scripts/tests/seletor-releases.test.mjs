import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { listarReleases, decideInstalarListada, parseFixada, deveVerificarSozinho, podeTrocarComFixada, decideAplicacaoEscolhida, decideReaproveitar, escolherRelease, candidataDe } = req("../../dist/main/atualizacao/updater-core.js");
const { mesclarCamposPerdidos } = req("../../dist/main/app/settings-normalize.js");
import { linhaRelease, releasesVisiveis, dataCurta, updateStateText } from "../../dist/renderer/lib/update-text.js";

const APP = "meu-bot-staging", ARCH = "arm64";
const zip = (v) => `${APP}-${v}-${ARCH}.zip`;
const rel = (tag, { sig = true, asset = true, prerelease = /staging/.test(tag), em = "2026-11-09T19:30:00Z" } = {}) => {
  const v = tag.replace(/^v/, "");
  const nomes = asset ? [zip(v), ...(sig ? [`${zip(v)}.sig`] : [])] : [`outro-app-${v}-${ARCH}.zip`];
  return { tag_name: tag, draft: false, prerelease, published_at: em, assets: nomes.map((n) => ({ name: n, browser_download_url: `https://x/${n}`, size: 1 })) };
};
const want = (current, minima = null) => ({ app: APP, arch: ARCH, current, canal: "staging", minima });

test("lista do super admin: todas as do canal, mais nova primeiro, com a instalada e as mais velhas", () => {
  const raw = [rel("v0.79.3-staging.1"), rel("v0.80.0-staging.1"), rel("v0.79.3"), rel("v0.79.3-staging.2")];
  const l = listarReleases(raw, want("0.79.3-staging.2"));
  assert.deepEqual(l.map((x) => [x.versao, x.relacao]), [["0.80.0-staging.1", "mais-nova"], ["0.79.3-staging.2", "atual"], ["0.79.3-staging.1", "mais-velha"]], "a estável 0.79.3 é do outro canal");
  assert.equal(l[0].candidata.asset.name, zip("0.80.0-staging.1"));
  assert.equal(l[0].publicadaEm, "2026-11-09T19:30:00Z");
});

test("lista: sem .sig vira motivo; release de outro produto some; abaixo da mínima marcada; corpo estranho = vazia", () => {
  const raw = [rel("v0.80.0-staging.1", { sig: false }), rel("v0.79.3-staging.2", { asset: false }), rel("v0.79.0-staging.1")];
  const l = listarReleases(raw, want("0.80.0-staging.0", "0.79.3"));
  assert.deepEqual(l.map((x) => x.versao), ["0.80.0-staging.1", "0.79.0-staging.1"]);
  assert.equal(l[0].candidata, null); assert.equal(l[0].motivo, "sem-assinatura");
  assert.equal(l[1].abaixoDaMinima, true);
  assert.deepEqual(listarReleases({ message: "rate limit" }, want("0.1.0")), []);
});

test("estável: lista as não-pre-release com tag x.y.z", () => {
  const raw = [rel("v0.79.3", { prerelease: false }), rel("v0.78.4", { prerelease: false }), rel("v0.80.0-staging.1")].map((r) => ({ ...r, assets: r.assets.map((a) => ({ ...a, name: a.name.replace(APP, "meu-bot") })) }));
  const l = listarReleases(raw, { app: "meu-bot", arch: ARCH, current: "0.80.0", canal: "estavel", minima: null });
  assert.deepEqual(l.map((x) => [x.versao, x.relacao]), [["0.79.3", "mais-velha"], ["0.78.4", "mais-velha"]]);
});

test("o feed normal continua só para a frente (a lista não mexeu nele)", () => {
  const raw = [rel("v0.79.3-staging.1"), rel("v0.79.3-staging.2")];
  assert.equal(candidataDe(escolherRelease(raw, { app: APP, arch: ARCH, current: "0.79.3-staging.2", canal: "staging" })), null);
  assert.equal(candidataDe(escolherRelease(raw, { app: APP, arch: ARCH, current: "0.79.3-staging.1", canal: "staging" })).version, "0.79.3-staging.2");
});

test("instalar uma linha: a atual, abaixo da mínima, sem candidata ou sumida recusam com motivo", () => {
  const [nova, atual, velha] = listarReleases([rel("v0.80.0-staging.1"), rel("v0.79.3-staging.2"), rel("v0.79.3-staging.1")], want("0.79.3-staging.2"));
  assert.equal(decideInstalarListada(velha).tipo, "instalar", "para trás é justamente o que o super admin pode");
  assert.equal(decideInstalarListada(nova).tipo, "instalar");
  assert.match(decideInstalarListada(atual).motivo, /já é a instalada/);
  assert.match(decideInstalarListada(undefined).motivo, /não está mais na lista/);
  assert.match(decideInstalarListada({ ...velha, abaixoDaMinima: true }).motivo, /mínima/);
  assert.match(decideInstalarListada({ ...velha, candidata: null, motivo: "sem-assinatura" }).motivo, /assinatura/);
});

test("fixação: arquivo válido; o ciclo não verifica; troca só para a própria fixada", () => {
  assert.deepEqual(parseFixada({ versao: "0.79.3-staging.1", por: "box@agentesgrok.com", em: "2026-11-10T16:00:00Z" }), { versao: "0.79.3-staging.1", por: "box@agentesgrok.com", em: "2026-11-10T16:00:00Z" });
  assert.equal(parseFixada({ versao: "x", por: "a", em: "2026-11-10T16:00:00Z" }), null);
  assert.equal(parseFixada(null), null);
  for (const t of ["inicio", "periodico", "acordou", "rede-voltou", "atualizar-agora"]) assert.equal(deveVerificarSozinho("0.79.3", t), false, t);
  for (const t of ["explicito", "versao-minima"]) assert.equal(deveVerificarSozinho("0.79.3", t), true, t);
  assert.equal(deveVerificarSozinho(null, "periodico"), true, "sem fixação, o ciclo de sempre");
  assert.equal(podeTrocarComFixada(null, "0.80.0"), true);
  assert.equal(podeTrocarComFixada("0.79.3", "0.80.0"), false, "fixada: a mais nova não entra calada (ocioso, ao sair)");
  assert.equal(podeTrocarComFixada("0.79.3", "0.79.3"), true);
  assert.equal(podeTrocarComFixada(null, null), false);
});

test("aplicar a escolhida: só exatamente a pedida, mais velha inclusive", () => {
  assert.deepEqual(decideAplicacaoEscolhida("0.79.3", "0.79.3"), { tipo: "seguir", versao: "0.79.3", trocou: false });
  assert.equal(decideAplicacaoEscolhida("0.79.3", "0.80.0").tipo, "recusar");
  assert.equal(decideAplicacaoEscolhida("0.79.3", null).tipo, "recusar");
});

test("reaproveitar ao abrir: a fixada mais velha serve; com fixação, nenhuma outra", () => {
  const p = (para) => ({ versao: 1, para, bundle: "/x/a.app", sha256: "0".repeat(64), em: "2026-11-10T16:00:00Z" });
  assert.equal(decideReaproveitar(p("0.79.3"), "0.80.0", () => true, "0.79.3").tipo, "usar");
  assert.equal(decideReaproveitar(p("0.80.1"), "0.80.0", () => true, "0.79.3").tipo, "descartar");
  assert.equal(decideReaproveitar(p("0.79.3"), "0.79.3", () => true, "0.79.3").tipo, "descartar", "já está nela");
  assert.equal(decideReaproveitar(p("0.79.3"), "0.80.0", () => true).tipo, "descartar", "sem fixação, para trás não");
});

test("configurações que a versão velha apagou voltam sem passar por cima do que mudou depois", () => {
  assert.deepEqual(mesclarCamposPerdidos({ version: 1, theme: "light" }, { version: 1, theme: "dark", mcpLigado: true, abaFixa: "chat" }), { version: 1, theme: "light", mcpLigado: true, abaFixa: "chat" });
  assert.deepEqual(mesclarCamposPerdidos({ a: 1 }, null), { a: 1 });
  assert.deepEqual(mesclarCamposPerdidos(null, { a: 1 }), { a: 1 });
});

test("tela: linha de cada release, confirmação em dois cliques e aviso de voltar", () => {
  const base = { versao: "0.79.3-staging.1", publicadaEm: null, relacao: "mais-velha", abaixoDaMinima: false, motivo: null };
  assert.deepEqual(linhaRelease({ ...base, relacao: "atual" }, false), { selo: "instalada", kind: "ok", botao: null, aviso: null });
  assert.equal(linhaRelease({ ...base, abaixoDaMinima: true }, false).botao, null);
  assert.equal(linhaRelease({ ...base, motivo: "a 0.79.3-staging.1 foi publicada sem a assinatura ao lado do arquivo" }, false).botao, null);
  const primeiro = linhaRelease(base, false);
  assert.equal(primeiro.botao, "Instalar esta"); assert.equal(primeiro.aviso, null); assert.equal(primeiro.selo, "mais velha");
  const segundo = linhaRelease(base, true);
  assert.equal(segundo.botao, "Confirmar: instalar a 0.79.3-staging.1");
  assert.match(segundo.aviso, /Voltar a atualizar sozinho/); assert.match(segundo.aviso, /voltam ao padrão/); assert.match(segundo.aviso, /até fechar o app/);
  assert.doesNotMatch(linhaRelease({ ...base, relacao: "mais-nova" }, true).aviso, /voltam ao padrão/);
});

test("tela: a frase da versão fixada diz quem fixou e se há mais nova", () => {
  const u = { current: "0.79.3", available: "0.80.0", ready: null, checking: false, error: null, errorKind: null, phase: "up-to-date", checkedAt: null, progress: null, aguardando: false, ocupadoAoAplicar: false, minima: null, abaixoDaMinima: false, atualizarOcioso: true, buildLocal: false, commit: "", arch: "arm64", fixada: { versao: "0.79.3", por: "box@agentesgrok.com" } };
  const t = updateStateText(u, "meu-bot");
  assert.equal(t.text, "Versão fixada na 0.79.3 por box@agentesgrok.com: o app não se atualiza sozinho. Há a 0.80.0 publicada.");
  assert.equal(t.kind, "warn");
  assert.equal(updateStateText({ ...u, available: null }, "meu-bot").text, "Versão fixada na 0.79.3 por box@agentesgrok.com: o app não se atualiza sozinho.");
  assert.equal(dataCurta("2026-11-09T19:30:00Z", Date.parse("2026-11-10T00:00:00Z")), "9 nov");
  assert.equal(dataCurta("2025-03-01T12:00:00Z", Date.parse("2026-11-10T00:00:00Z")), "1 mar 2025");
  assert.equal(dataCurta(null), "");
});

test("tela: a lista recolhe as mais velhas além das 2 mais recentes", () => {
  const r = (versao, relacao) => ({ versao, relacao });
  const rs = [r("0.83.0-staging.1", "mais-nova"), r("0.82.0-staging.2", "atual"), r("0.82.0-staging.1", "mais-velha"), r("0.81.0-staging.1", "mais-velha"), r("0.80.0-staging.4", "mais-velha"), r("0.1.0-staging.1", "mais-velha")];
  const { visiveis, ocultas } = releasesVisiveis(rs, false);
  assert.deepEqual(visiveis.map((x) => x.versao), ["0.83.0-staging.1", "0.82.0-staging.2", "0.82.0-staging.1", "0.81.0-staging.1"]);
  assert.equal(ocultas, 2);
  assert.deepEqual(releasesVisiveis(rs, true), { visiveis: rs, ocultas: 0 });
  assert.deepEqual(releasesVisiveis(rs.slice(0, 3), false).ocultas, 0);
});
