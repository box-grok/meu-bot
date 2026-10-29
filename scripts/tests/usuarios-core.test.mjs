import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerUsuarios, NOME_USUARIO_RE, RESERVADOS, LISTAR_SH, limiteKbDe, caminhoDentro, lerMaiores, apagarSh, PROTEGIDOS, lingerSh, nivelUso } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

test("usuários: lê a saída do script (só root vê), ordena por uid e ignora lixo", () => {
  const out = "ROOT\nDISCO=1000000\nCOTA=1\nU\tbox\t1002\t/home/box\t/bin/bash\t1\t1\t1\t500\t0\nU\tdebian\t1000\t/home/debian\t/bin/bash\t0\t0\t0\t20\t100000\nlixo\nU\tNome Ruim\t1005\t/x\t/bin/bash\t0\t0\t0\t\t\n";
  const r = lerUsuarios(out);
  assert.equal(r.root, true);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.sudo, u.meuBot, u.chave]), [["debian", false, false, false], ["box", true, true, true]]);
  assert.equal(lerUsuarios("NAOROOT\n").root, false);
});

test("usuários: linger lido da última coluna (linha antiga sem ela = ligado), ligado ao criar e desligado ao apagar", () => {
  const base = "ana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\tinfinity\tinfinity\t";
  const r = lerUsuarios(`ROOT\nU\t${base}\t0\nU\tbia${base.slice(3)}\t1\nU\tcid${base.slice(3)}\n`);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.ligado]), [["ana", false], ["bia", true], ["cid", true]]);
  assert.match(LISTAR_SH, /\/var\/lib\/systemd\/linger\/\$n/);
  assert.match(lingerSh("ana"), /loginctl enable-linger 'ana'/); assert.match(lingerSh("ana"), /LINGER=ok/);
  assert.match(apagarSh("ana"), /loginctl disable-linger "\$N"[\s\S]*userdel/);
});

test("usuários: nível de uso do disco (90% perto, 100% cheio; sem limite = ok)", () => {
  assert.equal(nivelUso(50, 100), "ok"); assert.equal(nivelUso(90, 100), "perto"); assert.equal(nivelUso(100, 100), "cheio"); assert.equal(nivelUso(120, 100), "cheio");
  assert.equal(nivelUso(500, null), "ok"); assert.equal(nivelUso(null, 100), "ok"); assert.equal(nivelUso(5, 0), "ok");
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
  assert.match(apagarSh("ana"), /tem sudo/); assert.match(apagarSh("ana"), /user-\$U\.slice\.d/); assert.ok(PROTEGIDOS.has("openclaw"));
});

test("usuários: RAM da máquina, do root e de cada um", () => {
  const r = lerUsuarios("ROOT\nDISCO=100\nCOTA=0\nRAM=32000000 2300000\nRAMROOT=2500000\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t1\t1\t\t\t900000\nU\tbia\t1002\t/home/bia\t/bin/bash\t0\t0\t1\t\t\t0\n");
  assert.deepEqual(r.ram, { totalKb: 32000000, usoKb: 2300000, rootKb: 2500000, swapKb: 0, swapUsoKb: 0 });
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.ramKb]), [["ana", 900000], ["bia", 0]]);
  assert.equal(lerUsuarios("ROOT\n").ram, null);
});

test("usuários: tetos de RAM e CPU (systemd) lidos e gravados", async () => {
  const { ramMaxDe, cpuMaxDe, recursosSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(ramMaxDe("1073741824"), 1024); assert.equal(ramMaxDe("infinity"), null); assert.equal(ramMaxDe(undefined), null);
  assert.equal(cpuMaxDe("1s"), 100); assert.equal(cpuMaxDe("500ms"), 50); assert.equal(cpuMaxDe("1.500s"), 150); assert.equal(cpuMaxDe("infinity"), null);
  assert.match(recursosSh("ana", 1024, 100), /MemoryHigh=921M MemoryMax=1024M CPUQuota=100%/);
  assert.match(recursosSh("ana", 0, 0), /MemoryHigh=infinity MemoryMax=infinity CPUQuota= /);
  for (const [r, c] of [[-1, 0], [0, -5], [1.5, 0], [0, Number.NaN]]) assert.throws(() => recursosSh("ana", r, c));
  const l = lerUsuarios("ROOT\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\t1073741824\t1s\n");
  assert.deepEqual([l.usuarios[0].ramMaxMb, l.usuarios[0].cpuMaxPct], [1024, 100]);
});

test("máquina: swap lida e o script de ligar confere espaço, guarda o fstab e não liga duas vezes", async () => {
  const { swapLigarSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const r = lerUsuarios("ROOT\nRAM=32000000 2000000\nRAMROOT=1\nSWAP=8388604 1024\n");
  assert.equal(r.ram.swapKb, 8388604); assert.equal(r.ram.swapUsoKb, 1024);
  const sh = swapLigarSh(8);
  assert.match(sh, /swapon --noheadings/); assert.match(sh, /fstab\.bak-meu-bot/); assert.match(sh, /findmnt --verify/); assert.match(sh, /swappiness=10/);
  for (const g of [0, 65, 2.5]) assert.throws(() => swapLigarSh(g));
});

test("usuários: apelido (descrição do usuário), sem mexer no login", async () => {
  const { apelidoValido, apelidoSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(apelidoValido("  Maria   (financeiro) "), "Maria (financeiro)");
  assert.equal(apelidoValido(""), "");
  for (const a of ["a:b", "a,b", "x".repeat(41), 3]) assert.throws(() => apelidoValido(a));
  assert.match(apelidoSh("ana", "Maria"), /usermod -c "\$A" 'ana'/);
  const l = lerUsuarios("ROOT\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\tinfinity\tinfinity\tMaria Souza\n");
  assert.equal(l.usuarios[0].apelido, "Maria Souza");
});

test("usuários: 'No meu-bot' gera o Host <máquina>-<usuário> e não duplica um Host que já existe", async () => {
  const { aliasDoUsuario, blocoSshUsuario, configTemHost } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(aliasDoUsuario("meu-root", "box-1"), "meu-root-box-1");
  assert.equal(aliasDoUsuario("Máquina da Lú", "ana"), "maquina-da-lu-ana");
  const b = blocoSshUsuario({ alias: "meu-root-box-1", hostname: "2.24.31.253", port: "22", user: "box-1", chave: "~/.ssh/meu-bot-admin", maquina: "meu-root" });
  assert.match(b, /^Host meu-root-box-1$/m); assert.match(b, /User box-1/); assert.match(b, /IdentitiesOnly yes/);
  assert.ok(configTemHost("Host a b meu-root-box-1\n  User x\n", "meu-root-box-1"));
  assert.ok(!configTemHost("Host meu-root-box-10\n", "meu-root-box-1"));
});

test("usuários: todo usuário novo nasce com 2 GB de RAM e 200% de CPU (cobre o OpenClaw, ~1,6 GB, e o Hermes com áudio)", async () => {
  const { RECURSOS_PADRAO, recursosSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.deepEqual({ ...RECURSOS_PADRAO }, { ramMb: 2048, cpuPct: 200 });
  assert.match(recursosSh("ana", RECURSOS_PADRAO.ramMb, RECURSOS_PADRAO.cpuPct), /MemoryMax=2048M CPUQuota=200%/);
});

test("seletores: entram os comuns com a chave deste Mac; sudo, meu-bot, sistema e sem chave ficam de fora", () => {
  const { candidatosAoSeletor, semChaveDesteMac } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const u = (nome, o = {}) => ({ nome, uid: 1001, home: `/home/${nome}`, shell: "/bin/bash", sudo: false, meuBot: false, chave: true, usadoKb: null, limiteKb: null, ramKb: 0, ramMaxMb: null, cpuMaxPct: null, apelido: "", ligado: true, ...o });
  const lista = [u("ana"), u("box", { sudo: true }), u("openclaw", { meuBot: true }), u("hermes"), u("bia", { chave: false }), u("admin")];
  assert.deepEqual(candidatosAoSeletor(lista).map((x) => x.nome), ["ana"]);
  assert.deepEqual(semChaveDesteMac(lista), ["bia"]);
});

test("removerBlocoUsuario: tira só o bloco do admin (marca + Host + indentadas) e não leva o comentário do bloco seguinte", () => {
  const { removerBlocoUsuario, blocoSshUsuario } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const bloco = blocoSshUsuario({ alias: "meu-root-ana", hostname: "203.0.113.7", port: "22", user: "ana", chave: "~/.ssh/id_ed25519", maquina: "meu-root" });
  const antes = "Include ~/.ssh/meu-bot-suporte.conf\n\nHost vps\n    HostName 203.0.113.7\n    User root\n";
  const depois = "\n# minha VPS de teste\nHost teste\n    HostName 198.51.100.2\n";
  const r = removerBlocoUsuario(`${antes}\n${bloco}${depois}`, "meu-root-ana");
  assert.equal(r.removido, true);
  assert.equal(r.texto, `${antes}${depois}`);
  assert.match(r.texto, /# minha VPS de teste\nHost teste/);
  // Sem a marca logo acima: o bloco não é do admin e fica.
  const meu = `${antes}\nHost meu-root-ana\n    User ana\n`;
  assert.deepEqual(removerBlocoUsuario(meu, "meu-root-ana"), { texto: meu, removido: false });
  assert.equal(removerBlocoUsuario(antes, "meu-root-ana").removido, false);
});

test("usuários: Hermes para todos na mesma versão do install-grok-oauth.sh, com atalho legível e git liberado", async () => {
  const { hermesGlobalSh, HERMES_VERSAO, lerUsuarios: ler, LISTAR_SH: listar } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const { readFileSync } = await import("node:fs");
  const grok = readFileSync(new URL("../../backend-colima/install-grok-oauth.sh", import.meta.url), "utf8");
  assert.equal(/^HERMES_VERSION=(\S+)$/m.exec(grok)?.[1], HERMES_VERSAO);
  const sh = hermesGlobalSh();
  assert.match(sh, /npm install -g --prefix "\$D" "hermes-agent@\$V"/);
  assert.match(sh, /chmod -R a\+rX "\$D"/);
  assert.match(sh, /meu-bot-hermes-global/);
  assert.match(sh, /GIT_CONFIG_VALUE_0=\/opt\/hermes\/lib\/node_modules\/hermes-agent\/runtime\/hermes-agent/);
  assert.match(sh, /runuser -u nobody/);
  assert.match(sh, /runtime\/hermes-agent\/\.hermes\/bin/, "o atalho que o serviço do gateway de cada usuário chama");
  assert.match(listar, /HERMES=global/);
  assert.equal(ler("ROOT\nHERMES=global\n").hermes, "global");
  assert.equal(ler("ROOT\nHERMES=root\n").hermes, "root");
  assert.equal(ler("ROOT\n").hermes, null);
});

test("usuários: o box- é fixo na frente do nome digitado, sem repetir", async () => {
  const { comPrefixo, PREFIXO_USUARIO, NOME_USUARIO_RE: re } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(comPrefixo("maria"), "box-maria");
  assert.equal(comPrefixo("box-1"), "box-1", "quem já digitou o box- não ganha outro");
  assert.equal(comPrefixo("1"), "box-1");
  assert.ok(re.test(comPrefixo("maria")) && re.test(comPrefixo("1")), "o nome com prefixo é um usuário Linux válido");
  const { readFileSync } = await import("node:fs");
  const tela = readFileSync(new URL("../../src/renderer/admin/usuarios-page.ts", import.meta.url), "utf8");
  assert.equal(/const PREFIXO = "([^"]+)";/.exec(tela)?.[1], PREFIXO_USUARIO, "a cópia da tela bate com a do main");
});
