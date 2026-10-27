#!/usr/bin/env node
/**
 * claude-porteiro.js — o porteiro do `claude` nesta máquina. Fica na frente do Claude Code (o shim
 * claude-porteiro.sh em ~/.local/share/meu-bot/bin/claude) e escolhe a conta do Claude pelo mesmo registro do
 * backend (contas-claude.js, ao lado): o login padrão da máquina é a base; as contas extras entram na ordem de
 * preferência quando a atual bate o limite. Vale para quem chamar `claude`: o OpenClaw (WhatsApp), o Terminal do
 * app, a pessoa no shell. O backend não passa por aqui (ele já faz o rodízio com retry no mesmo turno).
 *
 * Dois modos, decididos pelo shim:
 *  --env  args…        imprime `export …` da conta escolhida (interativo: o shim faz eval e exec do claude real).
 *  --run REAL args…    roda o claude real com a conta escolhida repassando a saída stream-json intacta e, nas
 *                      linhas de rate limit, anota o uso; limite rejeitado = marca a conta esgotada, anota o evento e
 *                      sai com 1 depois do `result`, para o OpenClaw não reaproveitar o processo (o próximo turno
 *                      nasce num processo novo, que vem parar aqui e sai na próxima conta com o mesmo --resume).
 * Regra de ouro: nunca bloquear. Qualquer erro aqui → claude real com o login padrão, como sem o porteiro.
 * Sem dependências npm. Mesmo arquivo em backend-colima/ e backend-vm/services/ (copiar, não editar só um).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODO = process.argv[2];
const ARGS = process.argv.slice(MODO === '--run' ? 4 : 3);
const REAL = MODO === '--run' ? process.argv[3] : null;
/** Para o filho (e qualquer `claude` chamado por ele) não entrar no porteiro de novo. */
const ENV_FILHO = { MEU_BOT_PORTEIRO: '0' };

const quoteSh = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const exportar = (env) => Object.entries(env).map(([k, v]) => `export ${k}=${quoteSh(v)}`).join('\n');
const origem = () => (process.env.MEU_BOT_ORIGEM || (process.stdin.isTTY ? 'terminal' : 'cli')).slice(0, 20);
const aviso = (t) => { try { process.stderr.write(`meu-bot: ${t}\n`); } catch (_) { /* sem stderr */ } };

/** Abre o registro de contas; null quando não dá (sem módulo, sem pasta): o chamador segue com o padrão. */
function abrirContas() {
  try {
    const contasClaude = require(path.join(__dirname, 'contas-claude.js'));
    const base = process.env.MEU_BOT_BASE || path.join(os.homedir(), '.local', 'share', 'meu-bot');
    return contasClaude.abrir({ base, log: () => {} });
  } catch (_) { return null; }
}

/** A conta para esta chamada: a melhor livre; sem nenhuma, o padrão mesmo assim (com aviso), nunca "não". */
function escolherConta(contas) {
  const conta = contas.escolher({ permitirAviso: true });
  if (conta !== null) return { conta, semLivre: false };
  return { conta: contas.conta('padrao'), semLivre: true };
}

function modoEnv() {
  const contas = abrirContas();
  if (contas === null) { process.stdout.write(`${exportar(ENV_FILHO)}\n`); return 0; }
  const { conta, semLivre } = escolherConta(contas);
  const env = { ...ENV_FILHO, ...contas.ambiente(conta) };
  if (semLivre) {
    const volta = contas.proximaDisponivelEm();
    aviso(`todas as contas do Claude estão no limite${volta ? ` (a próxima volta ${new Date(volta * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : ''}; seguindo na conta padrão`);
    if (temHermes()) aviso('para usar o Grok agora: hermes chat');
  } else if (conta.id !== 'padrao') aviso(`usando a conta do Claude "${conta.rotulo}"`);
  process.stdout.write(`${exportar(env)}\n`);
  return 0;
}

const temHermes = () => (process.env.PATH || '').split(path.delimiter).some((d) => { try { return fs.statSync(path.join(d, 'hermes')).isFile(); } catch (_) { return false; } });

function modoRun() {
  const contas = abrirContas();
  const escolha = contas === null ? null : escolherConta(contas);
  const conta = escolha === null ? null : escolha.conta;
  const env = { ...process.env, ...ENV_FILHO, ...(contas === null || conta === null ? {} : contas.ambiente(conta)) };
  if (escolha !== null && escolha.semLivre) aviso('todas as contas do Claude estão no limite; seguindo na conta padrão');
  const contasClaude = (() => { try { return require(path.join(__dirname, 'contas-claude.js')); } catch (_) { return null; } })();
  // MEU_BOT_FORCAR_LIMITE=<id>: teste de rodízio sem gastar cota (mesma semântica do backend): esta chamada dessa conta vira rejeitada.
  const forcar = conta !== null && process.env.MEU_BOT_FORCAR_LIMITE === conta.id;

  const child = spawn(REAL, ARGS, { env, stdio: ['inherit', 'pipe', 'inherit'] });
  let resto = ''; let rejeitado = false; let resets = null; let encerrando = false;
  const encerrar = (sig) => { encerrando = true; try { child.kill(sig); } catch (_) { /* já saiu */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => encerrar(sig));

  function olhar(linha) {
    if (contas === null || contasClaude === null || conta === null) return;
    let ev; try { ev = JSON.parse(linha); } catch (_) { return; }
    if (!ev || typeof ev !== 'object') return;
    const rl = (ev.type === 'rate_limit_event' || ev.type === 'system' || ev.type === 'result' || ev.rate_limit_info) ? contasClaude.analisarRateLimit(ev) : null;
    if (rl !== null) {
      try { if (Object.keys(rl.janelas).length) contas.registrarUso(conta.id, rl.janelas); } catch (_) { /* registro é cortesia */ }
      if (rl.rejeitado) { rejeitado = true; resets = rl.resets; }
    }
    if (ev.type === 'result' && (rejeitado || (forcar && ev.is_error !== false))) {
      rejeitado = true;
      try {
        contas.marcar(conta.id, 'esgotada', forcar ? 'limite forçado (teste)' : 'limite de uso (porteiro)', resets);
        const proxima = contas.escolher({ excluir: [conta.id], permitirAviso: true });
        contas.registrarEvento({ origem: origem(), de: conta.rotulo, para: proxima ? proxima.rotulo : null, motivo: forcar ? 'limite forçado' : 'limite de uso', resets });
        aviso(`conta "${conta.rotulo}" no limite; ${proxima ? `a próxima chamada vai pela conta "${proxima.rotulo}"` : 'nenhuma outra conta livre'}`);
      } catch (_) { /* nunca derrubar o turno por causa do registro */ }
      // Depois do result o OpenClaw manteria este processo vivo por 10 min, preso à conta esgotada: encerra.
      setTimeout(() => encerrar('SIGTERM'), 200);
    }
  }
  child.stdout.on('data', (d) => {
    process.stdout.write(d);
    resto += d.toString('utf8');
    let i;
    while ((i = resto.indexOf('\n')) >= 0) { const l = resto.slice(0, i).trim(); resto = resto.slice(i + 1); if (l !== '') olhar(l); }
  });
  child.on('error', (e) => { aviso(`não consegui iniciar ${REAL}: ${e.message}`); process.exit(127); });
  child.on('close', (code, sig) => {
    if (resto.trim() !== '') olhar(resto.trim());
    if (rejeitado) process.exit(1);
    process.exit(code === null ? (sig && !encerrando ? 1 : 0) : code);
  });
  return null;
}

try {
  if (MODO === '--env') process.exitCode = modoEnv();
  else if (MODO === '--run' && REAL) modoRun();
  else { process.stderr.write('uso: claude-porteiro.js --env args… | --run REAL args…\n'); process.exitCode = 2; }
} catch (e) {
  // Nunca bloquear: em --env, sem exports = claude real com o login padrão; em --run, o shim nem chega aqui.
  if (MODO === '--env') { process.stdout.write(`${exportar(ENV_FILHO)}\n`); process.exitCode = 0; } else { aviso(`porteiro falhou (${e && e.message}); rode MEU_BOT_PORTEIRO=0 claude`); process.exitCode = 1; }
}
