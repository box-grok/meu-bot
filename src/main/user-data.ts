/**
 * Pasta de userData própria por produto. O Electron nomeia a pasta pelo productName do package.json, que é
 * "meu-bot" em todos os apps (o empacotador troca nome, bundle id e ícone, não o package.json), então sem isto
 * o meu-bot-admin ou o meu-bot-crm dividiriam com o meu-bot normal configurações, conversas e a trava de
 * instância única: abrir um com o outro aberto fechava o segundo calado. Tem de rodar antes de qualquer uso
 * do userData e do requestSingleInstanceLock.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { carimboDe, deveHerdar, entradaHerdavel } from "./user-data-core";

/** `migrate(dir, appData)` roda uma vez depois de apontar o userData (ex.: o admin traz o pessoas.json). */
export function useVariantUserData(name: string, migrate?: (dir: string, appData: string) => void): void {
  const appData = app.getPath("appData");
  const dir = path.join(appData, name);
  app.setName(name);
  // Um --user-data-dir explícito (testes de fumaça ao lado do app instalado) continua valendo.
  if (app.commandLine.hasSwitch("user-data-dir")) return;
  app.setPath("userData", dir);
  if (migrate) migrate(dir, appData);
}

/**
 * Um app da pessoa (meu-bot-crm, um staging, meu-bot-fit…) nasce como cópia do app de origem dela (Produto.herdaDe):
 * tutoriais feitos, conversas, memória, favoritos e espaços de trabalho vêm juntos, em vez de começar do zero. Só na
 * primeira vez (carimbo por origem) e só enquanto o app novo não tem conversas próprias; depois cada app segue
 * sozinho. Caches, logs, o backend local e o que o chaveiro cifra com o nome do app ficam de fora (user-data-core.ts):
 * logins do Google Contatos e, em geral, do Navegador precisam ser refeitos no app novo.
 */
export const herdarDe = (nomeOrigem: string) => (dir: string, appData: string): void => {
  const origem = path.join(appData, nomeOrigem);
  const carimbo = path.join(dir, carimboDe(nomeOrigem));
  if (!fs.existsSync(path.join(origem, "settings.json"))) return;
  let conversas: string | null = null;
  try { conversas = fs.readFileSync(path.join(dir, "conversations.json"), "utf8"); } catch { conversas = null; }
  if (!deveHerdar(fs.existsSync(carimbo), conversas)) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let n = 0;
  for (const nome of fs.readdirSync(origem)) {
    if (!entradaHerdavel(nome)) continue;
    const de = path.join(origem, nome); const para = path.join(dir, nome);
    try { fs.rmSync(para, { recursive: true, force: true }); fs.cpSync(de, para, { recursive: true }); n++; }
    catch { /* uma entrada que não copiou não impede as outras */ }
  }
  fs.writeFileSync(carimbo, `${new Date().toISOString()} ${n} entradas de ${origem}\n`);
};
