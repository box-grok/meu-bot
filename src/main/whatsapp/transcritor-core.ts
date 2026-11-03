/**
 * Transcritor compartilhado da máquina (/opt/transcriber, do root, 755; ver transcritorSh no admin): os caminhos que o
 * Hermes (local_command), o OpenClaw (tools.media.models) e as sondas usam. Puro, sem IO.
 */
/** `transcrever <audio> <pasta-saida> [idioma]`: grava <pasta>/<nome>.txt (o molde do local_command do Hermes). */
export const TRANSCRITOR_BIN = "/opt/transcriber/bin/transcrever";
/** `transcrever-texto <audio> [idioma]`: imprime o texto no stdout (o molde do `cli` do OpenClaw). */
export const TRANSCRITOR_TEXTO_BIN = "/opt/transcriber/bin/transcrever-texto";
/**
 * `audiomaq=1` quando a máquina tem o que a transcrição precisa: o transcritor compartilhado (sem ffmpeg: decodifica pelo
 * PyAV) ou o ffmpeg para o caminho por usuário. `0` = só o root resolve (meu-bot-admin › Preparar máquina). As chaves
 * importam: sem elas o `||` engoliria o `&&`.
 */
export const AUDIO_MAQUINA_SH = `{ [ -x ${TRANSCRITOR_TEXTO_BIN} ] || command -v ffmpeg >/dev/null 2>&1; } && echo audiomaq=1 || echo audiomaq=0`;
/**
 * Marca de "transcrição desligada de propósito" (o admin ou a pessoa desligou): o app não religa sozinho enquanto ela
 * existe. Ligar (por qualquer caminho) apaga; desligar cria. `audiooff=1|0` na sonda.
 */
export const AUDIO_DESLIGADO_MARCA = "$HOME/.local/share/meu-bot/audio-desligado";
export const AUDIO_DESLIGADO_SH = `[ -e "${AUDIO_DESLIGADO_MARCA}" ] && echo audiooff=1 || echo audiooff=0`;
/** As duas linhas da sonda, para o status do OpenClaw e do Hermes. */
export const AUDIO_ESTADO_SH = `${AUDIO_MAQUINA_SH}\n${AUDIO_DESLIGADO_SH}`;
/** O que o instalador da transcrição faz com a marca antes de rodar: ligar apaga, desligar cria. */
export const audioMarcaSh = (off: boolean): string => off ? `mkdir -p "$HOME/.local/share/meu-bot" && touch "${AUDIO_DESLIGADO_MARCA}"` : `rm -f "${AUDIO_DESLIGADO_MARCA}"`;
/** Lê `audiomaq=` e `audiooff=` de um mapa chave=valor; só o que veio (ausente = não se sabe). */
export function lerAudioEstado(kv: Map<string, string>): { audioMaquina?: boolean; audioDesligado?: boolean } {
  return { ...(kv.has("audiomaq") ? { audioMaquina: kv.get("audiomaq") === "1" } : {}), ...(kv.has("audiooff") ? { audioDesligado: kv.get("audiooff") === "1" } : {}) };
}
