import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const D = join(import.meta.dirname, "..", "..", "backend-colima", "skills", "whatsapp-grupos");

test("skill whatsapp-grupos no pacote: genérica (sem conta, porta ou caminho de outra máquina) e scripts válidos", () => {
  const sk = readFileSync(join(D, "SKILL.md"), "utf8");
  assert.match(sk, /^---\nname: whatsapp-grupos\n/);
  // Números só o de exemplo (5511999998888); nada de conta real, caminho ou porta de outra máquina.
  for (const n of sk.match(/\+?55\d{10,11}\b/g) ?? []) assert.equal(n.replace("+", ""), "5511999998888", `número real no SKILL.md: ${n}`);
  for (const proibido of [/\/home\/[a-z]/, /mythos/, /box-lv/, /18791/]) assert.doesNotMatch(sk, proibido);
  assert.match(sk, /--remetentes/, "avisa para limitar quem dispara em grupo");
  const scripts = readdirSync(join(D, "scripts")).sort();
  assert.deepEqual(scripts, ["habilitar.py", "listar.sh", "wa-admin.sh", "wa-grupos.js"]);
  for (const f of scripts) assert.doesNotMatch(readFileSync(join(D, "scripts", f), "utf8"), /\/home\/[a-z]/, `${f} sem caminho fixo de conta`);
  execFileSync("bash", ["-n", join(D, "scripts", "wa-admin.sh")]); execFileSync("bash", ["-n", join(D, "scripts", "listar.sh")]);
  execFileSync(process.execPath, ["--check", join(D, "scripts", "wa-grupos.js")]);
  execFileSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", join(D, "scripts", "habilitar.py")]);
  // A guarda leva a skill e nunca toca no cache da conta.
  const inst = readFileSync(join(D, "..", "..", "install-guarda.sh"), "utf8");
  assert.match(inst, /skills\/whatsapp-grupos/); assert.doesNotMatch(inst, /rm -rf "\$K/);
});
