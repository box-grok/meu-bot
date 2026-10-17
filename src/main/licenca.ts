/**
 * Licença (meu-bot-admin): valida e monta o que o admin lê por SSH da máquina da pessoa (licenca.json e
 * maquinas.json). Puro, sem IO: a fronteira dona do formato do lado do admin. Vem de fora = dado, nunca comando.
 * Mesmo esquema do backend-colima/licenca.js (o backend é quem grava de fato); mudar os dois juntos.
 */
import type { License, LicenseDevice, LicensePatch, LicenseView } from "../shared/ipc";

const PLANS: License["plan"][] = ["free", "pro"];
const STATUSES: License["status"][] = ["free", "trialing", "active", "expired"];
const INTERVALS: NonNullable<License["interval"]>[] = ["month", "year"];

const isIso = (v: unknown): v is string => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));
const nowIso = (now: number): string => new Date(now).toISOString();

/** Licença de uma conta ainda não configurada: grátis, um device. */
export function defaultLicense(now: number = Date.now()): License {
  const at = nowIso(now);
  return { plan: "free", status: "free", interval: null, memberSince: at, trialEnd: null, expiresAt: null, deviceLimit: 1, updatedAt: at, updatedBy: "system" };
}

/** Normaliza o licenca.json lido; campo inválido/ausente cai no default (memberSince preservado). Nunca lança. */
export function parseLicense(raw: unknown, now: number = Date.now()): License {
  const base = defaultLicense(now);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  return {
    plan: PLANS.includes(o.plan as License["plan"]) ? (o.plan as License["plan"]) : base.plan,
    status: STATUSES.includes(o.status as License["status"]) ? (o.status as License["status"]) : base.status,
    interval: INTERVALS.includes(o.interval as NonNullable<License["interval"]>) ? (o.interval as License["interval"]) : null,
    memberSince: isIso(o.memberSince) ? o.memberSince : base.memberSince,
    trialEnd: isIso(o.trialEnd) ? o.trialEnd : null,
    expiresAt: isIso(o.expiresAt) ? o.expiresAt : null,
    deviceLimit: Number.isInteger(o.deviceLimit) && (o.deviceLimit as number) >= 1 && (o.deviceLimit as number) <= 100 ? (o.deviceLimit as number) : base.deviceLimit,
    updatedAt: isIso(o.updatedAt) ? o.updatedAt : base.updatedAt,
    updatedBy: o.updatedBy === "admin" || o.updatedBy === "system" ? o.updatedBy : base.updatedBy,
  };
}

/** Aplica a mudança do admin (só campos válidos) e carimba updatedAt/updatedBy=admin. */
export function applyLicensePatch(current: unknown, patch: LicensePatch, now: number = Date.now()): License {
  const lic = parseLicense(current, now);
  const p = patch && typeof patch === "object" ? patch : {};
  const next: License = { ...lic };
  if (p.plan !== undefined && PLANS.includes(p.plan)) next.plan = p.plan;
  if (p.status !== undefined && STATUSES.includes(p.status)) next.status = p.status;
  if (p.interval !== undefined && (p.interval === null || INTERVALS.includes(p.interval))) next.interval = p.interval;
  if (p.trialEnd !== undefined && (p.trialEnd === null || isIso(p.trialEnd))) next.trialEnd = p.trialEnd;
  if (p.expiresAt !== undefined && (p.expiresAt === null || isIso(p.expiresAt))) next.expiresAt = p.expiresAt;
  if (p.deviceLimit !== undefined && Number.isInteger(p.deviceLimit) && p.deviceLimit >= 1 && p.deviceLimit <= 100) next.deviceLimit = p.deviceLimit;
  next.updatedAt = nowIso(now);
  next.updatedBy = "admin";
  return next;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lê o maquinas.json (mapa id → entrada) e devolve os devices; status ausente (registro antigo) = ativo. */
export function parseDevices(raw: unknown): LicenseDevice[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: LicenseDevice[] = [];
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-f0-9]{12}$/.test(id) || v === null || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const status: LicenseDevice["status"] = e.status === "pending" ? "pending" : "active";
    out.push({
      id,
      name: str(e.name),
      user: str(e.user),
      platform: str(e.platform),
      app: str(e.app),
      firstSeen: str(e.firstSeen),
      lastSeen: str(e.lastSeen),
      status,
      requestedAt: isIso(e.requestedAt) ? e.requestedAt : null,
    });
  }
  // Mais recentes primeiro, como a tabela "Last seen" do Rambox.
  out.sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0));
  return out;
}

/** Monta a visão (licença + devices + contagens) a partir do que veio por SSH. */
export function buildLicenseView(licenseRaw: unknown, machinesRaw: unknown, now: number = Date.now()): LicenseView {
  const license = parseLicense(licenseRaw, now);
  const devices = parseDevices(machinesRaw);
  const activeCount = devices.filter((d) => d.status === "active").length;
  const pendingCount = devices.filter((d) => d.status === "pending").length;
  return { license, devices, activeCount, pendingCount, deviceLimit: license.deviceLimit };
}
