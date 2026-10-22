/**
 * server.js — backend OpenAI-compatível mínimo para o meu-bot, rodando na VM local do Colima.
 *
 * Sem dependências npm: só node:http. Cada turno spawna a CLI do Claude Code (login de assinatura,
 * sem API key) em modo -p com stream-json. Contrato igual ao backend da grokbot-1:
 *  - Authorization: Bearer $OPENAI_COMPAT_KEY (lido do .env ao lado deste arquivo).
 *  - GET /v1/models; POST /v1/chat/completions {model, messages, stream}.
 *  - stream=true sem cabeçalho → SSE legado (texto inteiro num chunk).
 *  - stream=true + X-Stream-Mode: live → SSE token a token, ": ping" a cada 15 s, finish_reason,
 *    usage e [DONE]; fechar a conexão aborta a CLI.
 *  - X-Conversation-Id + X-Conversation-Seen → retoma a sessão da CLI com --resume quando possível;
 *    resposta leva X-Session-Resumed: true|false.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sessions = require('./session-map');
const toolEvents = require('./tool-events');
const navegador = require('./navegador');
const NAVEGADOR_MCP = path.join(os.homedir(), '.local/share/meu-bot/navegador-mcp.mjs');
/** Passos por mensagem quando o Navegador está ligado (o perfil "agente" tem 30 sem ele). */
const BROWSER_MAX_TURNS = 100;
const providers = require('./providers');
const { readClaudeStatus, refreshRateLimits } = require('./account-status');
const licenca = require('./licenca');
const { createCrmApi } = require('./crm-api');

const ROOT = __dirname;
const ENV = loadEnv(path.join(ROOT, '.env'));
const KEY = ENV.OPENAI_COMPAT_KEY || process.env.OPENAI_COMPAT_KEY || '';
const HOST = ENV.HOST || '127.0.0.1';
const PORT = Number(ENV.PORT || 8080);
const CLAUDE_BIN = ENV.CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');
/** Versão da CLI (para saber se aceita --system-prompt-snapshot off); lida uma vez, em segundo plano. */
let CLAUDE_VERSION = '';
try { require('node:child_process').execFile(CLAUDE_BIN, ['--version'], { timeout: 10000 }, (e, out) => { if (!e) CLAUDE_VERSION = String(out).trim(); }); } catch (_) { /* fica vazio: sem a flag */ }
const WORKSPACE = ENV.WORKSPACE || path.join(os.homedir(), 'chat-workspace');
const TURN_TIMEOUT_MS = Number(ENV.TURN_TIMEOUT_MS || 10 * 60 * 1000);

const AGENT_WORKSPACE = ENV.AGENT_WORKSPACE || path.join(os.homedir(), 'agent-workspace');
/**
 * Diário das conversas que não passam pelo Claude Code (Grok, Hermes): sem ele, elas só existiriam no app. Uma
 * conversa por arquivo, uma linha JSON por mensagem ({at, role, model, provider, text}). O meu-bot-admin lista e lê;
 * "Copiar ID" aponta para cá; "Excluir" no app apaga (rota DELETE abaixo).
 */
const APP_CONVERSAS = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'conversas');
/**
 * Segurança: quais Macs já usaram o meu-bot desta máquina (maquinas.json) e como avisar quando aparece um novo
 * (alertas.json: WhatsApp da própria pessoa, e e-mail se ela quiser). Como o aviso de "login numa máquina nova"
 * do Rambox. O app se apresenta em POST /v1/meu-bot/hello a cada abertura; o primeiro Mac de todos não avisa
 * (é a instalação), os seguintes avisam e ficam no registro de auditoria da máquina (auditoria.py).
 */
const MEU_BOT_DIR = path.join(os.homedir(), '.local', 'share', 'meu-bot');
const MACHINES_FILE = path.join(MEU_BOT_DIR, 'maquinas.json');
const ALERTS_FILE = path.join(MEU_BOT_DIR, 'alertas.json');
/** Licença da conta (plano, status, validade, limite de devices): o admin é dono e grava por SSH; o app só lê. */
const LICENSE_FILE = path.join(MEU_BOT_DIR, 'licenca.json');
/** CRM próprio (meu-bot-crm): rotas /v1/crm/* sobre ~/.local/share/meu-bot/crm/db (crm-api.js); exige o plano personalizado. */
const CRM_CONFIG = path.join(MEU_BOT_DIR, 'crm.json');
const CRM_DB = process.env.MEU_BOT_CRM_DB || path.join(MEU_BOT_DIR, 'crm', 'db');
const readJson = (f, fallback) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; } };
function writeJson(f, v) { fs.mkdirSync(MEU_BOT_DIR, { recursive: true, mode: 0o700 }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); }
const alertPrefs = () => { const a = readJson(ALERTS_FILE, {}); return { whatsapp: a.whatsapp !== false, email: typeof a.email === 'string' ? a.email.slice(0, 120) : '' }; };
/**
 * Registro de auditoria da máquina (quem: "sistema"): o auditoria.py ao lado é o dono do formato e da corrente. Na
 * subida, uma cópia vai para ~/.local/share/meu-bot/auditoria.py, que os plugins do OpenClaw usam (pausa automática).
 */
const AUDITORIA_PY = path.join(__dirname, 'auditoria.py');
try { fs.mkdirSync(MEU_BOT_DIR, { recursive: true, mode: 0o700 }); fs.copyFileSync(AUDITORIA_PY, path.join(MEU_BOT_DIR, 'auditoria.py')); } catch (_) { /* sem o arquivo (backend antigo): sem registro */ }
function auditar(acao, alvo) {
  const b64 = Buffer.from(JSON.stringify({ quem: { tipo: 'sistema', nome: 'backend' }, app: 'backend', acao, alvo: String(alvo ?? '').slice(0, 120) }), 'utf8').toString('base64url');
  require('node:child_process').execFile('python3', [AUDITORIA_PY, 'gravar', b64], { timeout: 15_000 }, (err) => { if (err) log(`auditoria: não gravou ${acao}: ${err.message}`); });
}
/** Número do próprio WhatsApp (creds do OpenClaw); null sem pareamento. */
function selfWhatsappNumber() {
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'credentials', 'whatsapp', 'default', 'creds.json'), 'utf8')); const m = /^(\d{8,15})[:@]/.exec((c.me && c.me.id) || ''); return m ? m[1] : null; } catch (_) { return null; }
}
function sendWhatsappSelf(text) {
  const num = selfWhatsappNumber();
  if (!num) return Promise.resolve(false);
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${os.homedir()}/.openclaw/bin:${os.homedir()}/.local/bin:${process.env.PATH || ''}` };
    execFile('openclaw', ['message', 'send', '--channel', 'whatsapp', '--target', `+${num}`, '-m', text], { env, timeout: 60000 }, (err, _out, stderr) => {
      if (err) log(`aviso WhatsApp falhou: ${(stderr || err.message).toString().trim().split('\n').pop()}`);
      resolve(!err);
    });
  });
}
/** E-mail pela API do Resend (RESEND_API_KEY no .env; remetente ALERT_EMAIL_FROM ou o de teste do Resend). */
function sendEmail(to, subject, text) {
  const key = ENV.RESEND_API_KEY || process.env.RESEND_API_KEY || '';
  if (!key || !to) return Promise.resolve(false);
  return new Promise((resolve) => {
    const body = JSON.stringify({ from: ENV.ALERT_EMAIL_FROM || 'meu-bot <onboarding@resend.dev>', to: [to], subject, text });
    const req = https.request('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300)); });
    req.on('error', (e) => { log(`aviso e-mail falhou: ${e.message}`); resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}
/** IPs com sessão SSH aberta agora (quem está entrando nesta máquina), melhor esforço. */
function sshPeers() {
  try { return [...new Set(require('child_process').execSync("ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $NF}' | sed 's/:[0-9]*$//'", { encoding: 'utf8', timeout: 3000 }).split('\n').map((s) => s.trim()).filter(Boolean))]; } catch (_) { return []; }
}
/** Licença da conta, criando o arquivo com os defaults (e carimbando "membro desde") na 1ª vez. */
function ensureLicense() {
  const raw = readJson(LICENSE_FILE, null);
  if (raw === null) { const lic = licenca.defaultLicense(); writeJson(LICENSE_FILE, lic); return lic; }
  return licenca.parseLicense(raw);
}
/** Licença + devices (ativos/pendentes) da conta, como o app e o admin veem. */
function licenseView() {
  const license = ensureLicense();
  const all = readJson(MACHINES_FILE, {}) || {};
  const devices = Object.entries(all).map(([id, v]) => ({
    id, name: v.name, user: v.user, platform: v.platform, app: v.app, apps: v.apps && typeof v.apps === 'object' ? v.apps : {},
    firstSeen: v.firstSeen, lastSeen: v.lastSeen,
    status: licenca.deviceStatus(v), requestedAt: typeof v.requestedAt === 'string' ? v.requestedAt : null,
  })).sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0));
  const activeCount = devices.filter((d) => d.status === 'active').length;
  const pendingCount = devices.filter((d) => d.status === 'pending').length;
  return { license, devices, activeCount, pendingCount, deviceLimit: license.deviceLimit };
}
let crmApiInst = null;
/** Instância única da API do CRM (abre o db na 1ª chamada; sem CRM instalado só cria a pasta vazia). */
/**
 * Texto gerado pelo mesmo motor do chat (perfil "claudecode": só texto, sem ferramentas), para o resumo da caixa
 * no CRM. Chama este próprio servidor, então segue o fallback de provedores do chat. Conversa nova a cada pedido.
 */
function iaTexto(prompt, convId) {
  const body = JSON.stringify({ model: 'claudecode', messages: [{ role: 'user', content: prompt }], stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${KEY}`, 'X-Conversation-Id': convId }, timeout: 3 * 60_000 }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; });
      res.on('end', () => { try { const j = JSON.parse(t); if (res.statusCode !== 200) reject(new Error(j.error?.message ?? `motor respondeu ${res.statusCode}`)); else resolve(String(j.choices?.[0]?.message?.content ?? '')); } catch (e) { reject(new Error(`resposta inválida do motor: ${e.message}`)); } });
    });
    req.on('timeout', () => req.destroy(new Error('o motor não respondeu em 3 min')));
    req.on('error', reject); req.write(body); req.end();
  });
}
function crmApi() {
  if (crmApiInst === null) crmApiInst = createCrmApi({ dir: CRM_DB, configFile: CRM_CONFIG, licenseOk: () => licenca.crmOk(ensureLicense()), readJson, writeJson, json, readBody, log, iaTexto });
  return crmApiInst;
}
async function announceMachine(m) {
  const machines = readJson(MACHINES_FILE, null);
  const first = machines === null; // primeiro Mac de todos: a própria instalação, sem aviso
  const all = machines || {};
  const now = new Date().toISOString();
  const known = all[m.id];
  const license = ensureLicense();
  // Device conhecido mantém o status; device novo entra ativo se cabe no limite, senão "pending" (mão levantada).
  const status = licenca.admitDevice(license, all, m.id);
  const prev = known || {};
  all[m.id] = {
    name: m.name, user: m.user, platform: m.platform, app: m.app,
    // Um Mac pode ter o meu-bot e o meu-bot-crm: cada app que se apresenta fica em apps[produto].
    apps: licenca.mergeApps(prev.apps, m.produto, m.app),
    firstSeen: known ? known.firstSeen : now, lastSeen: now, ips: sshPeers().slice(0, 5),
    status,
    ...(status === 'pending' ? { requestedAt: prev.requestedAt || now } : {}),
  };
  writeJson(MACHINES_FILE, all);
  if (known || first) return { fresh: false, status, deviceLimit: license.deviceLimit };
  const when = new Date().toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' });
  const ips = all[m.id].ips.length ? ` · IP ${all[m.id].ips.join(', ')}` : '';
  const extra = status === 'pending'
    ? `\n\nEste device passou do limite do seu plano (${license.deviceLimit}). O pedido foi enviado ao admin para liberar um device a mais.`
    : '';
  const produto = typeof m.produto === 'string' && m.produto !== '' ? m.produto : 'meu-bot';
  const text = `${produto}: um Mac novo acabou de usar a sua máquina.\n\nNome: ${m.name} (${m.user})\nSistema: ${m.platform}\n${produto} ${m.app}${ips}\nQuando: ${when}${extra}\n\nSe não foi você, abra o meu-bot em Configurações › Suporte e peça ajuda ao admin.`;
  auditar(status === 'pending' ? 'device.pedido' : 'device.novo', `${m.name} (${m.user}, ${m.platform})`);
  const prefs = alertPrefs();
  const subject = status === 'pending' ? 'meu-bot: um device a mais pediu acesso' : 'meu-bot: um Mac novo usou a sua máquina';
  const results = await Promise.all([prefs.whatsapp ? sendWhatsappSelf(text) : Promise.resolve(null), prefs.email ? sendEmail(prefs.email, subject, text) : Promise.resolve(null)]);
  log(`máquina nova ${m.name} (${m.id}) status=${status}: whatsapp=${results[0]} email=${results[1]}`);
  return { fresh: true, status, deviceLimit: license.deviceLimit };
}
const MACHINE_FIELD_RE = /^[\p{L}\p{N} ._()-]{1,60}$/u;
const appConvFile = (convId) => path.join(APP_CONVERSAS, `${convId}.jsonl`);
function appendAppTranscript(convId, messages, model, provider, text) {
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const at = new Date().toISOString();
    const lines = [];
    if (lastUser) lines.push(JSON.stringify({ at, role: 'user', model, provider, text: messageText(lastUser) }));
    lines.push(JSON.stringify({ at, role: 'assistant', model, provider, text }));
    fs.mkdirSync(APP_CONVERSAS, { recursive: true, mode: 0o700 });
    const f = appConvFile(convId);
    const fresh = !fs.existsSync(f);
    fs.appendFileSync(f, `${lines.join('\n')}\n`, { mode: 0o600 });
    if (fresh) fs.chmodSync(f, 0o600);
  } catch (e) { log(`diário ${convId}: não gravei (${e.message})`); }
}
const MODELS = {
  claudecode: { maxTurns: 8, cwd: WORKSPACE, bypass: false, description: 'chat puro via Claude Code (assinatura)' },
  agente: { maxTurns: 30, cwd: AGENT_WORKSPACE, bypass: true, description: 'agente com ferramentas, sem pedir permissão (--dangerously-skip-permissions), cwd ~/agent-workspace' },
};

const CONV_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** providers.json: ordem de fallback (agente → grok-4 por padrão) e os provedores OpenAI-compatíveis (xAI). */
const PROVIDERS = providers.load(path.join(ROOT, 'providers.json'), { ...process.env, ...ENV }, log);
const listedModels = () => [
  ...Object.entries(MODELS).map(([id, p]) => ({ id, object: 'model', created: 0, owned_by: 'meu-bot', description: p.description })),
  ...providers.openaiModels(PROVIDERS).map((p) => ({ id: p.name, object: 'model', created: 0, owned_by: p.base_url, description: p.description })),
];

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch (_) { /* sem .env: só variáveis de ambiente */ }
  return out;
}

function log(...a) { console.log(new Date().toISOString(), '[backend]', ...a); }
let lastLimitsWhy = null;

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), ...extraHeaders });
  res.end(data);
}

function authOk(req) {
  if (!KEY) return true;
  const hdr = req.headers['authorization'] || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  return token.length === KEY.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(KEY));
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('corpo grande demais')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function messageText(m) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
  return '';
}

/** Achata mensagens OpenAI num prompt único; 'system' vai para --append-system-prompt. */
function flatten(messages) {
  const sys = []; const convo = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    if (m.role === 'system') sys.push(text);
    else if (m.role === 'assistant') convo.push(`Assistant: ${text}`);
    else convo.push(`User: ${text}`);
  }
  return { system: sys.join('\n\n'), prompt: convo.join('\n\n') };
}

function sysHash(messages) {
  const s = messages.filter((m) => m && m.role === 'system').map(messageText).join('\n');
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Roda a CLI uma vez. onDelta recebe texto incremental. Resolve {text, usage, sessionId, deltas}.
 * Rejeita com Error({code:'resume_failed'|'cli_failed'|'aborted'|'timeout'}).
 */
/**
 * Limite do modelo da conta (ex.: "You've reached your Fable limit"): a CLI devolve isso como texto de resposta.
 * Reconhecido antes de chegar ao cliente (as primeiras ~120 letras ficam retidas até descartar a hipótese) e vira
 * erro `model_limit`; o chamador refaz o turno com o modelo reserva (MODEL_FALLBACK, padrão Opus 5.5) e fica nele
 * até o limite passar (LIMIT_HOLD_MS), sem bater de novo no limite a cada mensagem.
 */
const LIMIT_RE = /you(?:'|’)?ve (?:reached|hit) your [\w .-]{1,40}limit/i;
const MODEL_FALLBACK = process.env.MODEL_FALLBACK || 'claude-opus-5-5';
const MODEL_FALLBACK_LABEL = process.env.MODEL_FALLBACK_LABEL || 'Opus 5.5';
const LIMIT_HOLD_MS = Number(process.env.LIMIT_HOLD_MS) > 0 ? Number(process.env.LIMIT_HOLD_MS) : 60 * 60 * 1000;
let limitUntil = 0; let limitWhat = '';
/** Nome legível do modelo que o Claude Code usa agora: o reserva durante o limite; senão o da conta (settings.json). */
const MODEL_LABELS = { fable: 'Fable 5.1', 'claude-fable-5-1': 'Fable 5.1', opus: 'Opus 5.5', 'claude-opus-5-5': 'Opus 5.5', sonnet: 'Sonnet 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', haiku: 'Haiku 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
function currentModelLabel() {
  if (Date.now() < limitUntil) return MODEL_FALLBACK_LABEL;
  let m = ''; try { m = String(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).model || ''); } catch (_) { /* sem settings */ }
  const k = m.toLowerCase().replace(/\[.*\]$/, '');
  return MODEL_LABELS[k] || (m || null);
}

function runClaude({ prompt, system, cwd, maxTurns, bypass, resume, signal, onDelta, onTool, browser, model }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-turns', String(maxTurns)];
    args.push(...(bypass ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'default']));
    // Navegador da pessoa ligado neste turno: o MCP navegador entra pela porta do túnel reverso (navegador.js).
    if (browser) args.push(...navegador.browserCliArgs({ port: browser.port, dono: browser.dono, mcpPath: NAVEGADOR_MCP, nodeBin: process.execPath, snapshotOff: navegador.cliSupportsSnapshotOff(CLAUDE_VERSION) }));
    if (system) args.push('--append-system-prompt', system);
    if (resume) args.push('--resume', resume);
    if (model) args.push('--model', model);
    fs.mkdirSync(cwd, { recursive: true });
    const child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, HOME: os.homedir() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; let deltas = 0; let usage = null; let sessionId = resume || null; let stderr = '';
    let resultText = null; let finished = false; let blockOpen = false; let sawTextBlock = false;
    const toolNames = new Map(); // tool_use_id → nome (o tool_result só traz o id)
    const timer = setTimeout(() => { fail('timeout', `CLI excedeu ${TURN_TIMEOUT_MS} ms`); }, TURN_TIMEOUT_MS);
    const onAbort = () => fail('aborted', 'cliente fechou a conexão');
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    function fail(code, msg) {
      if (finished) return; finished = true; clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 3000).unref();
      const e = new Error(msg); e.code = code; e.stderr = stderr.slice(-2000); reject(e);
    }
    // As primeiras letras ficam retidas: se forem o aviso de limite do modelo, o turno falha sem nada ter saído.
    let held = ''; let released = false;
    function release() { if (released) return; released = true; if (held && onDelta) onDelta(held); held = ''; }
    function emit(t) {
      if (!t) return; text += t; deltas++;
      if (released) { if (onDelta) onDelta(t); return; }
      held += t;
      if (LIMIT_RE.test(held)) { fail('model_limit', held.trim().split('\n')[0].slice(0, 200)); return; }
      if (held.length >= 120) release();
    }

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
        handle(ev);
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.stdin.on('error', () => {});
    child.stdin.end(browser ? `${navegador.browserTurnNote()}\n\n${prompt}` : prompt);

    function handle(ev) {
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
      if (onTool && (ev.type === 'assistant' || ev.type === 'user')) { for (const t of toolEvents.toolEventsFrom(ev, toolNames)) onTool(t); }
      if (ev.type === 'system' && ev.session_id) sessionId = ev.session_id;
      if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text') {
          if (sawTextBlock && text && !text.endsWith('\n\n')) emit('\n\n');
          blockOpen = true; sawTextBlock = true;
        } else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
          emit(e.delta.text);
        } else if (e.type === 'content_block_stop') {
          blockOpen = false;
        }
      } else if (ev.type === 'result') {
        if (ev.session_id) sessionId = ev.session_id;
        usage = ev.usage || null;
        if (typeof ev.result === 'string') resultText = ev.result;
        if (resultText && LIMIT_RE.test(resultText) && !released) { fail('model_limit', resultText.trim().split('\n')[0].slice(0, 200)); return; }
        // Limite de passos desta mensagem: a resposta parava no meio sem dizer nada. Avisa e diz como seguir.
        if (ev.subtype === 'error_max_turns' && text) emit(`\n\n_(Parei aqui: cheguei ao limite de ${maxTurns} passos desta mensagem. Mande "continua" que eu sigo de onde parei.)_`);
        if (ev.is_error && !text) { fail(looksLikeResumeFailure(ev, stderr) ? 'resume_failed' : 'cli_failed', resultText || ev.subtype || 'erro da CLI'); }
      }
    }

    child.on('error', (e) => fail('cli_failed', `não consegui iniciar a CLI: ${e.message}`));
    child.on('close', (code) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!deltas && resultText) { text = resultText; }
      if (LIMIT_RE.test(text.slice(0, 300))) { const e = new Error(text.trim().split('\n')[0].slice(0, 200)); e.code = 'model_limit'; return reject(e); }
      release();
      if (!text) {
        const code2 = looksLikeResumeFailure(null, stderr) ? 'resume_failed' : 'cli_failed';
        const e = new Error(`CLI saiu com código ${code} sem texto`); e.code = code2; e.stderr = stderr.slice(-2000); return reject(e);
      }
      if (/^\s*not logged in/i.test(text) || /please run \/?login/i.test(text)) {
        const e = new Error('Claude Code deslogado na VM: rode `claude /login` lá'); e.code = 'auth'; return reject(e);
      }
      resolve({ text, usage, sessionId, deltas, blockOpen });
    });
  });
}

function looksLikeResumeFailure(ev, stderr) {
  const s = `${ev && ev.result ? ev.result : ''}\n${stderr || ''}`;
  return /no conversation found|session.*not found|could not resume|invalid session|unable to resume/i.test(s);
}

/** Decide prompt e --resume a partir dos cabeçalhos de conversa (mesma regra do backend original). */
function planPrompt({ messages, convId, seenHdr, key, cwd, hash }) {
  const flat = flatten(messages);
  const fallback = { prompt: flat.prompt, system: flat.system, resume: null };
  if (!convId) return fallback;
  const entry = sessions.get(key);
  if (!entry) return fallback;
  if (entry.cwd !== cwd || entry.sysHash !== hash || !sessions.sessionFileExists(cwd, entry.sessionId)) { sessions.del(key); return fallback; }
  const convo = messages.filter((m) => m.role !== 'system' && messageText(m));
  const hdr = Number.parseInt(String(seenHdr ?? ''), 10);
  const seen = Number.isInteger(hdr) ? hdr : entry.seen;
  if (!(seen > 0 && seen < convo.length)) return fallback;
  const fresh = convo.slice(seen);
  if (!fresh.some((m) => m.role === 'user')) return fallback;
  const prompt = fresh.length === 1 ? messageText(fresh[0]) : flatten(fresh).prompt;
  return { prompt, system: flat.system, resume: entry.sessionId };
}

function convoCount(messages) { return messages.filter((m) => m.role !== 'system' && messageText(m)).length; }

function chunk(id, created, model, delta, finish_reason = null) {
  return { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }] };
}
function usageChunk(id, created, model, usage) {
  const input = (usage && usage.input_tokens) || 0; const output = (usage && usage.output_tokens) || 0;
  return { id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } };
}
function usageObj(usage) {
  const input = (usage && usage.input_tokens) || 0; const output = (usage && usage.output_tokens) || 0;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output };
}

async function chatCompletions(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: { message: `JSON inválido: ${e.message}`, type: 'invalid_request_error' } }); }
  const model = String(body.model || 'claudecode');
  const openaiProvider = providers.byName(PROVIDERS, model);
  if (!MODELS[model] && !(openaiProvider && openaiProvider.type === 'openai' && openaiProvider.available)) {
    return json(res, 404, { error: { message: `modelo desconhecido: ${model}`, type: 'invalid_request_error', code: 'model_not_found' } });
  }
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && typeof m.role === 'string') : [];
  if (!messages.some((m) => m.role === 'user')) return json(res, 400, { error: { message: 'messages precisa ter ao menos um user', type: 'invalid_request_error' } });
  const stream = body.stream === true;
  const live = stream && String(req.headers['x-stream-mode'] || '').toLowerCase() === 'live';

  // Navegador do agente (módulo Pro): só com a porta válida, licença Pro ativa e o MCP instalado na máquina.
  let browser = null;
  const browserPort = navegador.parseBrowserPort(req.headers['x-meu-bot-browser-port']);
  if (browserPort !== null) {
    const lic = licenseView().license;
    if (!licenca.proOk(lic)) log(`navegador pedido sem Pro (plano ${lic.plan}/${lic.status}); ignorado`);
    else if (!fs.existsSync(NAVEGADOR_MCP)) log(`navegador pedido, mas ${NAVEGADOR_MCP} não existe; ignorado`);
    else browser = { port: browserPort };
  }
  const convRaw = req.headers['x-conversation-id'];
  const convId = typeof convRaw === 'string' && CONV_ID_RE.test(convRaw) ? convRaw : null;
  // Dono das abas que este turno abrir no Navegador (cada conversa trabalha nas próprias abas): id da conversa + título.
  if (browser !== null && convId !== null) browser.dono = { id: `meu-bot:${convId}`, rotulo: navegador.parseRotulo(req.headers['x-meu-bot-browser-rotulo']) };
  const hash = sysHash(messages);
  const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  // Corrente: o pedido primeiro, depois os outros por prioridade. Fora do providers.json → só ele.
  const attempts = providers.chain(PROVIDERS, model);
  if (attempts.length === 0) attempts.push(model);
  const env = { ...process.env, ...ENV };

  const run = async () => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });

    let used = model; let resumed = false; let usedKey = null; let usedProfile = null;
    let headersSent = false; let heartbeat = null; let firstDeltaAt = 0;
    const pendingNotes = []; // fallbacks ocorridos antes de abrir o SSE

    const startSse = () => {
      if (headersSent) return;
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', 'X-Session-Resumed': resumed ? 'true' : 'false', 'X-Provider': used,
      });
      res.flushHeaders && res.flushHeaders();
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { role: 'assistant', content: '' }))}\n\n`);
      for (const n of pendingNotes.splice(0)) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, n.from, n.to, n.reason))}\n\n`);
      heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    };
    const onDelta = live ? (t) => { if (!firstDeltaAt) firstDeltaAt = Date.now(); startSse(); res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: t }))}\n\n`); } : null;
    // Atividade do agente (ferramentas): só no modo live, como chunk próprio; não conta como texto para o fallback.
    const onTool = live ? (t) => { startSse(); res.write(`data: ${JSON.stringify(toolEvents.toolChunk(id, created, used, t))}\n\n`); } : null;

    /** Um provedor claude: planeja resume pela chave dele e refaz sem resume se a sessão sumiu. */
    const runClaudeProvider = async (name) => {
      const profile = MODELS[name];
      const key = convId ? `${name}:${convId}` : null;
      let plan = planPrompt({ messages, convId, seenHdr: req.headers['x-conversation-seen'], key, cwd: profile.cwd, hash });
      // O modelo sabe quem é (a pergunta "qual modelo é você?" não depende do que ele acha de si).
      const identity = `Você responde dentro do meu-bot pelo Claude Code, perfil "${name}" (Anthropic). Se perguntarem qual modelo ou IA você é, diga exatamente isso.${browser ? `\n\n${navegador.BROWSER_RULE}` : ''}`;
      plan = { ...plan, system: plan.system ? `${identity}\n\n${plan.system}` : identity };
      resumed = Boolean(plan.resume);
      // Limite do modelo da conta recente: vai direto ao reserva até passar.
      let model = Date.now() < limitUntil ? MODEL_FALLBACK : undefined;
      // No reserva, o modelo sabe que é ele (a identidade padrão não diz o modelo).
      const withModel = (p) => (model ? { ...p, system: `${p.system}\n\nNeste turno o modelo é o ${MODEL_FALLBACK_LABEL} (${MODEL_FALLBACK}): o modelo padrão da conta bateu o limite de uso.` } : p);
      // Com o Navegador, cada clique, leitura e print é um passo: 30 acabava no meio de um formulário (Cloudflare, 22 out).
      const maxTurns = browser ? Math.max(profile.maxTurns, BROWSER_MAX_TURNS) : profile.maxTurns;
      const call = () => runClaude({ ...withModel(plan), cwd: profile.cwd, maxTurns, bypass: profile.bypass, signal: abort.signal, onDelta, onTool, browser, model });
      let out;
      for (let tries = 0; ; tries++) {
        try { out = await call(); break; }
        catch (e) {
          if (e.code === 'resume_failed' && plan.resume && !headersSent && tries < 3) {
            log(`resume falhou para ${key}; refazendo sem resume`);
            if (key) sessions.del(key);
            plan = { ...flatten(messages), resume: null }; resumed = false;
            plan = { ...plan, system: plan.system ? `${identity}\n\n${plan.system}` : identity };
            continue;
          }
          if (e.code === 'model_limit' && model === undefined && !firstDeltaAt && tries < 3) {
            limitUntil = Date.now() + LIMIT_HOLD_MS; limitWhat = e.message;
            log(`limite do modelo (${e.message}); refazendo com ${MODEL_FALLBACK} e mantendo por ${Math.round(LIMIT_HOLD_MS / 60000)} min`);
            model = MODEL_FALLBACK;
            // Aviso curto em português: "Fable falhou (limite de uso da conta); respondendo com Opus 5.5".
            const which = (/your ([\w .-]{1,30}?) limit/i.exec(e.message) || [])[1] || 'modelo da conta';
            const note = { from: which, to: MODEL_FALLBACK_LABEL, reason: `limite de uso da conta; o ${MODEL_FALLBACK_LABEL} segue por ${Math.round(LIMIT_HOLD_MS / 60000)} min` };
            if (headersSent) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, note.from, note.to, note.reason))}\n\n`);
            else pendingNotes.push(note);
            continue;
          }
          throw e;
        }
      }
      usedKey = key; usedProfile = profile;
      return out;
    };

    let out;
    try {
      for (let i = 0; i < attempts.length; i++) {
        const name = attempts[i];
        const next = attempts[i + 1];
        used = name;
        try {
          if (MODELS[name]) out = await runClaudeProvider(name);
          else { resumed = false; usedKey = null; usedProfile = null; out = await providers.openaiCompletion({ provider: providers.byName(PROVIDERS, name), env, messages, signal: abort.signal, onDelta }); }
          break;
        } catch (e) {
          // Já saiu texto para o cliente, ou não há próximo: o erro é definitivo.
          if (e.code === 'aborted' || firstDeltaAt || next === undefined) throw e;
          log(`${name} falhou (${e.code || '?'}: ${e.message}); caindo para ${next}`);
          const note = { from: name, to: next, reason: e.message };
          if (headersSent) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, next, note.from, note.to, note.reason))}\n\n`);
          else pendingNotes.push(note);
        }
      }
    } catch (e) {
      if (heartbeat) clearInterval(heartbeat);
      if (e.code === 'aborted') { log(`abortado pelo cliente após ${Date.now() - t0} ms`); try { res.end(); } catch (_) {} return; }
      log(`erro: ${e.code || '?'} ${e.message}${e.stderr ? ` | stderr: ${e.stderr.slice(-300).replace(/\s+/g, ' ')}` : ''}`);
      if (headersSent) {
        res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: `\n\n[erro ${used}: ${e.message}]` }, 'stop'))}\n\n`);
        res.write('data: [DONE]\n\n'); res.end(); return;
      }
      const status = e.code === 'auth' ? 401 : 503;
      return json(res, status, { error: { message: e.message, type: e.code === 'auth' ? 'authentication_error' : 'server_error', code: e.code || 'cli_failed' } }, { 'X-Session-Resumed': 'false' });
    }

    if (usedKey && out.sessionId) sessions.put(usedKey, { sessionId: out.sessionId, cwd: usedProfile.cwd, sysHash: hash, seen: convoCount(messages) + 1 });
    log(`${used}${used !== model ? ` (fallback de ${model})` : ''} ${live ? 'live' : stream ? 'stream' : 'json'} resumed=${resumed} first_delta_ms=${firstDeltaAt ? firstDeltaAt - t0 : '-'} total_ms=${Date.now() - t0} chars=${out.text.length} deltas=${out.deltas}`);
    // Fora do Claude Code não há .jsonl: o diário é a transcrição desta conversa na máquina.
    if (!MODELS[used] && convId) appendAppTranscript(convId, messages, model, used, out.text);

    if (live) {
      startSse();
      if (!out.deltas) res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: out.text }))}\n\n`);
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, {}, 'stop'))}\n\n`);
      res.write(`data: ${JSON.stringify(usageChunk(id, created, used, out.usage))}\n\n`);
      res.write('data: [DONE]\n\n'); res.end(); return;
    }
    const extra = { 'X-Session-Resumed': resumed ? 'true' : 'false', 'X-Provider': used };
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...extra });
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { role: 'assistant', content: '' }))}\n\n`);
      for (const n of pendingNotes.splice(0)) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, n.from, n.to, n.reason))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: out.text }))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, {}, 'stop'))}\n\n`);
      res.write('data: [DONE]\n\n'); res.end(); return;
    }
    json(res, 200, {
      id, object: 'chat.completion', created, model: used,
      choices: [{ index: 0, message: { role: 'assistant', content: out.text }, finish_reason: 'stop' }],
      usage: usageObj(out.usage),
      ...(pendingNotes.length ? { x_meu_bot: { fallback: pendingNotes[pendingNotes.length - 1] } } : {}),
    }, extra);
  };

  // Lock por conversa+modelo pedido: dois turnos da mesma conversa não correm em paralelo.
  const lockKey = convId ? `${model}:${convId}` : null;
  if (lockKey) return sessions.withLock(lockKey, run);
  return run();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, models: listedModels().map((m) => m.id) });
  if (!authOk(req)) return json(res, 401, { error: { message: 'chave inválida', type: 'authentication_error', code: 'invalid_api_key' } });
  // Status line do app: conta e limites do Claude Code desta máquina. O cache de limites é renovado aqui
  // quando está velho (o claude -p não roda a status line); o motivo de não renovar vai ao log quando muda.
  if (url.pathname === '/v1/meu-bot/status' && req.method === 'GET') {
    refreshRateLimits().then((why) => {
      if (why !== lastLimitsWhy) { lastLimitsWhy = why; if (why !== 'fresh') log(`limites da conta: ${why}`); }
      json(res, 200, { claude: readClaudeStatus(), model: currentModelLabel(), providers: PROVIDERS.map((p) => ({ name: p.name, type: p.type, available: p.available })) });
    });
    return;
  }
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    return json(res, 200, { object: 'list', data: listedModels() });
  }
  // O app se apresenta: qual Mac está usando esta máquina. Novo → aviso à pessoa (WhatsApp/e-mail) e registro.
  if (url.pathname === '/v1/meu-bot/hello' && req.method === 'POST') {
    let m;
    try { m = JSON.parse(await readBody(req, 64 * 1024) || '{}'); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); }
    const ok = m && /^[a-f0-9]{12}$/.test(m.id) && [m.name, m.user, m.platform, m.app].every((v) => typeof v === 'string' && MACHINE_FIELD_RE.test(v))
      && (m.produto === undefined || (typeof m.produto === 'string' && /^meu-bot(-[a-z0-9-]{1,30})?$/.test(m.produto)));
    if (!ok) return json(res, 400, { error: { message: 'máquina inválida', type: 'invalid_request_error' } });
    const r = await announceMachine({ id: m.id, name: m.name, user: m.user, platform: m.platform, app: m.app, produto: m.produto });
    return json(res, 200, r);
  }
  // Licença e devices da conta: o app mostra o próprio painel (plano/status/membro desde) e a tabela de máquinas.
  if (url.pathname === '/v1/meu-bot/license' && req.method === 'GET') return json(res, 200, licenseView());
  // CRM próprio (meu-bot-crm): extensão do Gmail (pelo app), agente (crm.mjs), job do WhatsApp e importador.
  if (url.pathname.startsWith('/v1/crm/') || url.pathname === '/v1/crm') { crmApi().handle(req, res, url).catch((e) => { log(`crm falhou: ${e.stack || e.message}`); if (!res.headersSent) json(res, 500, { error: { message: e.message, type: 'server_error' } }); }); return; }
  if (url.pathname === '/v1/meu-bot/alerts' && req.method === 'GET') return json(res, 200, alertPrefs());
  if (url.pathname === '/v1/meu-bot/alerts' && req.method === 'PUT') {
    let p;
    try { p = JSON.parse(await readBody(req, 16 * 1024) || '{}'); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); }
    const email = typeof p.email === 'string' ? p.email.trim().slice(0, 120) : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: { message: 'e-mail inválido', type: 'invalid_request_error' } });
    writeJson(ALERTS_FILE, { whatsapp: p.whatsapp !== false, email });
    return json(res, 200, { ok: true, ...alertPrefs() });
  }
  // A pessoa excluiu a conversa no app: a transcrição do Claude Code desta máquina vai junto (nos dois perfis),
  // e o mapa esquece a sessão. Mantém o histórico da máquina só com o que ainda existe no app.
  // "Copiar referência" no app: a sessão do Claude Code (o .jsonl nesta máquina) por trás da conversa, por perfil.
  if (url.pathname === '/v1/meu-bot/session' && req.method === 'GET') {
    const convId = url.searchParams.get('conv') || '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(convId)) return json(res, 400, { error: { message: 'conv inválido', type: 'invalid_request_error' } });
    const out = [];
    for (const name of Object.keys(MODELS)) {
      const entry = sessions.get(`${name}:${convId}`);
      if (!entry || !entry.sessionId || !entry.cwd) continue;
      out.push({ profile: name, sessionId: entry.sessionId, cwd: entry.cwd, file: path.join(sessions.projectDir(entry.cwd), `${entry.sessionId}.jsonl`) });
    }
    // Diário (Grok/Hermes): a conversa tem arquivo aqui mesmo sem sessão do Claude Code.
    if (fs.existsSync(appConvFile(convId))) out.push({ profile: 'app', sessionId: convId, cwd: APP_CONVERSAS, file: appConvFile(convId) });
    return json(res, 200, { sessions: out });
  }
  if (url.pathname === '/v1/meu-bot/session' && req.method === 'DELETE') {
    const convId = url.searchParams.get('conv') || '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(convId)) return json(res, 400, { error: { message: 'conv inválido', type: 'invalid_request_error' } });
    let removed = 0;
    for (const name of Object.keys(MODELS)) {
      const key = `${name}:${convId}`;
      const entry = sessions.get(key);
      if (!entry) continue;
      try { fs.unlinkSync(path.join(sessions.projectDir(entry.cwd), `${entry.sessionId}.jsonl`)); removed++; } catch (_) { /* já não havia */ }
      sessions.del(key);
    }
    try { fs.unlinkSync(appConvFile(convId)); removed++; } catch (_) { /* sem diário */ }
    if (removed) log(`conversa ${convId}: ${removed} transcrição(ões) apagada(s) a pedido do app`);
    return json(res, 200, { removed });
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    // Limite de devices: um device "pending" (passou do limite, aguarda o admin) não usa o agente ainda.
    const devId = String(req.headers['x-device-id'] || '');
    if (/^[a-f0-9]{12}$/.test(devId)) {
      const entry = (readJson(MACHINES_FILE, {}) || {})[devId];
      if (entry && licenca.deviceStatus(entry) === 'pending') {
        return json(res, 403, { error: { message: 'device aguardando liberação do admin (limite do plano)', type: 'forbidden', code: 'device_pending' } });
      }
    }
    chatCompletions(req, res).catch((e) => { log(`falha inesperada: ${e.stack || e.message}`); if (!res.headersSent) json(res, 500, { error: { message: e.message, type: 'server_error' } }); else { try { res.end(); } catch (_) {} } });
    return;
  }
  json(res, 404, { error: { message: `rota desconhecida: ${req.method} ${url.pathname}`, type: 'invalid_request_error' } });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;
server.listen(PORT, HOST, () => log(`ouvindo em http://${HOST}:${PORT} modelos=${listedModels().map((m) => m.id).join(',')} fallback=${PROVIDERS.map((p) => `${p.name}${p.available ? '' : '(indisponível)'}`).join('→')} claude=${CLAUDE_BIN} workspace=${WORKSPACE} auth=${KEY ? 'bearer' : 'DESLIGADA'}`));

process.on('SIGTERM', () => { log('SIGTERM; encerrando'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
