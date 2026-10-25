/**
 * contas-claude.js — várias contas do Claude Code na mesma máquina, com rodízio automático no limite de uso.
 *
 * Cada conta isolada é uma pasta (CLAUDE_CONFIG_DIR) em ~/.local/share/meu-bot/contas-claude/<id>/home com o
 * próprio login; o histórico (projects/ e companhia) é compartilhado por symlink com ~/.claude, então o
 * `claude -p --resume <sessão>` acha a conversa em qualquer conta. A conta "padrao" (home null) é o login normal
 * de ~/.claude e sempre existe, por último na ordem.
 *
 * Registro em ~/.local/share/meu-bot/contas-claude.json (contas + limiares) e contas-claude-uso.json (uso por
 * conta). Estados gravados: ok | esgotada | bloqueada | desconhecida. "aviso" nunca é gravado: é derivado na
 * leitura (pct acima do limiar com reset no futuro). `esgotada` expira sozinha em `ate` + 60 s. Tempos em epoch
 * segundos, como o account-status.js. Sem dependências npm. Mesmo arquivo em backend-colima/ e
 * backend-vm/services/ (copiar, não editar só um).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const accountStatus = require('./account-status');

const LIMIARES_PADRAO = { sessao: 90, semanal: 95, estrategia: 'ordem' };
const ESTRATEGIAS = ['ordem', 'folga'];
const ESTADOS = ['ok', 'esgotada', 'bloqueada', 'desconhecida'];
const ID_RE = /^(padrao|c-[a-f0-9]{8})$/;
/** Pastas de ~/.claude que toda conta compartilha (histórico, tarefas, skills…). `sessions/` NÃO: é o registro de processos vivos de cada pasta. */
const DIRS_COMPARTILHADOS = ['projects', 'todos', 'file-history', 'shell-snapshots', 'session-env', 'plans', 'tasks', 'transcripts', 'paste-cache', 'commands', 'agents', 'skills', 'plugins', 'output-styles'];
/** Dessas, as que são criadas em ~/.claude se faltarem (o link precisa existir desde a 1ª conta). */
const DIRS_CRIAR = ['projects', 'todos', 'file-history', 'plans', 'tasks', 'transcripts'];
/** Tempo padrão fora de rotação quando o limite não diz quando volta. */
const ESGOTADA_PADRAO_S = 60 * 60;
const MAX_CONTAS = 12;

const agoraS = () => Math.floor(Date.now() / 1000);
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const readJson = (f) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const existe = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

/** Janela de uso saneada: {pct 0..100, resets epoch s | null} ou null sem pct. */
function janela(j) {
  if (!j || typeof j !== 'object') return null;
  const pct = num(j.pct);
  if (pct === null) return null;
  const resets = num(j.resets);
  return { pct: Math.max(0, Math.min(100, Math.round(pct))), resets: resets !== null && resets > 0 ? Math.floor(resets) : null };
}

/**
 * Evento do stream-json com limite de uso: o Claude Code manda objetos com `rateLimitType` (five_hour, seven_day,
 * seven_day_opus…), `status` (allowed | allowed_warning | rejected), `utilization` (0..1 ou 0..100) e `resetsAt`
 * (epoch s ou ms). Procura em qualquer nível raso do evento. Devolve null se não há nada; senão
 * {janelas: {sessao?, semanal?}, rejeitado, resets, tipo}. Só five_hour e seven_day viram pct; os demais tipos
 * (por modelo) só contam para `rejeitado`.
 */
function analisarRateLimit(ev) {
  const alvo = acharRateLimit(ev, 0);
  if (alvo === null) return null;
  const tipo = String(alvo.rateLimitType);
  const u = num(alvo.utilization);
  const pct = u === null ? null : u <= 1 ? Math.round(u * 100) : Math.round(u);
  const r = num(alvo.resetsAt);
  const resets = r === null ? null : r > 1e12 ? Math.floor(r / 1000) : Math.floor(r);
  const janelas = {};
  if (pct !== null) {
    if (tipo === 'five_hour') janelas.sessao = { pct, resets };
    else if (tipo === 'seven_day') janelas.semanal = { pct, resets };
  }
  return { janelas, rejeitado: alvo.status === 'rejected', resets, tipo };
}
function acharRateLimit(v, prof) {
  if (!v || typeof v !== 'object' || prof > 4) return null;
  if (typeof v.rateLimitType === 'string') return v;
  for (const k of Object.keys(v)) { const r = acharRateLimit(v[k], prof + 1); if (r !== null) return r; }
  return null;
}

/** Nome do serviço no Keychain do macOS para uma pasta de config (o mesmo que account-status.js usa). */
const servicoKeychain = accountStatus.servicoKeychain;

/**
 * Abre o registro desta máquina. Tudo injetável para teste: base (pasta do meu-bot), claudeHome (~/.claude),
 * claudeJson (~/.claude.json), agora() em epoch s, temCredencial(configDir) (Keychain/credentials.json).
 */
function abrir(opts = {}) {
  const base = opts.base || path.join(os.homedir(), '.local', 'share', 'meu-bot');
  const claudeHome = opts.claudeHome || path.join(os.homedir(), '.claude');
  const claudeJson = opts.claudeJson || path.join(os.homedir(), '.claude.json');
  const agora = typeof opts.agora === 'function' ? opts.agora : agoraS;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const temCredencial = typeof opts.temCredencial === 'function' ? opts.temCredencial : (configDir) => accountStatus.readAccessToken(os.homedir(), agora() * 1000, process.platform === 'darwin', configDir) !== null;
  const REGISTRO = path.join(base, 'contas-claude.json');
  const USO = path.join(base, 'contas-claude-uso.json');
  const PASTA = path.join(base, 'contas-claude');

  let reg = null; // { contas: [...], limiares }
  let uso = null; // { [id]: {sessao, semanal, estado, motivo, ate, vistoEm} }

  function carregar() {
    if (reg !== null) return;
    const raw = readJson(REGISTRO) || {};
    const contas = Array.isArray(raw.contas) ? raw.contas.map(sanearConta).filter(Boolean) : [];
    if (!contas.some((c) => c.id === 'padrao')) contas.push({ id: 'padrao', rotulo: 'Login padrão', home: null, ordem: 1000, ativa: true, criadaEm: agora(), email: null });
    reg = { contas, limiares: sanearLimiares(raw.limiares) };
    const u = readJson(USO) || {};
    uso = {};
    for (const [id, v] of Object.entries(u)) if (ID_RE.test(id) && contas.some((c) => c.id === id)) uso[id] = sanearUso(v);
  }
  function sanearConta(c) {
    if (!c || typeof c !== 'object' || !ID_RE.test(String(c.id))) return null;
    const home = typeof c.home === 'string' && c.home !== '' ? c.home : null;
    if ((c.id === 'padrao') !== (home === null)) return null;
    return { id: c.id, rotulo: String(c.rotulo || c.id).slice(0, 60), home, ordem: num(c.ordem) ?? 100, ativa: c.ativa !== false, criadaEm: num(c.criadaEm) ?? agora(), email: typeof c.email === 'string' && c.email !== '' ? c.email : null };
  }
  function sanearLimiares(l) {
    const t = l && typeof l === 'object' ? l : {};
    const clamp = (v, d) => { const n = num(v); return n === null ? d : Math.max(50, Math.min(100, Math.round(n))); };
    return { sessao: clamp(t.sessao, LIMIARES_PADRAO.sessao), semanal: clamp(t.semanal, LIMIARES_PADRAO.semanal), estrategia: ESTRATEGIAS.includes(t.estrategia) ? t.estrategia : LIMIARES_PADRAO.estrategia };
  }
  function sanearUso(v) {
    const u = v && typeof v === 'object' ? v : {};
    const out = { estado: ESTADOS.includes(u.estado) ? u.estado : 'desconhecida' };
    const s = janela(u.sessao); if (s) out.sessao = s;
    const w = janela(u.semanal); if (w) out.semanal = w;
    if (typeof u.motivo === 'string' && u.motivo !== '') out.motivo = u.motivo.slice(0, 200);
    const ate = num(u.ate); if (ate !== null && ate > 0) out.ate = Math.floor(ate);
    const visto = num(u.vistoEm); if (visto !== null && visto > 0) out.vistoEm = Math.floor(visto);
    return out;
  }
  const salvarReg = () => writeJson(REGISTRO, { versao: 1, limiares: reg.limiares, contas: reg.contas });
  const salvarUso = () => writeJson(USO, uso);

  const conta = (id) => { carregar(); return reg.contas.find((c) => c.id === id) || null; };
  const configDir = (c) => (c && c.home ? c.home : null);

  /** Logada: padrão → ~/.claude.json tem oauthAccount; isolada → <home>/.claude.json tem oauthAccount, ou há credencial (arquivo/Keychain). */
  function logada(c) {
    if (!c) return false;
    if (c.home === null) { const j = readJson(claudeJson); return !!(j && j.oauthAccount); }
    const j = readJson(path.join(c.home, '.claude.json'));
    if (j && j.oauthAccount) return true;
    if (existe(path.join(c.home, '.credentials.json'))) return true;
    try { return temCredencial(c.home); } catch (_) { return false; }
  }
  /** E-mail do login (oauthAccount.emailAddress) na pasta da conta; null sem login. */
  function emailDe(c) {
    const j = readJson(c.home === null ? claudeJson : path.join(c.home, '.claude.json'));
    const e = j && j.oauthAccount && typeof j.oauthAccount.emailAddress === 'string' ? j.oauthAccount.emailAddress : '';
    return /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
  }

  /** Variáveis de ambiente para o `claude` desta conta: a pasta isolada e nada de API key herdada. {} para a padrão. */
  function ambiente(c) {
    if (!c || c.home === null) return {};
    return { CLAUDE_CONFIG_DIR: c.home, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '' };
  }

  const menorReset = (u) => [u.sessao && u.sessao.resets, u.semanal && u.semanal.resets].filter((x) => typeof x === 'number' && x > 0).sort((a, b) => a - b)[0] ?? null;

  /** Estado efetivo agora: aplica a expiração de `esgotada` e deriva `aviso` dos limiares. */
  function usoEfetivo(id, t = agora()) {
    carregar();
    const u = uso[id] || { estado: 'desconhecida' };
    if (u.estado === 'esgotada' && typeof u.ate === 'number' && u.ate + 60 < t) {
      const { ate, motivo, ...resto } = u; return { ...resto, estado: 'desconhecida' };
    }
    const acima = (j, lim) => !!j && j.pct >= lim && (j.resets === null || j.resets === undefined || j.resets > t);
    if (u.estado === 'ok' || u.estado === 'desconhecida') {
      if (acima(u.sessao, reg.limiares.sessao) || acima(u.semanal, reg.limiares.semanal)) return { ...u, estado: 'aviso', ate: menorReset(u) };
    }
    return u;
  }

  /**
   * Relato de uso fresco (evento do stream ou API). Atualiza as janelas; o estado vira `ok`, salvo `esgotada` com
   * `ate` no futuro (o limite já foi visto; um relato atrasado de outra conversa não ressuscita a conta antes da
   * hora) e `bloqueada` por motivo que não é login (conta suspensa/cobrança).
   */
  function registrarUso(id, janelas) {
    carregar();
    if (!conta(id)) return null;
    const u = uso[id] || { estado: 'desconhecida' };
    const t = agora();
    const s = janela(janelas && janelas.sessao); if (s) u.sessao = s;
    const w = janela(janelas && janelas.semanal); if (w) u.semanal = w;
    u.vistoEm = t;
    const presa = (u.estado === 'esgotada' && typeof u.ate === 'number' && u.ate + 60 >= t) || (u.estado === 'bloqueada' && !/login/i.test(u.motivo || ''));
    if (!presa) { u.estado = 'ok'; delete u.ate; delete u.motivo; }
    uso[id] = u; salvarUso();
    return usoEfetivo(id);
  }

  /** Marca a conta fora de rotação: `esgotada` até `ate` (padrão +60 min) ou `bloqueada` (sem prazo). */
  function marcar(id, estado, motivo, ate) {
    carregar();
    if (!conta(id) || (estado !== 'esgotada' && estado !== 'bloqueada')) return null;
    const u = uso[id] || {};
    u.estado = estado; u.motivo = String(motivo || '').slice(0, 200); u.vistoEm = agora();
    if (estado === 'esgotada') { const a = num(ate); u.ate = a !== null && a > agora() ? Math.floor(a) : agora() + ESGOTADA_PADRAO_S; } else delete u.ate;
    uso[id] = u; salvarUso();
    log(`conta ${id} ${estado}${u.ate ? ` até ${new Date(u.ate * 1000).toISOString()}` : ''}: ${u.motivo}`);
    return usoEfetivo(id);
  }
  /** "Usar agora": a pessoa sabe que a conta voltou (o limite visto era engano ou resetou antes). Só sai de `esgotada`. */
  function usarAgora(id) {
    carregar();
    const u = uso[id];
    if (!u || u.estado !== 'esgotada') return usoEfetivo(id);
    u.estado = 'desconhecida'; delete u.ate; delete u.motivo; salvarUso();
    return usoEfetivo(id);
  }
  function desbloquear(id) {
    carregar();
    const u = uso[id];
    if (!u || u.estado !== 'bloqueada') return usoEfetivo(id);
    u.estado = 'desconhecida'; delete u.motivo; salvarUso();
    return usoEfetivo(id);
  }

  /** Ordem de preferência: `ordem` (a posição que a pessoa definiu) ou `folga` (quem tem mais cota sobrando); empate pela ordem. */
  function ordenar(lista, estrategia = reg.limiares.estrategia) {
    const t = agora();
    const pctDe = (j) => (!j ? -1 : j.resets !== null && j.resets !== undefined && j.resets <= t ? 0 : j.pct);
    const usado = (c) => { const u = uso[c.id] || {}; return Math.max(pctDe(u.sessao), pctDe(u.semanal)); };
    return [...lista].sort((a, b) => {
      if (estrategia === 'folga') {
        const ua = usado(a); const ub = usado(b);
        if (ua !== ub) { if (ua < 0) return 1; if (ub < 0) return -1; return ua - ub; }
      }
      return a.ordem - b.ordem || a.id.localeCompare(b.id);
    });
  }

  /** A melhor conta disponível: ativa, logada, fora de `excluir`, `ok|desconhecida` primeiro; `aviso` só com permitirAviso. Nunca esgotada/bloqueada. */
  function escolher({ excluir = [], permitirAviso = false } = {}) {
    carregar();
    const candidatas = ordenar(reg.contas.filter((c) => c.ativa && !excluir.includes(c.id) && logada(c)));
    const est = (c) => usoEfetivo(c.id).estado;
    return candidatas.find((c) => est(c) === 'ok' || est(c) === 'desconhecida') || (permitirAviso ? candidatas.find((c) => est(c) === 'aviso') : undefined) || null;
  }
  /** Menor `ate` entre as contas ativas e logadas esgotadas (epoch s); null se nenhuma volta sozinha. */
  function proximaDisponivelEm() {
    carregar();
    const ts = reg.contas.filter((c) => c.ativa && logada(c)).map((c) => usoEfetivo(c.id)).filter((u) => u.estado === 'esgotada' && typeof u.ate === 'number').map((u) => u.ate);
    return ts.length ? Math.min(...ts) : null;
  }

  /** Cria a pasta da conta com o histórico compartilhado (symlinks), settings copiados e .claude.json sem o login. */
  function provisionar(home) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    for (const d of DIRS_COMPARTILHADOS) {
      const alvo = path.join(claudeHome, d); const link = path.join(home, d);
      if (existe(link)) continue;
      if (DIRS_CRIAR.includes(d)) fs.mkdirSync(alvo, { recursive: true });
      if (!existe(alvo)) continue;
      try { fs.symlinkSync(alvo, link, 'dir'); } catch (e) { log(`conta: sem link ${d} (${e.message}); a conta fica com histórico próprio`); }
    }
    const settings = path.join(claudeHome, 'settings.json');
    if (existe(settings) && !existe(path.join(home, 'settings.json'))) { try { fs.copyFileSync(settings, path.join(home, 'settings.json')); } catch (_) { /* opcional */ } }
    const md = path.join(claudeHome, 'CLAUDE.md');
    if (existe(md) && !existe(path.join(home, 'CLAUDE.md'))) { try { fs.writeFileSync(path.join(home, 'CLAUDE.md'), `@${md}\n`, { mode: 0o600 }); } catch (_) { /* opcional */ } }
    const destino = path.join(home, '.claude.json');
    const atual = readJson(destino) || {};
    const padrao = readJson(claudeJson) || {};
    const mesclado = { ...padrao, ...atual, projects: { ...(padrao.projects && typeof padrao.projects === 'object' ? padrao.projects : {}), ...(atual.projects && typeof atual.projects === 'object' ? atual.projects : {}) }, hasCompletedOnboarding: true };
    if (!atual.oauthAccount) delete mesclado.oauthAccount;
    for (const k of ['userID', 'cachedGrowthBookFeatures', 'cachedStatsigGates', 's1mAccessCache', 'claudeCodeFirstTokenDate']) delete mesclado[k];
    try { writeJson(destino, mesclado); } catch (_) { try { writeJson(destino, { hasCompletedOnboarding: true }); } catch (_2) { /* sem .claude.json: o CLI cria */ } }
  }

  function criar(rotulo) {
    carregar();
    if (reg.contas.length >= MAX_CONTAS) throw new Error(`no máximo ${MAX_CONTAS} contas por máquina`);
    const id = `c-${crypto.randomBytes(4).toString('hex')}`;
    const home = path.join(PASTA, id, 'home');
    provisionar(home);
    const ordem = reg.contas.filter((c) => c.id !== 'padrao').reduce((m, c) => Math.max(m, c.ordem), 0) + 1;
    const nome = String(rotulo || '').trim().slice(0, 60) || `Claude · conta ${ordem}`;
    const c = { id, rotulo: nome, home, ordem, ativa: true, criadaEm: agora(), email: null };
    reg.contas.push(c); salvarReg();
    log(`conta ${id} criada (${nome}) em ${home}`);
    return c;
  }

  function atualizar(id, patch) {
    carregar();
    const c = conta(id);
    if (!c) return null;
    const p = patch && typeof patch === 'object' ? patch : {};
    if (typeof p.rotulo === 'string' && p.rotulo.trim() !== '') {
      const nome = p.rotulo.trim().slice(0, 60);
      if (reg.contas.some((o) => o.id !== id && o.rotulo.toLowerCase() === nome.toLowerCase())) throw new Error('já existe uma conta com esse nome');
      c.rotulo = nome;
    }
    if (typeof p.ativa === 'boolean') c.ativa = p.ativa;
    if (num(p.ordem) !== null && id !== 'padrao') c.ordem = Math.max(1, Math.round(num(p.ordem)));
    salvarReg();
    return c;
  }
  /** Reordena as contas isoladas na sequência dada (ids); a padrão fica sempre por último. */
  function reordenar(ids) {
    carregar();
    if (!Array.isArray(ids)) return;
    let n = 1;
    for (const id of ids) { const c = conta(String(id)); if (c && c.id !== 'padrao') c.ordem = n++; }
    salvarReg();
  }

  /** Remove a conta e a pasta dela. Desfaz os symlinks antes do rm: o histórico real (em ~/.claude) nunca é apagado. */
  function remover(id) {
    carregar();
    const c = conta(id);
    if (!c) return false;
    if (c.id === 'padrao') throw new Error('a conta padrão não pode ser removida');
    const home = path.resolve(c.home);
    const raiz = path.resolve(PASTA) + path.sep;
    if (!home.startsWith(raiz)) throw new Error(`pasta da conta fora de ${PASTA}; não removo`);
    if (existe(home)) {
      for (const nome of fs.readdirSync(home)) { const p = path.join(home, nome); if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); }
      for (const d of DIRS_COMPARTILHADOS) { const p = path.join(home, d); if (existe(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error(`link ${d} ainda existe; não removo a pasta`); }
      fs.rmSync(path.dirname(home), { recursive: true, force: true });
    }
    reg.contas = reg.contas.filter((o) => o.id !== id); delete uso[id];
    salvarReg(); salvarUso();
    log(`conta ${id} removida`);
    return true;
  }

  /** Relê login e e-mail da conta (depois de um `claude auth login`); devolve a vista dela. */
  function conferir(id) {
    carregar();
    const c = conta(id);
    if (!c) return null;
    const email = emailDe(c);
    if (email !== c.email) { c.email = email; salvarReg(); }
    if (logada(c)) desbloquear(id);
    return vista(c);
  }

  function limiares() { carregar(); return { ...reg.limiares }; }
  function definirLimiares(t) { carregar(); reg.limiares = sanearLimiares({ ...reg.limiares, ...(t && typeof t === 'object' ? t : {}) }); salvarReg(); return { ...reg.limiares }; }

  /** Como o app vê uma conta. */
  function vista(c) {
    const u = usoEfetivo(c.id);
    return { id: c.id, rotulo: c.rotulo, email: c.email, padrao: c.home === null, home: c.home, ordem: c.ordem, ativa: c.ativa, logada: logada(c), uso: { sessao: u.sessao || null, semanal: u.semanal || null, estado: u.estado, motivo: u.motivo || null, ate: u.ate || null, vistoEm: u.vistoEm || null } };
  }
  function listar() {
    carregar();
    const atual = escolher({ permitirAviso: true });
    return { contas: ordenar(reg.contas, 'ordem').map(vista), limiares: { ...reg.limiares }, atual: atual ? atual.id : null, proximaEm: atual ? null : proximaDisponivelEm() };
  }
  /** Resumo para o /status: a conta em uso e quantas há. */
  function resumo(idAtual) {
    carregar();
    const c = conta(idAtual) || escolher({ permitirAviso: true });
    const esgotadas = reg.contas.filter((o) => o.ativa && ['esgotada', 'bloqueada'].includes(usoEfetivo(o.id).estado)).length;
    return { atual: c ? c.id : null, rotulo: c ? c.rotulo : null, total: reg.contas.length, esgotadas, proximaEm: c ? null : proximaDisponivelEm() };
  }

  return { conta, configDir, logada, emailDe, ambiente, usoEfetivo, registrarUso, marcar, usarAgora, desbloquear, escolher, proximaDisponivelEm, criar, atualizar, reordenar, remover, conferir, limiares, definirLimiares, listar, vista, resumo, provisionar, PASTA, REGISTRO, USO };
}

module.exports = { abrir, analisarRateLimit, servicoKeychain, LIMIARES_PADRAO, ESTRATEGIAS, DIRS_COMPARTILHADOS, ESGOTADA_PADRAO_S };
