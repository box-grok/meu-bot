#!/usr/bin/env bash
# Transcrição de áudio para o agente do WhatsApp (OpenClaw): sem ela, áudio chega ao agente como "Audio
# attachment not analyzed: no audio-understanding model is configured" e ele responde que não ouviu.
# Local e sem chave; o áudio não sai da máquina. Rodar no host. Idempotente: pode rodar de novo.
# - Máquina preparada pelo admin (meu-bot-admin › Preparar máquina › Transcritor de áudio): o transcritor compartilhado
#   /opt/transcriber/bin/transcrever-texto já existe, decodifica pelo PyAV e não precisa de ffmpeg; só aponta o OpenClaw
#   para ele. Nada é baixado para este usuário.
# - Sem o compartilhado (máquina de antes do padrão, ou fora do admin): faster-whisper (modelo "small", CPU, int8) num
#   ambiente Python deste usuário, em ~/.local/share/meu-bot/transcricao; comando ~/.local/bin/meu-bot-transcrever. O
#   ffmpeg da máquina decodifica o áudio (o PyAV que o faster-whisper usaria não tem versão para o Python 3.13).
# - OpenClaw: tools.media.models ganha a entrada "cli" do transcritor ({{MediaPath}}: vale da 2026.7 à 2026.9;
#   {{AttachmentPath}} só existe nas novas) e tools.media.audio.enabled = true. Se já
#   houver outro transcritor configurado, não mexe (avisa e sai com 3). Vale sem reiniciar o gateway.
# - Testa de ponta a ponta com `openclaw capability audio transcribe` num áudio gerado aqui.
# Uso: install-transcricao.sh [off]   (sem argumento liga; `off` desliga)
# Saídas: 0 ok · 1 erro (python3, venv) · 2 sem OpenClaw · 3 precisa do admin (outro transcritor configurado, ou falta
# ffmpeg e não há sudo) · 4 configurou mas o teste do OpenClaw não confirmou.
set -euo pipefail
FW_VERSION=1.1.1
MODEL=${MEU_BOT_WHISPER_MODEL:-small}
D=$HOME/.local/share/meu-bot/transcricao
BIN=$HOME/.local/bin/meu-bot-transcrever
# O compartilhado da máquina (só muda nos testes).
TT=${MEU_BOT_TRANSCRITOR:-/opt/transcriber/bin/transcrever-texto}
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH

# ffmpeg é pacote do sistema: instala pelo apt quando este usuário é root ou tem sudo sem senha. Numa box (sem root) a
# pendência é do admin: meu-bot-admin › Preparar máquina instala o transcritor compartilhado (sem ffmpeg) para todos.
ffmpeg_ou_avisa() {
  local para=$1
  command -v ffmpeg >/dev/null 2>&1 && return 0
  if [ "$(id -u)" = 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg >/dev/null 2>&1 || true
  elif sudo -n true 2>/dev/null; then sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg >/dev/null 2>&1 || true; fi
  command -v ffmpeg >/dev/null 2>&1 && { echo "ffmpeg instalado"; return 0; }
  echo "Esta máquina não deixa instalar programas sem senha. O admin prepara a máquina uma vez (pelo app dele: Preparar máquina › Transcritor de áudio, ou o ffmpeg em Pacotes do sistema) e aí $para."
  return 1
}
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw: a transcrição é para o agente do WhatsApp dele"; exit 2; }

# O transcritor configurado é um dos nossos (o compartilhado da máquina ou o deste usuário)?
e_nosso() { grep -Eq 'meu-bot-transcrever|/opt/transcriber/bin/transcrever-texto'; }

# `off`: desliga no OpenClaw (só se o transcritor configurado é o nosso); o ambiente fica, ligar de novo é rápido.
if [ "${1:-}" = off ]; then
  if openclaw config get tools.media.models 2>/dev/null | e_nosso; then
    openclaw config set tools.media.models '[]' --strict-json >/dev/null
  fi
  openclaw config set tools.media.audio.enabled false --strict-json >/dev/null
  echo "pronto: o agente deixa de transcrever áudios"
  exit 0
fi

# Outro transcritor já configurado (de quem não é o meu-bot): respeita.
CUR=$(openclaw config get tools.media.models 2>/dev/null || true)
if printf '%s' "$CUR" | grep -q '"audio"' && ! printf '%s' "$CUR" | e_nosso; then
  echo "o OpenClaw desta máquina já tem outro transcritor de áudio configurado (tools.media.models); nada foi alterado"
  exit 3
fi

# Um WAV de um segundo de silêncio para o teste de ponta a ponta (sem ffmpeg: python3 basta).
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
teste_wav() { python3 -c 'import sys, wave; w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(bytes(32000)); w.close()' "$T/teste.wav"; }
# Prova pelo próprio OpenClaw: ele chama o transcritor configurado. Silêncio não tem fala, então "No transcript
# returned" também prova que o transcritor rodou (falha de verdade seria comando não encontrado/erro do script).
confirma_openclaw() { R=$(timeout 180 openclaw capability audio transcribe --file "$1" --json 2>&1 || true); printf '%s' "$R" | grep -q '"ok": *true\|No transcript returned'; }

if [ -x "$TT" ]; then
  echo "ligando no OpenClaw o transcritor compartilhado da máquina ($TT)…"
  openclaw config set tools.media.models "[{\"type\":\"cli\",\"command\":\"$TT\",\"args\":[\"{{MediaPath}}\"],\"timeoutSeconds\":120,\"capabilities\":[\"audio\"]}]" --strict-json >/dev/null
  openclaw config set tools.media.audio.enabled true --strict-json >/dev/null
  command -v python3 >/dev/null 2>&1 && teste_wav 2>/dev/null || true
  if [ ! -s "$T/teste.wav" ] || confirma_openclaw "$T/teste.wav"; then
    # O ambiente por usuário de antes (venv + modelo, ~500 MB da cota) não é mais usado.
    [ -d "$D" ] && { rm -rf "$D"; rm -f "$BIN"; echo "o transcritor antigo deste usuário saiu (~500 MB livres)"; }
    echo "pronto: o agente do WhatsApp agora entende áudio, com o transcritor compartilhado da máquina"
    exit 0
  fi
  echo "configurado com o transcritor compartilhado, mas o teste do OpenClaw não confirmou; mande um áudio para conferir"
  exit 4
fi

ffmpeg_ou_avisa "a transcrição funciona aqui" || exit 3
command -v python3 >/dev/null 2>&1 || { echo "python3 não encontrado"; exit 1; }

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
ffmpeg -nostdin -v error -f lavfi -i "sine=frequency=440:duration=1" -c:a libopus "$T/teste.ogg"
"$BIN" "$T/teste.ogg" >/dev/null

echo "ligando no OpenClaw…"
openclaw config set tools.media.models "[{\"type\":\"cli\",\"command\":\"$BIN\",\"args\":[\"{{MediaPath}}\"],\"timeoutSeconds\":120,\"capabilities\":[\"audio\"]}]" --strict-json >/dev/null
openclaw config set tools.media.audio.enabled true --strict-json >/dev/null

if confirma_openclaw "$T/teste.ogg"; then
  echo "pronto: o agente do WhatsApp agora entende áudio (transcrição local, $MODEL)"
else
  echo "configurado, mas o teste do OpenClaw não confirmou; mande um áudio para conferir"
  exit 4
fi
