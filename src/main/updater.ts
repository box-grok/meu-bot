/**
 * Atualização automática no molde do Sparkle (Brave), sem assinatura da Apple (o meu-bot é assinado com o
 * certificado próprio "meu-bot local", então o autoUpdater/Squirrel do Electron não serve): consulta a release
 * mais nova do repositório no GitHub, baixa o .zip do app desta variante e o .sig ao lado, só segue se a
 * assinatura Ed25519 confere com UPDATE_PUBLIC_KEY, extrai em userData/update, confere que o app baixado tem a
 * MESMA identidade de assinatura do que está rodando (nunca reassina: o chaveiro amarra os cookies a ela) e
 * avisa as janelas. Trocar o .app acontece quando a pessoa clica "Reiniciar e atualizar" ou, calado, ao sair
 * do app. A versão anterior fica guardada (<app>.antigo) até a nova ficar 30 s de pé; se a nova não passar das
 * primeiras aberturas, volta sozinha. Só no app empacotado; MEU_BOT_NO_UPDATE=1 desliga.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { log } from "./backend";
import { appTitle, caps } from "./variant";
import { broadcast } from "./windows";
import { decideRollback, parsePendente, pickUpdate, releasesUrl, verificaAssinatura, type UpdateCandidate, type UpdatePendente } from "./updater-core";
import { noteNetworkError } from "./net";
import { offlineMessage } from "./net-core";

import type { UpdateState } from "../shared/ipc";

const CHECK_EVERY_MS = 6 * 3600_000;
/** Como no Rambox, a verificação aparece logo ao abrir ("verificando atualizações…"), sem segurar nada. */
const FIRST_CHECK_MS = 3_000;
const state: UpdateState = { current: app.getVersion(), available: null, ready: null, checking: false, error: null, phase: "idle", checkedAt: null };
let stagedApp: string | null = null;
let timer: NodeJS.Timeout | null = null;

export const updateState = (): UpdateState => ({ ...state });
/** A última verificação falhou por falta de internet (a faixa OFFLINE refaz quando a conexão voltar). */
export const lastUpdateErrorWasNetwork = (): boolean => state.phase === "error" && state.error === offlineMessage("update");
/** Fase nova → todas as janelas (Configurações → "Sobre e atualização" e o ponto da barra de cima). */
function setPhase(phase: UpdateState["phase"]): void { state.phase = phase; broadcast("update:state", { ...state }); }
/** "Verificar agora": fora do ciclo; devolve o estado ao fim (ou o atual, se já está verificando). */
export async function checkNow(): Promise<UpdateState> {
  if (!app.isPackaged || process.env.MEU_BOT_NO_UPDATE === "1" || runningBundle() === null) return updateState();
  if (!state.checking) await check();
  return updateState();
}
const arch = (): string => (process.arch === "arm64" ? "arm64" : "x64");
const updateDir = (): string => path.join(app.getPath("userData"), "update");
/** Fora de updateDir (a troca apaga a pasta): o registro da atualização que ainda precisa provar que abre. */
const pendenteFile = (): string => path.join(app.getPath("userData"), "update-pendente.json");
/** Tempo de pé que confirma a versão nova (aí os .antigo saem). */
const CONFIRMA_MS = 30_000;
/** O .app que está rodando: …/X.app/Contents/MacOS/x → …/X.app. null fora de um bundle (dev). */
function runningBundle(): string | null {
  const b = path.resolve(process.execPath, "..", "..", "..");
  return b.endsWith(".app") && fs.existsSync(path.join(b, "Contents", "Info.plist")) ? b : null;
}
const plist = (bundle: string, key: string): string | null => {
  try { return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch { return null; }
};

/** Liga as consultas periódicas (só empacotado) e, antes, confirma ou desfaz a atualização da abertura anterior. */
export function initUpdater(): void {
  if (!app.isPackaged || runningBundle() === null) return;
  conferirPendente();
  if (process.env.MEU_BOT_NO_UPDATE === "1") return;
  timer = setTimeout(() => { void check(); }, FIRST_CHECK_MS);
}

/**
 * A abertura depois de uma troca: conta a tentativa e, se o app ficar de pé CONFIRMA_MS, apaga os .antigo; na
 * terceira abertura sem confirmar, volta os .antigo para o lugar e reabre a versão anterior.
 */
function conferirPendente(): void {
  let p: UpdatePendente | null = null;
  try { p = parsePendente(JSON.parse(fs.readFileSync(pendenteFile(), "utf8"))); } catch { return; }
  if (p === null) { fs.rmSync(pendenteFile(), { force: true }); return; }
  const decisao = decideRollback(p, state.current);
  if (decisao === "descartar") { fs.rmSync(pendenteFile(), { force: true }); return; }
  if (decisao === "voltar") { voltarParaAnterior(p); return; }
  fs.writeFileSync(pendenteFile(), JSON.stringify({ ...p, tentativas: p.tentativas + 1 }), { mode: 0o600 });
  const pend = p;
  setTimeout(() => {
    for (const a of pend.antigos) fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(pendenteFile(), { force: true });
    log(`[atualização] ${pend.para} confirmada (ficou de pé); versão anterior apagada`);
  }, CONFIRMA_MS).unref();
}

/** Restaura cada <app>.antigo no lugar do <app> e reabre na versão anterior. */
function voltarParaAnterior(p: UpdatePendente): void {
  log(`[atualização] ${p.para} não passou das primeiras aberturas: voltando para ${p.de}`);
  for (const old of p.antigos) {
    const t = old.replace(/\.antigo$/, "");
    if (!fs.existsSync(old)) continue;
    try {
      const quebrado = `${t}.quebrado`;
      fs.rmSync(quebrado, { recursive: true, force: true });
      if (fs.existsSync(t)) fs.renameSync(t, quebrado);
      fs.renameSync(old, t);
      fs.rmSync(quebrado, { recursive: true, force: true });
      log(`[atualização] ${t} → ${p.de}`);
    } catch (e) { log(`[atualização] não consegui voltar ${t}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  fs.rmSync(pendenteFile(), { force: true });
  const mine = runningBundle();
  if (mine !== null) app.relaunch({ execPath: path.join(mine, "Contents", "MacOS", path.basename(process.execPath)) });
  app.exit(0);
}
export function disposeUpdater(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }

async function check(): Promise<void> {
  if (state.checking) return;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  state.checking = true; state.error = null; setPhase("checking");
  try {
    const res = await fetch(releasesUrl(caps().canal), { headers: { "User-Agent": `${appTitle()}/${state.current}`, Accept: "application/vnd.github+json" } });
    state.checkedAt = new Date().toISOString();
    if (res.status === 404) { state.available = null; setPhase("up-to-date"); return; } // ainda sem release: a instalada é a mais recente
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const cand = pickUpdate(await res.json(), { app: appTitle(), arch: arch(), current: state.current, canal: caps().canal });
    if (cand === null) { state.available = null; setPhase("up-to-date"); return; }
    state.available = cand.version;
    if (state.ready === cand.version) { setPhase("ready"); return; }
    setPhase("available");
    await stage(cand);
    setPhase("ready");
  } catch (e) {
    // Sem internet, a culpa não é do GitHub nem do app: a frase diz isso (e a volta da rede refaz a checagem).
    state.error = (await noteNetworkError(e)) ? offlineMessage("update") : e instanceof Error ? e.message : String(e);
    log(`[atualização] ${state.error}`);
    setPhase("error");
  } finally {
    state.checking = false;
    timer = setTimeout(() => { void check(); }, CHECK_EVERY_MS);
  }
}

/** Designated requirement da assinatura de um .app (`codesign -d -r-`): a identidade que o chaveiro reconhece. */
const requisito = (bundle: string): string | null => {
  try { const r = execFileSync("codesign", ["-d", "-r-", bundle], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return /designated => (.+)/.exec(r)?.[1]?.trim() ?? null; } catch { return null; }
};
const baixar = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": `${appTitle()}/${state.current}` } });
  if (!res.ok || res.body === null) throw new Error(`download falhou (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
};

/**
 * Baixa o .zip e o .sig, só extrai se a assinatura Ed25519 conferir, e só dá por pronto se o app extraído for desta
 * variante, desta versão e com a mesma identidade de assinatura do app em execução (fail-closed: nada é reassinado).
 */
async function stage(cand: UpdateCandidate): Promise<void> {
  const dir = updateDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const zip = path.join(dir, cand.asset.name);
  log(`[atualização] baixando ${cand.asset.name}`);
  const buf = await baixar(cand.asset.url);
  if (cand.asset.size > 0 && buf.length !== cand.asset.size) throw new Error("download incompleto");
  const sig = (await baixar(cand.sig.url)).toString("utf8");
  if (!verificaAssinatura(buf, sig)) throw new Error("a assinatura da atualização não confere: descartada");
  fs.writeFileSync(zip, buf, { mode: 0o600 });
  const stageDir = path.join(dir, "app");
  fs.mkdirSync(stageDir);
  execFileSync("ditto", ["-x", "-k", zip, stageDir]);
  const bundle = path.join(stageDir, `${appTitle()}.app`);
  if (!fs.existsSync(path.join(bundle, "Contents", "Info.plist"))) throw new Error("o .zip não traz o app esperado");
  const v = plist(bundle, "CFBundleShortVersionString");
  if (v !== cand.version) throw new Error(`o app baixado diz ${v ?? "?"}, a release diz ${cand.version}`);
  const id = plist(bundle, "CFBundleIdentifier"), mine = runningBundle();
  if (mine !== null && id !== plist(mine, "CFBundleIdentifier")) throw new Error("o app baixado é de outra variante");
  // A quarentena sai (sem Developer ID o Gatekeeper bloquearia o app); a assinatura fica como veio do release.
  execFileSync("xattr", ["-dr", "com.apple.quarantine", bundle]);
  try { execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: ["ignore", "ignore", "pipe"] }); } catch { throw new Error("o app baixado não tem uma assinatura de código íntegra"); }
  const dele = requisito(bundle), meu = mine === null ? null : requisito(mine);
  if (dele === null || meu === null || dele !== meu) throw new Error("o app baixado é assinado por outra identidade: descartado");
  fs.rmSync(zip, { force: true });
  stagedApp = bundle; state.ready = cand.version;
  log(`[atualização] ${cand.version} pronta em ${bundle}`);
  broadcast("update:ready", { version: cand.version });
}

/**
 * Troca os .app instalados pelo preparado: o que está rodando e as cópias em ~/Applications e na mesa (mesmo bundle
 * id). Cada anterior fica como <app>.antigo e o registro em update-pendente.json, até a nova provar que abre.
 */
function swapBundles(): string {
  if (stagedApp === null) throw new Error("não há atualização pronta");
  const mine = runningBundle();
  if (mine === null) throw new Error("fora de um .app");
  const id = plist(mine, "CFBundleIdentifier");
  const targets = new Set<string>([mine]);
  for (const p of [path.join(os.homedir(), "Applications", `${appTitle()}.app`), path.join(os.homedir(), "Desktop", `${appTitle()}.app`)]) {
    if (fs.existsSync(p) && plist(p, "CFBundleIdentifier") === id) targets.add(path.resolve(p));
  }
  const antigos: string[] = [];
  for (const t of targets) {
    const fresh = `${t}.novo`, old = `${t}.antigo`;
    fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true });
    execFileSync("ditto", [stagedApp, fresh]);
    fs.renameSync(t, old); fs.renameSync(fresh, t);
    antigos.push(old);
    log(`[atualização] ${t} → ${state.ready}`);
  }
  const pend: UpdatePendente = { de: state.current, para: state.ready ?? "", antigos, tentativas: 0 };
  fs.writeFileSync(pendenteFile(), JSON.stringify(pend), { mode: 0o600 });
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
