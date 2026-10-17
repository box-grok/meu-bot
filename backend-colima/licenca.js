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

const PLANS = ['free', 'pro'];
const STATUSES = ['free', 'trialing', 'active', 'expired'];
const INTERVALS = ['month', 'year'];
const DEVICE_STATUSES = ['active', 'pending'];

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
  return { plan, status, interval, memberSince, trialEnd, expiresAt, deviceLimit, updatedAt, updatedBy };
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

module.exports = {
  PLANS,
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
