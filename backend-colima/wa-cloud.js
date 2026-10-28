#!/usr/bin/env node
/**
 * wa-cloud.js — gateway da API oficial do WhatsApp (Cloud API da Meta) na máquina da pessoa. Escuta só em 127.0.0.1;
 * o mundo chega pelo Cloudflare Tunnel, que publica apenas /webhook. Fluxo:
 *   Meta → POST /webhook (assinatura conferida, 200 na hora) → fila por contato → política "quem o agente responde"
 *   → backend do meu-bot (POST /v1/chat/completions, modelo "whatsapp" para o dono, "whatsapp-cliente" para os outros)
 *   → resposta pela Graph API. Histórico de cada contato em ~/.local/share/meu-bot/wa-cloud/<número>.jsonl (o espelho
 *   do app lê dali). Fica fora do server.js de propósito: o server.js exige Bearer em toda rota e não deve ser público.
 *
 * Configuração (o app grava; nunca ao alcance do agente):
 *   ~/.config/meu-bot/wa-cloud.env  (0600): WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_PHONE_NUMBER_ID, WA_WABA_ID,
 *                                           WA_CLOUD_PORT (padrão 8090)
 *   ~/.local/share/meu-bot/wa-cloud.json   : { politica: self|open|list, dono, lista[], pausados[] } (relido a cada mensagem)
 *   <pasta do backend>/.env                : PORT e WA_CLOUD_KEY (a chave com que este serviço chama o backend)
 */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const core = require('./wa-cloud-core.js');
const licenca = require('./licenca.js');
const { spawn } = require('node:child_process');
// Freio de loop e memória do dono: os mesmos módulos puros da guarda do OpenClaw (ESM), que o install.sh põe em
// ./guarda/ ao lado deste arquivo. Sem eles (backend antigo), o receptor segue sem freio e sem memória.
const guardaRegras = import('./guarda/regras.mjs').catch(() => null);
const guardaMemoria = import('./guarda/memoria.mjs').catch(() => null);

const MEU_BOT = path.join(os.homedir(), '.local', 'share', 'meu-bot');
const ENV_FILE = path.join(os.homedir(), '.config', 'meu-bot', 'wa-cloud.env');
const ESTADO_FILE = path.join(MEU_BOT, 'wa-cloud.json');
const HIST_DIR = path.join(MEU_BOT, 'wa-cloud');
const STATUS_FILE = path.join(MEU_BOT, 'wa-cloud-status.json');
const LICENSE_FILE = path.join(MEU_BOT, 'licenca.json');
const MEMORIA_FILE = path.join(MEU_BOT, 'memoria-dono.md');
const AUDITORIA_PY = path.join(MEU_BOT, 'auditoria.py');
/** Quantas mensagens do histórico vão a cada turno (o --resume do backend cuida do resto). */
const JANELA = 40;
/** Corpo máximo aceito no webhook (a Meta manda lotes pequenos). */
const CORPO_MAX = 1024 * 1024;

function log(...a) { console.log(new Date().toISOString(), '[wa-cloud]', ...a); }
function lerEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch (_) { /* sem arquivo: não configurado */ }
  return out;
}
const lerJson = (file, padrao) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return padrao; } };
function gravarJson(file, v) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const CFG = lerEnv(ENV_FILE);
// O .env do backend fica na mesma pasta (o instalador põe os dois juntos); WA_CLOUD_BACKEND_DIR só para os testes.
const BACKEND = lerEnv(path.join(process.env.WA_CLOUD_BACKEND_DIR || __dirname, '.env'));
const PORTA = Number(CFG.WA_CLOUD_PORT || 8090);
const BACKEND_URL = `http://127.0.0.1:${Number(BACKEND.PORT || 8080)}/v1/chat/completions`;
const configurado = () => Boolean(CFG.WA_TOKEN && CFG.WA_APP_SECRET && CFG.WA_VERIFY_TOKEN && CFG.WA_PHONE_NUMBER_ID && BACKEND.WA_CLOUD_KEY);

/** Status para o app (sondado por SSH): configurado, última mensagem recebida, último erro. */
const status = lerJson(STATUS_FILE, {});
function marcar(campos) { Object.assign(status, campos, { em: new Date().toISOString() }); try { gravarJson(STATUS_FILE, status); } catch (_) { /* opcional */ } }

const histFile = (n) => path.join(HIST_DIR, `${n.slice(1)}.jsonl`);
function registrar(n, linha) {
  try {
    fs.mkdirSync(HIST_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(histFile(n), `${JSON.stringify(linha)}\n`, { mode: 0o600 });
  } catch (e) { log(`histórico de ${n}: não gravei (${e.message})`); }
}
function historico(n) {
  try { return fs.readFileSync(histFile(n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; }
}

async function graph(pedido) {
  const r = await fetch(pedido.url, { method: 'POST', headers: { Authorization: `Bearer ${CFG.WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pedido.corpo), signal: AbortSignal.timeout(30_000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${txt.slice(0, 300)}`);
  return txt;
}

/** Registro de auditoria da máquina (quem: "agente"), pelo auditoria.py que o backend deixa em ~/.local/share/meu-bot. */
function auditar(acao, alvo, detalhe) {
  if (!fs.existsSync(AUDITORIA_PY)) return;
  const b64 = Buffer.from(JSON.stringify({ quem: { tipo: 'agente', nome: 'WhatsApp oficial' }, app: 'wa-cloud', acao, alvo: String(alvo ?? ''), detalhe: String(detalhe ?? '').slice(0, 300) }), 'utf8').toString('base64url');
  spawn('python3', [AUDITORIA_PY, 'gravar', b64], { stdio: 'ignore' }).on('error', () => { /* sem python3: sem registro */ });
}

/** Pausa o contato no wa-cloud.json (a mesma lista que o app usa): o receptor deixa de chamar o agente para ele. */
function pausar(n) {
  const e = lerJson(ESTADO_FILE, {});
  const ps = (Array.isArray(e.pausados) ? e.pausados : []).filter((x) => x !== n);
  gravarJson(ESTADO_FILE, { ...e, pausados: [...ps, n] });
}

/** Resposta direta a um atalho de memória do dono ("lembre que …", "esquece que …", "o que você lembra?"), sem turno do agente. */
function respostaDaMemoria(mem, a) {
  if (a.tipo === 'anotar') {
    const r = mem.anotar(MEMORIA_FILE, a.fato);
    if (r.ok) return `Anotado: ${a.fato}.`;
    return r.motivo === 'repetido' ? 'Isso já estava anotado.' : `A memória está cheia (${mem.MAX_CHARS} caracteres). Escreva "esquece que …" para liberar espaço.`;
  }
  if (a.tipo === 'esquecer') {
    const fora = mem.esquecer(MEMORIA_FILE, a.fato);
    return fora.length > 0 ? `Esqueci: ${fora.map((l) => l.replace(/ \(\d{2}\/\d{2}\/\d{4}\)$/, '')).join('; ')}.` : `Não achei nada anotado com "${a.fato}".`;
  }
  const lista = mem.listar(MEMORIA_FILE, a.fato);
  return lista.length > 0 ? `O que tenho anotado${a.fato ? ` sobre "${a.fato}"` : ''}:\n${lista.map((l) => `- ${l}`).join('\n')}` : 'Não tenho nada anotado ainda. Escreva "lembre que …" para eu guardar.';
}

/** Um turno do agente: a janela do histórico + o que chegou; `seen` diz ao backend quantas a sessão já viu. */
async function perguntarAoAgente(n, papel) {
  const linhas = historico(n).filter((l) => l.texto && (l.quem === 'pessoa' || l.quem === 'agente')).slice(-JANELA);
  const msgs = linhas.map((l) => ({ role: l.quem === 'agente' ? 'assistant' : 'user', content: l.texto }));
  // Turnos do dono levam a memória dele (a mesma da guarda no OpenClaw); mudar a memória começa outra sessão no backend.
  const mem = papel === 'dono' ? await guardaMemoria : null;
  const ctxMemoria = mem ? mem.contexto(MEMORIA_FILE) : null;
  let novos = 0;
  for (let i = msgs.length - 1; i >= 0 && msgs[i].role === 'user'; i--) novos++;
  const r = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BACKEND.WA_CLOUD_KEY}`, 'Content-Type': 'application/json', 'X-Conversation-Id': `wa-${n.slice(1)}`, 'X-Conversation-Seen': String(Math.max(0, msgs.length - novos)) },
    body: JSON.stringify({ model: papel === 'dono' ? 'whatsapp' : 'whatsapp-cliente', stream: false, messages: ctxMemoria ? [{ role: 'system', content: ctxMemoria }, ...msgs] : msgs }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const v = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`backend ${r.status}: ${JSON.stringify(v).slice(0, 300)}`);
  return String(v?.choices?.[0]?.message?.content ?? '').trim();
}

/** Fila por contato: as mensagens de uma pessoa são respondidas em ordem; pessoas diferentes em paralelo. */
const filas = new Map();
/** Freio de loop por contato (o LoopTracker da guarda): criado quando o módulo carrega. */
let freio = null;
guardaRegras.then((m) => { if (m) freio = new m.LoopTracker(); });
function enfileirar(n, tarefa) {
  const antes = filas.get(n) ?? Promise.resolve();
  const agora = antes.then(tarefa).catch((e) => { log(`${n}: ${e.message}`); marcar({ erro: e.message }); });
  filas.set(n, agora);
  agora.finally(() => { if (filas.get(n) === agora) filas.delete(n); });
}

async function tratar(m) {
  registrar(m.de, { em: m.em, quem: 'pessoa', id: m.id, nome: m.nome, tipo: m.tipo, texto: m.texto, ...(m.midiaId ? { midiaId: m.midiaId } : {}) });
  marcar({ ultimaMensagem: m.em, erro: null });
  if (!licenca.proOk(licenca.parseLicense(lerJson(LICENSE_FILE, null)))) { log(`${m.de}: sem Pro em vigor, não respondo`); marcar({ erro: 'licença Pro fora de vigor: o agente não responde' }); return; }
  const d = core.decidir(m.de, core.lerEstado(lerJson(ESTADO_FILE, {})));
  if (d.acao !== 'responder') { log(`${m.de}: não respondo (${d.motivo})`); return; }
  if (core.textoParaAgente(m) === '') return;
  enfileirar(m.de, async () => {
    graph(core.envioLido(CFG.WA_PHONE_NUMBER_ID, m.id)).catch(() => { /* tiques azuis são opcionais */ });
    // Atalho de memória do dono: responde direto, sem turno do agente (Nota: só o dono chega aqui).
    if (d.papel === 'dono' && m.texto !== '') {
      const mem = await guardaMemoria;
      const a = mem ? mem.atalho(m.texto) : null;
      if (a !== null) {
        const texto = respostaDaMemoria(mem, a);
        const ret = JSON.parse(await graph(core.envioTexto(CFG.WA_PHONE_NUMBER_ID, m.de, texto)));
        registrar(m.de, { em: new Date().toISOString(), quem: 'agente', id: ret?.messages?.[0]?.id ?? '', texto });
        return;
      }
    }
    // O agente vê o texto (ou a descrição da mídia) como a última fala da pessoa.
    if (m.texto === '') registrar(m.de, { em: new Date().toISOString(), quem: 'pessoa', id: `${m.id}#desc`, texto: core.textoParaAgente(m) });
    if (freio && d.papel === 'cliente') freio.received(m.de, core.textoParaAgente(m));
    const resposta = await perguntarAoAgente(m.de, d.papel);
    if (resposta === '') return;
    // Outro bot do outro lado (despedidas ou textos quase iguais em ciclos curtos): não envia, pausa o contato e registra.
    const veredito = freio && d.papel === 'cliente' ? freio.sending(m.de, resposta) : { loop: false };
    if (veredito.loop) {
      pausar(m.de); freio.forget(m.de);
      log(`${m.de}: pausado sozinho (${veredito.reason})`); marcar({ erro: `pausei ${m.de} sozinho: conversa em loop (${veredito.reason})` });
      auditar('whatsapp.pausa-automatica', m.de, veredito.reason);
      return;
    }
    for (const parte of core.partes(resposta)) {
      const ret = JSON.parse(await graph(core.envioTexto(CFG.WA_PHONE_NUMBER_ID, m.de, parte)));
      registrar(m.de, { em: new Date().toISOString(), quem: 'agente', id: ret?.messages?.[0]?.id ?? '', texto: parte });
    }
  });
}

const duplicatas = core.criarDuplicatas();
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, configurado: configurado() })); return; }
  if (url.pathname !== '/webhook') { res.writeHead(404); res.end(); return; }
  if (req.method === 'GET') {
    const desafio = core.verificarDesafio(Object.fromEntries(url.searchParams), CFG.WA_VERIFY_TOKEN);
    if (desafio === null) { res.writeHead(403); res.end(); return; }
    marcar({ verificadoEm: new Date().toISOString() });
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(desafio); return;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const partesCorpo = []; let tamanho = 0;
  req.on('data', (c) => { tamanho += c.length; if (tamanho > CORPO_MAX) { res.writeHead(413); res.end(); req.destroy(); } else partesCorpo.push(c); });
  req.on('end', () => {
    if (res.writableEnded) return;
    const bruto = Buffer.concat(partesCorpo);
    if (!core.assinaturaOk(bruto, req.headers['x-hub-signature-256'], CFG.WA_APP_SECRET)) { log('assinatura inválida: descartado'); res.writeHead(401); res.end(); return; }
    // 200 antes de qualquer trabalho: a Meta reenvia se demorar, e um turno do agente leva minutos.
    res.writeHead(200); res.end();
    let corpo = null; try { corpo = JSON.parse(bruto.toString('utf8')); } catch (_) { return; }
    for (const m of core.lerMensagens(corpo, CFG.WA_PHONE_NUMBER_ID)) if (duplicatas.novo(m.id)) void tratar(m).catch((e) => log(`${m.de}: ${e.message}`));
  });
});

if (require.main === module) {
  if (!configurado()) log(`não configurado (faltam credenciais em ${ENV_FILE} ou WA_CLOUD_KEY no .env do backend): só /health responde`);
  servidor.listen(PORTA, '127.0.0.1', () => { log(`ouvindo em 127.0.0.1:${PORTA}`); marcar({ configurado: configurado(), porta: PORTA }); });
}
module.exports = { servidor };
