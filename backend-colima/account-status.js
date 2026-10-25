/**
 * account-status.js — estado da conta do Claude Code nesta máquina, para a status line do meu-bot.
 *
 * Lê o que o statusline.sh do Claude Code já deixa em ~/.cache/claude-statusline/:
 *  - profile.json    {email, assento}              (perfil OAuth, cache de 10 min)
 *  - ratelimits.json {session_pct, weekly_pct, session_resets, weekly_resets, updated}
 * A status line só roda num Claude Code interativo; o `claude -p` do backend não a executa. Por isso o
 * backend renova ratelimits.json ele mesmo (refreshRateLimits: GET /api/oauth/usage com o token OAuth do
 * Claude Code desta máquina) quando o cache está velho, e `updated` vai junto para o app mostrar a idade.
 * Sem cache → null nos campos. Mesmo arquivo em backend-colima/ e backend-vm/services/ (copiar, não
 * editar só um).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/**
 * Serviço no Keychain do macOS onde o Claude Code guarda o login. Sem CLAUDE_CONFIG_DIR é "Claude Code-credentials";
 * com uma pasta de config isolada (contas-claude.js), a CLI (2.1.x) acrescenta "-" + os 8 primeiros hex do sha256
 * do caminho normalizado em NFC, então cada conta tem a própria entrada.
 */
function servicoKeychain(configDir = null) {
  if (!configDir) return 'Claude Code-credentials';
  return `Claude Code-credentials-${crypto.createHash('sha256').update(String(configDir).normalize('NFC')).digest('hex').slice(0, 8)}`;
}
/** Onde fica o cache de limites de uma pasta de config isolada (a padrão usa ~/.cache/claude-statusline/). */
const cacheLimitesDe = (home, configDir) => (configDir ? path.join(configDir, '.cache-meu-bot', 'ratelimits.json') : path.join(home, '.cache', 'claude-statusline', 'ratelimits.json'));
/** Idade máxima do ratelimits.json antes de o backend renovar (o app consulta a cada resposta e ao abrir). */
const RATELIMITS_MAX_AGE_S = 60;

// Number(null) e Number('') são 0: um limite ausente virava "Sessão: 0% · now" no app. Ausente é null.
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** Segmentos da status line (ligar/desligar no meu-bot); a mesma lista do statusline.sh e do rodapé do app. */
const SEGMENT_KEYS = ['model', 'ctx', 'account', 'session', 'weekly'];
/** ~/.claude/statusline-segments.json validado (cada chave vale true salvo `false` explícito); null sem arquivo. */
function readSegments(home = os.homedir()) {
  const raw = readJson(path.join(home, '.claude', 'statusline-segments.json'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of SEGMENT_KEYS) out[k] = raw[k] !== false;
  return out;
}

/**
 * {email, assento, sessionPct, weeklyPct, sessionResets, weeklyResets, updated, segments} com null onde não há dado.
 * Com `configDir` (conta isolada) os limites vêm do cache daquela pasta e o e-mail do oauthAccount dela; o perfil
 * (assento) só existe para a padrão, que o statusline.sh alimenta.
 */
function readClaudeStatus(home = os.homedir(), configDir = null) {
  const dir = path.join(home, '.cache', 'claude-statusline');
  const profile = configDir ? {} : readJson(path.join(dir, 'profile.json')) || {};
  const limits = readJson(cacheLimitesDe(home, configDir)) || {};
  const oauth = configDir ? (readJson(path.join(configDir, '.claude.json')) || {}).oauthAccount : null;
  const emailConta = oauth && typeof oauth.emailAddress === 'string' && oauth.emailAddress ? oauth.emailAddress : null;
  return {
    email: emailConta || (typeof profile.email === 'string' && profile.email ? profile.email : null),
    assento: typeof profile.assento === 'string' && profile.assento ? profile.assento : null,
    sessionPct: num(limits.session_pct),
    weeklyPct: num(limits.weekly_pct),
    /** Epoch em segundos. */
    sessionResets: num(limits.session_resets),
    weeklyResets: num(limits.weekly_resets),
    updated: num(limits.updated),
    segments: readSegments(home),
  };
}

/**
 * Token OAuth do Claude Code: <config>/.credentials.json (Linux) ou o Keychain (macOS). null sem login ou vencido.
 * `configDir` = pasta de uma conta isolada (CLAUDE_CONFIG_DIR); sem ela, ~/.claude e o serviço padrão do Keychain.
 */
function readAccessToken(home = os.homedir(), now = Date.now(), keychain = process.platform === 'darwin', configDir = null) {
  let creds = readJson(path.join(configDir || path.join(home, '.claude'), '.credentials.json'));
  if (!creds && keychain) {
    const servico = servicoKeychain(configDir);
    const ler = (args) => JSON.parse(execFileSync('security', ['find-generic-password', ...args, '-s', servico, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    // A CLI grava com -a <usuário>; primeiro a entrada deste usuário, depois qualquer uma do serviço.
    let usuario = ''; try { usuario = os.userInfo().username; } catch (_) { /* sem nome */ }
    try { creds = usuario ? ler(['-a', usuario]) : ler([]); } catch (_) { try { creds = ler([]); } catch (_2) { creds = null; } }
  }
  const o = creds && typeof creds === 'object' ? creds.claudeAiOauth : null;
  if (!o || typeof o.accessToken !== 'string' || o.accessToken === '') return null;
  const exp = num(o.expiresAt);
  if (exp !== null && exp <= now) return null;
  return o.accessToken;
}

const toEpoch = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
const pct = (v) => { const n = num(v); return n === null ? null : Math.round(n); };

const inflight = new Map(); // arquivo de cache → Promise em andamento
/**
 * Renova o cache de limites (ratelimits.json) pela API de uso da conta quando ele tem mais de `maxAgeS` segundos
 * (ou não existe). Mesmo formato que o statusline.sh grava, então a barra do terminal e o rodapé do app leem a
 * mesma coisa. Com `configDir` (conta isolada) o token e o cache são os daquela pasta. Devolve o que aconteceu
 * ('fresh' | 'updated' | motivo de não renovar); nunca lança e nunca apaga um cache existente por causa de uma falha.
 */
async function refreshRateLimits({ home = os.homedir(), maxAgeS = RATELIMITS_MAX_AGE_S, fetchImpl = globalThis.fetch, now = Date.now(), keychain = process.platform === 'darwin', configDir = null } = {}) {
  const file = cacheLimitesDe(home, configDir);
  const dir = path.dirname(file);
  const cur = readJson(file);
  const updated = cur ? num(cur.updated) : null;
  if (updated !== null && now / 1000 - updated < maxAgeS) return 'fresh';
  const token = readAccessToken(home, now, keychain, configDir);
  if (token === null) return 'no-token';
  if (typeof fetchImpl !== 'function') return 'no-fetch';
  if (inflight.has(file)) return inflight.get(file);
  const p = (async () => {
    try {
      const r = await fetchImpl(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return `http-${r.status}`;
      const u = await r.json();
      const fh = u && typeof u === 'object' ? u.five_hour : null;
      const sd = u && typeof u === 'object' ? u.seven_day : null;
      if (!fh && !sd) return 'no-limits';
      const out = {
        session_pct: pct(fh && fh.utilization), session_resets: toEpoch(fh && fh.resets_at),
        weekly_pct: pct(sd && sd.utilization), weekly_resets: toEpoch(sd && sd.resets_at),
        updated: Math.floor(now / 1000),
      };
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
      return 'updated';
    } catch (e) {
      return `error:${e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || String(e)}`;
    } finally { inflight.delete(file); }
  })();
  inflight.set(file, p);
  return p;
}

module.exports = { readClaudeStatus, readSegments, refreshRateLimits, readAccessToken, servicoKeychain, SEGMENT_KEYS, RATELIMITS_MAX_AGE_S };
