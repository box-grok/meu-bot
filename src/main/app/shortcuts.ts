/**
 * Atalhos na área de trabalho: applets AppleScript que chamam o binário do app com um argumento.
 *   "<host>.app"          → `--host=<host>`   abre direto a janela da máquina
 *   "aliviar <host>.app"  → `--alivio=<host>` abre a janela de alívio (computador do Grok Bot)
 * Com o app já aberto, a chamada vira `second-instance` na instância principal (requestSingleInstanceLock).
 * `open -a` não serviria: num app já em execução o macOS descarta os `--args`.
 */
import { app, BrowserWindow, nativeImage } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidHost } from "./settings";

/** Emojis sorteados para o ícone de cada atalho (um por criação, nunca o mesmo da vez anterior). */
const EMOJIS = ["🦊", "🐙", "🦜", "🐝", "🦉", "🐬", "🦋", "🐢", "🦄", "🐳", "🍉", "🍋", "🍄", "🌵", "🌈", "⚡", "🔥", "🌊", "🪐", "🚀", "🎯", "🎲", "🧭", "🔮", "🧩", "🎈", "🛸", "🏄", "🥑", "🍩"];

export interface ShortcutLook { emoji: string; color: string }

/** Fundo sólido vivo (matiz sorteada) + emoji sorteado; evita repetir o emoji do atalho anterior. */
export function randomLook(avoidEmoji?: string): ShortcutLook {
  const pool = EMOJIS.filter((e) => e !== avoidEmoji);
  const emoji = pool[Math.floor(Math.random() * pool.length)] ?? "🦊";
  const hue = Math.floor(Math.random() * 360);
  return { emoji, color: `hsl(${hue} 70% 46%)` };
}

/** O botão de alívio é sempre igual: extintor sobre vermelho, para ser achado de longe. */
export const RELIEF_LOOK: ShortcutLook = { emoji: "🧯", color: "hsl(4 75% 48%)" };

/** PNG 1024² do ícone: quadrado arredondado na cor sólida com o emoji no centro, fundo transparente. */
async function renderIconPng(look: ShortcutLook): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;width:1024px;height:1024px;overflow:hidden}
    .tile{position:absolute;inset:60px;border-radius:230px;background:${look.color};display:flex;align-items:center;justify-content:center;
      box-shadow:inset 0 -40px 80px rgba(0,0,0,.18), inset 0 30px 60px rgba(255,255,255,.14)}
    .e{font:620px/1 "Apple Color Emoji","Segoe UI Emoji",sans-serif;transform:translateY(12px)}
  </style></head><body><div class="tile"><div class="e">${look.emoji}</div></div></body></html>`;
  const win = new BrowserWindow({
    show: false, width: 1024, height: 1024, transparent: true, frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 250)); // fonte de emoji e primeiro paint
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    return img.toPNG();
  } finally {
    win.destroy();
  }
}

/** Monta um .icns a partir do PNG 1024² com o iconutil do macOS. */
function pngToIcns(png: Buffer, out: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meu-bot-icon-"));
  const set = path.join(dir, "atalho.iconset");
  fs.mkdirSync(set);
  const base = nativeImage.createFromBuffer(png);
  const sizes: [string, number][] = [
    ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32], ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256], ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, px] of sizes) fs.writeFileSync(path.join(set, name), px === 1024 ? png : base.resize({ width: px, height: px, quality: "best" }).toPNG());
  const r = spawnSync("iconutil", ["-c", "icns", set, "-o", out], { encoding: "utf8", timeout: 30_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`iconutil falhou: ${(r.stderr || "").trim() || `código ${r.status}`}`);
}

const MARKER = "meu-bot-shortcut-v1";

/** Nome do applet na mesa: só o da máquina ("agente-box.app"). O seletor não precisa de atalho: o próprio meu-bot.app abre nele. */
export const shortcutPath = (host: string): string => appletPath(host);
/** Nome do botão de alívio: "aliviar <host>.app". */
export const reliefShortcutName = (host: string): string => `aliviar ${host}`;
const appletPath = (name: string): string => path.join(app.getPath("desktop"), `${name}.app`);

const markerFile = (name: string): string => path.join(appletPath(name), "Contents", "Resources", "meu-bot-host.txt");

/** Linha 1: marcador + nome do applet; linha 2 (opcional): emoji do ícone. */
function readMarker(name: string): { ok: boolean; emoji: string | null } {
  try {
    const [first, second] = fs.readFileSync(markerFile(name), "utf8").split("\n");
    return { ok: first?.trim() === `${MARKER} ${name}`, emoji: second?.trim() || null };
  } catch { return { ok: false, emoji: null }; }
}

export const hasShortcut = (host: string): boolean => readMarker(host).ok;
export const shortcutEmoji = (host: string): string | null => (readMarker(host).ok ? readMarker(host).emoji : null);
export const hasReliefShortcut = (host: string): boolean => readMarker(reliefShortcutName(host)).ok;

/** Comando que inicia o app com o argumento: binário empacotado, ou electron + pasta do app no dev. */
function launchCommand(arg: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
  const parts = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  return `${parts.map(q).join(" ")} ${arg} >/dev/null 2>&1 &`;
}

/** Cria o applet "<name>.app" na mesa (substitui o anterior nosso), com ícone gerado. */
async function createApplet(name: string, arg: string, look: ShortcutLook): Promise<void> {
  const target = appletPath(name);
  removeApplet(name);
  const png = await renderIconPng(look);
  // AppleScript: `do shell script` com o comando em background; o applet encerra na hora.
  const script = `do shell script ${JSON.stringify(launchCommand(arg))}`;
  const r = spawnSync("osacompile", ["-o", target, "-e", script], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`osacompile falhou: ${(r.stderr || r.stdout || "").trim() || `código ${r.status}`}`);
  const res = path.join(target, "Contents", "Resources");
  fs.writeFileSync(path.join(res, "meu-bot-host.txt"), `${MARKER} ${name}\n${look.emoji}\n`);
  try { pngToIcns(png, path.join(res, "applet.icns")); } catch { /* sem ícone próprio fica o do applet; o atalho funciona igual */ }
  // O applet vem com um catálogo Assets.car e CFBundleIconName apontando para o ícone padrão; o Finder
  // prefere isso ao applet.icns. Sem os dois, o nosso ícone aparece.
  try { fs.rmSync(path.join(res, "Assets.car"), { force: true }); } catch { /* ok */ }
  spawnSync("defaults", ["delete", path.join(target, "Contents", "Info.plist"), "CFBundleIconName"], { timeout: 10_000 });
  // Sem ícone no Dock enquanto o applet roda (ele vive por menos de um segundo).
  spawnSync("defaults", ["write", path.join(target, "Contents", "Info.plist"), "LSUIElement", "-bool", "true"], { timeout: 10_000 });
  // Finder só percebe o ícone novo quando a pasta muda de data.
  try { const now = new Date(); fs.utimesSync(target, now, now); } catch { /* ok */ }
}

function removeApplet(name: string): void {
  const target = appletPath(name);
  if (!fs.existsSync(target)) return;
  // Só remove o que foi criado por nós (marcador), nunca uma pasta qualquer com esse nome.
  if (!readMarker(name).ok) throw new Error(`"${path.basename(target)}" existe na mesa mas não é um atalho do meu-bot; não removo.`);
  fs.rmSync(target, { recursive: true, force: true });
}

export async function createShortcut(host: string): Promise<ShortcutLook> {
  if (!isValidHost(host)) throw new Error(`Host inválido: ${JSON.stringify(host)}`);
  const look = randomLook(shortcutEmoji(host) ?? undefined);
  await createApplet(host, `--host=${host}`, look);
  return look;
}

export function removeShortcut(host: string): void {
  if (!isValidHost(host)) return;
  removeApplet(host);
}

export async function createReliefShortcut(host: string): Promise<void> {
  if (!isValidHost(host)) throw new Error(`Host inválido: ${JSON.stringify(host)}`);
  await createApplet(reliefShortcutName(host), `--alivio=${host}`, RELIEF_LOOK);
}

export function removeReliefShortcut(host: string): void {
  if (!isValidHost(host)) return;
  removeApplet(reliefShortcutName(host));
}

/** `--alivio=<x>` entre os argumentos: abre a janela de alívio da máquina. */
export function reliefHostFromArgv(argv: readonly string[]): string | null {
  for (const a of argv) {
    const m = /^--alivio=(.+)$/.exec(a);
    if (m !== null && isValidHost(m[1]!)) return m[1]!;
  }
  return null;
}

/** `--host=<x>` entre os argumentos (primeira execução ou segunda instância). */
export function hostFromArgv(argv: readonly string[]): string | null {
  for (const a of argv) {
    const m = /^--host=(.+)$/.exec(a);
    if (m !== null && isValidHost(m[1]!)) return m[1]!;
  }
  return null;
}
