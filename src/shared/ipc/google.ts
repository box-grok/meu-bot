/** Contrato IPC · Conta Google: perfil, Gmail, Agenda, Planilhas, backup no Drive. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/** `foto`: a URL do Google, como veio. `fotoLocal`: a mesma imagem em data URL, baixada no main (a tela tem CSP `img-src 'self' data:`). */
export interface GooglePerfil { sub: string; email: string | null; emailVerificado: boolean; nome: string | null; foto: string | null; fotoLocal: string | null }
/** : de onde veio o client OAuth e de qual projeto do Google Cloud; null = nenhum configurado. */
export interface GoogleContaStatus { configurado: boolean; conectado: boolean; conectando: boolean; /** Máquina a que esta conta pertence (cada VM tem a sua). */ maquina: string; /** E-mail da conta antiga, única do Mac, que pode ser adotada nesta máquina; null = não há. */ contaDoMac: string | null; precisaReconectar: boolean; perfil: GooglePerfil | null; escopos: string[]; cliente: { projeto: string; origem: string } | null }
/** Um conjunto de dados da máquina que subiu para o Drive (CRM e financeiro vão separados, de propósito). */
export interface BackupDadosEnvio { conjunto: string; caminho: string; bytes: number; apagados: number; /** Caminho da cópia local no Mac, gravada antes do envio. */ local: string }
/** Cópia diária do CRM e do financeiro desta máquina no Drive da Conta Google do dono. */
export interface BackupDadosView { ligado: boolean; /** Só se existe senha do pacote cifrado; o valor nunca atravessa o IPC. */ temSenha: boolean; ultimaEm: string | null; /** Quando a última tentativa rodou (com ou sem sucesso); o erro é dessa hora. */ tentativaEm: string | null; conta: string | null; enviados: BackupDadosEnvio[]; erro: string | null }
export interface GmailMensagem { id: string; de: string; assunto: string; data: string; resumo: string; naoLida: boolean }
export interface GmailResumo { email: string | null; naoLidas: number; mensagens: GmailMensagem[] }
export interface AgendaEvento { id: string; titulo: string; inicio: string; fim: string; local: string; link: string }
export interface PlanilhaLeitura { intervalo: string; valores: string[][] }
