import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Lado do backend (CJS, roda na máquina da pessoa) e lado do admin (TS compilado), mesmo esquema.
const be = require("../../backend-colima/licenca.js");
const fe = require("../../dist/main/licenca.js");

const DEV = (n) => n.toString(16).padStart(12, "0");

test("defaultLicense: grátis, um device, membro desde carimbado", () => {
  const l = be.defaultLicense(0);
  assert.equal(l.plan, "free");
  assert.equal(l.status, "free");
  assert.equal(l.interval, null);
  assert.equal(l.deviceLimit, 1);
  assert.equal(l.memberSince, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(fe.defaultLicense(0), l, "backend e admin dão o mesmo default");
});

test("parseLicense: campo inválido/ausente cai no default; memberSince preservado", () => {
  const raw = { plan: "ultra", status: "active", interval: "week", memberSince: "2026-10-15T00:00:00.000Z", deviceLimit: 0 };
  for (const parse of [be.parseLicense, fe.parseLicense]) {
    const l = parse(raw, 1000);
    assert.equal(l.plan, "free", "plano desconhecido vira free");
    assert.equal(l.status, "active", "status válido mantido");
    assert.equal(l.interval, null, "intervalo inválido vira null");
    assert.equal(l.memberSince, "2026-10-15T00:00:00.000Z", "memberSince preservado");
    assert.equal(l.deviceLimit, 1, "limite fora da faixa vira 1");
  }
  for (const parse of [be.parseLicense, fe.parseLicense]) assert.equal(parse(null).plan, "free");
});

test("admitDevice: 1º cabe, 2º levanta a mão, conhecido mantém o status", () => {
  const free = be.defaultLicense(0); // deviceLimit 1
  assert.equal(be.admitDevice(free, {}, DEV(1)), "active", "1º device sempre ativo");
  const one = { [DEV(1)]: { status: "active" } };
  assert.equal(be.admitDevice(free, one, DEV(2)), "pending", "2º passa do limite 1 → pendente");
  const two = { ...free, deviceLimit: 2 };
  assert.equal(be.admitDevice(two, one, DEV(2)), "active", "com limite 2 o 2º entra ativo");
  const withPending = { [DEV(2)]: { status: "pending" } };
  assert.equal(be.admitDevice(two, withPending, DEV(2)), "pending", "device conhecido mantém o status (não reavalia)");
  const legacy = { [DEV(1)]: { name: "mac" } }; // registro antigo sem status
  assert.equal(be.admitDevice(free, legacy, DEV(2)), "pending", "registro antigo conta como ativo");
});

test("applyLicensePatch: aplica só o válido e carimba admin", () => {
  for (const apply of [be.applyLicensePatch, fe.applyLicensePatch]) {
    const next = apply(null, { plan: "pro", status: "trialing", deviceLimit: 3, interval: "month", bogus: 1 }, 5000);
    assert.equal(next.plan, "pro");
    assert.equal(next.status, "trialing");
    assert.equal(next.deviceLimit, 3);
    assert.equal(next.interval, "month");
    assert.equal(next.updatedBy, "admin");
    assert.equal(next.updatedAt, "1970-01-01T00:00:05.000Z");
    assert.equal(apply(null, { deviceLimit: 999 }).deviceLimit, 1, "limite fora da faixa é ignorado");
  }
});

test("buildLicenseView (admin): conta ativos/pendentes e ordena por visto há", () => {
  const machines = {
    [DEV(1)]: { name: "mac", platform: "macOS", app: "3.1.1", lastSeen: "2026-10-17T10:00:00.000Z" }, // sem status = ativo
    [DEV(2)]: { name: "vm", platform: "linux", app: "3.1.1", status: "pending", requestedAt: "2026-10-17T12:00:00.000Z", lastSeen: "2026-10-17T12:00:00.000Z" },
    [DEV(3)]: { name: "grokbot", platform: "linux", app: "3.1.1", status: "active", lastSeen: "2026-10-17T11:00:00.000Z" },
  };
  const view = fe.buildLicenseView({ plan: "pro", status: "active", deviceLimit: 2 }, machines);
  assert.equal(view.activeCount, 2);
  assert.equal(view.pendingCount, 1);
  assert.equal(view.deviceLimit, 2);
  assert.equal(view.devices[0].id, DEV(2), "mais recente primeiro");
  assert.equal(view.devices.find((d) => d.id === DEV(2)).requestedAt, "2026-10-17T12:00:00.000Z");
});

test("parseDevices (admin): ignora ids inválidos e normaliza status", () => {
  const devices = fe.parseDevices({ "nao-hex": { name: "x" }, [DEV(9)]: { name: "ok", status: "weird" } });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].status, "active", "status desconhecido vira ativo");
});
