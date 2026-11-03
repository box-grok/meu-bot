import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// O install-transcricao.sh (OpenClaw) num HOME de mentira, com `openclaw`, `sudo` e `timeout` falsos: com o transcritor
// compartilhado da máquina ele só aponta o OpenClaw (nada baixado); sem ele e sem ffmpeg/sudo, sai com 3 e aponta o admin.
const SCRIPT = path.join(import.meta.dirname, "..", "..", "backend-colima", "install-transcricao.sh");

function maquina({ models = "[]", transcritor = true, venvAntigo = false, semPython = false, testeFalha = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "transcricao-"));
  const bin = path.join(home, "bin-falso"); fs.mkdirSync(bin);
  const w = (p, txt, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); if (mode) fs.chmodSync(p, mode); };
  w(path.join(bin, "timeout"), "#!/bin/bash\nshift; exec \"$@\"\n", 0o755);
  // `python3` quebrado = sem o WAV do teste; `testeFalha` = o OpenClaw não confirma a transcrição.
  if (semPython) w(path.join(bin, "python3"), "#!/bin/bash\nexit 1\n", 0o755);
  if (testeFalha) w(path.join(home, "teste-falha"), "");
  w(path.join(bin, "sudo"), "#!/bin/bash\nexit 1\n", 0o755);
  w(path.join(bin, "openclaw"), `#!/bin/bash
echo "$*" >> "$HOME/openclaw-chamadas.log"
case "$*" in
  "config get tools.media.models") cat "$HOME/models.json";;
  "capability audio transcribe --file "*) [ -e "$HOME/teste-falha" ] && echo '{"ok": false}' || echo '{"ok": true}';;
  *) exit 0;;
esac
`, 0o755);
  w(path.join(home, "models.json"), models);
  const tt = path.join(home, "transcrever-texto");
  if (transcritor) w(tt, "#!/bin/sh\necho oi\n", 0o755);
  if (venvAntigo) { w(path.join(home, ".local/share/meu-bot/transcricao/venv/bin/python"), "", 0o755); w(path.join(home, ".local/bin/meu-bot-transcrever"), "", 0o755); }
  const roda = (...args) => {
    const r = spawnSync("bash", [SCRIPT, ...args], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, MEU_BOT_TRANSCRITOR: tt }, encoding: "utf8" });
    let chamadas = [];
    try { chamadas = fs.readFileSync(path.join(home, "openclaw-chamadas.log"), "utf8").trim().split("\n").filter(Boolean); } catch { /* nenhuma */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, ultima: r.stdout.trim().split("\n").pop() ?? "", chamadas };
  };
  return { home, roda, limpar: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("com o transcritor compartilhado da máquina: só aponta o OpenClaw para ele, nada por usuário, e o venv antigo sai", () => {
  const m = maquina({ venvAntigo: true });
  const r = m.roda();
  assert.equal(r.code, 0, r.out);
  assert.ok(r.chamadas.some((c) => c.startsWith("config set tools.media.models ") && c.includes(path.join(m.home, "transcrever-texto")) && c.includes('"capabilities":["audio"]')), r.chamadas.join("\n"));
  assert.ok(r.chamadas.includes("config set tools.media.audio.enabled true --strict-json"));
  assert.ok(!fs.existsSync(path.join(m.home, ".local/share/meu-bot/transcricao")), "o ambiente por usuário de antes foi apagado");
  assert.ok(!fs.existsSync(path.join(m.home, ".local/bin/meu-bot-transcrever")));
  assert.match(r.ultima, /transcritor compartilhado/);
  m.limpar();
});

test("compartilhado sem prova (sem python3, ou o teste do OpenClaw falhou): sai 4, o venv antigo fica e o OpenClaw volta para ele", () => {
  for (const o of [{ semPython: true }, { testeFalha: true }]) {
    const m = maquina({ venvAntigo: true, ...o });
    const r = m.roda();
    assert.equal(r.code, 4, r.out);
    assert.ok(fs.existsSync(path.join(m.home, ".local/share/meu-bot/transcricao/venv/bin/python")), `${JSON.stringify(o)}: o transcritor antigo não some sem a prova`);
    const sets = r.chamadas.filter((c) => c.startsWith("config set tools.media.models "));
    assert.ok(sets.at(-1).includes(path.join(m.home, ".local/bin/meu-bot-transcrever")), `${JSON.stringify(o)}: volta para o transcritor deste usuário`);
    assert.match(r.ultima, /continua com o transcritor deste usuário/);
    m.limpar();
  }
  // Sem transcritor antigo, só avisa que não confirmou (nada a restaurar).
  const s = maquina({ testeFalha: true });
  const rs = s.roda(); assert.equal(rs.code, 4); assert.match(rs.ultima, /não confirmou/);
  s.limpar();
});

test("sem o compartilhado, sem ffmpeg e sem sudo: sai com 3 (precisa do admin) e a última linha aponta Preparar máquina", () => {
  const m = maquina({ transcritor: false });
  const r = m.roda();
  assert.equal(r.code, 3, r.out);
  assert.match(r.ultima, /não deixa instalar programas sem senha/); assert.match(r.ultima, /Preparar máquina/);
  assert.ok(!r.chamadas.some((c) => c.startsWith("config set")), "nada gravado no OpenClaw");
  m.limpar();
});

test("off: com o compartilhado configurado, zera tools.media.models; com outro transcritor, só desliga o áudio", () => {
  const nosso = JSON.stringify([{ type: "cli", command: "/opt/transcriber/bin/transcrever-texto", capabilities: ["audio"] }]);
  const a = maquina({ models: nosso });
  const ra = a.roda("off");
  assert.equal(ra.code, 0, ra.out);
  assert.ok(ra.chamadas.includes("config set tools.media.models [] --strict-json"), ra.chamadas.join("\n"));
  a.limpar();
  const outro = JSON.stringify([{ type: "cli", command: "/usr/local/bin/whisper", capabilities: ["audio"] }]);
  const b = maquina({ models: outro });
  const rb = b.roda("off");
  assert.equal(rb.code, 0);
  assert.ok(!rb.chamadas.includes("config set tools.media.models [] --strict-json"), "transcritor de outro: respeita");
  assert.ok(rb.chamadas.includes("config set tools.media.audio.enabled false --strict-json"));
  // Ligar com o transcritor de outro configurado: não mexe, sai com 3.
  const c = maquina({ models: outro });
  assert.equal(c.roda().code, 3);
  c.limpar(); b.limpar();
});
