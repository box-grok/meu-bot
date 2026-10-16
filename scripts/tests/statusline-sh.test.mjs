import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("backend-colima/statusline.sh");
const INPUT = JSON.stringify({ model: { display_name: "Opus 4.8" }, context_window: { used_percentage: 12, context_window_size: 200000, current_usage: { input_tokens: 24000 } },
  rate_limits: { five_hour: { used_percentage: 57, resets_at: Math.floor(Date.now() / 1000) + 3840 }, seven_day: { used_percentage: 12, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } });
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

/** HOME temporário com perfil em cache (quente) e um `curl` falso que marca se foi chamado. */
function home() {
  const h = mkdtempSync(join(tmpdir(), "mb-sl-"));
  mkdirSync(join(h, ".cache", "claude-statusline"), { recursive: true }); mkdirSync(join(h, ".claude"), { recursive: true }); mkdirSync(join(h, "bin"));
  writeFileSync(join(h, ".cache", "claude-statusline", "profile.json"), JSON.stringify({ email: "voce@exemplo.com", assento: "Premium" }));
  writeFileSync(join(h, "bin", "curl"), `#!/bin/sh\ntouch "${h}/curl-chamado"\nexit 1\n`); chmodSync(join(h, "bin", "curl"), 0o755);
  return h;
}
const run = (h, extra = {}) => strip(spawnSync("bash", [SCRIPT], { input: INPUT, encoding: "utf8", env: { HOME: h, PATH: `${h}/bin:/usr/bin:/bin`, COLUMNS: "300", LANG: "pt_BR.UTF-8", ...extra } }).stdout);

test("statusline.sh: monta Modelo | Ctx | Conta | Sessão | Semanal e usa o cache de perfil (sem curl)", () => {
  const h = home();
  const out = run(h);
  assert.match(out, /Opus 4\.8/); assert.match(out, /Ctx: 12% · 24\.0k\/200\.0k/); assert.match(out, /voce@exemplo\.com \(Premium\)/);
  assert.match(out, /Sessão: 57%/); assert.match(out, /Semanal: 12%/);
  assert.ok(out.indexOf("Opus") < out.indexOf("Ctx") && out.indexOf("Ctx") < out.indexOf("voce@") && out.indexOf("Sessão") < out.indexOf("Semanal"), "ordem");
  assert.ok(!existsSync(join(h, "curl-chamado")), "com cache quente o script não chama a API (correção do stat no Linux)");
  // o bloco meu-bot gravou os limites para o backend
  assert.match(spawnSync("cat", [join(h, ".cache", "claude-statusline", "ratelimits.json")], { encoding: "utf8" }).stdout, /"weekly_pct": *12/);
});

test("statusline.sh: statusline-segments.json liga/desliga segmentos; sem Conta nem vai à API", () => {
  const h = home();
  writeFileSync(join(h, ".claude", "statusline-segments.json"), JSON.stringify({ account: false, weekly: false }));
  const out = run(h);
  assert.match(out, /Opus 4\.8/); assert.match(out, /Ctx: 12%/); assert.match(out, /Sessão: 57%/);
  assert.doesNotMatch(out, /voce@exemplo/); assert.doesNotMatch(out, /Semanal/);
  const h2 = home();
  writeFileSync(join(h2, ".claude", "statusline-segments.json"), JSON.stringify({ model: false, ctx: false }));
  const out2 = run(h2);
  assert.doesNotMatch(out2, /Opus|Ctx:/); assert.match(out2, /voce@exemplo\.com/);
});

test("statusline.sh: com MEU_BOT_STATUSLINE_TEST=1 mostra a linha mas não grava limites no cache", () => {
  const h = home();
  const out = run(h, { MEU_BOT_STATUSLINE_TEST: "1" });
  assert.match(out, /Sessão: 57%/);
  assert.ok(!existsSync(join(h, ".cache", "claude-statusline", "ratelimits.json")), "o teste do tutorial não pode contaminar o cache real");
});
