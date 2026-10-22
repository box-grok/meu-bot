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
  assert.deepEqual(l.produtos, []);
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

test("três planos: personalizado é aceito e libera o Pro; o CRM próprio com Pro ou superior, ou o produto contratado", () => {
  for (const parse of [be.parseLicense, fe.parseLicense]) assert.equal(parse({ plan: "personalizado" }).plan, "personalizado");
  const t = Date.parse("2026-10-19T00:00:00.000Z");
  const lic = (over) => ({ plan: "free", status: "free", expiresAt: null, ...over });
  assert.equal(be.proOk(lic({ plan: "pro", status: "active" }), t), true);
  assert.equal(be.proOk(lic({ plan: "personalizado", status: "trialing" }), t), true, "personalizado libera os módulos Pro");
  assert.equal(be.proOk(lic({ plan: "pro", status: "expired" }), t), false);
  assert.equal(be.proOk(lic({ plan: "pro", status: "active", expiresAt: "2026-10-01T00:00:00.000Z" }), t), false, "validade no passado vence");
  assert.equal(be.proOk(lic({ plan: "free", status: "active" }), t), false);
  assert.equal(be.crmOk(lic({ plan: "pro", status: "active" }), t), true, "Pro em vigor libera o CRM próprio");
  assert.equal(be.crmOk(lic({ plan: "pro", status: "trialing" }), t), true, "trial do Pro também");
  assert.equal(be.crmOk(lic({ plan: "pro", status: "expired" }), t), false);
  assert.equal(be.crmOk(lic({ plan: "free", status: "active" }), t), false, "gratuito sem produto não");
  assert.equal(be.crmOk(lic({ plan: "personalizado", status: "active" }), t), true, "personalizado libera todos");
  assert.equal(be.crmOk(lic({ plan: "personalizado", status: "expired" }), t), false);
  // Produtos acumulativos por cima do plano: free ou pro + meu-bot-crm contratado.
  assert.equal(be.crmOk(lic({ plan: "pro", status: "active", produtos: ["meu-bot-crm"] }), t), true);
  assert.equal(be.crmOk(lic({ produtos: ["meu-bot-crm"] }), t), true, "free + produto contratado também vale");
  assert.equal(be.crmOk(lic({ plan: "pro", status: "expired", produtos: ["meu-bot-crm"] }), t), false, "licença vencida tranca o produto");
  assert.equal(be.produtoOk(lic({ produtos: ["meu-bot-fit"] }), "meu-bot-fit", t), true);
  assert.equal(be.produtoOk(lic({ produtos: ["meu-bot-fit"] }), "meu-bot-crm", t), false);
  assert.deepEqual(be.parseLicense({ produtos: ["meu-bot-crm", "lixo!", "meu-bot-admin", "meu-bot-crm", "meu-bot-fit"] }).produtos, ["meu-bot-crm", "meu-bot-fit"], "nomes válidos, únicos, ordenados; admin não é produto");
  assert.deepEqual(be.applyLicensePatch(lic({ produtos: ["meu-bot-crm"] }), { produtos: [] }).produtos, [], "patch substitui a lista");
  assert.deepEqual(fe.parseLicense({ produtos: ["meu-bot-fit"] }).produtos, ["meu-bot-fit"]);
  // Lado do admin: mesmas regras.
  assert.equal(fe.proOk(fe.parseLicense(lic({ plan: "personalizado", status: "active" })), t), true);
  const v = (over) => ({ license: fe.parseLicense(lic(over)), devices: [] });
  assert.equal(fe.acessoProduto(v({ plan: "personalizado", status: "active" }), "agente-box", "personalizado", "meu-bot-crm", t), "ok");
  assert.equal(fe.acessoProduto(v({ plan: "pro", status: "active" }), "agente-box", "personalizado", "meu-bot-crm", t), "ausente", "pro sem o produto contratado");
  assert.equal(fe.acessoProduto(v({ plan: "pro", status: "active", produtos: ["meu-bot-crm"] }), "agente-box", "personalizado", "meu-bot-crm", t), "ok", "pro + produto contratado");
  assert.equal(fe.acessoProduto(v({ produtos: ["meu-bot-crm"] }), "agente-box", "personalizado", "meu-bot-crm", t), "ok", "free + produto contratado");
  assert.equal(fe.acessoProduto(v({ plan: "pro", status: "expired", produtos: ["meu-bot-crm"] }), "agente-box", "personalizado", "meu-bot-crm", t), "expirada");
  assert.equal(fe.acessoProduto(v({ produtos: ["meu-bot-fit"] }), "agente-box", "personalizado", "meu-bot-crm", t), "ausente", "outro produto não serve");
  assert.equal(fe.acessoProduto(null, "agente-box", "personalizado", "meu-bot-crm", t), "unknown");
  assert.equal(fe.acessoProduto(null, "agente-box", "free", "meu-bot", t), "ok", "produto free nunca bloqueia o app inteiro");
  // crmProprioOk (lado do app): por máquina; Pro em vigor ou produto contratado; este Mac e sem licença = não.
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "active" }), "agente-box", t), true);
  assert.equal(fe.crmProprioOk(v({ plan: "personalizado", status: "trialing" }), "agente-box", t), true);
  assert.equal(fe.crmProprioOk(v({ produtos: ["meu-bot-crm"] }), "agente-box", t), true, "gratuito + produto contratado");
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "expired" }), "agente-box", t), false);
  assert.equal(fe.crmProprioOk(v({}), "agente-box", t), false);
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "active" }), "local", t), false, "este Mac não tem CRM próprio");
  assert.equal(fe.crmProprioOk(null, "agente-box", t), false, "sem licença lida: fechado");
});

test("mergeApps: cada app que se apresenta fica em apps[produto]; app antigo sem produto conta como meu-bot", () => {
  const t = Date.parse("2026-10-19T12:00:00.000Z");
  const a = be.mergeApps(undefined, undefined, "0.1.0", t);
  assert.deepEqual(a, { "meu-bot": { version: "0.1.0", lastSeen: "2026-10-19T12:00:00.000Z" } });
  const b = be.mergeApps(a, "meu-bot-crm", "0.2.0", t + 1000);
  assert.deepEqual(Object.keys(b).sort(), ["meu-bot", "meu-bot-crm"]);
  assert.equal(b["meu-bot"].version, "0.1.0", "o outro app fica como estava");
  assert.equal(be.mergeApps({ "x y": { version: "1", lastSeen: "z" } }, "lixo!", "1", t)["meu-bot"].version, "1", "nome inválido vira meu-bot; entrada inválida some");
  const devs = fe.parseDevices({ [DEV(1)]: { name: "mac", apps: b } });
  assert.deepEqual(Object.keys(devs[0].apps).sort(), ["meu-bot", "meu-bot-crm"]);
  assert.deepEqual(fe.parseDevices({ [DEV(1)]: { name: "mac" } })[0].apps, {}, "registro antigo: sem apps");
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
