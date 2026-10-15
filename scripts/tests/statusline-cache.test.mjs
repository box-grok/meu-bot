import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = new URL("../../backend-colima/statusline.sh", import.meta.url).pathname;
const hasJq = spawnSync("jq", ["--version"]).status === 0;

/** HOME descartável e um PATH que esconde `security` e `curl`: o perfil não sai pra rede nem pro Keychain. */
function sandbox() {
  const home = mkdtempSync(path.join(tmpdir(), "meu-bot-sl-"));
  const bin = path.join(home, "bin"); mkdirSync(bin);
  for (const stub of ["security", "curl"]) { writeFileSync(path.join(bin, stub), "#!/bin/sh\nexit 1\n"); chmodSync(path.join(bin, stub), 0o755); }
  const run = (input) => spawnSync("bash", [SCRIPT], { input: JSON.stringify(input), encoding: "utf8", timeout: 20_000, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  const cache = path.join(home, ".cache", "claude-statusline", "ratelimits.json");
  return { run, cache, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("statusline.sh grava ratelimits.json com o que o Claude Code manda", { skip: !hasJq && "sem jq" }, () => {
  const sb = sandbox();
  try {
    const resets = Math.floor(Date.now() / 1000) + 5400;
    const r = sb.run({ model: { display_name: "x" }, rate_limits: { five_hour: { used_percentage: 37.4, resets_at: resets }, seven_day: { used_percentage: 12, resets_at: resets + 86_400 } } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(sb.cache), "ratelimits.json não foi gravado");
    const j = JSON.parse(readFileSync(sb.cache, "utf8"));
    assert.deepEqual({ ...j, updated: undefined }, { session_pct: 37.4, session_resets: resets, weekly_pct: 12, weekly_resets: resets + 86_400, updated: undefined });
    assert.ok(Math.abs(j.updated - Date.now() / 1000) < 30, "updated deve ser agora, em segundos");
  } finally { sb.done(); }
});

test("só sessão: o semanal fica null em vez de quebrar", { skip: !hasJq && "sem jq" }, () => {
  const sb = sandbox();
  try {
    const r = sb.run({ model: { display_name: "x" }, rate_limits: { five_hour: { used_percentage: 80, resets_at: 1_900_000_000 } } });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(sb.cache, "utf8"));
    assert.equal(j.session_pct, 80); assert.equal(j.weekly_pct, null); assert.equal(j.weekly_resets, null);
  } finally { sb.done(); }
});

test("sem rate_limits na entrada, não inventa cache de limites", { skip: !hasJq && "sem jq" }, () => {
  const sb = sandbox();
  try {
    const r = sb.run({ model: { display_name: "x" } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(sb.cache), "não devia gravar ratelimits.json sem dado");
  } finally { sb.done(); }
});
