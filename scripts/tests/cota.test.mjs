import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const c = require("../../backend-colima/cota.js");

const QUOTA = "Disk quotas for user box-2 (uid 1001): \n     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace\n      /dev/sda1 2902256  4126300 4126300           79495       0       0        \n";
const QUOTA_ACIMA = "Disk quotas for user box-2 (uid 1001): \n     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace\n      /dev/sda1 4200000* 4126300 4538930   6days   79495       0       0        \n";
const HOME = "/home/box-2";

test("lerQuota: amostra real; acima do soft traz grace; none, vazio e sem limites = null", () => {
  assert.deepEqual(c.lerQuota(QUOTA), { usadoKb: 2902256, softKb: 4126300, hardKb: 4126300, grace: null, acimaDoSoft: false });
  const acima = c.lerQuota(QUOTA_ACIMA);
  assert.equal(acima.grace, "6days");
  assert.equal(acima.acimaDoSoft, true);
  assert.equal(acima.usadoKb, 4200000);
  assert.equal(c.lerQuota("Disk quotas for user x (uid 1): none\n"), null);
  assert.equal(c.lerQuota(""), null);
  assert.equal(c.lerQuota(undefined), null);
  assert.equal(c.lerQuota("lixo qualquer\n"), null);
  assert.equal(c.lerQuota("      /dev/sda1 100  0 0           79495       0       0        \n"), null);
  const soHard = c.lerQuota("      /dev/sda1 1  0 5           79495       0       0        \n");
  assert.equal(c.limiteKbDe(soHard), 5);
  assert.equal(c.limiteKbDe(c.lerQuota(QUOTA)), 4126300);
});

test("duArgs separa `publico` na chamada -skL; lerDu ignora linhas malformadas", () => {
  const a = c.duArgs(HOME);
  assert.equal(a.normal[0], "-sk");
  assert.equal(a.link[0], "-skL");
  assert.deepEqual(a.link.slice(1), [`${HOME}/publico`]);
  assert.ok(!a.normal.includes(`${HOME}/publico`));
  assert.ok(a.normal.includes(`${HOME}/.hermes/cache/images`));
  const du = c.lerDu(`120\t${HOME}/.hermes/cache/images\ndu: cannot access '${HOME}/.npm': No such file or directory\n\n30\t${HOME}/.hermes/image_cache\n`);
  assert.equal(du.size, 2);
  assert.equal(du.get(`${HOME}/.hermes/cache/images`), 120);
});

test("montarItens: junta as duas pastas de imagens, calcula outros, mantém programas em 0 e some com o resto vazio", () => {
  const du = c.lerDu(`120\t${HOME}/.hermes/cache/images\n30\t${HOME}/.hermes/image_cache\n0\t${HOME}/.hermes/tools\n`);
  const itens = c.montarItens(du, HOME, 1000);
  assert.deepEqual(itens.map((i) => i.id), ["imagens", "programas", "outros"]);
  assert.equal(itens[0].kb, 150);
  assert.equal(itens[0].apagavel, true);
  assert.equal(itens[1].kb, 0);
  assert.equal(itens[1].dela, false);
  assert.deepEqual(itens[2], { id: "outros", rotulo: "outros", kb: 850, dela: true, apagavel: false });
  // du maior que a quota (arredondamentos): outros nunca negativo, some.
  assert.deepEqual(c.montarItens(du, HOME, 100).map((i) => i.id), ["imagens", "programas"]);
  assert.deepEqual(c.montarItens(du, HOME, 150).map((i) => i.id), ["imagens", "programas"]);
});

test("pctDe, nivelDe, fmtGb e resumoItens", () => {
  assert.equal(c.pctDe(0, 0), 0);
  assert.equal(c.pctDe(50, 100), 50);
  assert.equal(c.pctDe(5000, 1), 999);
  assert.equal(c.nivelDe(79), "ok");
  assert.equal(c.nivelDe(80), "perto");
  assert.equal(c.nivelDe(95), "critico");
  assert.equal(c.nivelDe(100), "cheio");
  assert.equal(c.fmtGb(4126300), "3,9 GB");
  assert.equal(c.fmtGb(43476), "42 MB");
  assert.equal(c.fmtGb(512), "512 KB");
  const itens = [
    { id: "imagens", rotulo: "imagens", kb: 300 * 1024 },
    { id: "audios", rotulo: "áudios", kb: 900 * 1024 },
    { id: "outros", rotulo: "outros", kb: 5000 * 1024 },
    { id: "programas", rotulo: "programas do agente (fixos)", kb: 2.3 * 1024 * 1024 },
  ];
  assert.equal(c.resumoItens(itens), "programas do agente (fixos) 2,3 GB, áudios 900 MB, imagens 300 MB");
  assert.equal(c.resumoItens(itens, 1), "programas do agente (fixos) 2,3 GB");
  assert.equal(c.resumoItens([{ id: "outros", rotulo: "outros", kb: 2048 }]), "outros 2 MB");
});

const leitura = (pct, extra = {}) => ({
  usadoKb: Math.round((pct / 100) * 4126300), limiteKb: 4126300, hardKb: 4126300, pct, nivel: c.nivelDe(pct), grace: null,
  itens: [{ id: "audios", rotulo: "áudios", kb: 900 * 1024 }, { id: "programas", rotulo: "programas do agente (fixos)", kb: 1024 }],
  em: 0, ...extra,
});

test("VigiaCota: avisa uma vez ao cruzar 80, não repete oscilando e rearma só 5 pontos abaixo", () => {
  const v = new c.VigiaCota();
  assert.deepEqual(v.registrar(leitura(70), 1), { nivel: "ok", avisar: [] });
  const r = v.registrar(leitura(82), 2);
  assert.equal(r.nivel, "perto");
  assert.equal(r.avisar.length, 1);
  assert.equal(r.avisar[0].nivel, 80);
  assert.match(r.avisar[0].texto, /82%/);
  assert.match(r.avisar[0].texto, /Liberar espaço/);
  assert.equal(v.avisado["80"], 2);
  assert.deepEqual(v.registrar(leitura(84), 3).avisar, []);
  assert.deepEqual(v.registrar(leitura(76), 4).avisar, [], "entre 75 e 80 continua armado");
  assert.equal(v.avisado["80"], 2);
  assert.deepEqual(v.registrar(leitura(74), 5).avisar, []);
  assert.equal(v.avisado["80"], undefined, "abaixo de 75 rearma");
  assert.equal(v.registrar(leitura(81), 6).avisar.length, 1, "e avisa de novo ao cruzar");
});

test("VigiaCota: cruzar 80 e 95 de uma vez manda só o de 95 e marca os dois; avisado persistido não repete", () => {
  const v = new c.VigiaCota();
  const r = v.registrar(leitura(97), 10);
  assert.equal(r.nivel, "critico");
  assert.equal(r.avisar.length, 1);
  assert.equal(r.avisar[0].nivel, 95);
  assert.match(r.avisar[0].texto, /97%/);
  assert.equal(v.avisado["80"], 10);
  assert.equal(v.avisado["95"], 10);
  assert.equal(v.avisado["100"], undefined);
  const depois = new c.VigiaCota({ "80": 1 });
  assert.deepEqual(depois.registrar(leitura(85), 20).avisar, []);
  assert.equal(depois.nivel, undefined);
  assert.equal(depois.ultima.pct, 85);
});

test("VigiaCota: link de pagamento no texto quando há; grace no texto de 100%; leitura null limpa ultima", () => {
  const com = new c.VigiaCota().registrar(leitura(82), 1, { link: "https://pague.exemplo/cota" });
  assert.match(com.avisar[0].texto, /https:\/\/pague\.exemplo\/cota/);
  const sem = new c.VigiaCota().registrar(leitura(82), 1);
  assert.match(sem.avisar[0].texto, /fale com o admin/);
  const cheio = new c.VigiaCota().registrar(leitura(100, { grace: "6days" }), 1);
  assert.equal(cheio.nivel, "cheio");
  assert.equal(cheio.avisar[0].nivel, 100);
  assert.match(cheio.avisar[0].texto, /6days/);
  assert.match(cheio.avisar[0].texto, /áudios 900 MB/);
  const semGrace = new c.VigiaCota().registrar(leitura(101), 1);
  assert.match(semGrace.avisar[0].texto, /alguns dias/);
  const v = new c.VigiaCota();
  v.registrar(leitura(82), 1);
  assert.deepEqual(v.registrar(null, 2), { nivel: "ok", avisar: [] });
  assert.equal(v.ultima, null);
  assert.equal(v.avisado["80"], 1, "quota indisponível não mexe no que já foi avisado");
});
