#!/usr/bin/env bash
# Respostas em áudio do agente do WhatsApp (OpenClaw), com voz local: Piper + voz pt-BR "faber" (medium), ou o
# Kokoro com a voz pt-BR feminina "dora" ou a masculina "alex" (pacote kokoro-onnx num venv). Sem
# chave e sem servidor: a extensão tts-local-cli do OpenClaw chama ~/.local/bin/meu-bot-falar com o texto na
# entrada e o caminho do WAV em {{OutputPath}}; o próprio OpenClaw converte para nota de voz do WhatsApp.
# Uso: install-voz.sh <off|inbound|always> [faber|dora|alex]   (voz padrão: faber)
#   off     = nunca responde em áudio (instala nada; só desliga)
#   inbound = responde em áudio quando recebe áudio
#   always  = toda resposta vira áudio
# Idempotente. A versão do Piper e da voz é fixa (sem "latest").
set -euo pipefail
MODE=${1:-}
VOZ=${2:-faber}
case "$MODE" in off|inbound|always) ;; *) echo "uso: install-voz.sh <off|inbound|always> [faber|dora|alex]"; exit 64 ;; esac
case "$VOZ" in faber|dora|alex) ;; *) echo "voz desconhecida: $VOZ (faber, dora ou alex)"; exit 64 ;; esac
KOKORO_PKG=kokoro-onnx==0.4.9
KOKORO_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
VOICE_URL=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
D=$HOME/.local/share/meu-bot/voz
BIN=$HOME/.local/bin/meu-bot-falar
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH

command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw: a voz é para o agente do WhatsApp dele"; exit 2; }

# O agente (chat do meu-bot e o dono pelo WhatsApp) também troca a voz a pedido: uma cópia deste script fica na máquina
# e a skill "voz-das-respostas" ensina como chamá-la. A tela do app lê a mesma marcação (voz/voz-atual).
mkdir -p "$D" "$HOME/.claude/skills/voz-das-respostas"
[ -f "$0" ] && [ "$(readlink -f "$0")" != "$(readlink -f "$D/install-voz.sh" 2>/dev/null)" ] && cp "$0" "$D/install-voz.sh" && chmod 755 "$D/install-voz.sh"
cat > "$HOME/.claude/skills/voz-das-respostas/SKILL.md" <<'MD'
---
name: voz-das-respostas
description: Troca ou liga/desliga a voz das respostas em áudio do agente do WhatsApp (voz feminina, masculina, masculina natural; responder em áudio sempre, só quando receber áudio, ou nunca). Use quando o dono pedir "voz feminina", "muda a voz", "responde em áudio", "para de mandar áudio".
---

# Voz das respostas em áudio (meu-bot)

Script: `bash ~/.local/share/meu-bot/voz/install-voz.sh <modo> <voz>`

- **voz:** `dora` (feminina), `faber` (masculina, padrão), `alex` (masculina natural). Todas rodam nesta máquina.
- **modo:** `inbound` (responde em áudio quando recebe áudio), `always` (toda resposta em áudio), `off` (só texto).
- Para trocar só a voz, mantenha o modo atual: `openclaw config get tts.auto` (se vier `off` ou vazio, use `inbound`
  e diga ao dono que ligou "responder em áudio quando receber áudio").
- Voz atual: `cat ~/.local/share/meu-bot/voz/voz-atual`.
- Na primeira vez que usa a dora ou o alex, a máquina baixa ~350 MB (pode levar 1–2 min): avise antes.
- Só o dono pede isto. Se outra pessoa pedir pelo WhatsApp, não troque.
- Responda ao dono, em português, com a última linha que o script imprimir.
MD
# Só estes comandos ficam liberados para o agente sem pedir autorização (o resto das permissões não muda).
python3 - "$HOME" <<'PY' 2>/dev/null || true
import json, os, sys
h = sys.argv[1]; f = os.path.join(h, ".claude", "settings.json")
try: c = json.load(open(f))
except Exception: c = {}
if not isinstance(c, dict): c = {}
p = c.setdefault("permissions", {}); a = p.setdefault("allow", [])
for r in ["Bash(bash ~/.local/share/meu-bot/voz/install-voz.sh:*)", f"Bash(bash {h}/.local/share/meu-bot/voz/install-voz.sh:*)",
          "Bash(openclaw config get tts.auto)", "Bash(cat ~/.local/share/meu-bot/voz/voz-atual)", f"Bash(cat {h}/.local/share/meu-bot/voz/voz-atual)"]:
    if r not in a: a.append(r)
os.makedirs(os.path.dirname(f), exist_ok=True)
tmp = f + ".tmp"; json.dump(c, open(tmp, "w"), indent=2); os.replace(tmp, f)
PY

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
ANTES=$(cat "$D/voz-atual" 2>/dev/null || echo faber)
if [ "$VOZ" = faber ]; then
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

fi

# Kokoro (dora/alex): venv + modelo de ~325 MB + vozes de ~28 MB, baixados uma vez (download cortado retoma).
K=$D/kokoro
if [ "$VOZ" != faber ]; then
  command -v python3 >/dev/null 2>&1 || { echo "python3 não encontrado: a voz $VOZ precisa dele"; exit 1; }
  if [ ! -x "$K/venv/bin/python" ] || ! "$K/venv/bin/python" -c "import kokoro_onnx, soundfile" 2>/dev/null; then
    echo "preparando o Kokoro (uma vez)…"
    mkdir -p "$K"
    python3 -m venv "$K/venv" >/dev/null 2>&1 || { echo "não consegui criar o ambiente Python (instale: apt install python3-venv)"; exit 1; }
    "$K/venv/bin/pip" -q install "$KOKORO_PKG" soundfile >/dev/null 2>&1 || { echo "não consegui instalar o $KOKORO_PKG"; exit 1; }
  fi
  if [ "$(stat -c %s "$K/kokoro-v1.0.onnx" 2>/dev/null || echo 0)" -lt 300000000 ]; then
    echo "baixando a voz natural (Kokoro, ~325 MB; só na primeira vez)…"
    curl -fsSL --retry 5 -C - -o "$K/kokoro-v1.0.onnx" "$KOKORO_URL/kokoro-v1.0.onnx"
  fi
  [ "$(stat -c %s "$K/voices-v1.0.bin" 2>/dev/null || echo 0)" -ge 25000000 ] || curl -fsSL --retry 5 -C - -o "$K/voices-v1.0.bin" "$KOKORO_URL/voices-v1.0.bin"
  [ "$(stat -c %s "$K/kokoro-v1.0.onnx")" -ge 300000000 ] && [ "$(stat -c %s "$K/voices-v1.0.bin")" -ge 25000000 ] || { echo "a voz baixou incompleta; rode de novo"; exit 1; }
  cat > "$K/falar.py" <<'PY'
# Texto na entrada, WAV em argv[2] com a voz argv[1] (pt-BR). Chamado pelo meu-bot-falar.
import os, sys, soundfile as sf
from kokoro_onnx import Kokoro
d = os.path.dirname(os.path.abspath(__file__))
texto = sys.stdin.read().strip() or "."
k = Kokoro(os.path.join(d, "kokoro-v1.0.onnx"), os.path.join(d, "voices-v1.0.bin"))
audio, sr = k.create(texto, voice=sys.argv[1], speed=1.0, lang="pt-br")
sf.write(sys.argv[2], audio, sr)
PY
fi

# O meu-bot-falar chama o motor da voz escolhida (o provedor no OpenClaw é sempre o tts-local-cli).
grava_falar() {
  case "$1" in
    faber) printf '#!/bin/sh\n# Texto na entrada, WAV em $1 (o OpenClaw passa {{OutputPath}}). Voz: faber (Piper).\nexec "%s/piper/piper" --model "%s/faber.onnx" --output_file "$1" --quiet\n' "$D" "$D" > "$BIN" ;;
    dora) printf '#!/bin/sh\n# Texto na entrada, WAV em $1. Voz: dora (Kokoro, feminina).\nexec "%s/venv/bin/python" "%s/falar.py" pf_dora "$1"\n' "$K" "$K" > "$BIN" ;;
    alex) printf '#!/bin/sh\n# Texto na entrada, WAV em $1. Voz: alex (Kokoro, masculina).\nexec "%s/venv/bin/python" "%s/falar.py" pm_alex "$1"\n' "$K" "$K" > "$BIN" ;;
  esac
  chmod +x "$BIN"
}
grava_falar "$VOZ"
echo "comando em $BIN (voz $VOZ)"

echo "ligando no OpenClaw (respostas em áudio: $MODE)…"
TMS=60000; [ "$VOZ" = faber ] || TMS=120000
openclaw config set tts "{\"auto\":\"$MODE\",\"provider\":\"tts-local-cli\",\"providers\":{\"tts-local-cli\":{\"command\":\"$BIN\",\"args\":[\"{{OutputPath}}\"],\"outputFormat\":\"wav\",\"timeoutMs\":$TMS}}}" --strict-json >/dev/null

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if timeout 120 openclaw capability tts convert --text "Olá! Agora eu também respondo em áudio." --output "$T/teste" --json >"$T/out" 2>&1 && grep -q '"ok": *true' "$T/out"; then
  echo "$VOZ" > "$D/voz-atual"
  echo "pronto: o agente do WhatsApp responde em áudio ($MODE, voz $VOZ)"
else
  # A voz nova não passou no teste: volta para a anterior (se estiver instalada) para não ficar sem áudio.
  MSG=$(tail -c 300 "$T/out" | tr '\n' ' ')
  tem_motor() { case "$1" in faber) [ -x "$D/piper/piper" ] ;; *) [ -x "$K/venv/bin/python" ] && [ -s "$K/falar.py" ] ;; esac; }
  if [ "$ANTES" != "$VOZ" ] && tem_motor "$ANTES"; then grava_falar "$ANTES"; echo "a voz $VOZ não passou no teste ($MSG); voltei para a voz $ANTES"; exit 4; fi
  echo "configurado, mas o teste de voz do OpenClaw não confirmou: $MSG"
  exit 4
fi
