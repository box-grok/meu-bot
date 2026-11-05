/**
 * Variante: admin. Na primeira abertura do meu-bot-admin-gestao, traz os dados do app como ele se chamava antes:
 * a pasta "meu-bot-admin" (até 4 nov: pessoas, configurações, produtos, auditoria entregue) e, mais antigo ainda, o
 * pessoas.json da pasta compartilhada "meu-bot" (antes de ter userData próprio). A origem fica intacta, como backup.
 */
import fs from "node:fs";
import path from "node:path";

/** O que o admin guarda na pasta de dados e vale levar (caches, logs e o que o chaveiro cifra pelo nome do app, não). */
const ARQUIVOS_DO_ADMIN = ["pessoas.json", "settings.json", "produtos.json", "auditoria-entregue.json"] as const;

export function migrateAdminPessoas(dir: string, appData: string): void {
  const mine = path.join(dir, "pessoas.json");
  if (fs.existsSync(mine)) return;
  const antigo = path.join(appData, "meu-bot-admin");
  if (fs.existsSync(path.join(antigo, "pessoas.json"))) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const nome of ARQUIVOS_DO_ADMIN) {
        const de = path.join(antigo, nome), para = path.join(dir, nome);
        if (fs.existsSync(de) && !fs.existsSync(para)) { fs.copyFileSync(de, para); fs.chmodSync(para, 0o600); }
      }
      return;
    } catch { /* cai no caminho antigo abaixo; o seletor repõe pela caixa de entrada */ }
  }
  const shared = path.join(appData, "meu-bot", "pessoas.json");
  if (fs.existsSync(shared)) {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.copyFileSync(shared, mine); fs.chmodSync(mine, 0o600); } catch { /* o seletor repõe pela caixa de entrada */ }
  }
}
