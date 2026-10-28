/**
 * Nível de liberdade do agente do WhatsApp (tutorial 7: "só conversa", "consulta e organiza", "age") aplicado no
 * Claude Code do backend. No OpenClaw a trava é do próprio OpenClaw (tools.toolsBySender); no Hermes quem executa é
 * este backend (modelo "whatsapp"), então é aqui que o nível vira `--disallowedTools`. Espelha as listas do OpenClaw
 * (objetivo-core.ts): "conversa" ≈ OTHERS_DENY (nada que escreva ou execute), "consulta" ≈ exec/process/cron/gateway
 * (lê, pesquisa e anota, mas não roda comandos), "age" sem trava. O Navegador fica liberado como no OpenClaw do dono.
 * Lido a cada turno de ~/.local/share/meu-bot/objetivo.json: mudar o nível no app vale na próxima mensagem.
 * Sem objetivo salvo (ou ilegível): "age", o comportamento de antes.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OBJETIVO = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'objetivo.json');
const NIVEIS = ['conversa', 'consulta', 'age'];

const BLOQUEIO = {
  conversa: ['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task'],
  consulta: ['Bash', 'BashOutput', 'KillShell', 'Task'],
  age: [],
};

/** O nível salvo no objetivo.json; "age" quando não há ou é inválido. */
function nivelAtual(arquivo = OBJETIVO) {
  try {
    const v = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return v && NIVEIS.includes(v.level) ? v.level : 'age';
  } catch (_) { return 'age'; }
}

/** Ferramentas do Claude Code bloqueadas no nível (lista vazia = sem trava). */
const ferramentasBloqueadas = (nivel) => [...(BLOQUEIO[nivel] || [])];

/**
 * Quem não é o dono, no WhatsApp da API oficial (perfil "whatsapp-cliente" do wa-cloud.js): só conversa e pesquisa na
 * web. Nada que execute, escreva ou LEIA arquivos desta máquina (credenciais, .env, conversas de outros), nem WebFetch
 * (alcançaria serviços locais). É o equivalente do toolsBySender do OpenClaw (NON_OWNER_DENY + DESCONHECIDO_DENY).
 */
const BLOQUEIO_CLIENTE = ['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Read', 'Glob', 'Grep', 'LS', 'WebFetch'];
/** As do cliente somadas às do nível do dono (o dono pode ter travado ainda mais). */
const ferramentasDoCliente = (nivel) => [...new Set([...BLOQUEIO_CLIENTE, ...ferramentasBloqueadas(nivel)])];
const AVISO_CLIENTE = 'Você está falando no WhatsApp com alguém que NÃO é o dono deste agente. Converse e ajude com o que souber ou pesquisar na web, mas não acesse arquivos, comandos ou dados desta máquina; se pedirem, diga que isso só o dono pode.';

/** A frase que vai junto do system prompt, para o agente explicar a recusa em vez de tentar e falhar calado. */
function avisoDoNivel(nivel) {
  if (nivel === 'conversa') return 'Nível de liberdade no WhatsApp: só conversa. Você não roda comandos nem cria, edita ou apaga arquivos nesta máquina; se pedirem, diga que o dono deixou o agente só para conversa (o nível muda no tutorial 7 do meu-bot).';
  if (nivel === 'consulta') return 'Nível de liberdade no WhatsApp: consulta e organiza. Você pode ler, pesquisar e anotar no seu workspace, mas não roda comandos no sistema; se pedirem, diga que o dono não liberou comandos (o nível muda no tutorial 7 do meu-bot).';
  return '';
}

module.exports = { OBJETIVO, NIVEIS, nivelAtual, ferramentasBloqueadas, avisoDoNivel, BLOQUEIO_CLIENTE, ferramentasDoCliente, AVISO_CLIENTE };
