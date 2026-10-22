/**
 * Pedido de câmera/microfone de uma página do Navegador: consulta o que já foi decidido para a origem (permissoes.json
 * na pasta do Navegador da máquina), senão pergunta à janela (balão como o do Brave) e espera a resposta; com
 * "permitir", também pede ao macOS se ele ainda não liberou a câmera/o microfone para o meu-bot.
 */
import { app, BrowserWindow, systemPreferences } from "electron";
import fs from "node:fs";
import path from "node:path";
import { decisaoGuardada, esquecer, guardar, nomeTipos, parsePermissoes, type Decisao, type PermissoesGuardadas, type TipoMidia } from "./nav-permissoes-core";

const sanit = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");
const arquivo = (host: string): string => path.join(app.getPath("userData"), "Navegador", sanit(host), "permissoes.json");
function ler(host: string): PermissoesGuardadas { try { return parsePermissoes(JSON.parse(fs.readFileSync(arquivo(host), "utf8"))); } catch { return {}; } }
function gravar(host: string, g: PermissoesGuardadas): void { const f = arquivo(host); fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(g, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); }

/** "Permitir desta vez": vale para aquela aba (webContents) e origem até ela fechar. */
const destaVez = new Set<string>();
const pendentes = new Map<string, (d: Decisao | null) => void>();
let seq = 0;

/** O macOS deixa o meu-bot usar a câmera/o microfone? Pergunta na primeira vez; false = bloqueado nos Ajustes. */
async function liberadoNoMac(tipos: readonly TipoMidia[]): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  for (const t of tipos) {
    const m = t === "camera" ? "camera" : "microphone";
    const st = systemPreferences.getMediaAccessStatus(m);
    if (st === "granted") continue;
    if (st === "not-determined") { if (!(await systemPreferences.askForMediaAccess(m))) return false; continue; }
    return false;
  }
  return true;
}

/** Já está liberado sem perguntar (para o check handler do Electron). */
export function permissaoJaDada(host: string, wcId: number, origem: string, tipos: readonly TipoMidia[]): boolean {
  return decisaoGuardada(ler(host), origem, tipos) === "permitir" || tipos.every((t) => destaVez.has(`${wcId}|${origem}|${t}`));
}

export async function pedirPermissao(host: string, win: BrowserWindow | null, wcId: number, origem: string, tipos: TipoMidia[]): Promise<boolean> {
  const guardada = decisaoGuardada(ler(host), origem, tipos);
  if (guardada === "negar") return false;
  if (guardada === "permitir" || tipos.every((t) => destaVez.has(`${wcId}|${origem}|${t}`))) return liberar(win, origem, tipos);
  if (win === null || win.isDestroyed()) return false;
  const id = `p${++seq}`;
  const resposta = await new Promise<Decisao | null>((resolve) => {
    pendentes.set(id, resolve);
    win.webContents.send("browser:permissao", { id, origem, tipos, texto: `${new URL(origem).host} quer usar a ${nomeTipos(tipos)}` });
    setTimeout(() => { if (pendentes.delete(id)) { resolve(null); if (!win.isDestroyed()) win.webContents.send("browser:permissao", { id, origem, tipos, texto: "", fechar: true }); } }, 120_000).unref();
  });
  if (resposta === null || resposta === "nunca") { if (resposta === "nunca") gravar(host, guardar(ler(host), origem, tipos, "nunca")); return false; }
  if (resposta === "sempre") gravar(host, guardar(ler(host), origem, tipos, "sempre"));
  else for (const t of tipos) destaVez.add(`${wcId}|${origem}|${t}`);
  return liberar(win, origem, tipos);
}
async function liberar(win: BrowserWindow | null, origem: string, tipos: TipoMidia[]): Promise<boolean> {
  if (await liberadoNoMac(tipos)) return true;
  if (win !== null && !win.isDestroyed()) win.webContents.send("browser:permissao", { id: `m${++seq}`, origem, tipos, texto: `O macOS está bloqueando a ${nomeTipos(tipos)} do meu-bot. Abra Ajustes do Sistema › Privacidade e Segurança › ${tipos.includes("camera") ? "Câmera" : "Microfone"}, ligue o meu-bot e recarregue a página.`, aviso: true });
  return false;
}
/** A janela respondeu ao balão. */
export function responderPermissao(id: string, d: Decisao): void { const r = pendentes.get(id); if (r !== undefined) { pendentes.delete(id); r(d); } }
/** Esquece o que foi decidido para uma origem (ou todas) nesta máquina. */
export function esquecerPermissoes(host: string, origem?: string): void { gravar(host, origem === undefined ? {} : esquecer(ler(host), origem)); for (const k of [...destaVez]) if (origem === undefined || k.includes(`|${origem}|`)) destaVez.delete(k); }
export function esquecerAba(wcId: number): void { for (const k of [...destaVez]) if (k.startsWith(`${wcId}|`)) destaVez.delete(k); }
