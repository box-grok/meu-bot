#!/usr/bin/env bash
# Desfaz o install-porteiro.sh: tira o shim, os blocos de PATH e o drop-in do gateway do OpenClaw. O claude real
# nunca foi mexido; depois disto tudo volta a ser o login padrão, como sem o porteiro.
set -u
BIN="$HOME/.local/share/meu-bot/bin"
rm -f "$BIN/claude" && echo "porteiro: $BIN/claude removido"
[ -f "$BIN/wa-enviar" ] && rm -f "$BIN/wa-enviar" && echo "porteiro: $BIN/wa-enviar removido"
if [ -f "$HOME/agent-workspace/CLAUDE.md" ]; then
  python3 - "$HOME/agent-workspace/CLAUDE.md" <<'PY'
import re, sys
f = sys.argv[1]; s = open(f, encoding="utf-8").read()
s2 = re.sub(r"\n?<!-- meu-bot:wa-enviar v1 inicio -->.*?<!-- meu-bot:wa-enviar v1 fim -->\n?", "", s, flags=re.S)
if s2 != s: open(f, "w", encoding="utf-8").write(s2); print("porteiro: regra do wa-enviar removida de " + f)
PY
fi
for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; do
  [ -f "$f" ] || continue
  python3 - "$f" <<'PY'
import re, sys
f = sys.argv[1]; s = open(f).read()
s2 = re.sub(r"\n?# meu-bot:porteiro inicio.*?# meu-bot:porteiro fim\n?", "", s, flags=re.S)
if s2 != s: open(f, "w").write(s2); print("porteiro: bloco removido de " + f)
PY
done
D="$HOME/.config/systemd/user/openclaw-gateway.service.d/meu-bot.conf"
if [ -f "$D" ]; then
  rm -f "$D"; systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user is-active openclaw-gateway.service >/dev/null 2>&1 && systemctl --user restart openclaw-gateway.service >/dev/null 2>&1 && echo "porteiro: drop-in removido e gateway do OpenClaw reiniciado"
fi
echo "porteiro: desinstalado"
