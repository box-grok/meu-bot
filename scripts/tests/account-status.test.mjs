import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { readClaudeStatus } = require("../../backend-colima/account-status.js");

/** HOME descartável com os arquivos dados em ~/.cache/claude-statusline/. */
function home(files) {
  const h = mkdtempSync(path.join(tmpdir(), "meu-bot-as-"));
  const d = path.join(h, ".cache", "claude-statusline"); mkdirSync(d, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(path.join(d, n), JSON.stringify(c));
  return h;
}

test("limite ausente (null) fica null, não vira 0% · now", () => {
  const h = home({ "profile.json": { email: "a@b", assento: "Premium" }, "ratelimits.json": { session_pct: null, session_resets: null, weekly_pct: 27, weekly_resets: 1792314000, updated: 1792048848 , segments: null } });
  try {
    assert.deepEqual(readClaudeStatus(h), { email: "a@b", assento: "Premium", sessionPct: null, weeklyPct: 27, sessionResets: null, weeklyResets: 1792314000, updated: 1792048848 , segments: null });
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("strings do statusline.sh da box viram números; sem cache, tudo null", () => {
  const h = home({ "ratelimits.json": { session_pct: "1", weekly_pct: "31", session_resets: "1792063200", weekly_resets: "1792314000", updated: "1792048664" } });
  try {
    const s = readClaudeStatus(h);
    assert.deepEqual([s.sessionPct, s.weeklyPct, s.sessionResets, s.updated], [1, 31, 1792063200, 1792048664]);
  } finally { rmSync(h, { recursive: true, force: true }); }
  const vazio = mkdtempSync(path.join(tmpdir(), "meu-bot-as-"));
  try { assert.deepEqual(readClaudeStatus(vazio), { email: null, assento: null, sessionPct: null, weeklyPct: null, sessionResets: null, weeklyResets: null, updated: null , segments: null }); }
  finally { rmSync(vazio, { recursive: true, force: true }); }
});

test("backend-colima e backend-vm têm o mesmo account-status.js (copiar, não editar só um)", () => {
  const a = readFileSync(new URL("../../backend-colima/account-status.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../../backend-vm/services/account-status.js", import.meta.url), "utf8");
  assert.equal(a, b);
});
