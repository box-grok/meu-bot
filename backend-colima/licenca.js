/**
 * licenca.js — dono do formato da licença do meu-bot (plano, status, validade, limite de devices).
 *
 * Puro, sem IO: o server.js lê/grava o arquivo (~/.local/share/meu-bot/licenca.json) e o admin grava por SSH.
 * A licença é da conta (a máquina da pessoa); os devices vivem no maquinas.json, cada um com status
 * "active" | "pending". O 1º device cabe sempre; acima do deviceLimit o device entra "pending" (a pessoa
 * "levanta a mão" e o admin libera subindo o limite ou aprovando o device). Mesmo esquema do src/main/licenca.ts
 * (o admin valida lá o que lê por SSH); são lados diferentes do mesmo contrato — mudar os dois juntos.
 */
'use strict';

// 'personalizado' (sob consulta) libera tudo do pro e os produtos por assinatura (meu-bot-crm).
const PLANS = ['free', 'pro', 'personalizado'];
const STATUSES = ['free', 'trialing', 'active', 'expired'];
const INTERVALS = ['month', 'year'];
const DEVICE_STATUSES = ['active', 'pending'];
/** Produtos contratados por cima do plano (acumulativos): meu-bot-crm, meu-bot-fit… O meu-bot em si não entra. */
const PRODUTO_NOME_RE = /^meu-bot-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const parseProdutos = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && PRODUTO_NOME_RE.test(x) && x !== 'meu-bot-admin'))].sort() : []);

const isIso = (v) => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
const nowIso = (now = Date.now()) => new Date(now).toISOString();

/** Licença de uma conta que ainda não foi configurada: plano grátis, um device. */
function defaultLicense(now = Date.now()) {
  const at = nowIso(now);
  return {
    plan: 'free',
    status: 'free',
    interval: null,
    memberSince: at,
    trialEnd: null,
    expiresAt: null,
    deviceLimit: 1,
    produtos: [],
    updatedAt: at,
    updatedBy: 'system',
  };
}

/**
 * Normaliza o que veio do arquivo (ou do admin): cada campo inválido/ausente cai no default, preservando
 * `memberSince` quando já existe. Nunca lança; o que entra é dado, não comando.
 */
function parseLicense(raw, now = Date.now()) {
  const base = defaultLicense(now);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw;
  const plan = PLANS.includes(o.plan) ? o.plan : base.plan;
  const status = STATUSES.includes(o.status) ? o.status : base.status;
  const interval = INTERVALS.includes(o.interval) ? o.interval : null;
  const memberSince = isIso(o.memberSince) ? o.memberSince : base.memberSince;
  const trialEnd = isIso(o.trialEnd) ? o.trialEnd : null;
  const expiresAt = isIso(o.expiresAt) ? o.expiresAt : null;
  const deviceLimit = Number.isInteger(o.deviceLimit) && o.deviceLimit >= 1 && o.deviceLimit <= 100 ? o.deviceLimit : base.deviceLimit;
  const updatedAt = isIso(o.updatedAt) ? o.updatedAt : base.updatedAt;
  const updatedBy = o.updatedBy === 'admin' || o.updatedBy === 'system' ? o.updatedBy : base.updatedBy;
  const produtos = parseProdutos(o.produtos);
  return { plan, status, interval, memberSince, trialEnd, expiresAt, deviceLimit, produtos, updatedAt, updatedBy };
}

/** Aplica uma mudança do admin (só campos válidos) e carimba updatedAt/updatedBy=admin. */
function applyLicensePatch(current, patch, now = Date.now()) {
  const lic = parseLicense(current, now);
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = { ...lic };
  if (PLANS.includes(p.plan)) next.plan = p.plan;
  if (STATUSES.includes(p.status)) next.status = p.status;
  if (p.interval === null || INTERVALS.includes(p.interval)) next.interval = p.interval ?? null;
  if (p.trialEnd === null || isIso(p.trialEnd)) next.trialEnd = p.trialEnd ?? null;
  if (p.expiresAt === null || isIso(p.expiresAt)) next.expiresAt = p.expiresAt ?? null;
  if (Number.isInteger(p.deviceLimit) && p.deviceLimit >= 1 && p.deviceLimit <= 100) next.deviceLimit = p.deviceLimit;
  if (Array.isArray(p.produtos)) next.produtos = parseProdutos(p.produtos);
  next.updatedAt = nowIso(now);
  next.updatedBy = 'admin';
  return next;
}

/** Status de um device do maquinas.json; ausente (registro antigo) conta como ativo. */
const deviceStatus = (entry) => (entry && DEVICE_STATUSES.includes(entry.status) ? entry.status : 'active');

/** Quantos devices ativos a conta tem hoje (ignora o id passado, para medir "os outros"). */
function activeCount(machines, exceptId = null) {
  const all = machines && typeof machines === 'object' ? machines : {};
  let n = 0;
  for (const [id, entry] of Object.entries(all)) {
    if (id === exceptId) continue;
    if (deviceStatus(entry) === 'active') n += 1;
  }
  return n;
}

/**
 * Decide o status de um device ao se apresentar. Device conhecido mantém o status que já tinha (não vira
 * pendente de novo). Device novo entra "active" se ainda cabe no deviceLimit, senão "pending" (mão levantada).
 */
function admitDevice(license, machines, id) {
  const lic = parseLicense(license);
  const all = machines && typeof machines === 'object' ? machines : {};
  const known = all[id];
  if (known) return deviceStatus(known);
  return activeCount(all, id) < lic.deviceLimit ? 'active' : 'pending';
}

/** Licença em vigor: status active/trialing e, se houver validade, ainda não vencida. */
function isActive(license, now = Date.now()) {
  const lic = parseLicense(license, now);
  if (lic.status !== 'active' && lic.status !== 'trialing') return false;
  return !(lic.expiresAt !== null && Date.parse(lic.expiresAt) < now);
}
/** Módulos Pro do meu-bot (Navegador, CRM pelo WhatsApp): pro ou personalizado, em vigor. */
function proOk(license, now = Date.now()) {
  const lic = parseLicense(license, now);
  return (lic.plan === 'pro' || lic.plan === 'personalizado') && isActive(lic, now);
}
/**
 * Um produto contratado (meu-bot-crm, meu-bot-fit…) está liberado? Produtos são acumulativos por cima do plano:
 * basta estar na lista e a licença não estar vencida (status expired ou validade passada). O plano personalizado
 * (sob consulta) libera todos.
 */
function produtoOk(license, nome, now = Date.now()) {
  const lic = parseLicense(license, now);
  if (lic.status === 'expired') return false;
  if (lic.expiresAt !== null && Date.parse(lic.expiresAt) < now) return false;
  return lic.plan === 'personalizado' ? isActive(lic, now) : lic.produtos.includes(nome);
}
/** O CRM próprio (meu-bot-crm): produto contratado ou plano personalizado em vigor. */
const crmOk = (license, now = Date.now()) => produtoOk(license, 'meu-bot-crm', now);

const PRODUTO_RE = /^meu-bot(-[a-z0-9-]{1,30})?$/;
/**
 * Apps que já se apresentaram deste device (um Mac pode ter o meu-bot e o meu-bot-crm): `apps[produto] =
 * {version, lastSeen}`. `produto` inválido/ausente (app antigo) conta como "meu-bot".
 */
function mergeApps(prev, produto, version, now = Date.now()) {
  const apps = {};
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    for (const [k, v] of Object.entries(prev)) {
      if (PRODUTO_RE.test(k) && v && typeof v === 'object' && typeof v.version === 'string' && typeof v.lastSeen === 'string') apps[k] = { version: v.version, lastSeen: v.lastSeen };
    }
  }
  const nome = typeof produto === 'string' && PRODUTO_RE.test(produto) ? produto : 'meu-bot';
  apps[nome] = { version: typeof version === 'string' ? version : '', lastSeen: nowIso(now) };
  return apps;
}

module.exports = {
  PLANS,
  isActive,
  proOk,
  produtoOk,
  crmOk,
  parseProdutos,
  mergeApps,
  STATUSES,
  INTERVALS,
  DEVICE_STATUSES,
  defaultLicense,
  parseLicense,
  applyLicensePatch,
  deviceStatus,
  activeCount,
  admitDevice,
};
