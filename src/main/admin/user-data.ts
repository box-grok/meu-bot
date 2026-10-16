/**
 * Variante: admin. Pasta de userData própria do meu-bot-admin. O Electron nomeia a pasta pelo productName do
 * package.json, que é "meu-bot" nos dois apps (o empacotador troca nome, bundle id e ícone, não o package.json),
 * então sem isto o admin e o meu-bot normal dividiriam configurações, conversas e a trava de instância única:
 * abrir um com o outro aberto fechava o segundo calado. Tem de rodar antes de qualquer uso do userData e do
 * requestSingleInstanceLock. Na primeira vez, traz o pessoas.json que o admin gravava na pasta compartilhada.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export const ADMIN_USER_DATA_NAME = "meu-bot-admin";

export function useAdminUserData(): void {
  const appData = app.getPath("appData");
  const dir = path.join(appData, ADMIN_USER_DATA_NAME);
  app.setName(ADMIN_USER_DATA_NAME);
  // Um --user-data-dir explícito (testes de fumaça ao lado do app instalado) continua valendo.
  if (app.commandLine.hasSwitch("user-data-dir")) return;
  app.setPath("userData", dir);
  const mine = path.join(dir, "pessoas.json");
  const shared = path.join(appData, "meu-bot", "pessoas.json");
  if (!fs.existsSync(mine) && fs.existsSync(shared)) {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.copyFileSync(shared, mine); fs.chmodSync(mine, 0o600); } catch { /* o seletor repõe pela caixa de entrada */ }
  }
}
