import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// vigia-gateway.sh (guarda) com um systemctl falso: religa só o gateway habilitado e parado, sem wa-admin.sh trabalhando.
const VIGIA = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend-colima/guarda/vigia-gateway.sh");

function rodar({ ativo = "inactive", habilitado = "enabled", lockVivo = false }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vigia-"));
  const bin = path.join(home, "bin"); fs.mkdirSync(bin);
  const chamadas = path.join(home, "chamadas");
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/bash
echo "$*" >> "${chamadas}"
case "$2" in
  cat) exit 0 ;;
  is-enabled) echo ${habilitado} ;;
  is-active) echo ${ativo} ;;
esac
exit 0
`, { mode: 0o755 });
  if (lockVivo) { fs.mkdirSync(path.join(home, ".cache/meu-bot"), { recursive: true }); fs.writeFileSync(path.join(home, ".cache/meu-bot/wa-admin.lock"), String(process.pid)); }
  execFileSync("bash", [VIGIA], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
  const out = fs.existsSync(chamadas) ? fs.readFileSync(chamadas, "utf8") : "";
  const log = path.join(home, ".cache/meu-bot/vigia-gateway.log");
  const r = { start: /--user start openclaw-gateway/.test(out), log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

test("vigia: gateway habilitado e parado é religado (e anotado)", () => {
  const r = rodar({});
  assert.equal(r.start, true);
  assert.match(r.log, /religou o gateway \(estava inactive\)/);
  assert.equal(rodar({ ativo: "failed" }).start, true);
});

test("vigia: não mexe no que foi desligado de propósito, no que está de pé, nem com wa-admin.sh trabalhando", () => {
  assert.equal(rodar({ habilitado: "disabled" }).start, false); // migração de máquina: disable --now
  assert.equal(rodar({ ativo: "active" }).start, false);
  assert.equal(rodar({ ativo: "deactivating" }).start, false);
  assert.equal(rodar({ lockVivo: true }).start, false);
});
