/**
 * Tela do bot (painel "Computador"): o que se pergunta à máquina e como se lê a resposta. Puro, testado; o IO fica em
 * tela.ts. Comportamento inspirado no computador do Grok Bot (status por pedido, acordar com poucas tentativas, noVNC
 * num <webview>), com um estado a mais: "não instalada", que lá não existe.
 */

/** Script remoto do status: uma linha `instalada=0|1 rodando=0|1 web=<porta>|-`. Não muda nada na máquina. */
export const TELA_STATUS_SH = [
  'D=$HOME/.local/share/meu-bot',
  'i=0; [ -x "$D/tela/tela.sh" ] && [ -f "$D/tela.env" ] && i=1',
  'web=-; [ -f "$D/tela.env" ] && web=$(sed -n "s/^TELA_WEB=\\([0-9]*\\)$/\\1/p" "$D/tela.env")',
  'r=0; if [ "$web" != "-" ] && [ -n "$web" ] && (exec 3<>"/dev/tcp/127.0.0.1/$web") 2>/dev/null; then r=1; fi',
  'echo "instalada=$i rodando=$r web=${web:--}"',
].join("; ");

/** Liga a tela: o serviço de usuário quando existe, senão nohup (máquina sem systemd de usuário). */
export const TELA_ACORDAR_SH = [
  'D=$HOME/.local/share/meu-bot',
  'if systemctl --user cat meu-bot-tela.service >/dev/null 2>&1; then systemctl --user start meu-bot-tela.service',
  'else pgrep -u "$(id -u)" -f "$D/tela/tela.sh" >/dev/null || nohup /bin/bash "$D/tela/tela.sh" >"$D/tela/tela.log" 2>&1 </dev/null & fi',
].join("; ");

export interface TelaLida { instalada: boolean; rodando: boolean; webPort: number | null }

/** Lê a linha do TELA_STATUS_SH (a última que casar, para ignorar o que um .bashrc imprima antes). null = resposta estranha. */
export function parseTelaStatus(stdout: string): TelaLida | null {
  const linhas = stdout.split("\n").map((l) => l.trim()).filter((l) => /^instalada=[01] rodando=[01] web=(\d+|-)$/.test(l));
  const l = linhas.at(-1);
  if (l === undefined) return null;
  const m = /^instalada=([01]) rodando=([01]) web=(\d+|-)$/.exec(l)!;
  const port = m[3] === "-" ? null : Number(m[3]);
  const webPort = port !== null && Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  return { instalada: m[1] === "1", rodando: m[2] === "1" && webPort !== null, webPort };
}

/** Acordar como o Grok Bot: até 3 tentativas, esperando 2 s depois da primeira e 4 s depois das outras. */
export const TENTATIVAS_ACORDAR = 3;
export const esperaAcordar = (tentativa: number): number => (tentativa <= 0 ? 2000 : 4000);
/** Prazo de cada pergunta à máquina. */
export const PRAZO_STATUS_MS = 15_000;

/** Endereço do noVNC pelo forward local: conecta sozinho, escala na janela e religa se a conexão piscar. */
export const urlNoVnc = (localPort: number): string =>
  `http://127.0.0.1:${localPort}/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=1500&show_dot=true`;
/** O <webview> do Computador só pode carregar o noVNC do forward local (o main confere ao anexar). */
export const urlTelaPermitida = (url: string): boolean => /^http:\/\/127\.0\.0\.1:\d{2,5}\/vnc\.html(\?|$)/.test(url);
/** Prefixo da partição do <webview> do Computador (em memória, uma por máquina): fora das sessões do Navegador. */
export const PARTICAO_COMPUTADOR = "computador-";
/** Partição do Computador desta máquina (o renderer usa a mesma regra; o main recusa qualquer outra). */
export const particaoComputador = (host: string): string => `${PARTICAO_COMPUTADOR}${host.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
