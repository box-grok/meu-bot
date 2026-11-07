/** Acesso ao D1: consultas tipadas, uma função por intenção. O que sai do banco é dado; quem decide é a rota. */
import type { CodigoLinha, ContaApi, ContaLinha, DeviceApi, DeviceLinha, License, LicencaLinha, MaquinaLinha, SessaoLinha } from "./tipos.js";
import { agoraIso, uuid } from "./sessao-core.js";
import type { UsuarioFirebase } from "./firebase.js";

export async function contaPorUid(db: D1Database, uid: string): Promise<ContaLinha | null> {
  return (await db.prepare("SELECT * FROM contas WHERE firebase_uid = ?1 AND apagada_em IS NULL").bind(uid).first<ContaLinha>()) ?? null;
}
export async function contaPorId(db: D1Database, id: string): Promise<ContaLinha | null> {
  return (await db.prepare("SELECT * FROM contas WHERE id = ?1 AND apagada_em IS NULL").bind(id).first<ContaLinha>()) ?? null;
}
/** Cria ou atualiza a conta a partir do que o Firebase diz (e-mail, nome, foto podem mudar). */
export async function upsertConta(db: D1Database, u: UsuarioFirebase, agora = agoraIso()): Promise<ContaLinha> {
  const atual = await contaPorUid(db, u.uid);
  if (atual === null) {
    const id = uuid();
    await db.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, nome, foto, criada_em, atualizada_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)")
      .bind(id, u.uid, u.email, u.emailVerificado ? 1 : 0, u.nome, u.foto, agora).run();
    return { id, firebase_uid: u.uid, email: u.email, email_verificado: u.emailVerificado ? 1 : 0, nome: u.nome, foto: u.foto, criada_em: agora, atualizada_em: agora, apagada_em: null };
  }
  await db.prepare("UPDATE contas SET email = ?2, email_verificado = ?3, nome = ?4, foto = ?5, atualizada_em = ?6 WHERE id = ?1")
    .bind(atual.id, u.email, u.emailVerificado ? 1 : 0, u.nome, u.foto, agora).run();
  return { ...atual, email: u.email, email_verificado: u.emailVerificado ? 1 : 0, nome: u.nome, foto: u.foto, atualizada_em: agora };
}

/** O papel de admin deste e-mail; o primeiro login do ADMIN_BOOTSTRAP_EMAIL entra como super se a tabela está vazia. */
export async function papelAdmin(db: D1Database, email: string, bootstrap: string, agora = agoraIso()): Promise<"super" | "admin" | null> {
  const r = await db.prepare("SELECT papel FROM admins WHERE email = ?1").bind(email).first<{ papel: string }>();
  if (r !== null && r !== undefined) return r.papel === "super" ? "super" : "admin";
  if (email === bootstrap.trim().toLowerCase()) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM admins").first<{ n: number }>();
    if ((n?.n ?? 0) === 0) { await db.prepare("INSERT INTO admins (email, papel, criado_em) VALUES (?1, 'super', ?2)").bind(email, agora).run(); return "super"; }
  }
  return null;
}

export async function criarCodigo(db: D1Database, c: Omit<CodigoLinha, "usado_em">): Promise<void> {
  await db.prepare("INSERT INTO codigos_login (code, conta_id, state, challenge, esquema, app, versao_app, criado_em, expira_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(c.code, c.conta_id, c.state, c.challenge, c.esquema, c.app, c.versao_app, c.criado_em, c.expira_em).run();
}
export async function codigoPor(db: D1Database, code: string): Promise<CodigoLinha | null> {
  return (await db.prepare("SELECT * FROM codigos_login WHERE code = ?1").bind(code).first<CodigoLinha>()) ?? null;
}
/** Marca o código como usado; devolve false se outro pedido já o usou (corrida). */
export async function usarCodigo(db: D1Database, code: string, agora = agoraIso()): Promise<boolean> {
  const r = await db.prepare("UPDATE codigos_login SET usado_em = ?2 WHERE code = ?1 AND usado_em IS NULL").bind(code, agora).run();
  return (r.meta.changes ?? 0) === 1;
}

const defaultLicense = (memberSince: string): License => ({ plan: "free", status: "free", interval: null, memberSince, trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], pagamento: null, updatedAt: memberSince, updatedBy: "system" });
function licencaDaLinha(l: LicencaLinha | null, memberSince: string): License {
  if (l === null) return defaultLicense(memberSince);
  let produtos: string[] = []; let pagamento: License["pagamento"] = null;
  try { const p: unknown = JSON.parse(l.produtos); if (Array.isArray(p)) produtos = p.filter((x): x is string => typeof x === "string"); } catch { /* vazio */ }
  try { if (l.pagamento !== null) { const p: unknown = JSON.parse(l.pagamento); if (p !== null && typeof p === "object" && typeof (p as { instrucoes?: unknown }).instrucoes === "string") pagamento = { instrucoes: (p as { instrucoes: string }).instrucoes, link: typeof (p as { link?: unknown }).link === "string" ? (p as { link: string }).link : null }; } } catch { /* null */ }
  return {
    plan: l.plan === "pro" ? "pro" : "free",
    status: l.status === "trialing" || l.status === "active" || l.status === "expired" ? l.status : "free",
    interval: l.interval === "month" || l.interval === "year" ? l.interval : null,
    memberSince: l.member_since, trialEnd: l.trial_end, expiresAt: l.expires_at,
    deviceLimit: Number.isInteger(l.device_limit) && l.device_limit >= 1 ? l.device_limit : 1,
    produtos, pagamento, updatedAt: l.updated_at, updatedBy: l.updated_by === "admin" ? "admin" : "system",
  };
}
export async function licencaDaConta(db: D1Database, conta: ContaLinha): Promise<License> {
  const l = (await db.prepare("SELECT * FROM licencas WHERE conta_id = ?1").bind(conta.id).first<LicencaLinha>()) ?? null;
  return licencaDaLinha(l, conta.criada_em);
}

export async function devicesDaConta(db: D1Database, contaId: string): Promise<DeviceLinha[]> {
  return (await db.prepare("SELECT * FROM devices WHERE conta_id = ?1 ORDER BY last_seen DESC").bind(contaId).all<DeviceLinha>()).results;
}
export async function devicePor(db: D1Database, contaId: string, id: string, alias: string | null): Promise<DeviceLinha | null> {
  const r = await db.prepare("SELECT * FROM devices WHERE conta_id = ?1 AND (id = ?2 OR (?3 IS NOT NULL AND alias_legado = ?3)) ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END LIMIT 1").bind(contaId, id, alias).first<DeviceLinha>();
  return r ?? null;
}
export interface DeviceGravar { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string; status: "active" | "pending" }
/** Grava o device (novo ou visto de novo); `apps[app]` recebe versão e hora. Device achado pelo alias antigo ganha o id novo. */
export async function gravarDevice(db: D1Database, contaId: string, d: DeviceGravar, atual: DeviceLinha | null, agora = agoraIso()): Promise<void> {
  let apps: Record<string, { version: string; lastSeen: string }> = {};
  if (atual !== null) { try { const a: unknown = JSON.parse(atual.apps); if (a !== null && typeof a === "object") apps = a as typeof apps; } catch { apps = {}; } }
  apps[d.app] = { version: d.versao, lastSeen: agora };
  const requested = d.status === "pending" ? (atual?.requested_at ?? agora) : null;
  if (atual === null) {
    await db.prepare("INSERT INTO devices (conta_id, id, alias_legado, name, user, platform, status, requested_at, first_seen, last_seen, apps) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)")
      .bind(contaId, d.id, d.alias, d.name, d.user, d.platform, d.status, requested, agora, JSON.stringify(apps)).run();
    return;
  }
  await db.prepare("UPDATE devices SET id = ?3, alias_legado = COALESCE(?4, alias_legado), name = ?5, user = ?6, platform = ?7, status = ?8, requested_at = ?9, last_seen = ?10, apps = ?11 WHERE conta_id = ?1 AND id = ?2")
    .bind(contaId, atual.id, d.id, d.alias, d.name, d.user, d.platform, d.status, requested, agora, JSON.stringify(apps)).run();
}

export async function maquinasDaConta(db: D1Database, contaId: string): Promise<MaquinaLinha[]> {
  return (await db.prepare("SELECT * FROM maquinas WHERE conta_id = ?1 ORDER BY criada_em").bind(contaId).all<MaquinaLinha>()).results;
}
export async function pedidosAbertos(db: D1Database, contaId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE conta_id = ?1 AND atendido_em IS NULL").bind(contaId).first<{ n: number }>())?.n ?? 0;
}

export async function criarSessao(db: D1Database, s: Omit<SessaoLinha, "revogada_em">): Promise<void> {
  await db.prepare("INSERT INTO sessoes (id, conta_id, refresh_hash, familia, device_id, app, versao_app, criada_em, usada_em, expira_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
    .bind(s.id, s.conta_id, s.refresh_hash, s.familia, s.device_id, s.app, s.versao_app, s.criada_em, s.usada_em, s.expira_em).run();
}
export async function sessaoPorHash(db: D1Database, hash: string): Promise<SessaoLinha | null> {
  return (await db.prepare("SELECT * FROM sessoes WHERE refresh_hash = ?1").bind(hash).first<SessaoLinha>()) ?? null;
}
export async function sessaoPorId(db: D1Database, id: string): Promise<SessaoLinha | null> {
  return (await db.prepare("SELECT * FROM sessoes WHERE id = ?1").bind(id).first<SessaoLinha>()) ?? null;
}
export async function revogarSessao(db: D1Database, id: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE id = ?1 AND revogada_em IS NULL").bind(id, agora).run();
}
export async function revogarFamilia(db: D1Database, familia: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE familia = ?1 AND revogada_em IS NULL").bind(familia, agora).run();
}

/** Contador por chave e janela; devolve quantos já houve nesta janela (inclusive este). */
export async function contarLimite(db: D1Database, chave: string, janela: string): Promise<number> {
  await db.prepare("INSERT INTO limites (chave, janela, n) VALUES (?1, ?2, 1) ON CONFLICT(chave) DO UPDATE SET n = CASE WHEN janela = ?2 THEN n + 1 ELSE 1 END, janela = ?2").bind(chave, janela).run();
  return (await db.prepare("SELECT n FROM limites WHERE chave = ?1").bind(chave).first<{ n: number }>())?.n ?? 1;
}

export async function auditar(db: D1Database, quem: string, acao: string, contaId: string | null, detalhe: string | null, agora = agoraIso()): Promise<void> {
  await db.prepare("INSERT INTO auditoria (quando, quem, acao, conta_id, detalhe) VALUES (?1, ?2, ?3, ?4, ?5)").bind(agora, quem, acao, contaId, detalhe).run();
}

/** A conta como o app a vê: licença, devices (com "este"), máquinas, pedidos e o papel de admin. */
export async function montarContaApi(db: D1Database, conta: ContaLinha, admin: "super" | "admin" | null, deviceAtual: string | null): Promise<ContaApi> {
  const [licenca, devices, maquinas, pedidos] = await Promise.all([licencaDaConta(db, conta), devicesDaConta(db, conta.id), maquinasDaConta(db, conta.id), pedidosAbertos(db, conta.id)]);
  const ds: DeviceApi[] = devices.map((d) => {
    let apps: DeviceApi["apps"] = {};
    try { const a: unknown = JSON.parse(d.apps); if (a !== null && typeof a === "object") apps = a as DeviceApi["apps"]; } catch { apps = {}; }
    return { id: d.id, alias: d.alias_legado, name: d.name ?? "", user: d.user ?? "", platform: d.platform ?? "", status: d.status === "pending" ? "pending" : "active", requestedAt: d.requested_at, firstSeen: d.first_seen, lastSeen: d.last_seen, apps, este: deviceAtual !== null && (d.id === deviceAtual || d.alias_legado === deviceAtual) };
  });
  return { id: conta.id, email: conta.email, nome: conta.nome, foto: conta.foto, admin, licenca, devices: ds, maquinas: maquinas.map((m) => ({ id: m.id, apelido: m.apelido, vinculadaPor: m.vinculada_por })), pedidos };
}
