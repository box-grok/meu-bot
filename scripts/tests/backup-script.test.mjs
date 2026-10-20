import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
const SH = join(import.meta.dirname, "..", "..", "backend-colima", "meu-bot-backup.sh");

// Comandos falsos (systemctl, crontab, openclaw, node) no PATH: anotam as chamadas num log e nunca tocam no Mac.
function ambiente() {
  const raiz = mkdtempSync(join(tmpdir(), "mb-bkp-"));
  const fakes = join(raiz, "fakes"); mkdirSync(fakes);
  const log = join(raiz, "chamadas.log");
  const fake = (nome, corpo) => { writeFileSync(join(fakes, nome), `#!/bin/sh\necho "${nome} $*" >> "${log}"\n${corpo}\n`); chmodSync(join(fakes, nome), 0o755); };
  fake("systemctl", 'case "$*" in *is-active*) [ -f "' + raiz + '/ativo-$3" ] && exit 0 || exit 3;; esac; exit 0');
  fake("crontab", 'if [ "$1" = "-l" ]; then cat "' + raiz + '/cron-$(basename $HOME)" 2>/dev/null || exit 1; else cp "$1" "' + raiz + '/cron-$(basename $HOME)"; fi');
  fake("openclaw", 'echo "OpenClaw 2026.9.9 (bcfc888)"');
  return { raiz, log, env: (home) => ({ HOME: home, PATH: `${fakes}:/usr/bin:/bin`, TMPDIR: raiz }) };
}
const escrever = (base, rel, txt) => { mkdirSync(join(base, rel, ".."), { recursive: true }); writeFileSync(join(base, rel), txt); };

test("backup.sh: criar → restaurar em outro usuário devolve os dados, sem caches/modelos, com o $HOME trocado", () => {
  const a = ambiente();
  const origem = join(a.raiz, "box"); const destino = join(a.raiz, "novo");
  escrever(origem, ".openclaw/openclaw.json", JSON.stringify({ workspace: `${origem}/.openclaw/workspace`, outro: `${origem}x/nao` }));
  escrever(origem, ".openclaw/credentials/whatsapp/default/creds.json", '{"me":{"id":"5521900000001:1@s.whatsapp.net"}}');
  escrever(origem, ".openclaw/media/audio.ogg", "OGG");
  writeFileSync(join(origem, ".openclaw/media/grande.bin"), randomBytes(400_000));
  escrever(origem, ".openclaw/cache/lixo.bin", "CACHE");
  escrever(origem, ".local/share/meu-bot/crm/db/contatos.json", '{"contatos":{}}');
  escrever(origem, ".local/share/meu-bot/auditoria.jsonl", '{"hash":"' + "a".repeat(64) + '"}\n');
  escrever(origem, ".local/share/meu-bot/transcricao/modelo.bin", "MODELO-GRANDE");
  escrever(origem, ".hermes/agente-rene/backend-sdk-claude/.env", `CLAUDE_BIN=${origem}/.local/bin/claude\nOPENAI_COMPAT_KEY=k\n`);
  escrever(origem, ".claude/projects/x.jsonl", "{}");
  escrever(origem, ".claude/cache/c", "C");
  writeFileSync(join(a.raiz, "cron-box"), `*/5 * * * * ${origem}/.local/bin/tarefa\n`);
  writeFileSync(join(a.raiz, "ativo-openclaw-gateway"), "");
  // Destino com coisa própria (deve ir para "antes-da-restauracao", não sumir).
  escrever(destino, ".local/share/meu-bot/auditoria.jsonl", '{"hash":"b"}\n');

  const pacote = execFileSync("bash", [SH, "criar", "abcdef123456"], { env: a.env(origem), maxBuffer: 64 << 20 });
  const chamadas = readFileSync(a.log, "utf8");
  assert.match(chamadas, /systemctl --user stop openclaw-gateway/); assert.match(chamadas, /systemctl --user start openclaw-gateway/, "religou o que estava ligado");
  assert.doesNotMatch(chamadas, /start meu-bot-backend/, "o que estava parado continua parado");

  const conf = execFileSync("bash", [SH, "conferir"], { env: a.env(destino), encoding: "utf8" });
  assert.match(conf, /WHATSAPP_PAREADO=0/); assert.match(conf, /OPENCLAW=2026\.9\.9/);
  const r = execFileSync("bash", [SH, "restaurar"], { env: a.env(destino), input: pacote, encoding: "utf8", maxBuffer: 64 << 20 });
  assert.match(r, /RESTAURADO=ok/); assert.match(r, /WHATSAPP=aguardando/); assert.match(r, /ORIGEM=abcdef123456 a{64}/);
  assert.equal(readFileSync(join(destino, ".openclaw/credentials/whatsapp/default/creds.json"), "utf8").includes("5521900000001"), true);
  assert.equal(readFileSync(join(destino, ".openclaw/media/audio.ogg"), "utf8"), "OGG", "mídias vão junto");
  assert.equal(existsSync(join(destino, ".openclaw/cache/lixo.bin")), false, "cache fica fora");
  assert.equal(existsSync(join(destino, ".local/share/meu-bot/transcricao")), false, "modelo fica fora");
  assert.equal(existsSync(join(destino, ".claude/cache")), false);
  const cfg = JSON.parse(readFileSync(join(destino, ".openclaw/openclaw.json"), "utf8"));
  assert.equal(cfg.workspace, `${destino}/.openclaw/workspace`, "$HOME trocado");
  assert.equal(cfg.outro, `${origem}x/nao`, "só o caminho exato, não prefixo de outro nome");
  assert.match(readFileSync(join(destino, ".hermes/agente-rene/backend-sdk-claude/.env"), "utf8"), new RegExp(`CLAUDE_BIN=${destino}/`));
  assert.match(readFileSync(join(a.raiz, "cron-novo"), "utf8"), new RegExp(`${destino}/.local/bin/tarefa`));
  const antes = readdirSync(destino).find((d) => d.startsWith(".meu-bot-antes-da-restauracao-"));
  assert.equal(readFileSync(join(destino, antes, ".local/share/meu-bot/auditoria.jsonl"), "utf8"), '{"hash":"b"}\n', "o que havia no destino foi guardado");
  assert.match(readFileSync(a.log, "utf8"), /systemctl --user disable --now openclaw-gateway/, "gateway desativado até ativar-whatsapp");

  // Já pareado: recusa sem --substituir.
  const de2 = spawnSync("bash", [SH, "restaurar"], { env: a.env(destino), input: pacote });
  assert.equal(de2.status, 65); assert.match(String(de2.stderr), /já há um WhatsApp pareado/);
  // Pacote adulterado: recusa antes de mexer em qualquer coisa.
  const ruim = Buffer.from(pacote); ruim[Math.floor(ruim.length / 2)] ^= 0xff;
  const ad = spawnSync("bash", [SH, "restaurar", "--substituir"], { env: a.env(join(a.raiz, "outro")), input: ruim });
  assert.notEqual(ad.status, 0); assert.match(String(ad.stderr), /não confere|gzip|tar|Error|erro/i);
  assert.equal(existsSync(join(a.raiz, "outro", ".openclaw")), false);
});

test("backup.sh: desativar-whatsapp para e desativa o gateway sem logout; ativar liga; erro no meio religa os serviços", () => {
  const a = ambiente();
  const home = join(a.raiz, "box"); mkdirSync(home);
  const d = execFileSync("bash", [SH, "desativar-whatsapp", "123456abcdef"], { env: a.env(home), encoding: "utf8" });
  assert.match(d, /WHATSAPP=desativado/);
  assert.match(readFileSync(join(home, ".local/share/meu-bot/migrada-para"), "utf8"), /^123456abcdef /);
  const log = readFileSync(a.log, "utf8");
  assert.match(log, /systemctl --user disable --now openclaw-gateway/);
  assert.doesNotMatch(log, /logout/, "nunca channels logout");
  assert.match(execFileSync("bash", [SH, "ativar-whatsapp"], { env: a.env(home), encoding: "utf8" }), /WHATSAPP=ativo/);
  assert.equal(existsSync(join(home, ".local/share/meu-bot/migrada-para")), false);
  // criar sem nada para guardar falha, mas religa o gateway que estava ligado.
  writeFileSync(join(a.raiz, "ativo-openclaw-gateway"), "");
  const vazio = join(a.raiz, "vazio"); mkdirSync(vazio);
  assert.notEqual(spawnSync("bash", [SH, "criar", "abcdef123456"], { env: a.env(vazio) }).status, 0);
  assert.match(readFileSync(a.log, "utf8").split("\n").filter((l) => /start openclaw-gateway/.test(l)).join(), /start/, "religou mesmo com erro");
});
