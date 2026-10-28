import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const m = require("../../dist/main/usuarios-mac/usuarios-mac-core.js");
const { capsFor, produtoDe, nomesReservados } = require("../../dist/main/app/variant-core.js");
const { MAC_CHANNELS, ADMIN_CHANNELS, CLIENT_CHANNELS } = require("../../dist/main/ipc/ipc-policy.js");
const here = dirname(fileURLToPath(import.meta.url));

test("nome novo: regra do Linux, reservados do macOS e conta que já existe", () => {
  assert.equal(m.nomeNovoInvalido("meu-box", ["box", "lv-box"]), null);
  assert.match(m.nomeNovoInvalido("lv-box", ["box", "lv-box"]), /já existe/);
  for (const n of ["guest", "root", "svc", "admin"]) assert.match(m.nomeNovoInvalido(n, []), /reservado/, n);
  for (const n of ["Maria", "1abc", "a", "x y", "_spotlight", "a;rm"]) assert.match(m.nomeNovoInvalido(n, []), /nome inválido/, n);
});

test("senha: a gerada é forte e sem ambiguidade; a escolhida tem regra que não quebra o script", () => {
  const s = m.senhaDe(new Uint8Array(32).map((_, i) => i * 37));
  assert.match(s, /^[A-Za-z0-9]{24}$/);
  assert.doesNotMatch(s, /[0O1lI]/, "sem caracteres que se confundem");
  assert.throws(() => m.senhaDe(new Uint8Array(4)), /insuficientes/);
  assert.equal(m.senhaEscolhidaInvalida("minha senha 2026!"), null);
  assert.match(m.senhaEscolhidaInvalida("curta"), /8 a 64/);
  for (const x of ["tem'aspas", "barra\\invertida", "acentuação1", "linha\nnova"]) assert.match(m.senhaEscolhidaInvalida(x), /não pode/, x);
});

test("lista: lê a saída do dscl, protege você, quem está na tela, sistema e serviço", () => {
  const b64 = (s) => Buffer.from(s).toString("base64");
  const out = ["ATUAL=box", "TELA=lv-box", `U\tbox\t501\t1\t${b64("Box")}`, `U\tsvc\t502\t0\t${b64("svc")}`, `U\tlv-box\t507\t1\t${b64("LV")}`, `U\tbianca-box\t505\t1\t${b64("bianca-box")}`, "U\t../x\t9\t1\t", "lixo"].join("\n");
  const v = m.lerUsuariosMac(out);
  assert.equal(v.atual, "box"); assert.equal(v.naTela, "lv-box");
  assert.deepEqual(v.usuarios.map((u) => [u.nome, u.apelido, u.admin, u.protegida]), [
    ["box", "Box", true, "é a sua conta"], ["svc", "", false, "conta de serviço deste Mac"], ["bianca-box", "", true, null], ["lv-box", "LV", true, "está usando o Mac agora"],
  ]);
  assert.equal(m.lerUsuariosMac("ATUAL=box\nTELA=root\n").naTela, null, "tela de login (root) não protege ninguém");
});

test("criar: conta administrador com a senha só dentro do script, home e o meu-bot clonado na mesa como a conta nova", () => {
  const sh = m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs" });
  assert.match(sh, /sysadminctl -addUser "meu-box" -fullName "meu-box" -shell \/bin\/zsh -home "\/Users\/meu-box" -admin -password 'Abcdefghjk23456789mnpqrs'/);
  assert.match(m.criarMacSh({ nome: "meu-box", senha: "minha senha 2026!" }), /-password 'minha senha 2026!'/, "a escolhida também vai");
  assert.match(sh, /createhomedir -c -u "meu-box"/);
  assert.match(sh, /sudo -u "meu-box" -H git clone -q 'https:\/\/github\.com\/diegofornalha\/meu-bot\.git' "\/Users\/meu-box\/Desktop\/meu-bot"/);
  assert.match(sh, /xcode-select -p/, "sem as ferramentas do Xcode, não dispara o instalador do git");
  assert.ok(sh.indexOf("CRIADO=") < sh.indexOf("git clone"), "o clone que falhar não desfaz a conta");
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "curta" }), /senha/);
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "x'; rm -rf /; '" }), /senha/);
  assert.throws(() => m.criarMacSh({ nome: "x';rm -rf /;'", senha: "Abcdefghjk23456789mnpqrs" }), /nome/);
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs", repo: "https://evil.example/x.git" }), /repositório/);
});

test("apagar e apelido: nomes e textos que não quebram o script", () => {
  assert.match(m.apagarMacSh("teste-mac"), /sysadminctl -deleteUser "teste-mac"/);
  assert.throws(() => m.apagarMacSh("root"), /nome inválido/);
  assert.match(m.apelidoMacSh("meu-box", "Meu Box"), /RealName 'Meu Box'/);
  assert.throws(() => m.apelidoMacSh("meu-box", "x'; rm -rf ~"), /apelido/);
  assert.throws(() => m.apelidoMacSh("meu-box", ""), /apelido/);
  assert.throws(() => m.saidaMac("ERRO=já existe\n", /CRIADO/, "?"), /já existe/);
  assert.throws(() => m.saidaMac("nada\n", /CRIADO/, "sem confirmação"), /sem confirmação/);
});

test("variante meu-bot-admin-mac: só a janela das contas; canais próprios, só no preload dela", () => {
  const c = capsFor("admin-mac");
  assert.deepEqual([c.usuariosMac, c.chat, c.supportAdmin, c.tunnel], [true, false, false, false]);
  for (const v of ["client", "client-staging", "finance-staging", "admin"]) assert.equal(capsFor(v).usuariosMac, false, v);
  assert.equal(produtoDe("admin-mac").nome, "meu-bot-admin-mac");
  assert.ok(nomesReservados().has("meu-bot-admin-mac"));
  for (const ch of MAC_CHANNELS) assert.ok(!ADMIN_CHANNELS.includes(ch) && !CLIENT_CHANNELS.includes(ch), ch);
  const src = readFileSync(join(here, "..", "..", "dist", "preload", "usuarios-mac-preload.js"), "utf8");
  const chans = [...src.matchAll(/ipcRenderer\.(?:invoke|send)\("([a-z:-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(chans.sort(), [...MAC_CHANNELS].sort());
});

test("apagar: se o sysadminctl não apagar (conta sem home), cai para o dscl e diz o motivo se nem assim", () => {
  const sh = m.apagarMacSh("bianca-box");
  assert.ok(sh.indexOf("sysadminctl -deleteUser") < sh.indexOf('dscl . -delete "/Users/bianca-box"'));
  assert.match(sh, /ERRO=o macOS não apagou a conta \(sysadminctl: \$\{SYS:-sem resposta\}; dscl: \$\{DS:-sem resposta\}\)/);
  assert.match(sh, /stat -f %u "\$H"\)" = "\$UID_C" \]; then rm -rf "\$H"/, "só apaga o home que é da conta");
});
