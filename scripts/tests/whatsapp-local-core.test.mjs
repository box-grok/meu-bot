import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// WhatsApp na máquina "local": os scripts das máquinas rodam em `bash -s` neste Mac com o prelúdio, que dá ao bash 3.2 e
// às ferramentas BSD o `timeout` e o `stat -c %Y` que os scripts esperam do Linux.
const c = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-local-core.js");
const noMac = process.platform === "darwin";
const bash = (script) => spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal(script), encoding: "utf8", timeout: 30_000 });

test("scriptLocal: o prelúdio vem antes do script e põe ~/.local e o Homebrew no PATH", () => {
  const s = c.scriptLocal("echo oi\n");
  assert.ok(s.startsWith(c.LOCAL_SH_PRELUDE) && s.endsWith("echo oi\n"));
  assert.match(c.LOCAL_SH_PRELUDE, /\$HOME\/\.local\/bin/);
  assert.match(c.LOCAL_SH_PRELUDE, /\/opt\/homebrew\/bin/);
});

test("timeout: estoura com 124, devolve o código do comando e passa a saída", { skip: !noMac && "só no macOS" }, () => {
  const r = bash("timeout 1 sleep 5; echo a=$?; timeout 5 sh -c 'exit 3'; echo b=$?; timeout 5 echo saida");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^a=124$/m);
  assert.match(r.stdout, /^b=3$/m);
  assert.match(r.stdout, /^saida$/m);
});

test("stat -c %Y: o mtime em segundos (o pareamento compara o do creds.json)", { skip: !noMac && "só no macOS" }, () => {
  const f = join(mkdtempSync(join(tmpdir(), "mb-wa-local-")), "creds.json");
  writeFileSync(f, "{}");
  utimesSync(f, 1_700_000_000, 1_700_000_000);
  const r = bash(`stat -c %Y '${f}'`);
  assert.equal(r.stdout.trim(), "1700000000", r.stderr);
});

test("sem escolha gravada, o prelúdio grava o OpenClaw; uma escolha existente fica", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-wa-home-"));
  const r1 = spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal("cat \"$HOME/.local/share/meu-bot/whatsapp-agente\""), encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(r1.stdout.trim(), "openclaw", r1.stderr);
  writeFileSync(join(home, ".local/share/meu-bot/whatsapp-agente"), "picoclaw\n");
  const r2 = spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal("cat \"$HOME/.local/share/meu-bot/whatsapp-agente\""), encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(r2.stdout.trim(), "picoclaw");
});
