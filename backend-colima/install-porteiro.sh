#!/usr/bin/env bash
# Instala o porteiro do `claude` nesta máquina (rodízio de contas do Claude para o OpenClaw/WhatsApp e o Terminal).
# Rodar depois do install.sh (ele chama este no fim), com claude-porteiro.sh ao lado. Idempotente: pode rodar de novo.
# - Grava ~/.local/share/meu-bot/bin/claude (shim) apontando para o node e a pasta do backend.
# - Põe essa pasta na frente do PATH dos shells (~/.profile, ~/.bashrc; ~/.zshrc e ~/.bash_profile se existirem),
#   num bloco delimitado, no FIM do arquivo: linhas de baixo que põem ~/.local/bin na frente (onde mora o claude
#   real) passariam por cima se o bloco ficasse no topo. Shell não interativo não chega lá; esse usa o drop-in/CLAUDE_BIN.
# - OpenClaw: drop-in do systemd de usuário em openclaw-gateway.service.d/meu-bot.conf com o PATH do serviço
#   prefixado e MEU_BOT_ORIGEM=whatsapp; recarrega e reinicia o gateway só se o conteúdo mudou.
# Variáveis: MEU_BOT_NODE (node do backend), MEU_BOT_BACKEND_DIR (pasta do backend); sem elas, descobre.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HOME/.local/share/meu-bot/bin"
DEST="${MEU_BOT_BACKEND_DIR:-}"
if [ -z "$DEST" ]; then
  for d in "$HOME/.local/share/meu-bot/backend" "$HOME/.hermes/agente-rene/backend-sdk-claude"; do [ -f "$d/claude-porteiro.js" ] && { DEST=$d; break; }; done
fi
[ -n "$DEST" ] && [ -f "$DEST/claude-porteiro.js" ] || { echo "claude-porteiro.js não está na pasta do backend (instale o backend antes)"; exit 1; }
NODE="${MEU_BOT_NODE:-}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  # O node do backend (unidade do systemd), senão os lugares conhecidos (node do meu-bot, do PATH, do Hermes, do sistema).
  svc=$(sed -n 's/^ExecStart=\([^ ]*node\) .*/\1/p' "$HOME/.config/systemd/user/meu-bot-backend.service" /etc/systemd/system/meu-bot-backend.service 2>/dev/null | head -1)
  for n in "$svc" "$HOME/.local/share/meu-bot/node/bin/node" "$HOME/.local/node/bin/node" "$(command -v node 2>/dev/null)" "$HOME"/.hermes/tools/node-*/bin/node /opt/node/bin/node /usr/local/bin/node; do [ -n "$n" ] && [ -x "$n" ] && { NODE=$n; break; }; done
fi
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "node não encontrado para o porteiro"; exit 1; }
[ -f "$HERE/claude-porteiro.sh" ] || { echo "claude-porteiro.sh não está ao lado deste script"; exit 1; }

# 1. O shim.
mkdir -p "$BIN"
tmp=$(mktemp); sed -e "s#__NODE__#$NODE#g" -e "s#__DEST__#$DEST#g" "$HERE/claude-porteiro.sh" > "$tmp"
if ! cmp -s "$tmp" "$BIN/claude"; then install -m 755 "$tmp" "$BIN/claude"; echo "porteiro: $BIN/claude gravado"; else echo "porteiro: $BIN/claude já estava igual"; fi
rm -f "$tmp"

# 2. PATH dos shells: bloco no fim dos arquivos de perfil (idempotente, via python3).
BLOCO_INI='# meu-bot:porteiro inicio'
BLOCO_FIM='# meu-bot:porteiro fim'
BLOCO="$BLOCO_INI
# O \`claude\` desta máquina passa pelo porteiro do meu-bot (rodízio de contas do Claude).
case \":\$PATH:\" in *\":\$HOME/.local/share/meu-bot/bin:\"*) ;; *) PATH=\"\$HOME/.local/share/meu-bot/bin:\$PATH\" ;; esac
$BLOCO_FIM"
perfil() {
  f=$1; obrig=$2
  [ -f "$f" ] || { [ "$obrig" = 1 ] || return 0; : > "$f"; }
  BLOCO="$BLOCO" python3 - "$f" <<'PY'
import os, re, sys
f = sys.argv[1]; bloco = os.environ["BLOCO"]
s = open(f).read() if os.path.exists(f) else ""
s2 = re.sub(r"\n?# meu-bot:porteiro inicio.*?# meu-bot:porteiro fim\n?", "", s, flags=re.S)
s2 = (s2.rstrip("\n") + "\n" if s2.strip() else "") + "\n" + bloco + "\n"
if s2 != s: open(f, "w").write(s2); print("porteiro: PATH gravado em " + f)
PY
}
perfil "$HOME/.profile" 1
perfil "$HOME/.bashrc" 1
perfil "$HOME/.zshrc" 0
perfil "$HOME/.bash_profile" 0

# 3. OpenClaw: PATH do gateway (systemd de usuário) com o porteiro na frente, e a origem para o diário de trocas.
if command -v systemctl >/dev/null 2>&1 && systemctl --user cat openclaw-gateway.service >/dev/null 2>&1; then
  atual=$(systemctl --user show -p Environment --value openclaw-gateway.service 2>/dev/null | tr ' ' '\n' | sed -n 's/^PATH=//p' | head -1)
  [ -n "$atual" ] || atual="/usr/local/bin:/usr/bin:/bin"
  case ":$atual:" in *":$BIN:"*) novo=$atual ;; *) novo="$BIN:$atual" ;; esac
  DIR="$HOME/.config/systemd/user/openclaw-gateway.service.d"; mkdir -p "$DIR"
  tmp=$(mktemp); printf '# meu-bot: porteiro do claude (rodízio de contas) na frente do PATH do gateway. Gerado por install-porteiro.sh.\n[Service]\nEnvironment=PATH=%s\nEnvironment=MEU_BOT_ORIGEM=whatsapp\n' "$novo" > "$tmp"
  if ! cmp -s "$tmp" "$DIR/meu-bot.conf"; then
    install -m 644 "$tmp" "$DIR/meu-bot.conf"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if systemctl --user is-active openclaw-gateway.service >/dev/null 2>&1; then systemctl --user restart openclaw-gateway.service >/dev/null 2>&1 && echo "porteiro: gateway do OpenClaw reiniciado com o porteiro no PATH (o WhatsApp volta em ~10 s)" || echo "aviso: não consegui reiniciar o gateway do OpenClaw; reinicie-o para o porteiro valer no WhatsApp"; fi
  else echo "porteiro: drop-in do gateway do OpenClaw já estava igual"; fi
  rm -f "$tmp"
else
  echo "porteiro: sem gateway do OpenClaw no systemd de usuário; só o PATH dos shells"
fi
echo "porteiro: pronto ($BIN/claude → $(grep '^CLAUDE_BIN=' "$DEST/.env" 2>/dev/null | cut -d= -f2- || echo '?'))"
