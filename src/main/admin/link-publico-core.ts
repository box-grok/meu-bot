/**
 * Link Público Global (parte pura): os scripts que o admin roda como root na máquina. Cada usuário ganha um link
 * `https://<nome>.<domínio>/` servido pela pasta dele (`~/publico` → `/var/www/publico/<nome>`), por um nginx só em
 * 127.0.0.1 atrás de um Cloudflare Tunnel do root (a máquina não abre porta nenhuma; o TLS é da Cloudflare). O
 * domínio fica na conta Cloudflare do root (login uma vez, como o Claude Code Global); o agente de cada usuário dá
 * links com o comando `publicar`, ensinado por uma skill do Hermes e um bloco no CLAUDE.md. O nome do link a pessoa
 * troca sozinha (`link-publico-nome`, tutorial 17): a pasta é dela numa pasta com sticky bit, sem passar pelo root.
 */
import type { LpEstado } from "../../shared/ipc";
import { NOME_USUARIO_RE } from "./usuarios-core";

export const LP_ETC = "/etc/meu-bot-link-publico";
export const LP_WWW = "/var/www/publico";
export const LP_PORTA = 8099;
export const LP_TUNEL = "meu-bot-publico";
export const LP_LOGIN_LOG = "/tmp/meu-bot-cf-login.log";
/** Domínio raiz dos links (ex.: agentesgrok.com): só letras minúsculas, números, hífen e pontos. */
export const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Nome do link (subdomínio): o que o nginx aceita e o `link-publico-nome` confere. */
export const NOME_LINK_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const nomeOk = (nome: string): string => { if (!NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido"); return nome; };
const dominioOk = (d: string): string => { if (!DOMINIO_RE.test(d)) throw new Error("domínio inválido: use algo como agentesgrok.com"); return d; };

const SO_ROOT = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }`;

/** Comando `publicar` de todo usuário: copia para a pasta do link e imprime a URL. Lê o domínio de ${LP_ETC}/config.json. */
export const PUBLICAR_SH = `#!/bin/sh
# meu-bot: publica um arquivo (ou pasta) no link público deste usuário e imprime a URL.
# Uso: publicar <arquivo|pasta> [nome-no-link]   ·   publicar --lista   ·   publicar --remover <nome-no-link>
set -u
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO: o link público não está instalado nesta máquina (é o admin quem instala, no meu-bot-admin › Link Público Global)." >&2; exit 1; }
P="$HOME/publico"
ALVO=$(readlink -f "$P" 2>/dev/null || true)
case "$ALVO" in ${LP_WWW}/*) ;; *) echo "ERRO: o seu link público não está ligado: peça ao admin para ligar o Link Público Global para $USER." >&2; exit 1;; esac
[ -d "$ALVO" ] || { echo "ERRO: a pasta do seu link ($ALVO) não existe: peça ao admin para ligar de novo." >&2; exit 1; }
NOME=$(basename "$ALVO")
case "\${1:-}" in
  --lista) ls -1A "$ALVO" 2>/dev/null | sed "s|^|https://$NOME.$DOM/|"; exit 0 ;;
  --remover) [ -n "\${2:-}" ] || { echo "Uso: publicar --remover <nome-no-link>" >&2; exit 1; }; N=$(basename "$2"); rm -rf "$ALVO/$N"; echo "fora do ar: https://$NOME.$DOM/$N"; exit 0 ;;
  ""|-h|--help) echo "Uso: publicar <arquivo|pasta> [nome-no-link]   ·   publicar --lista   ·   publicar --remover <nome>" >&2; echo "Seu link: https://$NOME.$DOM/" >&2; exit 1 ;;
esac
ARQ="$1"; [ -e "$ARQ" ] || { echo "ERRO: não existe: $ARQ" >&2; exit 1; }
DEST=$(basename "\${2:-$ARQ}"); DEST=$(printf '%s' "$DEST" | tr -c 'A-Za-z0-9._-' '-'); DEST=\${DEST#.}
[ -n "$DEST" ] || { echo "ERRO: nome inválido" >&2; exit 1; }
if [ -d "$ARQ" ]; then rm -rf "$ALVO/$DEST"; cp -r "$ARQ" "$ALVO/$DEST"; chmod -R u+rwX,go+rX "$ALVO/$DEST"; echo "https://$NOME.$DOM/$DEST/"
else cp -f "$ARQ" "$ALVO/$DEST"; chmod 644 "$ALVO/$DEST"; echo "https://$NOME.$DOM/$DEST"; fi
`;

/** Comando `link-publico-nome` de todo usuário: troca o subdomínio dele (renomeia a pasta, que é dele, e refaz ~/publico). */
export const LINK_NOME_SH = `#!/bin/sh
# meu-bot: troca o nome do link público deste usuário (<nome>.<domínio>). Uso: link-publico-nome <novo-nome>   ·   link-publico-nome --ver
set -u
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO: o link público não está instalado nesta máquina." >&2; exit 1; }
P="$HOME/publico"; ALVO=$(readlink -f "$P" 2>/dev/null || true)
case "$ALVO" in ${LP_WWW}/*) ;; *) echo "ERRO: o seu link público não está ligado (peça ao admin)." >&2; exit 1;; esac
ATUAL=$(basename "$ALVO")
[ "\${1:-}" = "--ver" ] && { echo "https://$ATUAL.$DOM/"; exit 0; }
NOVO=$(printf '%s' "\${1:-}" | tr 'A-Z' 'a-z')
printf '%s' "$NOVO" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' || { echo "ERRO: nome inválido: só letras minúsculas, números e hífen (2 a 63 caracteres, sem começar ou terminar com hífen)." >&2; exit 1; }
case "$NOVO" in www|admin|api|mail|ftp|smtp|imap|pop|ns1|ns2|root|meu|meu-bot|suporte|status|app|login|dash|cdn|static) echo "ERRO: esse nome é reservado." >&2; exit 1;; esac
if [ "$NOVO" != "$USER" ] && getent passwd "$NOVO" >/dev/null 2>&1; then echo "ERRO: esse nome é de outro usuário desta máquina." >&2; exit 1; fi
[ "$NOVO" = "$ATUAL" ] && { echo "https://$ATUAL.$DOM/"; exit 0; }
[ -e "${LP_WWW}/$NOVO" ] && { echo "ERRO: o nome $NOVO já está em uso." >&2; exit 1; }
mv "${LP_WWW}/$ATUAL" "${LP_WWW}/$NOVO" || { echo "ERRO: não consegui renomear a pasta do link." >&2; exit 1; }
ln -sfn "${LP_WWW}/$NOVO" "$P"
mkdir -p "$HOME/.local/share/meu-bot"; printf '{"url": "https://%s.%s/", "nome": "%s", "dominio": "%s"}\\n' "$NOVO" "$DOM" "$NOVO" "$DOM" > "$HOME/.local/share/meu-bot/link-publico.json"
echo "https://$NOVO.$DOM/"
`;

/** Skill do Hermes (vai para ~/.hermes/skills/meu-bot-link-publico/SKILL.md de quem tem o link ligado). */
export const skillLinkPublico = (dominio: string): string => `---
name: meu-bot-link-publico
description: Dar um link público (URL https) de um arquivo, página HTML ou pasta desta máquina com o comando \`publicar\`. Use quando pedirem "link", "URL", "me manda o link", "publica", "compartilha", "coloca no ar" ou um site/página para alguém ver.
version: 1.0.0
author: meu-bot
platforms: [linux]
metadata:
  hermes:
    tags: [meu-bot, link, publicar, site, url]
---
# Link público (meu-bot)

Cada usuário desta máquina tem um link público próprio, \`https://<nome>.${dominio}/\`, servido pela pasta \`~/publico\`.
Você CONSEGUE gerar link público: nunca diga que não tem como.

## Como dar o link de um arquivo
1. Rode \`publicar /caminho/do/arquivo\` (opcional, o nome que aparece no link: \`publicar arquivo.md fluxo.md\`). O comando imprime a URL.
2. Responda com a URL que ele imprimiu, sem inventar outra.

## Regras
- Tudo em \`~/publico\` fica visível para qualquer pessoa na internet, sem senha. Não publique dados pessoais, senhas ou arquivos de terceiros sem a pessoa pedir.
- Para uma página, gere um \`.html\` e publique; \`publicar pasta/ nome\` publica uma pasta inteira, e \`index.html\` abre na raiz.
- \`publicar --lista\` mostra o que está no ar; \`publicar --remover <nome>\` tira do ar.
- \`link-publico-nome --ver\` mostra o link; \`link-publico-nome <novo-nome>\` troca o nome (só se a pessoa pedir).
- Se o comando disser que o link "não está ligado" ou "não está instalado", diga que o admin precisa ligar o Link Público Global no meu-bot-admin.
`;

/** Bloco do CLAUDE.md do workspace do agente da máquina (marcadores idempotentes, como o do wa-enviar). */
export const claudeMdLinkPublico = (dominio: string): string => `<!-- meu-bot:link-publico v1 inicio -->
## Link público (meu-bot)
Para dar um link público de um arquivo, página ou pasta: \`publicar <arquivo> [nome-no-link]\`, que imprime a URL (\`https://<nome>.${dominio}/...\`, a pasta \`~/publico\`).
Responda com a URL impressa. Tudo ali é público na internet: não publique dados pessoais ou segredos sem a pessoa pedir.
\`publicar --lista\` mostra o que está no ar; \`publicar --remover <nome>\` tira; \`link-publico-nome <novo>\` troca o nome do link (só se a pessoa pedir).
<!-- meu-bot:link-publico v1 fim -->
`;

/** O site do nginx: `<nome>.<domínio>` → `${LP_WWW}/<nome>`, só em 127.0.0.1 (atrás do túnel), sem listar pastas nem seguir symlink de outro dono. */
export const nginxSite = (dominio: string): string => `# meu-bot: link público de cada usuário da máquina (<nome>.${dominio} → ${LP_WWW}/<nome>), atrás do Cloudflare Tunnel.
server {
    listen 127.0.0.1:${LP_PORTA};
    server_name "~^(?<sub>[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\\.${dominio.replace(/\./g, "\\.")}$";
    root ${LP_WWW}/$sub;
    index index.html index.htm;
    autoindex off;
    disable_symlinks if_not_owner from=${LP_WWW};
    client_max_body_size 1m;
    add_header X-Content-Type-Options nosniff;
    location ~ /\\. { return 404; }
    location / { try_files $uri $uri/ =404; }
}
server { listen 127.0.0.1:${LP_PORTA} default_server; server_name _; return 404; }
`;

/**
 * Estado para a tela, numa linha `ESTADO=<json>`: instalado (nginx + cloudflared + config), nginx no ar, login do root
 * na Cloudflare (cert.pem), túnel criado e serviço no ar, rota curinga no DNS, domínio, e os usuários com o link
 * ligado (nome do link e quantos arquivos no ar).
 */
export const LP_ESTADO_SH = `${SO_ROOT}
NGINX=0; command -v nginx >/dev/null 2>&1 && [ -f /etc/nginx/sites-enabled/meu-bot-publico ] && NGINX=1
NGATIVO=0; systemctl is-active --quiet nginx 2>/dev/null && NGATIVO=1
CF=0; command -v cloudflared >/dev/null 2>&1 && CF=1
LOGIN=0; [ -s /root/.cloudflared/cert.pem ] && LOGIN=1
TID=$(sed -n 's/^tunnel: *//p' /etc/cloudflared/config.yml 2>/dev/null | head -1)
SERV=0; systemctl is-active --quiet cloudflared 2>/dev/null && SERV=1
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null)
ROTA=0; [ -n "$DOM" ] && getent hosts "meu-bot-sonda.$DOM" >/dev/null 2>&1 && ROTA=1
LOGINURL=$(grep -o 'https://dash.cloudflare.com/argotunnel[^ ]*' ${LP_LOGIN_LOG} 2>/dev/null | head -1)
pgrep -f '^cloudflared tunnel login' >/dev/null 2>&1 || LOGINURL=""
NGINX=$NGINX NGATIVO=$NGATIVO CF=$CF LOGIN=$LOGIN TID="$TID" SERV=$SERV DOM="$DOM" ROTA=$ROTA LOGINURL="$LOGINURL" python3 -c '
import json, os, pwd
www = "${LP_WWW}"
usuarios = []
for p in pwd.getpwall():
    if p.pw_uid < 1000 or p.pw_uid >= 60000 or p.pw_shell.endswith(("nologin", "false")): continue
    alvo = None
    try:
        a = os.readlink(os.path.join(p.pw_dir, "publico"))
        if a.startswith(www + "/") and os.path.isdir(a) and os.stat(a).st_uid == p.pw_uid: alvo = a
    except OSError: pass
    n = 0
    if alvo:
        try: n = len([x for x in os.listdir(alvo) if not x.startswith(".")])
        except OSError: n = 0
    usuarios.append({"nome": p.pw_name, "ligado": alvo is not None, "link": os.path.basename(alvo) if alvo else None, "arquivos": n})
usuarios.sort(key=lambda x: x["nome"])
e = os.environ
print("ESTADO=" + json.dumps({
    "instalado": e["NGINX"] == "1" and e["CF"] == "1" and bool(e["DOM"]), "nginx": e["NGATIVO"] == "1",
    "login": e["LOGIN"] == "1", "loginUrl": e["LOGINURL"] or None, "tunel": e["TID"] or None, "servico": e["SERV"] == "1", "rota": e["ROTA"] == "1",
    "dominio": e["DOM"] or None, "usuarios": usuarios}))
'`;

/**
 * Instala (idempotente): nginx e cloudflared (pacote .deb do GitHub), a pasta dos links (root, 1733: cada usuário cria
 * a sua, ninguém lista as outras), o site do nginx, os modelos (skill e bloco do CLAUDE.md), o config.json com o
 * domínio e os comandos `publicar` e `link-publico-nome` em /usr/local/bin. Saída `INSTALADO=ok` ou `ERRO=`.
 */
export function lpInstalarSh(dominio: string): string {
  const d = dominioOk(dominio);
  return `${SO_ROOT}
export DEBIAN_FRONTEND=noninteractive; LOG=/tmp/meu-bot-link-publico.log
command -v nginx >/dev/null 2>&1 || { apt-get -qq update >>$LOG 2>&1 || true; apt-get -y -qq install nginx >>$LOG 2>&1 || { echo "ERRO=não consegui instalar o nginx (log em $LOG)"; exit 0; }; }
if ! command -v cloudflared >/dev/null 2>&1; then
  a=$(dpkg --print-architecture); t=$(mktemp -d)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$a.deb" -o "$t/cf.deb" && dpkg -i "$t/cf.deb" >>$LOG 2>&1 || { rm -rf "$t"; echo "ERRO=não consegui instalar o cloudflared (log em $LOG)"; exit 0; }
  rm -rf "$t"
fi
mkdir -p ${LP_WWW}; chown root:root ${LP_WWW}; chmod 1733 ${LP_WWW}
mkdir -p ${LP_ETC}; chmod 755 ${LP_ETC}
printf '{"dominio": "${d}", "porta": ${LP_PORTA}}\\n' > ${LP_ETC}/config.json
cat > ${LP_ETC}/SKILL.md <<'EOF_SKILL'
${skillLinkPublico(d)}EOF_SKILL
cat > ${LP_ETC}/claude.md <<'EOF_CLAUDE'
${claudeMdLinkPublico(d)}EOF_CLAUDE
chmod 644 ${LP_ETC}/config.json ${LP_ETC}/SKILL.md ${LP_ETC}/claude.md
cat > /etc/nginx/sites-available/meu-bot-publico <<'EOF_NGINX'
${nginxSite(d)}EOF_NGINX
ln -sfn /etc/nginx/sites-available/meu-bot-publico /etc/nginx/sites-enabled/meu-bot-publico
rm -f /etc/nginx/sites-enabled/default
nginx -t >>$LOG 2>&1 || { echo "ERRO=a configuração do nginx não passou (log em $LOG)"; exit 0; }
systemctl enable --now nginx >>$LOG 2>&1; systemctl reload nginx >>$LOG 2>&1 || systemctl restart nginx >>$LOG 2>&1
cat > /usr/local/bin/publicar <<'EOF_PUB'
${PUBLICAR_SH}EOF_PUB
cat > /usr/local/bin/link-publico-nome <<'EOF_NOME'
${LINK_NOME_SH}EOF_NOME
chmod 755 /usr/local/bin/publicar /usr/local/bin/link-publico-nome
systemctl is-active --quiet nginx || { echo "ERRO=o nginx não subiu (journalctl -u nginx)"; exit 0; }
echo "INSTALADO=ok"`;
}

/**
 * Login do root na Cloudflare: sobe `cloudflared tunnel login` solto (setsid), que espera a autorização e baixa o
 * cert.pem sozinho; imprime `URL=<link>` para a pessoa abrir no navegador. Saída `ERRO=` se o link não apareceu.
 */
export const LP_LOGIN_SH = `${SO_ROOT}
command -v cloudflared >/dev/null 2>&1 || { echo "ERRO=o cloudflared não está instalado: instale o Link Público Global antes"; exit 0; }
pkill -f '^cloudflared tunnel login' 2>/dev/null; sleep 1
rm -f /root/.cloudflared/cert.pem ${LP_LOGIN_LOG}
setsid nohup cloudflared tunnel login >${LP_LOGIN_LOG} 2>&1 </dev/null &
u=""; for i in $(seq 1 30); do u=$(grep -o 'https://dash.cloudflare.com/argotunnel[^ ]*' ${LP_LOGIN_LOG} 2>/dev/null | head -1); [ -n "$u" ] && break; sleep 1; done
[ -n "$u" ] && echo "URL=$u" || echo "ERRO=o cloudflared não mostrou o link de login (veja ${LP_LOGIN_LOG})"`;

/**
 * Com o cert.pem do root: cria o túnel (uma vez), grava /etc/cloudflared/config.yml (curinga `*.<domínio>` → nginx,
 * resto 404), aponta o DNS curinga para o túnel e instala/sobe o serviço. Saída `TUNEL=ok <id>` ou `ERRO=`.
 */
export function lpTunelSh(dominio: string): string {
  const d = dominioOk(dominio);
  return `${SO_ROOT}
[ -s /root/.cloudflared/cert.pem ] || { echo "ERRO=o root ainda não entrou na Cloudflare"; exit 0; }
LOG=/tmp/meu-bot-link-publico.log
ID=$(cloudflared tunnel list -o json 2>/dev/null | python3 -c 'import json, sys
try:
    for t in json.load(sys.stdin):
        if t.get("name") == "${LP_TUNEL}" and str(t.get("deleted_at", "0001")).startswith("0001"): print(t["id"]); break
except Exception: pass')
if [ -z "$ID" ]; then
  cloudflared tunnel create ${LP_TUNEL} >>$LOG 2>&1 || { echo "ERRO=não consegui criar o túnel (log em $LOG)"; exit 0; }
  ID=$(cloudflared tunnel list -o json 2>/dev/null | python3 -c 'import json, sys
for t in json.load(sys.stdin):
    if t.get("name") == "${LP_TUNEL}" and str(t.get("deleted_at", "0001")).startswith("0001"): print(t["id"]); break')
fi
[ -n "$ID" ] && [ -f "/root/.cloudflared/$ID.json" ] || { echo "ERRO=o túnel não tem credencial em /root/.cloudflared"; exit 0; }
mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<EOF_CF
# meu-bot: Link Público Global. *.${d} → nginx local (${LP_WWW}/<nome>); o resto, 404.
tunnel: $ID
credentials-file: /root/.cloudflared/$ID.json
ingress:
  - hostname: "*.${d}"
    service: http://127.0.0.1:${LP_PORTA}
  - service: http_status:404
EOF_CF
cloudflared tunnel route dns ${LP_TUNEL} "*.${d}" >>$LOG 2>&1 || grep -q "already exists" $LOG || { echo "ERRO=não consegui apontar *.${d} para o túnel (o domínio está nesta conta da Cloudflare? log em $LOG)"; exit 0; }
if [ ! -f /etc/systemd/system/cloudflared.service ]; then cloudflared --config /etc/cloudflared/config.yml service install >>$LOG 2>&1 || { echo "ERRO=não consegui instalar o serviço do cloudflared (log em $LOG)"; exit 0; }; fi
systemctl daemon-reload; systemctl enable --now cloudflared >>$LOG 2>&1; systemctl restart cloudflared >>$LOG 2>&1
sleep 3; systemctl is-active --quiet cloudflared || { echo "ERRO=o serviço do cloudflared não subiu (journalctl -u cloudflared)"; exit 0; }
echo "TUNEL=ok $ID"`;
}

/**
 * Liga o link do usuário: a pasta `${LP_WWW}/<nome>` (dona ele, 755; se ele já trocou o nome, fica o que ele escolheu;
 * se estava desligado, volta a pasta guardada), e, gravados por ele dentro do home (symlink plantado não leva o root a
 * lugar nenhum): `~/publico`, o json que a tela dele lê, a skill do Hermes e o bloco no CLAUDE.md. Saída `LINK=ok <nome>`.
 */
export function lpLigarSh(nome: string): string {
  const n = nomeOk(nome);
  return `${SO_ROOT}
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO=o Link Público Global ainda não está instalado nesta máquina"; exit 0; }
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=usuário ${n} não existe"; exit 0; }
A=$(runuser -u ${n} -- readlink -f "$H/publico" 2>/dev/null || true)
case "$A" in ${LP_WWW}/*) [ "$(stat -c %U "$A" 2>/dev/null)" = "${n}" ] && NOME=$(basename "$A") || NOME=${n} ;; *) NOME=${n} ;; esac
D="${LP_WWW}/$NOME"
[ -d "${LP_WWW}/.desligado-${n}" ] && [ ! -e "$D" ] && mv "${LP_WWW}/.desligado-${n}" "$D"
if [ ! -e "$D" ]; then mkdir "$D"; chown ${n}:${n} "$D"; chmod 755 "$D"; fi
J=$(printf '{"url": "https://%s.%s/", "nome": "%s", "dominio": "%s"}' "$NOME" "$DOM" "$NOME" "$DOM")
printf '%s\\n' "$J" | runuser -u ${n} -- sh -c '
  ln -sfn "$1" "$HOME/publico"
  mkdir -p "$HOME/.local/share/meu-bot" && cat > "$HOME/.local/share/meu-bot/link-publico.json"
  if [ -d "$HOME/.hermes" ]; then mkdir -p "$HOME/.hermes/skills/meu-bot-link-publico" && cp -f ${LP_ETC}/SKILL.md "$HOME/.hermes/skills/meu-bot-link-publico/SKILL.md"; fi
  if [ -d "$HOME/agent-workspace" ]; then python3 - "$HOME/agent-workspace/CLAUDE.md" <<"PY"
import re, sys
p = sys.argv[1]; bloco = open("${LP_ETC}/claude.md").read().rstrip("\\n")
try: t = open(p).read()
except FileNotFoundError: t = ""
t2 = re.sub(r"\\n?<!-- meu-bot:link-publico v1 inicio -->.*?<!-- meu-bot:link-publico v1 fim -->\\n?", "\\n", t, flags=re.S).rstrip("\\n")
t2 = (t2 + "\\n\\n" if t2 else "") + bloco + "\\n"
if t2 != t: open(p, "w").write(t2)
PY
  fi' sh "$D"
echo "LINK=ok $NOME"`;
}

/** Desliga o link do usuário: a pasta sai do ar (guardada em `.desligado-<nome>`, para voltar igual), e some o que era dele no home. Saída `LINK=desligado`. */
export function lpDesligarSh(nome: string): string {
  const n = nomeOk(nome);
  return `${SO_ROOT}
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] || { echo "ERRO=usuário ${n} não existe"; exit 0; }
A=$(runuser -u ${n} -- readlink -f "$H/publico" 2>/dev/null || true)
case "$A" in ${LP_WWW}/*) [ "$(stat -c %U "$A" 2>/dev/null)" = "${n}" ] && [ -d "$A" ] && { rm -rf "${LP_WWW}/.desligado-${n}"; mv "$A" "${LP_WWW}/.desligado-${n}"; } ;; esac
runuser -u ${n} -- sh -c '
  rm -f "$HOME/publico" "$HOME/.local/share/meu-bot/link-publico.json"; rm -rf "$HOME/.hermes/skills/meu-bot-link-publico"
  [ -f "$HOME/agent-workspace/CLAUDE.md" ] && python3 - "$HOME/agent-workspace/CLAUDE.md" <<"PY"
import re, sys
p = sys.argv[1]; t = open(p).read()
t2 = re.sub(r"\\n?<!-- meu-bot:link-publico v1 inicio -->.*?<!-- meu-bot:link-publico v1 fim -->\\n?", "\\n", t, flags=re.S)
if t2 != t: open(p, "w").write(t2)
PY
  true'
echo "LINK=desligado"`;
}

/** Lê a linha `ESTADO=` (null se o script não respondeu ou não é root). */
export function lerEstadoLp(out: string): LpEstado | null {
  const m = /^ESTADO=(.*)$/m.exec(out);
  if (m === null) return null;
  try {
    const v = JSON.parse(m[1]!) as Partial<LpEstado>;
    return {
      instalado: v.instalado === true, nginx: v.nginx === true, login: v.login === true,
      loginUrl: typeof v.loginUrl === "string" && /^https:\/\/dash\.cloudflare\.com\//.test(v.loginUrl) ? v.loginUrl : null,
      tunel: typeof v.tunel === "string" && /^[a-f0-9-]{36}$/.test(v.tunel) ? v.tunel : null, servico: v.servico === true, rota: v.rota === true,
      dominio: typeof v.dominio === "string" && DOMINIO_RE.test(v.dominio) ? v.dominio : null,
      usuarios: Array.isArray(v.usuarios) ? v.usuarios.filter((u) => NOME_USUARIO_RE.test(String(u?.nome))).map((u) => ({ nome: String(u.nome), ligado: u.ligado === true, link: typeof u.link === "string" && NOME_LINK_RE.test(u.link) ? u.link : null, arquivos: typeof u.arquivos === "number" ? u.arquivos : 0 })) : [],
    };
  } catch { return null; }
}
