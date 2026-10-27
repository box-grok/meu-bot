import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const FIXTURE = path.join(RAIZ, "scripts/tests/fixtures/claude-falso.sh");

/** Máquina de mentira: HOME com ~/.claude logado, backend com o porteiro, registro com a conta "Segunda" na frente da padrão. */
function maquina() {
  const home = mkdtempSync(path.join(tmpdir(), "meu-bot-porteiro-"));
  const base = path.join(home, ".local/share/meu-bot");
  const dest = path.join(base, "backend");
  const bin = path.join(base, "bin");
  mkdirSync(dest, { recursive: true }); mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, ".claude/projects"), { recursive: true });
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "padrao@x.y" } }));
  for (const f of ["contas-claude.js", "account-status.js", "claude-porteiro.js"]) copyFileSync(path.join(RAIZ, "backend-colima", f), path.join(dest, f));
  writeFileSync(path.join(dest, ".env"), `PORT=1\nCLAUDE_BIN=${FIXTURE}\n`);
  const shim = readFileSync(path.join(RAIZ, "backend-colima/claude-porteiro.sh"), "utf8").replace(/__NODE__/g, process.execPath).replace(/__DEST__/g, dest);
  writeFileSync(path.join(bin, "claude"), shim); chmodSync(path.join(bin, "claude"), 0o755);
  const contas = require(path.join(dest, "contas-claude.js")).abrir({ base, claudeHome: path.join(home, ".claude"), claudeJson: path.join(home, ".claude.json"), temCredencial: () => false });
  const segunda = contas.criar("Segunda");
  writeFileSync(path.join(segunda.home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "segunda@x.y" } }));
  const fake = path.join(home, "fake"); mkdirSync(fake);
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, FAKE_DIR: fake, MEU_BOT_BASE: base };
  const claude = (args, extra = {}) => spawnSync("bash", [path.join(bin, "claude"), ...args], { env: { ...env, ...extra }, input: "oi\n", encoding: "utf8", cwd: home });
  const log = () => (existsSync(path.join(fake, "log")) ? readFileSync(path.join(fake, "log"), "utf8").trim().split("\n") : []);
  const uso = () => JSON.parse(readFileSync(path.join(base, "contas-claude-uso.json"), "utf8"));
  const eventos = () => (existsSync(path.join(base, "contas-claude-eventos.jsonl")) ? readFileSync(path.join(base, "contas-claude-eventos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { home, base, segunda, contas, claude, log, uso, eventos, limpar: () => rmSync(home, { recursive: true, force: true }) };
}
const STREAM = ["-p", "--output-format", "stream-json", "--verbose"];

test("porteiro: a conta da frente atende; no limite marca esgotada, anota a troca e sai com 1; a chamada seguinte vai pela padrão", () => {
  const m = maquina();
  const r1 = m.claude(STREAM);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /olá da chamada 1 em /);
  assert.equal(m.log()[0].split("|")[1], m.segunda.home, "chamada 1 na Segunda (ordem 1; padrão por último)");
  assert.equal(m.uso()[m.segunda.id].sessao.pct, 42, "o uso visto no stream vai para o registro");
  assert.match(r1.stderr, /usando a conta do Claude "Segunda"|^$/);
  // Chamada 2: o claude falso rejeita (rate_limit_event rejected + result de erro).
  const r2 = m.claude(STREAM);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /"type":"result"/, "a saída passa intacta, inclusive o result");
  assert.equal(m.uso()[m.segunda.id].estado, "esgotada");
  const ev = m.eventos(); assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].origem, ev[0].de, ev[0].para], ["cli", "Segunda", "Login padrão"]);
  // Chamada 3: processo novo → padrão (CLAUDE_CONFIG_DIR vazio), mesmo stream.
  const r3 = m.claude(STREAM);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(m.log()[2].split("|")[1], "", "padrão = sem CLAUDE_CONFIG_DIR");
  assert.match(r3.stdout, /olá da chamada 3 em padrao/);
  m.limpar();
});

test("porteiro: passa direto com MEU_BOT_PORTEIRO=0 e nos comandos de manutenção; interativo escolhe a conta pelo ambiente", () => {
  const m = maquina();
  const v = m.claude(["--version"]);
  assert.equal(v.stdout.trim(), "2.1.310 (Claude Code)"); assert.equal(m.log().length, 0);
  const r1 = m.claude(STREAM, { MEU_BOT_PORTEIRO: "0" });
  assert.equal(r1.status, 0); assert.equal(m.log()[0].split("|")[1], "", "com MEU_BOT_PORTEIRO=0 nada é escolhido: login padrão");
  // Chamada 2 do falso seria o limite: não é nossa (passou direto), então ninguém marca nada.
  const r2 = m.claude(STREAM, { MEU_BOT_PORTEIRO: "0" });
  assert.equal(r2.status, 1); assert.ok(!existsSync(path.join(m.base, "contas-claude-uso.json")) || m.uso()[m.segunda.id] === undefined);
  // Interativo (sem stream-json): o shim faz eval dos exports e exec; o falso vê o CLAUDE_CONFIG_DIR da Segunda.
  const r3 = m.claude(["-p"]);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(m.log()[2].split("|")[1], m.segunda.home);
  assert.match(r3.stderr, /usando a conta do Claude "Segunda"/);
  m.limpar();
});

test("porteiro: MEU_BOT_FORCAR_LIMITE=<id> esgota a conta na chamada (teste sem gastar cota); sem conta livre segue na padrão com aviso", () => {
  const m = maquina();
  const r1 = m.claude(STREAM, { MEU_BOT_FORCAR_LIMITE: m.segunda.id });
  assert.equal(r1.status, 1, "turno encerrado como no limite");
  assert.equal(m.uso()[m.segunda.id].estado, "esgotada");
  assert.equal(m.eventos()[0].motivo, "limite forçado");
  // Padrão também esgotada: nenhuma livre → ainda roda, na padrão, avisando.
  m.contas.marcar("padrao", "esgotada", "teste", Math.floor(Date.now() / 1000) + 3600);
  const r2 = m.claude(STREAM);
  assert.equal(r2.status, 1, "chamada 2 do falso é o limite dele; o que importa é ter rodado");
  assert.match(r2.stderr, /todas as contas do Claude estão no limite; seguindo na conta padrão/);
  assert.equal(m.log()[1].split("|")[1], "");
  m.limpar();
});

test("porteiro: sem o node ou sem o .js do porteiro, o shim ainda roda o claude real", () => {
  const m = maquina();
  rmSync(path.join(m.base, "backend/claude-porteiro.js"));
  const r = m.claude(STREAM);
  assert.equal(r.status, 0, r.stderr); assert.equal(m.log()[0].split("|")[1], "");
  m.limpar();
});
