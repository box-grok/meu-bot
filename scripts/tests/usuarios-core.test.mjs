import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerUsuarios, NOME_USUARIO_RE, RESERVADOS, LISTAR_SH } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

test("usuários: lê a saída do script (só root vê), ordena por uid e ignora lixo", () => {
  const out = "ROOT\nU\tbox\t1002\t/home/box\t/bin/bash\t1\t1\t1\nU\tdebian\t1000\t/home/debian\t/bin/bash\t0\t0\t0\nlixo\nU\tNome Ruim\t1005\t/x\t/bin/bash\t0\t0\t0\n";
  const r = lerUsuarios(out);
  assert.equal(r.root, true);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.sudo, u.meuBot, u.chave]), [["debian", false, false, false], ["box", true, true, true]]);
  assert.equal(lerUsuarios("NAOROOT\n").root, false);
});

test("usuários: nome aceito e reservados; o script não lista contas sem login", () => {
  for (const n of ["maria", "box-lv", "joao_2"]) assert.ok(NOME_USUARIO_RE.test(n), n);
  for (const n of ["Maria", "1abc", "a", "maria silva", "x".repeat(33), "rm;-rf"]) assert.ok(!NOME_USUARIO_RE.test(n), n);
  assert.ok(RESERVADOS.has("root") && RESERVADOS.has("admin"));
  assert.match(LISTAR_SH, /nologin\|false/);
});
