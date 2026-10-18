import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { pauseNoteText, pauseNoteSh, pauseRuleSh, localWhenText, PAUSE_RULE_BLOCK, PAUSE_RULE_VERSION } = createRequire(import.meta.url)("../../dist/main/whatsapp-pause.js");

test("localWhenText: data e hora em pt-BR com o fuso por extenso", () => {
  const t = localWhenText(new Date("2026-10-17T03:20:00Z"), "America/Sao_Paulo");
  assert.match(t, /^17\/10\/2026 00:20 \(.*Bras/);
});

test("pauseNoteText: começa com 'Nota do meu-bot', diz quem pausou e aponta a retomada para a nota de pausa", () => {
  const p = pauseNoteText("pause", "17/10/2026 00:20 (Horário de Brasília)", "dono");
  assert.ok(p.startsWith("Nota do meu-bot: o agente foi pausado"));
  assert.ok(p.includes("17/10/2026 00:20") && p.includes("pelo dono do número") && p.includes("nada do que você responder será entregue"));
  const r = pauseNoteText("resume", "17/10/2026 09:00 (Horário de Brasília)", "admin");
  assert.ok(r.startsWith("Nota do meu-bot: pausa encerrada em 17/10/2026 09:00"));
  assert.ok(r.includes("pelo suporte") && r.includes('nota "pausado" acima') && r.includes("resumida"));
  assert.ok(p.includes("responda NO_REPLY a tudo") && p.includes("nunca a mencione ao contato"), "pausa: só NO_REPLY e sem contar ao contato");
  assert.ok(r.includes("NO_REPLY") && r.includes("nunca a mencione ao contato"), "retomada: nota respondida com NO_REPLY, pausa é interna");
});

test("pauseNoteSh: turno do agente em segundo plano com a nota por arquivo (base64), sem --deliver; recusa chave estranha", () => {
  const key = "agent:main:whatsapp:direct:+5511999990000";
  const text = "Nota do meu-bot: teste 'com aspas' e acento ç";
  const sh = pauseNoteSh(key, text);
  assert.ok(sh.includes(`openclaw agent --session-key "$1" --message-file "$2"`) && sh.includes(`sh '${key}' "$F"`));
  assert.ok(!sh.includes("--deliver"), "nada vai para o WhatsApp");
  assert.ok(sh.includes("nohup") && sh.includes("mktemp") && sh.includes('rm -f "$2"'));
  const b64 = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > "\$F"/.exec(sh)[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), text);
  assert.ok(!sh.includes("'com aspas'"), "o texto não vai cru para o shell");
  assert.ok(sh.includes('echo "NOTA=agendada"'));
  assert.throws(() => pauseNoteSh("x'; rm -rf /", "t"), /chave/);
});

test("pauseRuleSh: bloco versionado em base64, workspace configurado com reserva, grava via tmp+mv e devolve REGRA=", () => {
  const sh = pauseRuleSh();
  assert.ok(sh.includes("openclaw config get agents.defaults.workspace") && sh.includes('W="$HOME/.openclaw/workspace"'));
  const b64 = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d \| python3/.exec(sh)[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), PAUSE_RULE_BLOCK);
  assert.ok(PAUSE_RULE_BLOCK.startsWith(`<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} inicio -->`) && PAUSE_RULE_BLOCK.trimEnd().endsWith(`<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} fim -->`));
  assert.ok(PAUSE_RULE_BLOCK.includes("pausa encerrada") && PAUSE_RULE_BLOCK.includes("Não repita respostas antigas") && PAUSE_RULE_BLOCK.includes("NO_REPLY") && PAUSE_RULE_BLOCK.includes("nunca mencione ao contato"));
  assert.ok(sh.includes("os.replace(tmp, f)") && sh.includes('print("REGRA=1")') && sh.includes('print("REGRA=0")') && sh.includes('echo "REGRA=erro"'));
});

test("pauseRuleSh (python local): acrescenta, não duplica e troca versão antiga", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pausa-"));
  const f = join(dir, "AGENTS.md");
  writeFileSync(f, "# AGENTS.md\n\nconteúdo da pessoa\n");
  const py = /python3 -c '([\s\S]*?)' "\$W\/AGENTS\.md"/.exec(pauseRuleSh())[1];
  const run = () => spawnSync("python3", ["-c", py, f], { input: PAUSE_RULE_BLOCK, encoding: "utf8" }).stdout.trim();
  assert.equal(run(), "REGRA=1");
  assert.equal(run(), "REGRA=0");
  const once = readFileSync(f, "utf8");
  assert.equal(once.split("meu-bot:pausa v").length - 1, 2, "um bloco (inicio+fim)");
  assert.ok(once.startsWith("# AGENTS.md\n\nconteúdo da pessoa\n"), "o que a pessoa tinha fica");
  // versão antiga é trocada no lugar
  writeFileSync(f, once.replace(new RegExp(`v${PAUSE_RULE_VERSION}`, "g"), "v0").replace("Não repita", "Texto velho"));
  assert.equal(run(), "REGRA=1");
  const swapped = readFileSync(f, "utf8");
  assert.ok(!swapped.includes("v0") && !swapped.includes("Texto velho") && swapped.includes("Não repita"));
  assert.equal(swapped.split("meu-bot:pausa v").length - 1, 2);
});
