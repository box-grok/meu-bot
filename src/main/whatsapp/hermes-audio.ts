/**
 * Áudio do agente do WhatsApp numa máquina com Hermes: ouvir (stt) e responder em voz (voice/tts) são do próprio
 * Hermes, no `~/.hermes/config.yaml` (`stt.enabled`, padrão ligado, e o provedor; `voice.auto_tts` = responde em
 * áudio quando a pessoa manda áudio). O app só lê e mostra: os instaladores de transcrição e voz do meu-bot são do
 * OpenClaw e não se aplicam aqui. Lê com o Python do runtime do Hermes (tem PyYAML); sem ele, assume o padrão.
 */
import type { VoiceReplyMode } from "../../shared/ipc";
import { runSsh } from "./whatsapp";

const LER_SH = `export PATH=$HOME/.local/bin:$PATH; R=$(hermes --version 2>/dev/null | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; PY="$R/venv/bin/python3"; [ -x "$PY" ] || PY=python3; "$PY" -c '
import os
try:
    import yaml
    c = yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
except Exception:
    c = {}
s = c.get("stt") or {}
en = s.get("enabled", True)
en = en if isinstance(en, bool) else str(en).strip().lower() in ("1", "true", "yes", "on")
print("stt=" + ("1" if en and (s.get("provider") or os.path.isdir(os.path.expanduser("~/.hermes/venv-whisper"))) else "0"))
v = c.get("voice") or {}
print("tts=" + ("inbound" if v.get("auto_tts") else "off"))
' 2>/dev/null`;

export interface HermesAudio { audioIn: boolean; audioOut: VoiceReplyMode }

/** Estado do áudio no Hermes da máquina; null se não deu para ler (a tela fica sem a linha, sem inventar). */
export async function hermesAudioStatus(host: string): Promise<HermesAudio | null> {
  const r = await runSsh(host, `${LER_SH}\n`, 30_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  const stt = /^stt=([01])$/m.exec(r.stdout); const tts = /^tts=(off|inbound|always)$/m.exec(r.stdout);
  if (stt === null || tts === null) return null;
  return { audioIn: stt[1] === "1", audioOut: tts[1] as VoiceReplyMode };
}
