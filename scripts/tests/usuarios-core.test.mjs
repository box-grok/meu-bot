import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerUsuarios, NOME_USUARIO_RE, RESERVADOS, LISTAR_SH, limiteKbDe, caminhoDentro, lerMaiores, apagarSh, PROTEGIDOS } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

test("usuários: lê a saída do script (só root vê), ordena por uid e ignora lixo", () => {
  const out = "ROOT\nDISCO=1000000\nCOTA=1\nU\tbox\t1002\t/home/box\t/bin/bash\t1\t1\t1\t500\t0\nU\tdebian\t1000\t/home/debian\t/bin/bash\t0\t0\t0\t20\t100000\nlixo\nU\tNome Ruim\t1005\t/x\t/bin/bash\t0\t0\t0\t\t\n";
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

test("usuários: disco e cota; limite 0 vira 'sem limite'; % → KB", () => {
  const r = lerUsuarios("ROOT\nDISCO=1000000\nCOTA=1\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t300\t0\nU\tbia\t1002\t/home/bia\t/bin/bash\t0\t0\t1\t50\t100000\n");
  assert.equal(r.discoKb, 1000000); assert.equal(r.cota, true);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.usadoKb, u.limiteKb]), [["ana", 300, null], ["bia", 50, 100000]]);
  assert.equal(lerUsuarios("ROOT\nCOTA=0\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\n").usuarios[0].usadoKb, null);
  assert.equal(limiteKbDe(10, 1000000), 100000); assert.equal(limiteKbDe(0, 1000000), 0);
  for (const p of [-1, 101, 2.5, Number.NaN]) assert.throws(() => limiteKbDe(p, 1000000));
});

test("usuários: apagar só dentro da pasta; nunca a pasta, nem com ..; protegidos e sudo", () => {
  assert.ok(caminhoDentro("/home/ana", "/home/ana/videos"));
  for (const p of ["/home/ana", "/home/ana/", "/home/anabela/x", "/home/ana/../bia", "/etc/passwd", "/home/ana/a\nb"]) assert.ok(!caminhoDentro("/home/ana", p), p);
  assert.ok(!caminhoDentro("/root", "/root/x"), "só pastas em /home");
  const m = lerMaiores("HOME=/home/ana\nI\t900\td\t/home/ana/videos\nI\t5\tf\t/etc/passwd\nI\tx\tf\t/home/ana/y\n");
  assert.deepEqual(m.itens.map((i) => i.caminho), ["/home/ana/videos"]);
  assert.match(apagarSh("ana"), /tem sudo/); assert.ok(PROTEGIDOS.has("openclaw"));
});
