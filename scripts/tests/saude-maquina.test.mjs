import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const s = require("../../backend-colima/saude-maquina.js");
const f = require("../../backend-colima/faxina.js");

const MEMINFO = "MemTotal:        8130000 kB\nMemFree:          580000 kB\nMemAvailable:    2500000 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n";

test("lerMeminfo: MB arredondados; sem MemAvailable (kernel antigo) ou lixo = null", () => {
  assert.deepEqual(s.lerMeminfo(MEMINFO), { memTotalMB: 7939, memLivreMB: 2441, swapTotalMB: 0, swapLivreMB: 0 });
  assert.equal(s.lerMeminfo("MemTotal: 100 kB\n"), null);
  assert.equal(s.lerMeminfo(""), null);
  assert.equal(s.discoLivrePct({ blocks: 1000, bavail: 612 }), 61.2);
  assert.equal(s.discoLivrePct({ blocks: 0, bavail: 0 }), null);
});

test("Vigia: memória abaixo de 10% só avisa na 3ª leitura seguida, e de novo só depois de 6 h", () => {
  const v = new s.Vigia();
  const baixa = { memTotalMB: 8000, memLivreMB: 700, swapTotalMB: 0, discoLivrePct: 60, lagMs: 3 };
  const t0 = 1_000_000;
  assert.deepEqual(v.registrar(baixa, t0), { alerta: null, avisar: [] });
  assert.deepEqual(v.registrar(baixa, t0 + 30_000).avisar, []);
  const r = v.registrar(baixa, t0 + 60_000);
  assert.equal(r.alerta, "memoria");
  assert.equal(r.avisar.length, 1);
  assert.match(r.avisar[0].texto, /700 MB livres de 8000 MB e ela não tem swap/);
  assert.deepEqual(v.registrar(baixa, t0 + 90_000).avisar, [], "dentro das 6 h não repete");
  assert.equal(v.ultima.alerta, "memoria", "o /health continua mostrando o alerta");
  assert.equal(v.registrar(baixa, t0 + 60_000 + 6 * 3600_000).avisar.length, 1, "passadas 6 h avisa de novo");
  // Uma leitura boa no meio zera a contagem.
  const w = new s.Vigia();
  w.registrar(baixa, t0); w.registrar(baixa, t0 + 1); w.registrar({ ...baixa, memLivreMB: 4000 }, t0 + 2);
  assert.deepEqual(w.registrar(baixa, t0 + 3).avisar, []);
  assert.equal(w.ultima.alerta, null);
});

test("Vigia: disco avisa na hora; travamento precisa de 3 seguidas; o intervalo sobrevive a reinício (avisadoEm)", () => {
  const ok = { memTotalMB: 8000, memLivreMB: 4000, swapTotalMB: 2048, discoLivrePct: 40, lagMs: 5 };
  const v = new s.Vigia();
  const d = v.registrar({ ...ok, discoLivrePct: 3.5 }, 10);
  assert.deepEqual([d.alerta, d.avisar.map((a) => a.tipo)], ["disco", ["disco"]]);
  assert.match(d.avisar[0].texto, /3.5% livre/);
  for (let i = 0; i < 2; i += 1) assert.deepEqual(v.registrar({ ...ok, lagMs: 2500 }, 20 + i).avisar, []);
  assert.deepEqual(v.registrar({ ...ok, lagMs: 2500 }, 30).avisar.map((a) => a.tipo), ["lag"]);
  // Reiniciado com o registro dos avisos: o disco não repete dentro das 6 h.
  const depois = new s.Vigia({}, { disco: 10 });
  assert.deepEqual(depois.registrar({ ...ok, discoLivrePct: 3 }, 1000).avisar, []);
  // Limite de teste (MEU_BOT_VIGIA_MEM_PCT=100): qualquer leitura conta como baixa.
  const teste = new s.Vigia({ memMinPct: 100 });
  teste.registrar(ok, 1); teste.registrar(ok, 2);
  assert.equal(teste.registrar(ok, 3).alerta, "memoria");
});

test("faxina: corta para as últimas N linhas; abaixo do teto não mexe", () => {
  const dir = mkdtempSync(join(tmpdir(), "meu-bot-faxina-"));
  const ev = join(dir, "eventos.jsonl");
  writeFileSync(ev, Array.from({ length: 10 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
  assert.equal(f.cortarLinhas(ev, 4), 6);
  assert.deepEqual(readFileSync(ev, "utf8").trim().split("\n").map((l) => JSON.parse(l).i), [6, 7, 8, 9]);
  assert.equal(statSync(ev).mode & 0o777, 0o600);
  assert.equal(f.cortarLinhas(ev, 4), 0);
  assert.equal(f.cortarLinhas(join(dir, "nao-existe"), 4), 0);
});

test("faxina: log acima do teto vai para .1 e o original fica vazio no mesmo lugar (quem escreve com >> segue)", () => {
  const dir = mkdtempSync(join(tmpdir(), "meu-bot-faxina-"));
  const log = join(dir, "backend.log");
  writeFileSync(log, "x".repeat(2000));
  assert.equal(f.rodarLog(log, 5000), false);
  writeFileSync(log, "y".repeat(6000));
  assert.equal(f.rodarLog(log, 5000), true);
  assert.equal(readFileSync(`${log}.1`, "utf8").length, 6000);
  assert.equal(statSync(log).size, 0);
  const feito = f.faxinar({ eventos: [join(dir, "nada.jsonl")], logs: [log, join(dir, "nada.log")], maxBytes: 5000 });
  assert.deepEqual(feito, [], "nada a fazer, nada no log");
  assert.ok(existsSync(`${log}.1`));
});
