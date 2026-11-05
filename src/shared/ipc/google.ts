/** Contrato IPC · Conta Google: perfil, Gmail, Agenda, Planilhas, backup no Drive. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/** `foto`: a URL do Google, como veio. `fotoLocal`: a mesma imagem em data URL, baixada no main (a tela tem CSP `img-src 'self' data:`). */
export interface GooglePerfil { sub: string; email: string | null; emailVerificado: boolean; nome: string | null; foto: string | null; fotoLocal: string | null }
/** : de onde veio o client OAuth e de qual projeto do Google Cloud; null = nenhum configurado. */
export interface GoogleContaStatus { configurado: boolean; conectado: boolean; conectando: boolean; /** Máquina a que esta conta pertence (cada VM tem a sua). */ maquina: string; /** E-mail da conta antiga, única do Mac, que pode ser adotada nesta máquina; null = não há. */ contaDoMac: string | null; precisaReconectar: boolean; /** A autorização inclui gmail.modify (lixeira do Gmail); sem ele a página lê e busca, e pede reconectar só para apagar. */ gmailEscreve: boolean; perfil: GooglePerfil | null; escopos: string[]; cliente: { projeto: string; origem: string } | null; /** Sem client no build, o app tentou buscar na release: null = resolveu (ou não precisou); texto = por que ainda falta. */ busca?: string | null }
/** Um conjunto de dados da máquina que subiu para o Drive (CRM e financeiro vão separados, de propósito). */
export interface BackupDadosEnvio { conjunto: string; caminho: string; bytes: number; apagados: number; /** Caminho da cópia local no Mac, gravada antes do envio. */ local: string }
/** Cópia diária do CRM e do financeiro desta máquina no Drive da Conta Google do dono. */
export interface BackupDadosView { ligado: boolean; /** Só se existe senha do pacote cifrado; o valor nunca atravessa o IPC. */ temSenha: boolean; ultimaEm: string | null; /** Quando a última tentativa rodou (com ou sem sucesso); o erro é dessa hora. */ tentativaEm: string | null; conta: string | null; enviados: BackupDadosEnvio[]; erro: string | null }
/** Etapa de um conjunto durante a cópia: `pulado` = cifrado sem senha; `ausente` = a máquina não tem o conjunto (não é erro). */
export type BackupDadosEtapa = "enviando" | "enviado" | "pulado" | "ausente" | "erro";
/**
 * Andamento da cópia em curso (evento `backup-dados:progress`, um por etapa de cada conjunto, na ordem em que sobem): a
 * tela mostra "CRM ✓ 1 KB · Agente enviando…" em vez de um botão mudo por 40 s (1 nov). `bytes` só em `enviado`;
 * `detalhe` é o motivo do pulo ou a mensagem do erro.
 */
export interface BackupDadosProgresso { conjunto: string; nome: string; etapa: BackupDadosEtapa; indice: number; total: number; bytes: number | null; detalhe: string | null }
/** Onde a cópia de um conjunto está: no Drive da conta, na pasta do Mac, ou nos dois (mesmo arquivo). */
export type BackupCopiaOrigem = "drive" | "local" | "ambos";
/** A cópia mais nova de um conjunto de uma máquina, para a pessoa escolher o que restaurar. `data` é o dia (AAAA-MM-DD). */
export interface BackupCopiaConjunto { conjunto: string; nome: string; arquivo: string; bytes: number; data: string; cifrado: boolean; origem: BackupCopiaOrigem }
export interface BackupCopiaMaquina { maquina: string; conjuntos: BackupCopiaConjunto[] }
/** As cópias que dá para restaurar nesta máquina (de qualquer máquina): `atual` é o nome desta, na forma que entra no arquivo. `driveErro` = o Drive não foi lido (sem conta, sem permissão, rede); as locais valem mesmo assim. */
export interface BackupCopiasView { atual: string; maquinas: BackupCopiaMaquina[]; temSenha: boolean; driveErro: string | null }
export interface BackupRestauroPedido { maquina: string; conjuntos: string[]; /** Credenciais traz o pareamento do WhatsApp da origem; só entra por cima de um WhatsApp vivo com isto. */ substituirWhatsapp: boolean; /** Senha só para esta restauração (pacote cifrado sem senha gravada, ou com outra senha); não é guardada. */ senha?: string }
export type BackupRestauroEtapa = "baixando" | "decifrando" | "restaurando" | "restaurado" | "erro";
/** Andamento da restauração (evento `backup-dados:restauro`, um por etapa de cada conjunto escolhido). */
export interface BackupRestauroProgresso { conjunto: string; nome: string; etapa: BackupRestauroEtapa; indice: number; total: number; detalhe: string | null }
/** `antes`: a pasta na máquina onde ficou o que foi sobrescrito (a última, se vários conjuntos). */
export interface BackupRestauroResultado { restaurados: string[]; erros: string[]; antes: string | null; avisos: string[] }
export interface GmailMensagem { id: string; de: string; assunto: string; data: string; resumo: string; naoLida: boolean }
/** Uma página da caixa (ou de uma busca): `proxima` é o token da página seguinte, null no fim. */
export interface GmailLista { email: string | null; naoLidas: number; mensagens: GmailMensagem[]; proxima: string | null; busca: string }
export interface GmailAnexo { nome: string; tipo: string; bytes: number }
export interface GmailDetalhe extends GmailMensagem { para: string; corpo: string; anexos: GmailAnexo[]; truncado: boolean; /** Para "Abrir no Gmail". */ link: string }
/** "O agente pode ler seus e-mails" (página E-mail; socket + túnel reverso): a mesma forma do estado do Navegador. */
export interface GmailAgenteState { on: boolean; state: "connecting" | "up" | "down"; port: number | null }
/** O que foi para a lixeira (ou voltou dela): o bastante para a tela e o agente dizerem qual. */
export interface GmailApagado { id: string; de: string; assunto: string; data: string }
export interface AgendaEvento { id: string; titulo: string; inicio: string; fim: string; local: string; link: string }
export interface PlanilhaLeitura { intervalo: string; valores: string[][] }
