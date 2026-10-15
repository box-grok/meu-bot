import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProbe, hostLabel } from "../../dist/renderer/lib/probe-text.js";

const base = { host: "vm", reachable: true, user: "box", os: "Debian 13", arch: "x86_64", backendInstalled: false, backendListening: false, claudePath: "/usr/bin/claude", claudeLoggedIn: true, node: "v24", systemd: true, models: [], error: null };

test("estados da sondagem remota", () => {
  assert.deepEqual(pick(describeProbe({ ...base, reachable: false, error: "timeout" })), { kind: "bad", install: null, canOpen: false });
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: true, models: ["claudecode", "agente"] })), { kind: "ok", install: null, canOpen: true });
  assert.match(describeProbe({ ...base, backendInstalled: true, backendListening: true, models: ["claudecode", "agente"] }).text, /modelos: claudecode, agente/);
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: false })), { kind: "warn", install: "reinstall", canOpen: true });
  assert.deepEqual(pick(describeProbe({ ...base, claudePath: null })), { kind: "bad", install: null, canOpen: false });
  assert.deepEqual(pick(describeProbe({ ...base, claudeLoggedIn: false })), { kind: "bad", install: null, canOpen: false });
  assert.match(describeProbe({ ...base, claudeLoggedIn: false }).text, /Entrar no Claude Code/);
  assert.equal(describeProbe({ ...base, claudeLoggedIn: false }).login, true);
  // backend no ar mas Claude deslogado: dá para abrir (grok-4 responde), mas avisa e oferece o login
  const offLogged = describeProbe({ ...base, backendInstalled: true, backendListening: true, claudeLoggedIn: false });
  assert.deepEqual(pick(offLogged), { kind: "warn", install: null, canOpen: true });
  assert.equal(offLogged.login, true);
  assert.deepEqual(pick(describeProbe(base)), { kind: "warn", install: "install", canOpen: false });
});

test("estados do local", () => {
  const local = { ...base, host: "local" };
  assert.deepEqual(pick(describeProbe({ ...local, claudeLoggedIn: false })), { kind: "bad", install: null, canOpen: false });
  assert.deepEqual(pick(describeProbe({ ...local, backendInstalled: true })), { kind: "ok", install: null, canOpen: true });
  assert.equal(hostLabel("local"), "este Mac (sem SSH)");
  assert.equal(hostLabel("colima"), "colima");
});

function pick(t) { return { kind: t.kind, install: t.install, canOpen: t.canOpen }; }
