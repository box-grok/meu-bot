/**
 * Onde fica o backend do meu-bot numa máquina, sem depender do agente que roda o WhatsApp lá (Hermes, OpenClaw,
 * PicoClaw). Instalações novas vão para a pasta própria (`~/.local/share/meu-bot/backend`, ao lado da licença e
 * do CRM). A pasta herdada (`~/.hermes/agente-rene/backend-sdk-claude`) continua valendo onde o backend do
 * meu-bot já foi instalado nela, mas só quando o `server.js` de lá é o nosso: na grokbot-1 essa pasta é o backend
 * original do Hermes (app.js, services/), que o app não deve nem contar como instalado nem tocar. Puro: o trecho
 * de shell é testado com bash num HOME de mentira.
 */
export const BACKEND_DIR_CANONICAL = "$HOME/.local/share/meu-bot/backend";
export const BACKEND_DIR_LEGACY = "$HOME/.hermes/agente-rene/backend-sdk-claude";
/** Rota que só o server.js do meu-bot tem (backend-colima); o do Hermes não. */
export const BACKEND_MARK = "meu-bot/hello";

/**
 * Trecho de shell (POSIX, `;` entre comandos) que deixa em `$BD` a pasta do backend do meu-bot e em `$FOREIGN` 1 quando
 * a pasta herdada tem o server.js de outro backend. Sem backend nenhum, `$BD` é a pasta própria (onde instalar).
 */
export const BACKEND_DIR_SH = [
  `BD=""; FOREIGN=0`,
  `if [ -f "${BACKEND_DIR_CANONICAL}/server.js" ]; then BD="${BACKEND_DIR_CANONICAL}"`,
  `elif [ -f "${BACKEND_DIR_LEGACY}/server.js" ]; then if grep -q "${BACKEND_MARK}" "${BACKEND_DIR_LEGACY}/server.js" 2>/dev/null; then BD="${BACKEND_DIR_LEGACY}"; else FOREIGN=1; fi; fi`,
  `[ -n "$BD" ] || BD="${BACKEND_DIR_CANONICAL}"`,
].join("; ");
