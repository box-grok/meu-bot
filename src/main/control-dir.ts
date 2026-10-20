/**
 * Pasta curta dos sockets deste app: o mestre do SSH (cm-%C, tunnel.ts) e o serviço do Navegador para o agente
 * (nav-<host>.sock, nav-api.ts). Fica em /tmp porque o caminho em userData passa dos 104 bytes do sun_path, e é
 * POR APP (/tmp/<app>-<uid>): o estável e o staging abertos juntos não podem dividir o mestre do SSH (um fecharia
 * os túneis do outro ao sair) nem o socket do agente (ele navegaria no Navegador do app errado).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appTitle } from "./variant";

export function controlDir(): string {
  const dir = path.join(os.tmpdir().startsWith("/") ? "/tmp" : os.tmpdir(), `${appTitle()}-${os.userInfo().uid}`);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== os.userInfo().uid) throw new Error(`Diretório de controle inseguro: ${dir}`);
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  return dir;
}
