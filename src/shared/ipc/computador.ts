/** Contrato IPC · Computador (a tela do bot ao vivo, via noVNC pelo túnel). Só tipos; reexportado por src/shared/ipc.ts. */

/** O que a máquina diz da tela. `erro`: não deu para perguntar (máquina fora, SSH caiu); aí o resto não vale. */
export interface TelaStatus {
  instalada: boolean;
  rodando: boolean;
  erro: string | null;
}
/** Resultado de instalar a tela na máquina: `codigo` 3 = faltam pacotes e não há sudo (precisa do admin). */
export interface TelaInstalacao {
  ok: boolean;
  codigo: number | null;
  log: string[];
}
/** Onde o <webview> do Computador carrega a tela: a url local do noVNC e a partição que o main aceita. */
export interface TelaEndereco {
  url: string;
  particao: string;
}
