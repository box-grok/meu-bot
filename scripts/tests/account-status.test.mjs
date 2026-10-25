import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { readClaudeStatus, refreshRateLimits, readAccessToken, servicoKeychain } = require("../../backend-colima/account-status.js");
import { createHash } from "node:crypto";

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

/** HOME com credenciais do Claude Code (token "tok", vence em 1 h) e, opcionalmente, um ratelimits.json. */
function homeWithLogin(now, limits = null) {
  const h = home(limits ? { "ratelimits.json": limits } : {});
  mkdirSync(path.join(h, ".claude"), { recursive: true });
  writeFileSync(path.join(h, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt: now + 3600_000 } }));
  return h;
}
const USAGE = { five_hour: { utilization: 74.0, resets_at: "2026-10-16T20:40:00.156750+00:00" }, seven_day: { utilization: 23.4, resets_at: "2026-10-23T09:00:00.156768+00:00" } };
const fakeFetch = (calls, body = USAGE, status = 200) => async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return { ok: status === 200, status, json: async () => body }; };

test("refreshRateLimits: sem cache busca o uso da conta e grava no formato do statusline.sh", async () => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  const h = homeWithLogin(now);
  const calls = [];
  try {
    assert.equal(await refreshRateLimits({ home: h, fetchImpl: fakeFetch(calls), now }), "updated");
    assert.equal(calls.length, 1); assert.equal(calls[0].auth, "Bearer tok"); assert.match(calls[0].url, /\/api\/oauth\/usage$/);
    const saved = JSON.parse(readFileSync(path.join(h, ".cache", "claude-statusline", "ratelimits.json"), "utf8"));
    assert.deepEqual(saved, { session_pct: 74, session_resets: 1792183200, weekly_pct: 23, weekly_resets: 1792746000, updated: Math.floor(now / 1000) });
    const s = readClaudeStatus(h);
    assert.deepEqual([s.sessionPct, s.weeklyPct, s.sessionResets], [74, 23, 1792183200]);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("refreshRateLimits: cache novo não vai à API; velho vai; falha HTTP mantém o cache", async () => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  const fresh = { session_pct: 5, session_resets: null, weekly_pct: 6, weekly_resets: null, updated: Math.floor(now / 1000) - 30 };
  const h = homeWithLogin(now, fresh);
  const calls = [];
  try {
    assert.equal(await refreshRateLimits({ home: h, fetchImpl: fakeFetch(calls), now }), "fresh");
    assert.equal(calls.length, 0);
    assert.equal(await refreshRateLimits({ home: h, fetchImpl: fakeFetch(calls, {}, 500), now: now + 120_000 }), "http-500");
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(path.join(h, ".cache", "claude-statusline", "ratelimits.json"), "utf8")), fresh, "cache antigo fica");
    assert.equal(await refreshRateLimits({ home: h, fetchImpl: fakeFetch(calls), now: now + 120_000 }), "updated");
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("conta isolada (configDir): credencial, cache de limites e e-mail vêm da pasta dela", async () => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  const h = homeWithLogin(now, { session_pct: 99, weekly_pct: 99, updated: Math.floor(now / 1000) });
  const dir = path.join(h, "contas", "c-1", "home"); mkdirSync(dir, { recursive: true });
  const calls = [];
  try {
    assert.equal(servicoKeychain(dir), `Claude Code-credentials-${createHash("sha256").update(dir.normalize("NFC")).digest("hex").slice(0, 8)}`);
    assert.equal(readAccessToken(h, now, false, dir), null, "sem .credentials.json na pasta: a da padrão não vale");
    writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "tok2", expiresAt: now + 3600_000 } }));
    assert.equal(readAccessToken(h, now, false, dir), "tok2");
    assert.equal(await refreshRateLimits({ home: h, fetchImpl: fakeFetch(calls), now, keychain: false, configDir: dir }), "updated");
    assert.equal(calls[0].auth, "Bearer tok2");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".cache-meu-bot", "ratelimits.json"), "utf8")).session_pct, 74);
    writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "iso@x.y" } }));
    const s = readClaudeStatus(h, dir);
    assert.deepEqual([s.email, s.sessionPct, s.weeklyPct], ["iso@x.y", 74, 23]);
    assert.equal(readClaudeStatus(h).sessionPct, 99, "a padrão continua lendo o cache do statusline.sh");
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("refreshRateLimits: sem login ou token vencido não chama a API", async () => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  const calls = [];
  const semLogin = home({});
  // keychain: false — neste Mac o Keychain tem o login do Claude Code, e o teste é sobre a máquina sem login.
  try { assert.equal(await refreshRateLimits({ home: semLogin, fetchImpl: fakeFetch(calls), now, keychain: false }), "no-token"); }
  finally { rmSync(semLogin, { recursive: true, force: true }); }
  const vencido = homeWithLogin(now - 7200_000);
  try { assert.equal(await refreshRateLimits({ home: vencido, fetchImpl: fakeFetch(calls), now }), "no-token"); assert.equal(calls.length, 0); }
  finally { rmSync(vencido, { recursive: true, force: true }); }
});
