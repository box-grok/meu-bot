/**
 * WhatsApp na máquina "local" (este Mac): os mesmos scripts das máquinas por SSH, rodando em `bash -s` aqui, sem SSH.
 * Puro (sem processos): o prelúdio que deixa o bash 3.2 e as ferramentas BSD do macOS falarem o dialeto que os scripts
 * esperam do Linux. Quem roda é whatsapp-ssh.ts.
 */

export const LOCAL_WA_HOST = "local";

/**
 * Antes de cada script local:
 * - PATH com o que o OpenClaw instala neste Mac (~/.local, ~/.openclaw) e o Homebrew (app de GUI tem PATH mínimo).
 * - `timeout N cmd…`: o macOS não tem; um perl que mata o comando no prazo e sai com 124, como o GNU.
 * - `stat -c %Y arq`: o stat do BSD não tem -c; %Y (mtime em segundos) vira `stat -f %m`. Sem isso o pareamento
 *   nunca via o número vinculado (linked_now compara o mtime do creds.json).
 * - Sem escolha de agente gravada, o OpenClaw: no Mac o Hermes não atende o WhatsApp (o gateway dele depende de
 *   systemd/pm2), mas um `hermes` da pessoa em ~/.local/bin faria a regra do motor (WA_MOTOR_SH) escolhê-lo.
 * Os trechos de systemd dos scripts já saem sozinhos sem /run/systemd/system; o restart cai em `openclaw gateway
 * restart`, que no Mac é o launchd.
 */
export const LOCAL_SH_PRELUDE = `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.local/share/meu-bot/whatsapp-agente" ] || { mkdir -p "$HOME/.local/share/meu-bot" && echo openclaw > "$HOME/.local/share/meu-bot/whatsapp-agente"; } 2>/dev/null || true
command -v timeout >/dev/null 2>&1 || timeout() {
  _t=$1; shift
  perl -e 'my $t = shift; my $pid = fork(); die "fork" unless defined $pid; if ($pid == 0) { exec @ARGV or exit 127 } $SIG{ALRM} = sub { kill "TERM", $pid; sleep 1; kill "KILL", $pid; exit 124 }; alarm $t; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$_t" "$@"
}
stat() {
  if [ "$1" = "-c" ]; then
    case "$2" in
      %Y) shift 2; command stat -f %m "$@" ;;
      %s) shift 2; command stat -f %z "$@" ;;
      %U) shift 2; command stat -f %Su "$@" ;;
      *) command stat "$@" ;;
    esac
  else command stat "$@"; fi
}
`;

/** O script completo para o `bash -s` local. */
export const scriptLocal = (script: string): string => `${LOCAL_SH_PRELUDE}${script}`;
