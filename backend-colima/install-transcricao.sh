#!/usr/bin/env bash
# Transcrição de áudio para o agente do WhatsApp (OpenClaw): sem ela, áudio chega ao agente como "Audio
# attachment not analyzed: no audio-understanding model is configured" e ele responde que não ouviu.
# Local e sem chave: faster-whisper (modelo "small", CPU, int8) num ambiente Python próprio; o áudio não sai
# da máquina. Rodar no host. Idempotente: pode rodar de novo.
# - Ambiente em ~/.local/share/meu-bot/transcricao (venv, script, modelos); comando ~/.local/bin/meu-bot-transcrever.
# - O ffmpeg da máquina decodifica o áudio (ogg/opus do WhatsApp…): o PyAV que o faster-whisper usaria não tem
#   versão compatível com Python 3.13 nas versões que ele aceita.
# - OpenClaw: tools.media.models ganha a entrada "cli" do transcritor ({{MediaPath}}: vale da 2026.7 à 2026.9;
#   {{AttachmentPath}} só existe nas novas) e tools.media.audio.enabled = true. Se já
#   houver outro transcritor configurado, não mexe (avisa e sai com 3). Vale sem reiniciar o gateway.
# - Testa de ponta a ponta com `openclaw capability audio transcribe` num áudio gerado aqui.
set -euo pipefail
FW_VERSION=1.1.1
MODEL=${MEU_BOT_WHISPER_MODEL:-small}
D=$HOME/.local/share/meu-bot/transcricao
BIN=$HOME/.local/bin/meu-bot-transcrever
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH

command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw: a transcrição é para o agente do WhatsApp dele"; exit 2; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg não encontrado: a transcrição precisa dele para ler os áudios (apt install ffmpeg)"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 não encontrado"; exit 1; }

# Outro transcritor já configurado (de quem não é o meu-bot): respeita.
CUR=$(openclaw config get tools.media.models 2>/dev/null || true)
if printf '%s' "$CUR" | grep -q '"audio"' && ! printf '%s' "$CUR" | grep -q 'meu-bot-transcrever'; then
  echo "o OpenClaw desta máquina já tem outro transcritor de áudio configurado (tools.media.models); nada foi alterado"
  exit 3
fi

mkdir -p "$D" "$HOME/.local/bin"
if [ ! -x "$D/venv/bin/python" ]; then
  echo "criando o ambiente Python em $D/venv…"
  python3 -m venv "$D/venv" || { echo "não consegui criar o ambiente Python (falta o pacote python3-venv?)"; exit 1; }
fi
echo "instalando o faster-whisper $FW_VERSION (só na primeira vez demora)…"
"$D/venv/bin/python" -m pip install -q --disable-pip-version-check "faster-whisper==$FW_VERSION" requests

cat > "$D/transcrever.py" <<'PY'
"""Transcreve um áudio para texto com faster-whisper, local. Uso: transcrever.py <arquivo>; imprime o texto.
O ffmpeg da máquina decodifica (ogg/opus do WhatsApp, mp3, m4a…) para 16 kHz mono; assim não depende do PyAV."""
import os, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
here = os.path.dirname(os.path.abspath(__file__))
pcm = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", sys.argv[1], "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
model = WhisperModel(os.environ.get("MEU_BOT_WHISPER_MODEL", "small"), device="cpu", compute_type="int8",
                     cpu_threads=os.cpu_count() or 2, download_root=os.path.join(here, "modelos"))
segments, _ = model.transcribe(audio, beam_size=1, vad_filter=True)
print(" ".join(s.text.strip() for s in segments).strip())
PY
printf '#!/bin/sh\nMEU_BOT_WHISPER_MODEL=${MEU_BOT_WHISPER_MODEL:-%s} exec "%s/venv/bin/python" "%s/transcrever.py" "$@"\n' "$MODEL" "$D" "$D" > "$BIN"
chmod +x "$BIN"
echo "comando em $BIN"

# Baixa o modelo agora (uma vez, ~480 MB no small), para o primeiro áudio real não esperar o download.
echo "baixando o modelo $MODEL (só na primeira vez)…"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
ffmpeg -nostdin -v error -f lavfi -i "sine=frequency=440:duration=1" -c:a libopus "$T/teste.ogg"
"$BIN" "$T/teste.ogg" >/dev/null

echo "ligando no OpenClaw…"
openclaw config set tools.media.models "[{\"type\":\"cli\",\"command\":\"$BIN\",\"args\":[\"{{MediaPath}}\"],\"timeoutSeconds\":120,\"capabilities\":[\"audio\"]}]" --strict-json >/dev/null
openclaw config set tools.media.audio.enabled true --strict-json >/dev/null

# Prova pelo próprio OpenClaw: ele chama o transcritor configurado. Tom puro não tem fala, então "No transcript
# returned" também prova que o transcritor rodou (falha de verdade seria comando não encontrado/erro do script).
R=$(timeout 180 openclaw capability audio transcribe --file "$T/teste.ogg" --json 2>&1 || true)
if printf '%s' "$R" | grep -q '"ok": *true\|No transcript returned'; then
  echo "pronto: o agente do WhatsApp agora entende áudio (transcrição local, $MODEL)"
else
  echo "configurado, mas o teste do OpenClaw não confirmou; mande um áudio para conferir"
  exit 4
fi
