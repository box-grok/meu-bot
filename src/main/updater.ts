/**
 * Atualização automática, como a de um app de verdade mas sem assinatura da Apple (o meu-bot é assinado
 * ad-hoc, então o autoUpdater do Electron não serve): consulta a release mais nova do repositório no GitHub,
 * baixa o .zip do app desta variante, deixa pronto em userData/update (tira a quarentena, reassina ad-hoc) e
 * avisa as janelas. Trocar o .app acontece quando a pessoa clica "Reiniciar e atualizar" ou, calado, ao
 * sair do app. Só no app empacotado; MEU_BOT_NO_UPDATE=1 desliga. Os dois apps (meu-bot e meu-bot-admin).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { log } from "./backend";
import { appTitle } from "./variant";
import { broadcast } from "./windows";
import { UPDATE_REPO, pickUpdate, type UpdateCandidate } from "./updater-core";

export interface UpdateState {
  current: string;
  /** Versão mais nova vista no GitHub (baixando ou pronta); null = nenhuma. */
  available: string | null;
  /** Versão já baixada e preparada: trocar é imediato. */
  ready: string | null;
  checking: boolean;
  error: string | null;
}

const CHECK_EVERY_MS = 6 * 3600_000;
const FIRST_CHECK_MS = 20_000;
const state: UpdateState = { current: app.getVersion(), available: null, ready: null, checking: false, error: null };
let stagedApp: string | null = null;
let timer: NodeJS.Timeout | null = null;

export const updateState = (): UpdateState => ({ ...state });
const arch = (): string => (process.arch === "arm64" ? "arm64" : "x64");
const updateDir = (): string => path.join(app.getPath("userData"), "update");
/** O .app que está rodando: …/X.app/Contents/MacOS/x → …/X.app. null fora de um bundle (dev). */
function runningBundle(): string | null {
  const b = path.resolve(process.execPath, "..", "..", "..");
  return b.endsWith(".app") && fs.existsSync(path.join(b, "Contents", "Info.plist")) ? b : null;
}
const plist = (bundle: string, key: string): string | null => {
  try { return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch { return null; }
};

/** Liga as consultas periódicas (só empacotado). */
export function initUpdater(): void {
  if (!app.isPackaged || process.env.MEU_BOT_NO_UPDATE === "1" || runningBundle() === null) return;
  timer = setTimeout(() => { void check(); }, FIRST_CHECK_MS);
}
export function disposeUpdater(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }

async function check(): Promise<void> {
  if (state.checking) return;
  state.checking = true; state.error = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { "User-Agent": `${appTitle()}/${state.current}`, Accept: "application/vnd.github+json" } });
    if (res.status === 404) { state.available = null; return; } // ainda sem release
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const cand = pickUpdate(await res.json(), { app: appTitle(), arch: arch(), current: state.current });
    if (cand === null) { state.available = null; return; }
    state.available = cand.version;
    if (state.ready !== cand.version) await stage(cand);
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    log(`[atualização] ${state.error}`);
  } finally {
    state.checking = false;
    timer = setTimeout(() => { void check(); }, CHECK_EVERY_MS);
  }
}

/** Baixa o .zip, extrai, tira a quarentena e reassina ad-hoc; confere a versão do Info.plist antes de dar por pronto. */
async function stage(cand: UpdateCandidate): Promise<void> {
  const dir = updateDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const zip = path.join(dir, cand.asset.name);
  log(`[atualização] baixando ${cand.asset.name}`);
  const res = await fetch(cand.asset.url, { redirect: "follow", headers: { "User-Agent": `${appTitle()}/${state.current}` } });
  if (!res.ok || res.body === null) throw new Error(`download falhou (${res.status})`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
  if (cand.asset.size > 0 && fs.statSync(zip).size !== cand.asset.size) throw new Error("download incompleto");
  const stageDir = path.join(dir, "app");
  fs.mkdirSync(stageDir);
  execFileSync("ditto", ["-x", "-k", zip, stageDir]);
  const bundle = path.join(stageDir, `${appTitle()}.app`);
  if (!fs.existsSync(path.join(bundle, "Contents", "Info.plist"))) throw new Error("o .zip não traz o app esperado");
  const v = plist(bundle, "CFBundleShortVersionString");
  if (v !== cand.version) throw new Error(`o app baixado diz ${v ?? "?"}, a release diz ${cand.version}`);
  const id = plist(bundle, "CFBundleIdentifier"), mine = runningBundle();
  if (mine !== null && id !== plist(mine, "CFBundleIdentifier")) throw new Error("o app baixado é de outra variante");
  execFileSync("xattr", ["-dr", "com.apple.quarantine", bundle]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  fs.rmSync(zip, { force: true });
  stagedApp = bundle; state.ready = cand.version;
  log(`[atualização] ${cand.version} pronta em ${bundle}`);
  broadcast("update:ready", { version: cand.version });
}

/** Troca os .app instalados pelo preparado: o que está rodando e as cópias em ~/Applications e na mesa (mesmo bundle id). */
function swapBundles(): string {
  if (stagedApp === null) throw new Error("não há atualização pronta");
  const mine = runningBundle();
  if (mine === null) throw new Error("fora de um .app");
  const id = plist(mine, "CFBundleIdentifier");
  const targets = new Set<string>([mine]);
  for (const p of [path.join(os.homedir(), "Applications", `${appTitle()}.app`), path.join(os.homedir(), "Desktop", `${appTitle()}.app`)]) {
    if (fs.existsSync(p) && plist(p, "CFBundleIdentifier") === id) targets.add(path.resolve(p));
  }
  for (const t of targets) {
    const fresh = `${t}.novo`, old = `${t}.antigo`;
    fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true });
    execFileSync("ditto", [stagedApp, fresh]);
    fs.renameSync(t, old); fs.renameSync(fresh, t);
    fs.rmSync(old, { recursive: true, force: true });
    log(`[atualização] ${t} → ${state.ready}`);
  }
  fs.rmSync(updateDir(), { recursive: true, force: true });
  stagedApp = null;
  return mine;
}

/** "Reiniciar e atualizar": troca e reabre o app já na versão nova. */
export function applyUpdate(): void {
  const mine = swapBundles();
  app.relaunch({ execPath: path.join(mine, "Contents", "MacOS", path.basename(process.execPath)) });
  app.exit(0);
}

/** Ao sair do app com uma atualização pronta, troca calado: a próxima abertura já é a nova. */
export function applyStagedOnQuit(): void {
  if (stagedApp === null) return;
  try { swapBundles(); } catch (e) { log(`[atualização] ao sair: ${e instanceof Error ? e.message : String(e)}`); }
}
