/**
 * Atualização automática no molde do Sparkle (Brave) e do updater do Grok Bot, sem assinatura da Apple (o meu-bot é
 * assinado com o certificado próprio "meu-bot local", então o autoUpdater/Squirrel do Electron não serve):
 *
 * - Verifica: 10 s depois de abrir e a cada hora (com jitter), ao voltar a internet, ao acordar o Mac, por
 *   "Verificar agora" e quando o backend da máquina exige uma versão mínima. Consulta a release mais nova do
 *   repositório no GitHub (`pickUpdate`, puro).
 * - Prepara: baixa o `.sig` e o `.zip` desta variante em fluxo, com retomada e progresso (update-download.ts), só
 *   segue se a assinatura Ed25519 confere com uma de UPDATE_PUBLIC_KEYS, extrai em `userData/update/app`, confere
 *   que o app baixado tem a MESMA identidade de assinatura do que está rodando (nunca reassina: o chaveiro amarra
 *   os cookies a ela) e grava `preparada.json`: a versão pronta sobrevive a fechar e abrir o app, sem baixar de novo.
 *   Nada disso trava a janela (processos filhos assíncronos, proc.ts).
 * - Troca: em "Reiniciar e atualizar" (só para a versão que o botão mostrou; reconfirma no GitHub se a última
 *   verificação é velha; espera uma resposta em andamento terminar), sozinha com o Mac ocioso (preferência
 *   "atualizarOcioso") ou, calada, ao sair do app. A versão anterior fica guardada (<app>.antigo) até a nova ficar
 *   30 s de pé; se a nova não passar das primeiras aberturas, volta sozinha; se reabrir na antiga, a troca não
 *   pegou e o app registra e prepara de novo. Só no app empacotado; MEU_BOT_NO_UPDATE=1 desliga.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, powerMonitor } from "electron";
import { log } from "../maquina/backend";
import { anyConversationBusy } from "../conversa/conversation";
import { liveTerminals } from "../terminal/terminal";
import { appTitle, caps } from "../app/variant";
import { broadcast, getLastFocusedHost } from "../app/windows";
import { getAtualizarOcioso } from "../app/settings";
import { run, runText } from "../app/proc";
import { baixarComRetomada, DownloadError } from "./update-download";
import { noteNetworkError } from "../app/net";
import { offlineMessage } from "../app/net-core";
import {
  abaixoDaMinima, CHECK_EVERY_MS, compareVersions, CONFIRMA_FEED_MS, decideReinicioOcioso, decideRollback, feedAindaOferece, OCIOSO_SEG, parsePendente, parsePreparada, parseVersaoMinima,
  pickUpdate, proximaVerificacaoMs, releasesUrl, repararTroca, verificaAssinatura,
  type EstadoSistema, type UpdateCandidate, type UpdateGatilho, type UpdatePendente, type UpdatePreparada,
} from "./updater-core";

import type { UpdateErrorKind, UpdatePhase, UpdateState, UpdateTrigger } from "../../shared/ipc";

/** Como no Rambox, a verificação aparece logo ao abrir ("verificando atualizações…"), sem concorrer com o túnel. */
const FIRST_CHECK_MS = 10_000;
/** Consulta ao GitHub e download do .sig: limite por pedido (o zip tem o próprio vigia de inatividade). */
const FEED_TIMEOUT_MS = 15_000;
/** Tempo de pé que confirma a versão nova (aí os .antigo saem). */
const CONFIRMA_MS = 30_000;
/** "Reiniciar e atualizar" com uma resposta em andamento: espera até isto por ela; depois reinicia mesmo assim. */
const ESPERA_OCUPADO_MS = 20_000;
/** De quanto em quanto o updater olha se o Mac está ocioso para reiniciar sozinho (só com uma versão pronta). */
const OCIOSO_POLL_MS = 60_000;

/** Falha com a causa para a tela (`errorKind`); as frases são as que a pessoa vê. */
class UpdateFalha extends Error { constructor(public readonly kind: UpdateErrorKind, msg: string) { super(msg); this.name = "UpdateFalha"; } }

const state: UpdateState = { current: app.getVersion(), available: null, ready: null, checking: false, error: null, errorKind: null, phase: "idle", checkedAt: null, progress: null, aguardando: false, minima: null, abaixoDaMinima: false, atualizarOcioso: true };
/** A versão preparada em disco (preparada.json); null = nada pronto. */
let preparada: UpdatePreparada | null = null;
let timer: NodeJS.Timeout | null = null;
let ociosoTimer: NodeJS.Timeout | null = null;
/** Verificação em andamento (uma por vez; chamadas simultâneas esperam a mesma). */
let inflight: Promise<void> | null = null;
/** Cancela o download/preparação em curso ao sair. */
let abort: AbortController | null = null;
/** Versão mínima exigida pelo backend de cada máquina que esta sessão abriu; vale a maior. */
const minimaPorHost = new Map<string, string>();
let ligado = false;

export const updateState = (): UpdateState => ({ ...state, atualizarOcioso: getAtualizarOcioso() });
/** A última verificação falhou por falta de internet (a faixa OFFLINE refaz quando a conexão voltar). */
export const lastUpdateErrorWasNetwork = (): boolean => state.phase === "error" && state.errorKind === "rede";
function publish(): void { broadcast("update:state", updateState()); }
function setPhase(phase: UpdatePhase): void { state.phase = phase; state.checking = phase === "checking"; if (phase !== "downloading") state.progress = null; if (phase !== "applying") state.aguardando = false; publish(); }
const erroTexto = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const arch = (): string => (process.arch === "arm64" ? "arm64" : "x64");
const updateDir = (): string => path.join(app.getPath("userData"), "update");
const preparadaFile = (): string => path.join(updateDir(), "preparada.json");
/** Fora de updateDir (a troca apaga a pasta): o registro da troca que ainda precisa provar que abre. */
const pendenteFile = (): string => path.join(app.getPath("userData"), "update-pendente.json");
const gravarJson = (f: string, v: unknown): void => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(tmp, f); };
/** O .app que está rodando: …/X.app/Contents/MacOS/x → …/X.app. null fora de um bundle (dev). */
function runningBundle(): string | null {
  const b = path.resolve(process.execPath, "..", "..", "..");
  return b.endsWith(".app") && fs.existsSync(path.join(b, "Contents", "Info.plist")) ? b : null;
}
const plistSync = (bundle: string, key: string): string | null => {
  try { return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch { return null; }
};
const plist = async (bundle: string, key: string): Promise<string | null> => { try { return await runText("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { timeoutMs: 10_000 }); } catch { return null; } };
/** Designated requirement da assinatura de um .app (`codesign -d -r-`): a identidade que o chaveiro reconhece. */
const requisito = async (bundle: string): Promise<string | null> => {
  try { const r = await run("codesign", ["-d", "-r-", bundle], { timeoutMs: 60_000 }); return /designated => (.+)/.exec(`${r.stdout}\n${r.stderr}`)?.[1]?.trim() ?? null; } catch { return null; }
};
const ativo = (): boolean => app.isPackaged && process.env.MEU_BOT_NO_UPDATE !== "1" && runningBundle() !== null;

/* ---------- ciclo de vida ---------- */

/** Liga as verificações (só empacotado) e, antes, confirma ou desfaz a troca da abertura anterior e reaproveita a versão preparada. */
export function initUpdater(): void {
  if (!app.isPackaged || runningBundle() === null) return;
  conferirPendente();
  if (process.env.MEU_BOT_NO_UPDATE === "1") return;
  ligado = true;
  void reaproveitarPreparada().finally(() => { agendar(FIRST_CHECK_MS, "inicio"); });
  ociosoTimer = setInterval(() => { void tentarReinicioOcioso(); }, OCIOSO_POLL_MS);
  ociosoTimer.unref();
  // A tela bloqueou: boa hora para trocar, se há versão pronta e nada em andamento.
  powerMonitor.on("lock-screen", () => { void tentarReinicioOcioso(); });
}
export function disposeUpdater(): void {
  ligado = false;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (ociosoTimer !== null) { clearInterval(ociosoTimer); ociosoTimer = null; }
  abort?.abort();
}
function agendar(ms: number, trigger: UpdateTrigger): void {
  if (timer !== null) clearTimeout(timer);
  if (!ligado) return;
  timer = setTimeout(() => { timer = null; void check(trigger); }, ms);
  timer.unref();
}

/* ---------- verificar ---------- */

/** "Verificar agora" e os gatilhos de fora do ciclo: devolve o estado ao fim (ou o atual, se já está verificando). */
export async function checkNow(trigger: UpdateTrigger = "explicito"): Promise<UpdateState> {
  if (!ativo()) return updateState();
  await check(trigger);
  return updateState();
}
/** Ao acordar o Mac ou voltar a internet: só se a última verificação ficou velha (o ciclo normal cobre o resto). */
export function checkIfStale(trigger: UpdateTrigger): void {
  if (!ativo() || !ligado) return;
  const idade = state.checkedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(state.checkedAt);
  if (idade >= CHECK_EVERY_MS) void check(trigger);
}

function check(trigger: UpdateTrigger): Promise<void> {
  if (inflight !== null) return inflight;
  inflight = (async () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    state.error = null; state.errorKind = null; setPhase("checking");
    log(`[atualização] verificando (${trigger})`);
    const ac = new AbortController(); abort = ac;
    try {
      const cand = await consultarFeed(ac.signal);
      state.checkedAt = new Date().toISOString();
      if (cand === null) {
        // Nada mais novo que a instalada: uma preparada que sobrou foi retirada do ar (ou é a própria versão de agora).
        if (preparada !== null) { log(`[atualização] a ${preparada.para} não está mais na release: descartada`); limparPreparada(); }
        state.available = null; setPhase("up-to-date"); return;
      }
      state.available = cand.version;
      if (preparada !== null && preparada.para === cand.version) { setPhase("ready"); return; }
      if (preparada !== null) { log(`[atualização] ${preparada.para} preparada, mas a release oferece ${cand.version}: preparando a nova`); limparPreparada(); }
      setPhase("available");
      await preparar(cand, ac.signal);
      setPhase("ready");
    } catch (e) {
      if (ac.signal.aborted) { setPhase(preparada !== null ? "ready" : "idle"); return; }
      const f = await classificar(e);
      state.error = f.msg; state.errorKind = f.kind;
      log(`[atualização] ${f.msg}`);
      setPhase("error");
    } finally {
      if (abort === ac) abort = null;
      agendar(proximaVerificacaoMs(), "periodico");
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

async function consultarFeed(signal: AbortSignal): Promise<UpdateCandidate | null> {
  const res = await fetch(releasesUrl(caps().canal), { headers: { "User-Agent": `${appTitle()}/${state.current}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]) });
  if (res.status === 404) return null; // ainda sem release: a instalada é a mais recente
  if (!res.ok) throw new UpdateFalha("github", `GitHub respondeu ${res.status}`);
  return pickUpdate(await res.json(), { app: appTitle(), arch: arch(), current: state.current, canal: caps().canal });
}

/** Sem internet, a culpa não é do GitHub nem do app: a frase diz isso (e a volta da rede refaz a checagem). */
async function classificar(e: unknown): Promise<{ kind: UpdateErrorKind; msg: string }> {
  if (e instanceof UpdateFalha) return { kind: e.kind, msg: e.message };
  if (e instanceof DownloadError) return { kind: "download", msg: e.message };
  if (await noteNetworkError(e)) return { kind: "rede", msg: offlineMessage("update") };
  const msg = erroTexto(e);
  return { kind: /download|conexão/i.test(msg) ? "download" : "outro", msg };
}

/* ---------- preparar ---------- */

const baixarTexto = async (url: string, signal: AbortSignal): Promise<string> => {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": `${appTitle()}/${state.current}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]) });
  if (!res.ok) throw new DownloadError(`download falhou (${res.status})`);
  return await res.text();
};

/**
 * Baixa o .sig e o .zip, só extrai se a assinatura Ed25519 conferir, e só dá por pronto se o app extraído for desta
 * variante, desta versão e com a mesma identidade de assinatura do app em execução (fail-closed: nada é reassinado).
 * Um download interrompido da mesma versão retoma do `.partial`.
 */
async function preparar(cand: UpdateCandidate, signal: AbortSignal): Promise<void> {
  const dir = updateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Sobras de outra versão saem; o .partial/.resume desta versão fica para retomar.
  for (const f of fs.readdirSync(dir)) if (!f.startsWith(cand.asset.name)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const zip = path.join(dir, cand.asset.name);
  // O .sig primeiro: pequeno, e sem ele não há o que baixar.
  const sig = await baixarTexto(cand.sig.url, signal);
  log(`[atualização] baixando ${cand.asset.name}`);
  state.progress = null; setPhase("downloading");
  let ultimo = -1;
  const { sha256, retomadas } = await baixarComRetomada({
    url: cand.asset.url, destino: zip, tamanho: cand.asset.size, signal, headers: { "User-Agent": `${appTitle()}/${state.current}` },
    onProgress: (recebido, total) => {
      if (total === null || total <= 0) return;
      const p = Math.min(1, recebido / total);
      if (p - ultimo >= 0.01) { ultimo = p; state.progress = p; publish(); }
    },
  });
  if (retomadas > 0) log(`[atualização] download retomado ${retomadas}x`);
  setPhase("verifying");
  const stageDir = path.join(dir, "app");
  const bundle = path.join(stageDir, `${appTitle()}.app`);
  try {
    // Ed25519 do Node não é por hash: o zip entra em memória uma vez, aqui, e é liberado em seguida.
    if (!verificaAssinatura(fs.readFileSync(zip), sig)) throw new UpdateFalha("assinatura", "a assinatura da atualização não confere: descartada");
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir);
    await run("ditto", ["-x", "-k", zip, stageDir], { timeoutMs: 300_000 });
    if (!fs.existsSync(path.join(bundle, "Contents", "Info.plist"))) throw new UpdateFalha("assinatura", "o .zip não traz o app esperado");
    const v = await plist(bundle, "CFBundleShortVersionString");
    if (v !== cand.version) throw new UpdateFalha("assinatura", `o app baixado diz ${v ?? "?"}, a release diz ${cand.version}`);
    await conferirBundle(bundle);
  } catch (e) {
    // Zip ou app inválidos: não adianta insistir no mesmo arquivo; a próxima verificação baixa de novo.
    if (e instanceof UpdateFalha) fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const em = new Date().toISOString();
  gravarJson(preparadaFile(), { versao: 1, para: cand.version, bundle, sha256, em } satisfies UpdatePreparada);
  fs.rmSync(zip, { force: true });
  preparada = { versao: 1, para: cand.version, bundle, sha256, em };
  state.ready = cand.version;
  log(`[atualização] ${cand.version} pronta em ${bundle}`);
}

/** O .app extraído é desta variante, íntegro e assinado pela mesma identidade do app em execução (senão lança). */
async function conferirBundle(bundle: string): Promise<void> {
  const mine = runningBundle();
  if (mine !== null && (await plist(bundle, "CFBundleIdentifier")) !== (await plist(mine, "CFBundleIdentifier"))) throw new UpdateFalha("assinatura", "o app baixado é de outra variante");
  // A quarentena sai (sem Developer ID o Gatekeeper bloquearia o app); a assinatura fica como veio do release.
  await run("xattr", ["-dr", "com.apple.quarantine", bundle], { timeoutMs: 60_000 }).catch(() => undefined);
  try { await run("codesign", ["--verify", "--deep", "--strict", bundle], { timeoutMs: 300_000 }); } catch { throw new UpdateFalha("assinatura", "o app baixado não tem uma assinatura de código íntegra"); }
  const dele = await requisito(bundle), meu = mine === null ? null : await requisito(mine);
  if (dele === null || meu === null || dele !== meu) throw new UpdateFalha("assinatura", "o app baixado é assinado por outra identidade: descartado");
}

/** Na abertura: a versão preparada da sessão anterior ainda vale? Reconfere a integridade e já fica "pronta", sem baixar. */
async function reaproveitarPreparada(): Promise<void> {
  let p: UpdatePreparada | null = null;
  try { p = parsePreparada(JSON.parse(fs.readFileSync(preparadaFile(), "utf8"))); } catch { return; }
  if (p === null || compareVersions(p.para, state.current) <= 0 || !fs.existsSync(path.join(p.bundle, "Contents", "Info.plist"))) { limparPreparada(); return; }
  try {
    await conferirBundle(p.bundle);
    preparada = p; state.ready = p.para; state.available = p.para;
    log(`[atualização] ${p.para} já estava preparada: pronta para instalar`);
    setPhase("ready");
  } catch (e) { log(`[atualização] a ${p.para} preparada não passou na conferência (${erroTexto(e)}): descartada`); limparPreparada(); }
}
function limparPreparada(): void {
  preparada = null; state.ready = null;
  try { fs.rmSync(updateDir(), { recursive: true, force: true }); } catch { /* cortesia */ }
}

/* ---------- trocar ---------- */

/**
 * "Reiniciar e atualizar" (gatilho "clique") e o reinício ocioso: só para a versão que a tela mostrou; se a última
 * verificação é velha, reconfirma no GitHub antes (release retirada = nada muda); espera uma resposta em andamento
 * terminar (até 20 s no clique; o ocioso já exige nada em andamento). Troca os .app e reabre na mesma máquina.
 */
export async function applyUpdate(expectedVersion: string, gatilho: Exclude<UpdateGatilho, "saida">): Promise<void> {
  if (inflight !== null) await inflight; // uma verificação no meio pode ter trocado a versão pronta
  if (preparada === null || state.ready === null) throw new Error("não há atualização pronta");
  if (expectedVersion !== state.ready) throw new Error(`A versão pronta mudou para ${state.ready}; confira e clique de novo.`);
  if (state.phase === "applying") return;
  const idade = state.checkedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(state.checkedAt);
  if (idade > CONFIRMA_FEED_MS) {
    // Reconfirma só a release (sem preparar outra): retirada do ar, nada muda; sem internet, a preparada já conferida vale.
    let cand: UpdateCandidate | null | undefined;
    try { cand = await consultarFeed(new AbortController().signal); state.checkedAt = new Date().toISOString(); } catch (e) { log(`[atualização] não deu para reconfirmar no GitHub (${erroTexto(e)}); sigo com a ${expectedVersion} já conferida`); }
    if (cand !== undefined && !feedAindaOferece(cand, expectedVersion)) { log(`[atualização] a ${expectedVersion} foi retirada da release: descartada`); limparPreparada(); state.available = cand?.version ?? null; setPhase("up-to-date"); throw new Error("A atualização foi retirada do ar; nada foi mudado."); }
  }
  setPhase("applying");
  if (gatilho === "clique" && anyConversationBusy()) {
    state.aguardando = true; publish();
    const fim = Date.now() + ESPERA_OCUPADO_MS;
    while (anyConversationBusy() && Date.now() < fim) await new Promise((r) => setTimeout(r, 500));
    state.aguardando = false; publish();
  }
  let mine: string;
  try { mine = swapBundles(gatilho); } catch (e) {
    const ro = soLeitura(e); setPhase(ro ? "needs-move" : "ready");
    throw ro ? new Error("O app está numa pasta só de leitura (ainda na imagem do instalador?). Arraste-o para a pasta Aplicativos e abra de lá.") : e;
  }
  relancar(mine);
}
const soLeitura = (e: unknown): boolean => { const c = (e as { code?: unknown })?.code; return c === "EROFS" || c === "EACCES" || c === "EPERM"; };
/** Reabre o app já na versão nova, na mesma máquina que a pessoa estava (sem `--host`, o seletor abre). */
function relancar(mine: string): void {
  const host = getLastFocusedHost();
  app.relaunch({ execPath: path.join(mine, "Contents", "MacOS", path.basename(process.execPath)), args: host === null ? [] : [`--host=${host}`] });
  app.exit(0);
}

/**
 * Troca os .app instalados pelo preparado: o que está rodando e as cópias em ~/Applications e na mesa (mesmo bundle
 * id). Cada anterior fica como <app>.antigo e o registro em update-pendente.json ("pedida" antes de mexer, "trocada"
 * depois), até a nova provar que abre. Síncrono de propósito: acontece imediatamente antes de o app sair.
 */
function swapBundles(gatilho: UpdateGatilho): string {
  if (preparada === null) throw new Error("não há atualização pronta");
  const mine = runningBundle();
  if (mine === null) throw new Error("fora de um .app");
  // Pré-voo: sem escrita no .app ou na pasta dele (imagem .dmg, pasta de outro usuário) não há troca possível.
  fs.accessSync(mine, fs.constants.W_OK); fs.accessSync(path.dirname(mine), fs.constants.W_OK);
  const id = plistSync(mine, "CFBundleIdentifier");
  const targets = new Set<string>([mine]);
  for (const p of [path.join(os.homedir(), "Applications", `${appTitle()}.app`), path.join(os.homedir(), "Desktop", `${appTitle()}.app`)]) {
    if (fs.existsSync(p) && plistSync(p, "CFBundleIdentifier") === id) targets.add(path.resolve(p));
  }
  const pend: UpdatePendente = { de: state.current, para: preparada.para, antigos: [...targets].map((t) => `${t}.antigo`), tentativas: 0, gatilho, pedidoEm: new Date().toISOString(), fase: "pedida" };
  gravarJson(pendenteFile(), pend);
  const antigos: string[] = [];
  for (const t of targets) {
    const fresh = `${t}.novo`, old = `${t}.antigo`;
    fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true });
    try {
      execFileSync("ditto", [preparada.bundle, fresh]);
      fs.renameSync(t, old); fs.renameSync(fresh, t);
    } catch (e) {
      // Uma cópia sem escrita (mesa de outro usuário) é pulada; o .app em execução precisa trocar.
      if (t === mine) throw e;
      log(`[atualização] não troquei a cópia ${t}: ${erroTexto(e)}`); fs.rmSync(fresh, { recursive: true, force: true }); continue;
    }
    antigos.push(old);
    log(`[atualização] ${t} → ${preparada.para} (${gatilho})`);
  }
  gravarJson(pendenteFile(), { ...pend, antigos, fase: "trocada" } satisfies UpdatePendente);
  fs.rmSync(updateDir(), { recursive: true, force: true });
  preparada = null; state.ready = null;
  return mine;
}

/** Ao sair do app com uma atualização pronta, troca calado: a próxima abertura já é a nova. */
export function applyStagedOnQuit(): void {
  if (preparada === null) return;
  try { swapBundles("saida"); } catch (e) { log(`[atualização] ao sair: ${erroTexto(e)}`); }
}

/* ---------- reinício ocioso ---------- */

async function tentarReinicioOcioso(): Promise<void> {
  if (!ligado || state.phase !== "ready" || state.ready === null) return;
  let sistema: EstadoSistema = "unknown";
  try { sistema = powerMonitor.getSystemIdleState(OCIOSO_SEG); } catch { /* fica unknown */ }
  if (!decideReinicioOcioso({ ligado: getAtualizarOcioso(), pronta: true, sistema, ocupado: anyConversationBusy(), terminais: liveTerminals().length })) return;
  log(`[atualização] Mac ${sistema === "locked" ? "bloqueado" : "ocioso"} e nada em andamento: reiniciando na ${state.ready}`);
  try { await applyUpdate(state.ready, "ocioso"); } catch (e) { log(`[atualização] reinício ocioso não aconteceu: ${erroTexto(e)}`); }
}

/* ---------- versão mínima ---------- */

/** O backend de `host` respondeu ao hello com a versão mínima do app que ele atende (undefined = backend antigo). */
export function noteVersaoMinima(host: string, raw: unknown): void {
  const v = parseVersaoMinima(raw);
  if (v === null) minimaPorHost.delete(host); else minimaPorHost.set(host, v);
  let maior: string | null = null;
  for (const m of minimaPorHost.values()) if (maior === null || compareVersions(m, maior) > 0) maior = m;
  const abaixo = abaixoDaMinima(state.current, maior);
  if (maior === state.minima && abaixo === state.abaixoDaMinima) return;
  state.minima = maior; state.abaixoDaMinima = abaixo;
  if (abaixo) log(`[atualização] o backend de ${host} exige o app ${maior ?? "?"} ou mais novo (este é ${state.current})`);
  publish();
  if (abaixo && ativo() && (state.phase === "idle" || state.phase === "up-to-date" || state.phase === "error")) void check("versao-minima");
}

/* ---------- a abertura depois de uma troca ---------- */

/**
 * Conta a tentativa e, se o app ficar de pé CONFIRMA_MS, apaga os .antigo; na terceira abertura sem confirmar,
 * volta os .antigo para o lugar e reabre a versão anterior; reaberto na versão de antes da troca, a troca não pegou
 * (repõe um .app que tenha ficado faltando) e a próxima verificação prepara de novo.
 */
function conferirPendente(): void {
  let p: UpdatePendente | null = null;
  try { p = parsePendente(JSON.parse(fs.readFileSync(pendenteFile(), "utf8"))); } catch { return; }
  if (p === null) { fs.rmSync(pendenteFile(), { force: true }); return; }
  const decisao = decideRollback(p, state.current);
  if (decisao === "voltar") { voltarParaAnterior(p); return; }
  if (decisao === "nao-pegou") {
    for (const r of repararTroca(p.antigos, fs.existsSync)) { try { fs.renameSync(r.de, r.para); log(`[atualização] repus ${r.para} (a troca tinha parado no meio)`); } catch (e) { log(`[atualização] não consegui repor ${r.para}: ${erroTexto(e)}`); } }
    log(`[atualização] reabriu na ${p.de} depois de pedir a ${p.para} (${p.gatilho ?? "?"}): a troca não pegou; vou preparar de novo`);
    for (const a of p.antigos) fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(pendenteFile(), { force: true });
    return;
  }
  if (decisao === "descartar") { for (const a of p.antigos) fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(pendenteFile(), { force: true }); return; }
  gravarJson(pendenteFile(), { ...p, tentativas: p.tentativas + 1 } satisfies UpdatePendente);
  const pend = p;
  setTimeout(() => {
    for (const a of pend.antigos) fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(pendenteFile(), { force: true });
    const demorou = pend.pedidoEm !== null && Date.now() - Date.parse(pend.pedidoEm) > 10 * 60_000;
    log(`[atualização] ${pend.para} confirmada (ficou de pé${demorou ? ", bem depois do pedido" : ""}; ${pend.gatilho ?? "?"}); versão anterior apagada`);
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
    } catch (e) { log(`[atualização] não consegui voltar ${t}: ${erroTexto(e)}`); }
  }
  fs.rmSync(pendenteFile(), { force: true });
  const mine = runningBundle();
  if (mine !== null) relancar(mine); else app.exit(0);
}
