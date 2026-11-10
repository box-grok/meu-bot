/** Contrato IPC · Atualização do app. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/** Conta e limites do Claude Code na máquina (cache do statusline.sh), via GET /v1/meu-bot/status. */
/** Atualização automática do app (src/main/updater.ts). */
/**
 * Fase para a tela: idle (dev/desligado) · checking · up-to-date · available (achou, vai baixar) · downloading (com
 * `progress`) · verifying (assinatura, extração, codesign) · ready (preparada em disco) · applying (trocando, ou
 * esperando uma resposta em andamento) · needs-move (o app está numa pasta só de leitura) · error.
 */
export type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "verifying" | "ready" | "applying" | "needs-move" | "error";
/**
 * Por que a última verificação falhou: rede (sem internet), github (a API respondeu mal ou limitou), release
 * (achamos uma release e não dá para instalar: sem o arquivo desta arquitetura, sem assinatura, corpo estranho),
 * download, assinatura/integridade do zip ou do .app, disco (sem espaço), outro.
 */
export type UpdateErrorKind = "rede" | "github" | "release" | "download" | "assinatura" | "disco" | "outro";
/** Quem disparou a verificação (vai no registro). */
export type UpdateTrigger = "inicio" | "periodico" | "explicito" | "rede-voltou" | "acordou" | "confirmar" | "versao-minima" | "atualizar-agora";
export interface UpdateState {
  current: string;
  available: string | null;
  /** Versão preparada e conferida em disco (sobrevive a fechar e abrir o app). */
  ready: string | null;
  checking: boolean;
  error: string | null;
  errorKind: UpdateErrorKind | null;
  phase: UpdatePhase;
  /** Última consulta ao GitHub (ISO); null antes da primeira. */
  checkedAt: string | null;
  /** Em downloading: 0..1 (null enquanto o servidor não disse o total). */
  progress: number | null;
  /** Em applying: esperando uma resposta ou um terminal terminar antes de reiniciar. */
  aguardando: boolean;
  /**
   * A troca foi pedida, a espera pela resposta em andamento esgotou e o app NÃO reiniciou: a escolha de parar o
   * trabalho volta para a pessoa ("Parar e atualizar"). Antes o app reiniciava calado por cima da conversa.
   */
  ocupadoAoAplicar: boolean;
  /** Versão mínima que o backend da máquina exige (null = ele não disse); abaixo dela a janela bloqueia até atualizar. */
  minima: string | null;
  abaixoDaMinima: boolean;
  /**
   * Build que não saiu de uma release (o hook ou um `npm run dist…` empacotou o main ou um branch): a versão dele
   * não muda a cada merge e nada publicado é mais novo; a tela diz isso em vez de "versão mais recente".
   */
  buildLocal: boolean;
  /** Commit de onde o build saiu (Resources/build.json); "" se não se sabe. */
  commit: string;
  /** Preferência "atualizar sozinho quando o Mac estiver ocioso" (Configurações › Sobre e atualização). */
  atualizarOcioso: boolean;
}
