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
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sessions = require('./session-map');
const providers = require('./providers');
const { readClaudeStatus } = require('./account-status');

const ROOT = __dirname;
const ENV = loadEnv(path.join(ROOT, '.env'));
const KEY = ENV.OPENAI_COMPAT_KEY || process.env.OPENAI_COMPAT_KEY || '';
const HOST = ENV.HOST || '127.0.0.1';
const PORT = Number(ENV.PORT || 8080);
const CLAUDE_BIN = ENV.CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');
const WORKSPACE = ENV.WORKSPACE || path.join(os.homedir(), 'chat-workspace');
const TURN_TIMEOUT_MS = Number(ENV.TURN_TIMEOUT_MS || 10 * 60 * 1000);

const AGENT_WORKSPACE = ENV.AGENT_WORKSPACE || path.join(os.homedir(), 'agent-workspace');
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
function runClaude({ prompt, system, cwd, maxTurns, bypass, resume, signal, onDelta }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-turns', String(maxTurns)];
    args.push(...(bypass ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'default']));
    if (system) args.push('--append-system-prompt', system);
    if (resume) args.push('--resume', resume);
    fs.mkdirSync(cwd, { recursive: true });
    const child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, HOME: os.homedir() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; let deltas = 0; let usage = null; let sessionId = resume || null; let stderr = '';
    let resultText = null; let finished = false; let blockOpen = false; let sawTextBlock = false;
    const timer = setTimeout(() => { fail('timeout', `CLI excedeu ${TURN_TIMEOUT_MS} ms`); }, TURN_TIMEOUT_MS);
    const onAbort = () => fail('aborted', 'cliente fechou a conexão');
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    function fail(code, msg) {
      if (finished) return; finished = true; clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 3000).unref();
      const e = new Error(msg); e.code = code; e.stderr = stderr.slice(-2000); reject(e);
    }
    function emit(t) { if (!t) return; text += t; deltas++; if (onDelta) onDelta(t); }

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
    child.stdin.end(prompt);

    function handle(ev) {
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
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
        if (ev.is_error && !text) { fail(looksLikeResumeFailure(ev, stderr) ? 'resume_failed' : 'cli_failed', resultText || ev.subtype || 'erro da CLI'); }
      }
    }

    child.on('error', (e) => fail('cli_failed', `não consegui iniciar a CLI: ${e.message}`));
    child.on('close', (code) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!deltas && resultText) { text = resultText; }
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

  const convRaw = req.headers['x-conversation-id'];
  const convId = typeof convRaw === 'string' && CONV_ID_RE.test(convRaw) ? convRaw : null;
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

    /** Um provedor claude: planeja resume pela chave dele e refaz sem resume se a sessão sumiu. */
    const runClaudeProvider = async (name) => {
      const profile = MODELS[name];
      const key = convId ? `${name}:${convId}` : null;
      let plan = planPrompt({ messages, convId, seenHdr: req.headers['x-conversation-seen'], key, cwd: profile.cwd, hash });
      resumed = Boolean(plan.resume);
      let out;
      try {
        out = await runClaude({ ...plan, cwd: profile.cwd, maxTurns: profile.maxTurns, bypass: profile.bypass, signal: abort.signal, onDelta });
      } catch (e) {
        if (e.code === 'resume_failed' && plan.resume && !headersSent) {
          log(`resume falhou para ${key}; refazendo sem resume`);
          if (key) sessions.del(key);
          plan = { ...flatten(messages), resume: null }; resumed = false;
          out = await runClaude({ ...plan, cwd: profile.cwd, maxTurns: profile.maxTurns, bypass: profile.bypass, signal: abort.signal, onDelta });
        } else throw e;
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, models: listedModels().map((m) => m.id) });
  if (!authOk(req)) return json(res, 401, { error: { message: 'chave inválida', type: 'authentication_error', code: 'invalid_api_key' } });
  // Status line do app: conta e limites do Claude Code desta máquina (cache do statusline.sh).
  if (url.pathname === '/v1/meu-bot/status' && req.method === 'GET') return json(res, 200, { claude: readClaudeStatus(), providers: PROVIDERS.map((p) => ({ name: p.name, type: p.type, available: p.available })) });
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    return json(res, 200, { object: 'list', data: listedModels() });
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
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
