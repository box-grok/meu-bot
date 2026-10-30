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

const CG = {
  current: "1363148800\n", stat: "anon 331350016\nfile 1000000000\n", high: "1932525568\n", max: "2147483648\n", swapCurrent: "12288\n",
  events: "low 0\nhigh 393\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n", pressure: "some avg10=0.00 avg60=0.00 avg300=0.00 total=1234\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
  cpuPressure: "some avg10=1.50 avg60=3.20 avg300=2.00 total=99\n", cpuStat: "usage_usec 1\nuser_usec 1\nsystem_usec 0\nnr_periods 791000\nnr_throttled 3083\nthrottled_usec 2439000000\n",
};

test("box: o caminho da fatia vem do /proc/self/cgroup; os arquivos do cgroup viram MB, eventos e PSI", () => {
  assert.equal(s.caminhoDaBox("0::/user.slice/user-1001.slice/user@1001.service/app.slice/meu-bot-backend.service\n"), "/user.slice/user-1001.slice");
  assert.equal(s.caminhoDaBox("0::/system.slice/sshd.service\n"), null); assert.equal(s.caminhoDaBox("0::/user.slice/user-0.slice/session-1.scope"), "/user.slice/user-0.slice");
  assert.equal(s.caminhoDaBox(""), null);
  const b = s.lerBox(CG);
  assert.deepEqual(b, { usoMB: 1300, anonMB: 316, altoMB: 1843, tetoMB: 2048, swapMB: 0, eventos: { high: 393, max: 0, oomKill: 0 }, psiMem60: 0, psiCpu60: 3.2, periodos: 791000, estranguladoUsec: 2439000000 });
  assert.equal(s.lerBox({ ...CG, max: "max\n", high: "max\n" }).tetoMB, null);
  assert.equal(s.lerBox({ current: "", stat: "" }), null);
});

test("Vigia: a própria box no limite só avisa na 3ª leitura seguida (OOM na hora), com texto de memória ou de CPU, antes dos outros tipos", () => {
  const ok = { memTotalMB: 32000, memLivreMB: 28000, swapTotalMB: 8192, discoLivrePct: 90, lagMs: 3 };
  const box = s.lerBox(CG);
  const v = new s.Vigia();
  assert.deepEqual(v.registrar({ ...ok, box }, 1).avisar, [], "folgada");
  const cheia = { ...box, anonMB: 1800 };
  assert.deepEqual(v.registrar({ ...ok, box: cheia }, 2).avisar, []); assert.deepEqual(v.registrar({ ...ok, box: cheia }, 3).avisar, []);
  const r = v.registrar({ ...ok, box: cheia }, 4);
  assert.equal(r.alerta, "box"); assert.match(r.avisar[0].texto, /limite de memória da sua box \(1800 MB de 2048 MB\)/);
  assert.deepEqual(v.registrar({ ...ok, box: cheia }, 5).avisar, [], "6 h de intervalo"); assert.equal(v.ultima.alerta, "box");
  // CPU: só a PSI de CPU alta → o texto de processador.
  const w = new s.Vigia();
  for (let i = 0; i < 2; i += 1) w.registrar({ ...ok, box: { ...box, psiCpu60: 70 } }, 10 + i);
  assert.match(w.registrar({ ...ok, box: { ...box, psiCpu60: 70 } }, 12).avisar[0].texto, /sem fôlego de processador.*70%/);
  // OOM: o contador subiu desde a leitura anterior → avisa na hora, uma vez.
  const x = new s.Vigia();
  x.registrar({ ...ok, box }, 20);
  const o = x.registrar({ ...ok, box: { ...box, eventos: { ...box.eventos, oomKill: 1 } } }, 21);
  assert.equal(o.avisar.length, 1); assert.equal(o.alerta, "box");
  // Prioridade: box antes de memória da máquina; sem box (null) nada muda.
  const y = new s.Vigia({ boxPct: 1 });
  const baixa = { memTotalMB: 8000, memLivreMB: 700, swapTotalMB: 0, discoLivrePct: 60, lagMs: 3, box };
  y.registrar(baixa, 30); y.registrar(baixa, 31);
  assert.equal(y.registrar(baixa, 32).alerta, "box");
  const z = new s.Vigia(); z.registrar({ ...ok, box: null }, 40); z.registrar({ ...ok, box: null }, 41);
  assert.deepEqual(z.registrar({ ...ok, box: null }, 42), { alerta: null, avisar: [] });
});
