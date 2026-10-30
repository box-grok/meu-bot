import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../dist/main/admin/link-publico-core.js");
const cli = require("../../dist/main/agente/link-publico.js");
const page = await import("../../dist/renderer/admin/link-publico-page.js");

test("link público: o nginx só em 127.0.0.1, por subdomínio, sem listar pastas nem seguir symlink de outro dono; regex entre aspas (chaves)", () => {
  const n = core.nginxSite("agentesgrok.com");
  assert.match(n, /listen 127\.0\.0\.1:8099;/); assert.doesNotMatch(n, /listen 80|listen 443/);
  assert.match(n, /server_name "~\^\(\?<sub>\[a-z0-9\]\(\[a-z0-9-\]\{0,61\}\[a-z0-9\]\)\?\)\\\.agentesgrok\\\.com\$";/, "regex com chaves vai entre aspas, senão o nginx recusa");
  assert.match(n, /root \/var\/www\/publico\/\$sub;/); assert.match(n, /autoindex off;/); assert.match(n, /disable_symlinks if_not_owner from=\/var\/www\/publico;/);
  assert.match(n, /default_server; server_name _; return 404;/, "outro host: 404");
  assert.match(n, /include \/etc\/nginx\/mime\.types;\n\s+types \{ text\/markdown md markdown; \}/, "o .md sai como texto (sem tipo o navegador baixava)");
  assert.match(n, /charset utf-8;/);
  assert.match(n, /absolute_redirect off;/, "pasta sem barra: Location relativo, não http://host:8099/");
});

test("link público: instalar valida o domínio, grava config, modelos, site e os dois comandos; a pasta dos links é root 1733", () => {
  const sh = core.lpInstalarSh("agentesgrok.com");
  assert.match(sh, /^\[ "\$\(id -u\)" = 0 \]/m, "só root");
  assert.match(sh, /chmod 1733 \/var\/www\/publico/); assert.match(sh, /chmod 755 \/etc\/meu-bot-link-publico/, "os usuários leem o domínio e os modelos daqui (não de /etc/meu-bot, que é 700)");
  assert.match(sh, /"dominio": "agentesgrok.com", "porta": 8099/);
  assert.match(sh, /cat > \/usr\/local\/bin\/publicar <<'EOF_PUB'/); assert.match(sh, /cat > \/usr\/local\/bin\/link-publico-nome <<'EOF_NOME'/);
  assert.match(sh, /cat > \/etc\/meu-bot-link-publico\/md2html\.py <<'EOF_MD'\n#!\/usr\/bin\/env python3/, "conversor de markdown vai junto");
  assert.match(sh, /apt-get -y -qq install python3-markdown/);
  assert.match(sh, /cloudflared-linux-\$a\.deb/); assert.match(sh, /^echo "INSTALADO=ok"$/m);
  assert.throws(() => core.lpInstalarSh("agentes grok.com"), /domínio inválido/);
  assert.throws(() => core.lpInstalarSh("x; rm -rf /"), /domínio inválido/);
});

test("link público: ligar cria a pasta (dona o usuário), respeita um nome já trocado, e o que vai no home é gravado por ele; desligar guarda a pasta", () => {
  const sh = core.lpLigarSh("box-2");
  assert.match(sh, /mkdir "\$D"; chown box-2:box-2 "\$D"; chmod 755 "\$D"/);
  assert.match(sh, /\.desligado-box-2/, "voltar do desligado");
  assert.match(sh, /runuser -u box-2 -- sh -c '\n  ln -sfn "\$1" "\$HOME\/publico"/, "quem grava no home é o usuário");
  assert.match(sh, /\.hermes\/skills\/meu-bot-link-publico\/SKILL\.md/); assert.match(sh, /agent-workspace\/CLAUDE\.md/);
  assert.doesNotMatch(sh, /chown [^\n]*\$H\//, "o root não dá chown dentro do home");
  assert.match(sh, /^echo "LINK=ok \$NOME"$/m);
  assert.throws(() => core.lpLigarSh("box-2; id"), /inválido/);
  const d = core.lpDesligarSh("box-2");
  assert.match(d, /mv "\$A" "\/var\/www\/publico\/\.desligado-box-2"/); assert.match(d, /rm -rf "\$HOME\/\.hermes\/skills\/meu-bot-link-publico"/); assert.match(d, /^echo "LINK=desligado"$/m);
});

test("link público: túnel cria uma vez (deleted_at dos vivos vem como 0001-…), rota curinga e serviço; login sobe o cloudflared solto e devolve o link", () => {
  const sh = core.lpTunelSh("agentesgrok.com");
  assert.match(sh, /startswith\("0001"\)/, "túnel vivo tem deleted_at 0001-01-01, não vazio");
  assert.match(sh, /hostname: "\*\.agentesgrok\.com"\n    service: http:\/\/127\.0\.0\.1:8099\n  - service: http_status:404/);
  assert.match(sh, /cloudflared tunnel route dns meu-bot-publico "\*\.agentesgrok\.com"/); assert.match(sh, /^echo "TUNEL=ok \$ID"$/m);
  assert.match(core.LP_LOGIN_SH, /setsid nohup cloudflared tunnel login/); assert.match(core.LP_LOGIN_SH, /pkill -f '\^cloudflared tunnel login'/, "o pkill ancorado não mata o próprio bash");
  assert.match(core.LP_LOGIN_SH, /echo "URL=\$u"/);
});

test("link público: os comandos do usuário recusam fora da pasta dos links, limpam o nome e trocam o subdomínio com regras", () => {
  assert.match(core.PUBLICAR_SH, /case "\$ALVO" in \/var\/www\/publico\/\*\) ;; \*\) echo "ERRO: o seu link público não está ligado/);
  assert.match(core.PUBLICAR_SH, /tr -c 'A-Za-z0-9\._-' '-'/, "nome no link só com caracteres seguros");
  assert.match(core.PUBLICAR_SH, /case "\$ARQ" in \*\.md\|\*\.MD\|\*\.markdown\)/, "md vira página");
  assert.match(core.PUBLICAR_SH, /DEST=\$\{DEST%\.md\}/, "a URL do .md fica sem extensão (…/fluxo/)");
  assert.match(core.PUBLICAR_SH, /python3 \/etc\/meu-bot-link-publico\/md2html\.py "\$ARQ" > "\$ALVO\/\$DEST\/index\.html"/);
  assert.match(core.PUBLICAR_SH, /cp -f "\$ARQ" "\$ALVO\/\$DEST\/\$DEST\.md"/, "o .md original fica ao lado da página");
  assert.match(core.MD2HTML_PY, /import markdown/); assert.match(core.MD2HTML_PY, /except ImportError:\n\s+corpo = "<pre>"/, "sem o módulo, ainda sai página");
  assert.match(core.MD2HTML_PY, /lang="pt-BR"/); assert.match(core.MD2HTML_PY, /prefers-color-scheme:dark/);
  assert.match(core.skillLinkPublico("agentesgrok.com"), /publicar fluxo-atendimento\.md.*fluxo-atendimento\//, "a skill diz que .md vira página");
  assert.match(core.LINK_NOME_SH, /www\|admin\|api\|mail/, "nomes reservados");
  assert.match(core.LINK_NOME_SH, /getent passwd "\$NOVO"/, "nome de outro usuário não vale");
  assert.match(core.LINK_NOME_SH, /mv "\/var\/www\/publico\/\$ATUAL" "\/var\/www\/publico\/\$NOVO"/, "a pasta é dele: renomeia sem root (sticky bit)");
  assert.match(core.skillLinkPublico("agentesgrok.com"), /^name: meu-bot-link-publico$/m); assert.match(core.skillLinkPublico("agentesgrok.com"), /https:\/\/<nome>\.agentesgrok\.com\//);
  assert.match(core.claudeMdLinkPublico("agentesgrok.com"), /<!-- meu-bot:link-publico v1 inicio -->[\s\S]*<!-- meu-bot:link-publico v1 fim -->/);
});

test("link público: estado lido da linha ESTADO=, com usuários e link validados; etapa da aba em ordem", () => {
  const e = core.lerEstadoLp(`x\nESTADO=${JSON.stringify({ instalado: true, nginx: true, login: true, loginUrl: "https://dash.cloudflare.com/argotunnel?x", tunel: "afb28655-3bbe-406a-9f5a-c1f9c3bef802", servico: true, rota: true, dominio: "agentesgrok.com", usuarios: [{ nome: "box-2", ligado: true, link: "daniel", arquivos: 3 }, { nome: "x;y", ligado: true }, { nome: "box-3", ligado: true, link: "Ruim Nome", arquivos: 0 }] })}\n`);
  assert.equal(e.dominio, "agentesgrok.com"); assert.equal(e.usuarios.length, 2); assert.equal(e.usuarios[0].link, "daniel"); assert.equal(e.usuarios[1].link, null, "link fora do padrão não passa");
  assert.equal(core.lerEstadoLp("NAOROOT\n"), null);
  assert.equal(page.etapaLp({ ...e, instalado: false }), "instalar"); assert.equal(page.etapaLp({ ...e, login: false }), "entrar");
  assert.equal(page.etapaLp({ ...e, tunel: null }), "tunel"); assert.equal(page.etapaLp({ ...e, servico: false }), "tunel"); assert.equal(page.etapaLp(e), "pronto");
});

test("link público da pessoa: lê LINK=1 + json; desligado, json torto ou nome fora do padrão → null", () => {
  const ok = cli.lerLinkPublico('LINK=1 2 box-2\n{"url": "https://daniel.agentesgrok.com/", "nome": "daniel", "dominio": "agentesgrok.com"}\n');
  assert.deepEqual(ok, { url: "https://daniel.agentesgrok.com/", nome: "daniel", dominio: "agentesgrok.com", arquivos: 2, usuario: "box-2" });
  assert.equal(cli.lerLinkPublico("LINK=0\n"), null);
  assert.equal(cli.lerLinkPublico('LINK=1 0 box-2\n{"url": "javascript:x", "nome": "daniel", "dominio": "agentesgrok.com"}\n'), null);
  assert.equal(cli.lerLinkPublico('LINK=1 0 box-2\n{"url": "https://a.b/", "nome": "Ruim Nome", "dominio": "b"}\n'), null);
});
