import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseVpsNova, aliasRootDe, motivoAcesso, TEXTO_ACESSO, blocoModeloDe, planoVpsNova, textoFinal, NOME_VPS_RE } = createRequire(import.meta.url)("../../dist/main/admin/vps-nova-core.js");

test("parseVpsNova: IP ou DNS, nome curto, usuário e porta válidos; recusa reservados, maiúsculas e porta fora", () => {
  const r = parseVpsNova({ endereco: " 187.41.115.200 ", nome: "Meu", porta: "2222", dominio: "MeuBot.com.br", chromium: true });
  assert.ok(r.ok); assert.deepEqual(r.pedido, { endereco: "187.41.115.200", nome: "meu", usuario: "root", porta: 2222, dominio: "meubot.com.br", chromium: true, primeiroUsuario: true, reinstalada: false });
  assert.ok(parseVpsNova({ endereco: "vps.exemplo.com", nome: "agente-2", usuario: "ubuntu", primeiroUsuario: false }).ok);
  assert.equal(parseVpsNova({ endereco: "vps.exemplo.com", nome: "agente-2" }).pedido.porta, 22);
  assert.match(parseVpsNova({ endereco: "", nome: "meu" }).reason, /endereço/);
  assert.match(parseVpsNova({ endereco: "-x", nome: "meu" }).reason, /endereço/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "suporte-x" }).reason, /reservado/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "local" }).reason, /reservado/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "a" }).reason, /nome curto/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "meu", porta: 70000 }).reason, /porta/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "meu", usuario: "a b" }).reason, /usuário/);
  assert.match(parseVpsNova({ endereco: "1.2.3.4", nome: "meu", dominio: "sem-ponto" }).reason, /domínio/);
  assert.match(parseVpsNova(null).reason, /endereço/);
  assert.ok(NOME_VPS_RE.test("meu-root-2") && !NOME_VPS_RE.test("Meu"));
});

test("motivoAcesso classifica o stderr do ssh: só chave, senha, chave do servidor mudou, rede", () => {
  assert.equal(motivoAcesso(0, ""), "ok");
  assert.equal(motivoAcesso(255, "root@1.2.3.4: Permission denied (publickey)."), "so-chave");
  assert.equal(motivoAcesso(255, "root@1.2.3.4: Permission denied (publickey,password)."), "senha");
  assert.equal(motivoAcesso(255, "Permission denied (publickey,keyboard-interactive)."), "senha");
  assert.equal(motivoAcesso(255, "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed."), "host-key-mudou");
  assert.equal(motivoAcesso(255, "ssh: connect to host 1.2.3.4 port 22: Operation timed out"), "rede");
  assert.equal(motivoAcesso(255, "ssh: Could not resolve hostname x: nodename nor servname provided"), "rede");
  assert.equal(motivoAcesso(1, "algo estranho"), "outro");
  for (const k of ["so-chave", "senha", "host-key-mudou", "rede", "outro"]) assert.ok(TEXTO_ACESSO[k].length > 10, k);
  assert.match(TEXTO_ACESSO["so-chave"], /id_ed25519\.pub/);
});

test("aliasRootDe e blocoModeloDe no formato do config/ssh-hosts.conf", () => {
  assert.equal(aliasRootDe("meu"), "meu-root");
  const b = blocoModeloDe({ nome: "meu", hostname: "187.41.115.200", user: "root", port: 22 });
  assert.equal(b, "Host meu-root\n    HostName 187.41.115.200\n    User root\n    Port 22\n    IdentityFile ~/.ssh/id_ed25519\n    IdentitiesOnly yes\n    ServerAliveInterval 60\n    ServerAliveCountMax 3\n");
});

test("planoVpsNova: o que já está feito sai como feito; Claude Global, Link Público e o QR ficam humanos", () => {
  const antes = planoVpsNova({ acesso: null, aliasNoConfig: false, pessoa: null, prepararFaltam: null, prepararHumanos: [], usuario: null, primeiroUsuario: true, modeloTemHost: false });
  assert.deepEqual(antes.map((p) => p.estado), ["pendente", "pendente", "pendente", "pendente", "pendente", "humano"]);
  const depois = planoVpsNova({ acesso: "ok", aliasNoConfig: true, pessoa: "suporte-meu-1234", prepararFaltam: [], prepararHumanos: ["claude-global"], usuario: "meu-box-1", primeiroUsuario: true, modeloTemHost: true });
  assert.deepEqual(depois.map((p) => [p.id, p.estado]), [["acesso", "feito"], ["alias", "feito"], ["pessoa", "feito"], ["preparar", "humano"], ["usuario", "humano"], ["modelo", "feito"]]);
  assert.match(depois[3].detalhe, /claude-global/); assert.match(depois[4].detalhe, /QR/);
  const semUsuario = planoVpsNova({ ...depois, acesso: "so-chave", aliasNoConfig: false, pessoa: null, prepararFaltam: ["swap", "cota"], prepararHumanos: [], usuario: null, primeiroUsuario: false, modeloTemHost: false });
  assert.equal(semUsuario.length, 5); assert.match(semUsuario[0].detalhe, /painel/); assert.match(semUsuario[3].detalhe, /faltam: swap, cota/);
});

test("textoFinal aponta o próximo clique: Claude do root, Link Público quando há domínio, QR quando há usuário", () => {
  const plano = planoVpsNova({ acesso: "ok", aliasNoConfig: true, pessoa: "suporte-meu-1234", prepararFaltam: [], prepararHumanos: [], usuario: "meu-box-1", primeiroUsuario: true, modeloTemHost: false });
  const t = textoFinal("meu", plano, { aliasBox: "meu-box-1", dominio: "meubot.com.br" });
  assert.match(t, /^✓ meu entrou no fluxo\./); assert.match(t, /1\) entrar no Claude Code do root/); assert.match(t, /2\) Link Público/); assert.match(t, /3\) ler o QR .* meu-box-1/);
  const parcial = textoFinal("meu", planoVpsNova({ acesso: "ok", aliasNoConfig: true, pessoa: null, prepararFaltam: null, prepararHumanos: [], usuario: null, primeiroUsuario: false, modeloTemHost: false }), { aliasBox: null, dominio: "" });
  assert.match(parcial, /^⚠ meu entrou parcialmente/); assert.ok(!/Link Público/.test(parcial) && !/QR/.test(parcial));
});
