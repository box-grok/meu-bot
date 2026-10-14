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
  assert.match(describeProbe({ ...base, claudeLoggedIn: false }).text, /ssh -t vm claude/);
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
