/**
 * Variante: admin. Na primeira vez, traz o pessoas.json que o admin gravava na pasta compartilhada "meu-bot"
 * (antes de ter userData próprio; ver src/main/user-data.ts).
 */
import fs from "node:fs";
import path from "node:path";

export function migrateAdminPessoas(dir: string, appData: string): void {
  const mine = path.join(dir, "pessoas.json");
  const shared = path.join(appData, "meu-bot", "pessoas.json");
  if (!fs.existsSync(mine) && fs.existsSync(shared)) {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.copyFileSync(shared, mine); fs.chmodSync(mine, 0o600); } catch { /* o seletor repõe pela caixa de entrada */ }
  }
}
