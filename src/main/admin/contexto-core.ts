/**
 * "Contexto para agentes" (Preparar máquina): o bloco que diz ao Claude Code do root (e das contas) e ao agente do
 * OpenClaw o que o meu-bot deixa numa máquina preparada, para uma auditoria não apontar como suspeito o que é nosso
 * (5 nov: o agente da VM "meu" quis remover o usuário `nova`, que o pacote novnc cria). Bloco com marcadores, no molde da
 * regra do Navegador: regravado inteiro a cada aplicação, nunca toca no resto do arquivo. Puro: só texto e script.
 */

export const CONTEXTO_VERSAO = 2;
export const CONTEXTO_START = `<!-- meu-bot:maquina v${CONTEXTO_VERSAO} inicio -->`;
export const CONTEXTO_END = `<!-- meu-bot:maquina v${CONTEXTO_VERSAO} fim -->`;

/** O texto, em linguagem de quem audita: o que é do meu-bot, onde está, e a regra. */
export const CONTEXTO_MD = [
  CONTEXTO_START,
  "## Esta máquina é administrada pelo meu-bot (contexto para auditorias)",
  "O meu-bot-admin-gestao, no Mac do admin, prepara e administra esta máquina por SSH como root. O que segue é dele, está onde deve e não é sobra, lixo nem invasão. Antes de apontar algo como suspeito, confira esta lista; e nunca remova, desative ou \"corrija\" um item daqui sem o admin pedir nesta conversa. Para mudar qualquer um deles, o caminho é o meu-bot-admin (Preparar máquina, aba Usuários), não o shell.",
  "- **Contas `box-*`** (UID ≥ 1000, shell bash, sempre ligadas com linger, teto de RAM/CPU em `user-<uid>.slice`, cota de disco): uma por pessoa ou cliente. Cada uma tem o meu-bot em `~/.local/share/meu-bot` (backend, porteiro, guarda, scripts), o Claude Code em `~/.local/bin` e um gateway do WhatsApp (OpenClaw ou Hermes) como serviço do usuário.",
  "- **Usuários de sistema que pacotes criam:** `nova` (UID < 1000, home `/var/lib/nova` inexistente, senha travada) vem do pacote `novnc` da tela do bot, por herança do OpenStack; `auditoria` é a central de auditoria do meu-bot. Não apague nem \"conserte\".",
  "- **/opt/hermes, /opt/openclaw, /opt/transcriber:** Hermes, OpenClaw e o transcritor de áudio para todos (dono root, só leitura para os outros); atalhos em `/usr/local/bin/{hermes,openclaw,gh}`.",
  "- **Memória e disco:** `/swapfile` de 8 GB com `/etc/sysctl.d/90-meu-bot-swap.conf`; `usrquota` no `/`; `user.slice` com `MemoryMax` (reserva para o sistema) e `MemorySwapMax`/`MemoryLow`/`CPUWeight` por box.",
  "- **Rede:** `/etc/systemd/resolved.conf.d/meu-bot-sem-llmnr.conf` (LLMNR desligado de propósito; o resolvedor não responde na porta 5355).",
  "- **Gateway do OpenClaw por conta:** `systemd --user openclaw-gateway.service`, drop-in `openclaw-gateway.service.d/meu-bot-leve.conf` (heap do Node limitada) e `plugins.allow` enxuto; o plugin `meu-bot-guarda` e o timer `meu-bot-vigia-gateway` são do meu-bot.",
  "- **Pacotes:** jq, ffmpeg, xvfb, x11-utils, openbox, x11vnc, novnc, python3-websockify, xdotool, scrot (a tela do bot), opcionalmente chromium; nginx e cloudflared (Link Público Global) e o serviço do Claude Code Global, quando ligados.",
  "- **Docker**, quando presente, é do provedor ou de testes do admin; os containers não são do meu-bot.",
  "- **Backup e restauro:** o meu-bot do dono, no Mac dele, copia os conjuntos de cada conta (agente, credenciais, trabalho, CRM, financeiro) para o Google Drive dele, com cópia local no Mac; esta máquina não guarda o pacote. O que subiu e quando fica em `~/.local/share/meu-bot/backup-drive.json` da conta: leia-o quando perguntarem se o backup entrou. Restaurar ou mudar de máquina é pelo meu-bot (Conta Google › Restaurar uma cópia), nunca à mão nem pelo guia de migração do OpenClaw.",
  "O que estiver fora desta lista, aí sim descreva como achado.",
  CONTEXTO_END,
].join("\n");

/** Onde o bloco mora: o CLAUDE.md do agent-workspace (Claude Code) e o AGENTS.md do workspace do OpenClaw, do root e de cada box. */
const ALVOS_SH = `for h in /root /home/*; do [ -d "$h" ] || continue; u=$(stat -c %U "$h" 2>/dev/null); [ -n "$u" ] || continue
  echo "$u|$h/agent-workspace/CLAUDE.md|1"
  [ -d "$h/.openclaw/workspace" ] && echo "$u|$h/.openclaw/workspace/AGENTS.md|0"
done`;

/** `CONTEXTO=<arquivos> <atualizados>`: quantos alvos existem e quantos já têm o bloco desta versão. */
export const CONTEXTO_ESTADO_SH = `T=0; A=0; ${ALVOS_SH} | while IFS='|' read -r u f c; do T=$((T+1)); grep -qF '${CONTEXTO_START}' "$f" 2>/dev/null && A=$((A+1)); echo "$T $A"; done | tail -1 | sed 's/^/CONTEXTO=/'; [ -d /root ] || echo "CONTEXTO=0 0"`;

/**
 * O passo (root): regrava o bloco em cada alvo (cria o CLAUDE.md do agent-workspace se faltar; o AGENTS.md só onde o
 * workspace do OpenClaw existe), com dono e modo da conta. Imprime `CONTEXTO=ok <n>`.
 */
export function contextoSh(): string {
  const b64 = Buffer.from(CONTEXTO_MD, "utf8").toString("base64");
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
N=0
${ALVOS_SH} | while IFS='|' read -r u f c; do
  d=$(dirname "$f"); if [ ! -d "$d" ]; then [ "$c" = 1 ] || continue; mkdir -p "$d"; chown "$u":"$u" "$d" 2>/dev/null; fi
  python3 - "$f" '${b64}' '${CONTEXTO_START}' '${CONTEXTO_END}' <<'MEUBOT_PY' || { echo "aviso: $f: não gravei"; continue; }
import base64, os, re, sys
f, bloco, ini, fim = sys.argv[1], base64.b64decode(sys.argv[2]).decode("utf-8"), sys.argv[3], sys.argv[4]
try: t = open(f, encoding="utf-8").read()
except FileNotFoundError: t = ""
# tira qualquer versão anterior do bloco (marcadores meu-bot:maquina vN)
t = re.sub(r"<!-- meu-bot:maquina v\\d+ inicio -->.*?<!-- meu-bot:maquina v\\d+ fim -->\\n?", "", t, flags=re.S).strip("\\n")
t = (t + "\\n\\n" if t else "") + bloco + "\\n"
tmp = f + ".tmp"; open(tmp, "w", encoding="utf-8").write(t); os.replace(tmp, f)
MEUBOT_PY
  chown "$u":"$u" "$f" 2>/dev/null; chmod 644 "$f" 2>/dev/null; echo "ok $f"
done | { n=0; while read -r l; do case "$l" in ok\\ *) n=$((n+1));; *) echo "$l";; esac; done; echo "CONTEXTO=ok $n"; }`;
}
