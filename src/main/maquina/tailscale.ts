/**
 * Orquestração: desligar a verificação do Tailscale SSH editando a política do tailnet pela API
 * (ssh: check → accept), com backup antes, validação e If-Match. E o caminho de volta: restaurar
 * o backup mais novo. Só o bloco ssh muda (garantido por tailscale-policy.ts).
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { TailscaleSshResult } from "../../shared/ipc";
import { log } from "./backend";
import { loadTailscaleCredential } from "../app/secrets";
import { getPolicy, oauthToken, setPolicy, TailscaleApiError, validatePolicy } from "./tailscale-api";
import { applySshAction } from "./tailscale-policy";

const backupsDir = (): string => path.join(app.getPath("userData"), "tailscale-policy-backups");
const KEEP_BACKUPS = 10;

function writeBackup(text: string): string {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.hujson`;
  const target = path.join(dir, name);
  fs.writeFileSync(target, text, { mode: 0o600 });
  // Só os mais recentes ficam; a ordem alfabética do nome ISO é a cronológica.
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".hujson")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) { try { fs.rmSync(path.join(dir, old)); } catch { /* ok */ } }
  return target;
}

const fail = (detail: string, needsCredential = false): TailscaleSshResult => ({ ok: false, changed: false, needsCredential, detail, backupPath: null });

const describe = (e: unknown): string => (e instanceof TailscaleApiError ? e.message : e instanceof Error ? e.message : String(e));

/** Regra ssh de check → accept na política do tailnet. Idempotente. */
export async function disableSshCheck(): Promise<TailscaleSshResult> {
  const cred = loadTailscaleCredential();
  if (cred === null) return fail("nenhum OAuth client do Tailscale salvo; configure no seletor (Cmd+Shift+N) › máquina › Desligar a verificação de vez", true);
  try {
    log("[tailscale] pedindo token");
    const token = await oauthToken(cred);
    log("[tailscale] lendo a política");
    const { text, etag } = await getPolicy(token);
    const backupPath = writeBackup(text);
    const edit = applySshAction(text, "accept");
    if (!edit.changed) return { ok: true, changed: false, needsCredential: false, detail: `a política já estava com accept (${edit.summary}); se o ssh ainda pede verificação, a máquina ainda não recarregou`, backupPath };
    const v = await validatePolicy(token, edit.text);
    if (!v.ok) return { ...fail(`a política editada não passou na validação do Tailscale: ${v.message}`), backupPath };
    log(`[tailscale] salvando: ${edit.summary}`);
    await setPolicy(token, edit.text, etag);
    return { ok: true, changed: true, needsCredential: false, detail: `Regra ssh: ${edit.summary} · backup em ${path.basename(backupPath)}`, backupPath };
  } catch (e) {
    log(`[tailscale] falhou: ${describe(e)}`);
    return fail(describe(e));
  }
}

/** Volta a política para o backup mais novo (o estado de antes do último "desligar"). */
export async function restoreLastPolicy(): Promise<TailscaleSshResult> {
  const cred = loadTailscaleCredential();
  if (cred === null) return fail("nenhum OAuth client do Tailscale salvo", true);
  let latest: string | undefined;
  try { latest = fs.readdirSync(backupsDir()).filter((f) => f.endsWith(".hujson")).sort().pop(); } catch { /* sem pasta */ }
  if (latest === undefined) return fail("não há backup da política para restaurar");
  const backupPath = path.join(backupsDir(), latest);
  try {
    const text = fs.readFileSync(backupPath, "utf8");
    const token = await oauthToken(cred);
    const current = await getPolicy(token);
    if (current.text === text) return { ok: true, changed: false, needsCredential: false, detail: `a política já é igual ao backup ${latest}`, backupPath };
    writeBackup(current.text); // o estado atual também vira backup, para desfazer o desfazer
    await setPolicy(token, text, current.etag);
    log(`[tailscale] política restaurada de ${latest}`);
    return { ok: true, changed: true, needsCredential: false, detail: `política restaurada do backup ${latest}`, backupPath };
  } catch (e) {
    log(`[tailscale] restaurar falhou: ${describe(e)}`);
    return fail(describe(e));
  }
}
