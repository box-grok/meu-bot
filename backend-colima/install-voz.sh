#!/usr/bin/env bash
# Respostas em áudio do agente do WhatsApp (OpenClaw), com voz local: Piper + voz pt-BR "faber" (medium). Sem
# chave e sem servidor: a extensão tts-local-cli do OpenClaw chama ~/.local/bin/meu-bot-falar com o texto na
# entrada e o caminho do WAV em {{OutputPath}}; o próprio OpenClaw converte para nota de voz do WhatsApp.
# Uso: install-voz.sh <off|inbound|always>
#   off     = nunca responde em áudio (instala nada; só desliga)
#   inbound = responde em áudio quando recebe áudio
#   always  = toda resposta vira áudio
# Idempotente. A versão do Piper e da voz é fixa (sem "latest").
set -euo pipefail
MODE=${1:-}
case "$MODE" in off|inbound|always) ;; *) echo "uso: install-voz.sh <off|inbound|always>"; exit 64 ;; esac
PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
VOICE_URL=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
D=$HOME/.local/share/meu-bot/voz
BIN=$HOME/.local/bin/meu-bot-falar
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH

command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw: a voz é para o agente do WhatsApp dele"; exit 2; }

if [ "$MODE" = off ]; then
  if openclaw config get tts.provider 2>/dev/null | grep -q tts-local-cli; then
    openclaw config set tts.auto '"off"' --strict-json >/dev/null
  fi
  echo "pronto: o agente responde só em texto"
  exit 0
fi

# Outra voz já configurada (de quem não é o meu-bot): respeita.
CUR=$(openclaw config get tts.provider 2>/dev/null | tr -d '"' || true)
case "$CUR" in ""|*unset*|tts-local-cli) ;; *) echo "o OpenClaw desta máquina já usa outra voz ($CUR); nada foi alterado"; exit 3 ;; esac

[ "$(uname -m)" = x86_64 ] || { echo "a voz local só está pronta para x86_64 (esta máquina é $(uname -m))"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg não encontrado: a voz precisa dele para virar nota de voz (apt install ffmpeg)"; exit 1; }
mkdir -p "$D" "$HOME/.local/bin"
if [ ! -x "$D/piper/piper" ]; then
  echo "baixando o Piper…"
  curl -fsSL --retry 5 -o "$D/piper.tgz" "$PIPER_URL"
  tar xzf "$D/piper.tgz" -C "$D"; rm -f "$D/piper.tgz"
fi
# A voz tem ~63 MB e o download às vezes corta: retoma (-C -) e confere o tamanho.
if [ "$(stat -c %s "$D/faber.onnx" 2>/dev/null || echo 0)" -lt 50000000 ]; then
  echo "baixando a voz pt-BR (faber)…"
  curl -fsSL --retry 5 -C - -o "$D/faber.onnx" "$VOICE_URL"
fi
[ -s "$D/faber.onnx.json" ] || curl -fsSL --retry 5 -o "$D/faber.onnx.json" "$VOICE_URL.json"
[ "$(stat -c %s "$D/faber.onnx")" -ge 50000000 ] || { echo "a voz baixou incompleta; rode de novo"; exit 1; }

cat > "$BIN" <<SH
#!/bin/sh
# Texto na entrada, WAV em \$1 (o OpenClaw passa {{OutputPath}}).
exec "$D/piper/piper" --model "$D/faber.onnx" --output_file "\$1" --quiet
SH
chmod +x "$BIN"
echo "comando em $BIN"

echo "ligando no OpenClaw (respostas em áudio: $MODE)…"
openclaw config set tts "{\"auto\":\"$MODE\",\"provider\":\"tts-local-cli\",\"providers\":{\"tts-local-cli\":{\"command\":\"$BIN\",\"args\":[\"{{OutputPath}}\"],\"outputFormat\":\"wav\",\"timeoutMs\":60000}}}" --strict-json >/dev/null

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if timeout 120 openclaw capability tts convert --text "Olá! Agora eu também respondo em áudio." --output "$T/teste" --json >"$T/out" 2>&1 && grep -q '"ok": *true' "$T/out"; then
  echo "pronto: o agente do WhatsApp responde em áudio ($MODE)"
else
  echo "configurado, mas o teste de voz do OpenClaw não confirmou: $(tail -c 300 "$T/out" | tr '\n' ' ')"
  exit 4
fi
