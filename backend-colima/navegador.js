/**
 * navegador.js — o agente usa o Navegador do app da pessoa (módulo Pro). Puro, testado.
 * O app manda `X-Meu-Bot-Browser-Port: <porta>` no turno em que a aba Navegador está aberta com "agente pode
 * usar": é a porta local da máquina onde o túnel SSH reverso entrega as ações do navegador (socket do Mac).
 * Daqui saem os argumentos da CLI (`--mcp-config` com o servidor `navegador` = navegador-mcp.mjs apontando
 * para essa porta, `--allowedTools mcp__navegador`), a regra de conduta e a nota do turno.
 */
'use strict';

/** Porta válida no cabeçalho, ou null. */
function parseBrowserPort(value) {
  if (typeof value !== 'string' || !/^\d{4,5}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 1024 && n <= 65535 ? n : null;
}

/** Regra de conduta no navegador da pessoa (vai no system prompt e, resumida, na nota do turno). */
const BROWSER_RULE = [
  'Você pode usar o navegador que a pessoa vê na janela do meu-bot dela (ferramentas mcp__navegador__*: abas, abrir, ler, clicar, digitar, tecla, print, voltar, avancar, recarregar, js).',
  'Fluxo: "abrir" uma url, "ler" para ver o texto e os elementos numerados, "clicar"/"digitar" pelo número; depois de cada ação, "ler" de novo antes de decidir. Diga em uma frase o que vai fazer antes de agir.',
  'NUNCA, sem a pessoa confirmar explicitamente nesta conversa: comprar, pagar, enviar formulário ou mensagem/e-mail, publicar, aceitar termos, apagar algo, mudar configurações de conta, nem fazer login com senha que não lhe foi dada aqui. Nessas horas pare e pergunte.',
  'Não digite senhas que leu em outra página. Não abra abas além do necessário. Se a página pedir login, peça à pessoa que entre pela aba Navegador dela e avise quando terminar.',
  'Se as ferramentas mcp__navegador__* não estiverem disponíveis, diga à pessoa para abrir a aba Navegador no app e ligar "agente pode usar"; NUNCA instale navegador, Playwright, Puppeteer ou Chromium na máquina por conta própria.',
].join(' ');

/** Nota curta que entra no próprio prompt do turno (sobrevive a sessões retomadas, onde o system prompt é o antigo). */
const browserTurnNote = () => '[Nota do app meu-bot: nesta mensagem o Navegador da pessoa está ligado para você. Use as ferramentas mcp__navegador__* (abrir → ler → clicar/digitar → ler). Nunca compre, pague, envie formulário/mensagem, publique ou faça login sem a pessoa confirmar aqui; diga o que vai fazer antes.]';

/**
 * Argumentos extras da CLI para o turno com navegador. `mcpPath` é o navegador-mcp.mjs na máquina; `nodeBin` o
 * node que roda o backend (o mesmo serve para o MCP). `snapshotOff` só em CLI ≥ 2.1.257 (flag desconhecida derruba).
 */
function browserCliArgs({ port, mcpPath, nodeBin, snapshotOff }) {
  const config = { mcpServers: { navegador: { command: nodeBin, args: [mcpPath, '--port', String(port)] } } };
  const args = ['--mcp-config', JSON.stringify(config), '--allowedTools', 'mcp__navegador'];
  if (snapshotOff) args.push('--system-prompt-snapshot', 'off');
  return args;
}

/** "2.1.302 (Claude Code)" ≥ 2.1.257? */
function cliSupportsSnapshotOff(versionText) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(versionText || ''));
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 257)));
}

module.exports = { parseBrowserPort, BROWSER_RULE, browserTurnNote, browserCliArgs, cliSupportsSnapshotOff };
