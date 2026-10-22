/**
 * App encerrado (o antigo meu-bot-crm): o CRM próprio passou a vir no meu-bot, liberado pela licença. Este app continua
 * publicado só para quem ainda o tem instalado atualizar e ver o aviso; não abre janela, não lê nem grava dados
 * (a fusão da pasta é feita pelo meu-bot na primeira abertura dele).
 */
import { app, dialog, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UPDATE_REPO } from "./updater-core";

export function encerrar(nome: string): void {
  const alvo = path.join(os.homedir(), "Applications", "meu-bot.app");
  const tem = fs.existsSync(alvo);
  const escolha = dialog.showMessageBoxSync({
    type: "info",
    title: nome,
    message: `O ${nome} virou parte do meu-bot.`,
    detail: `O CRM no Gmail agora vem no meu-bot e abre com o seu plano. ${tem ? "Abra o meu-bot" : "Baixe o meu-bot"}: tudo o que você tinha aqui (conversas, favoritos, preferências) vai junto na primeira abertura; só o login do Google e os logins do Navegador precisam ser refeitos. Depois, este app pode ser apagado.`,
    buttons: [tem ? "Abrir o meu-bot" : "Baixar o meu-bot", "Fechar"],
    defaultId: 0,
    cancelId: 1,
  });
  if (escolha === 0) {
    if (tem) void shell.openPath(alvo); else void shell.openExternal(`https://github.com/${UPDATE_REPO}/releases/latest`);
    setTimeout(() => app.exit(0), 800);
    return;
  }
  app.exit(0);
}
