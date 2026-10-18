/**
 * Seletor de máquinas: a janela que abre o app ("abrir o meu-bot em…"). Sonda todos os hosts em paralelo
 * (com cache curto para reabrir instantâneo) e abre a janela principal do escolhido. O que muda por variante
 * vem de uma PickerSource: no meu-bot normal (clientPickerSource, aqui) a lista é `local` + hosts do
 * ~/.ssh/config, com instalar o backend, sincronizar o ~/.ssh/config, renomear e remover; no meu-bot-admin
 * (admin/picker-source.ts) a lista são as pessoas do suporte. Os handlers comuns ficam em initPicker.
 */
import { BrowserWindow, shell } from "electron";
import path from "node:path";
import type { HostProbe, PickerInit } from "../shared/ipc";
import { approveTailscaleCheck, installAudio, installBackend, installClaudeCode, installGuarda, installStatusLine, probeHost } from "./hostProbe";
import { isSupportAlias } from "./support-code";
import { LOCAL_HOST } from "./localBackend";
import { runSsh } from "./whatsapp";
import { showRelief } from "./relief";
import { openGrokbotReset } from "./grokbot";
import { clearTailscaleCredential, saveTailscaleCredential, tailscaleCredentialState } from "./secrets";
import { disableSshCheck } from "./tailscale";
import { handleClient, handleShared, onShared } from "./ipc/registry";
import { log } from "./backend";
import { settingsView, getBackendPort, getHostNames, getLastHost, getOpenDirect, isOnboardingDone, isPodHost, isValidHost, setHostName, setLastHost, setOnboardingDone, setOpenDirect, setPodHost } from "./settings";
import { listSshHosts } from "./sshConfig";
import { removeHostFromSshConfig, syncSshConfig } from "./sshSync";
import {
  createReliefShortcut, createShortcut, hasReliefShortcut, hasShortcut, removeReliefShortcut, removeShortcut, shortcutEmoji,
} from "./shortcuts";
import { backgroundColor, broadcast, openMainWindow, sendWhenLoaded, windowForHost } from "./windows";

/** URLs que o seletor pode pedir para abrir: lista fechada, nunca URL livre do renderer. */
const KNOWN_URLS: Record<string, string> = { "tailscale-keys": "https://login.tailscale.com/admin/settings/keys" };

/** O que o seletor usa de dentro, oferecido aos handlers de cada variante. */
export interface PickerIpcContext {
  /** O pedido veio da janela do seletor? */
  fromPicker(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean;
  /** `payload.host` validado. */
  hostArg(payload: unknown): string;
  /** A próxima sondagem desse host precisa ser nova. */
  forgetProbe(host: string): void;
  /** Linha de progresso de uma instalação, para a lista do seletor. */
  progress(host: string, line: string): void;
  closePicker(): void;
}

/** O que muda no seletor por variante. */
export interface PickerSource {
  title: string;
  /** Os hosts da lista. */
  hosts(): string[];
  /** meu-bot-admin: as pessoas; null no meu-bot normal. */
  support(): PickerInit["support"];
  /** Handlers só desta variante (os comuns ficam em initPicker). */
  registerIpc(ctx: PickerIpcContext): void;
}

let source: PickerSource | null = null;
let pickerWin: BrowserWindow | null = null;
let lastError: string | null = null;
let preselectOverride: string | null = null;

/** Última sondagem por host; serve `window:info` (modelos) e reabre o seletor sem esperar o ssh. */
const probes = new Map<string, { probe: HostProbe; at: number }>();
const PROBE_TTL_MS = 60_000;
const inflight = new Map<string, Promise<HostProbe>>();

export const knownModels = (host: string): string[] => probes.get(host)?.probe.models ?? [];

function probeCached(host: string): Promise<HostProbe> {
  const hit = probes.get(host);
  if (hit !== undefined && Date.now() - hit.at < PROBE_TTL_MS) return Promise.resolve(hit.probe);
  const running = inflight.get(host);
  if (running !== undefined) return running;
  const p = probeHost(host, getBackendPort()).then((probe) => {
    probes.set(host, { probe, at: Date.now() });
    // Só uma sondagem que entrou sabe dizer; inacessível não apaga o que já se sabia.
    if (probe.reachable) setPodHost(host, probe.grokPod);
    ensureGuarda(host, probe);
    return probe;
  }).finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

/**
 * Anti-loop é padrão da conta: toda máquina com OpenClaw recebe a guarda do WhatsApp sozinha (notas técnicas
 * não vão ao contato; despedidas bot-com-bot em 3 ciclos pausam a conversa). Uma tentativa por máquina por
 * sessão do app, em segundo plano; o tutorial 8 só confere e explica. Uma máquina sem SSH ou sem OpenClaw fica fora.
 */
const guardaTried = new Set<string>();
function ensureGuarda(host: string, probe: HostProbe): void {
  if (!probe.reachable || probe.gateway !== "openclaw" || probe.guarda !== false || host === LOCAL_HOST || guardaTried.has(host)) return;
  guardaTried.add(host);
  log(`[guarda] ${host}: máquina com OpenClaw sem a guarda; instalando em segundo plano`);
  void installGuarda(host).then((r) => {
    log(`[guarda] ${host}: ${r.ok ? "instalada sozinha" : `instalação automática falhou: ${r.log.at(-1) ?? "?"}`}`);
    const hit = probes.get(host); if (r.ok && hit !== undefined) probes.set(host, { probe: { ...hit.probe, guarda: true }, at: hit.at });
  }).catch((e: unknown) => { log(`[guarda] ${host}: instalação automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

const current = (): PickerSource => { if (source === null) throw new Error("seletor sem fonte: initPicker não rodou"); return source; };

/** A chegada animada do seletor toca uma vez por sessão do app; depois a lista aparece seca. */
let arrivalShown = false;

function initPayload(): PickerInit {
  const arrival = !arrivalShown; arrivalShown = true;
  const hosts = current().hosts();
  const wanted = preselectOverride ?? getLastHost() ?? LOCAL_HOST;
  return {
    hosts,
    support: current().support(),
    preselect: hosts.includes(wanted) ? wanted : (hosts[0] ?? LOCAL_HOST),
    open: hosts.filter((h) => windowForHost(h) !== undefined),
    shortcuts: hosts.filter(hasShortcut).map((h) => ({ host: h, emoji: shortcutEmoji(h) })),
    pods: hosts.filter(isPodHost),
    reliefShortcuts: hosts.filter(hasReliefShortcut),
    openDirect: getOpenDirect(),
    names: getHostNames(),
    onboardingDone: isOnboardingDone(),
    error: lastError,
    arrival,
  };
}

const ctx: PickerIpcContext = {
  fromPicker: (event) => pickerWin !== null && !pickerWin.isDestroyed() && event.sender === pickerWin.webContents,
  hostArg: (payload) => {
    const host = String((payload as { host?: unknown } | null)?.host ?? "").trim();
    if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
    return host;
  },
  forgetProbe: (host) => { probes.delete(host); },
  progress: (host, line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); },
  closePicker: () => { pickerWin?.close(); },
};
const { fromPicker, hostArg } = ctx;

/**
 * Variante: cliente. `local` + hosts do ~/.ssh/config, menos os aliases `suporte-*` (do meu-bot-admin, via
 * Include no ~/.ssh/config): são as máquinas das pessoas que o admin atende, não máquinas desta pessoa.
 */
export const clientPickerSource: PickerSource = {
  title: "meu-bot · escolher máquina",
  hosts: () => [LOCAL_HOST, ...listSshHosts().filter((h) => !isSupportAlias(h))],
  support: () => null,
  registerIpc: ({ fromPicker, hostArg, forgetProbe, progress, closePicker }) => {
    handleClient("picker:install", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installBackend(host, getBackendPort(), (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-statusline", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installStatusLine(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-claude", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installClaudeCode(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-guarda", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installGuarda(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-transcricao", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installAudio(host, { kind: "in" }, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:sync-ssh", (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return syncSshConfig();
    });
    // "Remover do seletor": sai do ~/.ssh/config (com backup) e os atalhos da mesa dela vão junto.
    handleClient("picker:remove-host", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      if (host === LOCAL_HOST) throw new Error("este Mac não sai da lista");
      if (windowForHost(host) !== undefined) throw new Error(`feche a janela de ${host} antes de remover`);
      const r = removeHostFromSshConfig(host);
      if (hasShortcut(host)) removeShortcut(host);
      if (hasReliefShortcut(host)) removeReliefShortcut(host);
      forgetProbe(host);
      if (getLastHost() === host) setLastHost(LOCAL_HOST);
      return { backup: r.backup };
    });
    handleClient("picker:rename-host", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      setHostName(host, String((payload as { name?: unknown } | null)?.name ?? ""));
      // As janelas abertas trocam o título na hora (settings:changed já leva hostNames).
      broadcast("settings:changed", settingsView());
    });
    handleClient("picker:open-direct", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      setOpenDirect((payload as { value?: unknown } | null)?.value === true);
    });
    handleClient("picker:onboarding-done", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      setOnboardingDone((payload as { value?: unknown } | null)?.value === true);
    });
    handleClient("picker:approve-tailscale", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await approveTailscaleCheck(host);
      forgetProbe(host);
      return r;
    });
    handleClient("picker:tailscale-credential-save", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { clientId?: unknown; clientSecret?: unknown } | null;
      return saveTailscaleCredential(String(p?.clientId ?? ""), String(p?.clientSecret ?? ""));
    });
    handleClient("picker:tailscale-credential-forget", (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return clearTailscaleCredential();
    });
    handleClient("picker:tailscale-disable-check", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await disableSshCheck();
      forgetProbe(host);
      return r;
    });
    handleClient("picker:claude-login", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const raw = String((payload as { host?: unknown } | null)?.host ?? "").trim();
      const host = raw === LOCAL_HOST ? LOCAL_HOST : hostArg(payload);
      setLastHost(host);
      const win = openMainWindow(host, "picker");
      sendWhenLoaded(win, "ui:claude-login", {});
      forgetProbe(host);
      closePicker();
    });
  },
};

export function initPicker(src: PickerSource): void {
  source = src;
  handleShared("picker:list", (event) => { if (!fromPicker(event)) throw new Error("origem inválida"); return initPayload(); });
  // Plano de cada host (licenca.json por SSH, melhor esforço) para o selo "PRO"; local e máquinas fora do ar ficam de fora.
  handleShared("picker:plans", async (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const hosts = current().hosts().filter((h) => h !== LOCAL_HOST && isValidHost(h));
    const out: Record<string, "free" | "pro"> = {};
    await Promise.all(hosts.map(async (h) => {
      try {
        const r = await runSsh(h, `cat "$HOME/.local/share/meu-bot/licenca.json" 2>/dev/null; echo\n`, 10_000);
        if (r.code !== 0) return;
        const v = JSON.parse(r.stdout.trim() || "null") as { plan?: unknown } | null;
        if (v && (v.plan === "pro" || v.plan === "free")) out[h] = v.plan;
      } catch { /* fora do ar, ausente ou JSON inválido: sem selo */ }
    }));
    return out;
  });
  handleShared("picker:probe", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return probeCached(hostArg(payload));
  });
  handleShared("picker:choose", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    setLastHost(host);
    lastError = null;
    preselectOverride = null;
    openMainWindow(host, "picker");
    // Abrir antes de fechar: fora do macOS, fechar a última janela encerraria o app.
    pickerWin?.close();
  });
  handleShared("picker:shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createShortcut(host); else removeShortcut(host);
    return { has: hasShortcut(host), emoji: shortcutEmoji(host) };
  });
  handleShared("picker:relieve", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    if (!isPodHost(host)) throw new Error(`${host} não foi reconhecida como computador do Grok Bot.`);
    showRelief(host);
    pickerWin?.close();
  });
  handleShared("picker:relief-shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createReliefShortcut(host); else removeReliefShortcut(host);
    return { has: hasReliefShortcut(host) };
  });
  handleShared("picker:tailscale-credential", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return tailscaleCredentialState();
  });
  handleShared("picker:open-url", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const which = String((payload as { which?: unknown } | null)?.which ?? "");
    const url = KNOWN_URLS[which];
    if (url === undefined) throw new Error("página desconhecida");
    await shell.openExternal(url);
  });
  handleShared("picker:open-grokbot-reset", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return openGrokbotReset();
  });
  onShared("picker:cancel", (event) => { if (fromPicker(event)) pickerWin?.close(); });
  src.registerIpc(ctx);
}

/** Mostra o seletor (foca se já existe). `error` aparece no topo; `preselect` vence a última máquina. */
export function showPicker(opts: { error?: string; preselect?: string } = {}): void {
  if (opts.error !== undefined) lastError = opts.error;
  if (opts.preselect !== undefined) preselectOverride = opts.preselect;
  if (pickerWin !== null && !pickerWin.isDestroyed()) {
    pickerWin.show();
    pickerWin.focus();
    if (!pickerWin.webContents.isLoading()) pickerWin.webContents.send("picker:init", initPayload());
    return;
  }
  const win = new BrowserWindow({
    width: 540, height: 600, minWidth: 460, minHeight: 420, resizable: true,
    title: current().title,
    titleBarStyle: "hiddenInset",
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "picker-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  pickerWin = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) win.webContents.send("picker:init", initPayload()); });
  win.on("closed", () => { if (pickerWin === win) pickerWin = null; });
  void win.loadFile(path.join(__dirname, "..", "renderer", "picker.html"));
}

export const isPickerOpen = (): boolean => pickerWin !== null && !pickerWin.isDestroyed();
