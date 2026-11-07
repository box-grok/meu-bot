/**
 * Deep link da conta meu-bot (IO): registra o esquema do produto no sistema e entrega ao app a URL com que a página
 * de login devolve a pessoa. No macOS a URL chega pelo evento `open-url` (que precisa estar ligado ANTES do `ready`:
 * quando o app está fechado, o LaunchServices o abre e dispara o evento ainda no arranque); no Windows/Linux ela vem
 * nos argumentos da instância nova (`second-instance`) ou do próprio processo. O que chega antes de alguém escutar
 * fica na fila e sai quando `aoReceberUrl` é chamado, depois do `ready`.
 */
import { app } from "electron";
import path from "node:path";
import { log } from "../maquina/backend";
import { ehUrlDoEsquema, urlDeArgv } from "./deep-link-core";

let ouvinte: ((url: string) => void) | null = null;
const pendentes: string[] = [];
const entregar = (url: string): void => { if (ouvinte === null) pendentes.push(url); else ouvinte(url); };

/** Liga o `open-url` do macOS para este esquema. Chamar antes do `ready`. */
export function instalarOpenUrl(esquema: string): void {
  app.on("open-url", (event, url) => {
    if (!ehUrlDoEsquema(url, esquema)) return;
    event.preventDefault();
    log(`[conta] deep link recebido (open-url)`);
    entregar(url);
  });
}

/** A URL deste esquema nos argumentos (Windows/Linux, segunda instância): entrega e diz que havia uma. */
export function tratarArgv(argv: readonly string[], esquema: string): boolean {
  const url = urlDeArgv(argv, esquema);
  if (url === null) return false;
  log(`[conta] deep link recebido (argv)`);
  entregar(url);
  return true;
}

/** Quem trata as URLs; o que já tinha chegado sai agora, na ordem. */
export function aoReceberUrl(cb: (url: string) => void): void {
  ouvinte = cb;
  for (const u of pendentes.splice(0)) cb(u);
}

/**
 * Registra o esquema no sistema. Empacotado no macOS já está no Info.plist (CFBundleURLTypes, scripts/package.mjs) e
 * esta chamada só confirma; no Windows/Linux é ela que registra; em dev (`electron .`) aponta para o executável com o
 * caminho do projeto, senão o sistema abriria o Electron sem o app.
 */
export function registrarEsquema(esquema: string): void {
  const ok = app.isPackaged ? app.setAsDefaultProtocolClient(esquema) : app.setAsDefaultProtocolClient(esquema, process.execPath, [path.resolve(process.argv[1] ?? ".")]);
  log(`[conta] esquema ${esquema}:// ${ok ? "registrado" : "NÃO registrado"} (${app.isPackaged ? "empacotado" : "dev"})`);
}
