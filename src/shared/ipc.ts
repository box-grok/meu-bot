/** Contrato IPC entre renderer, preload e processo principal. Só tipos: nada aqui é emitido em runtime. */

export type BackendModel = "claudecode" | "agente" | "rene-dm" | "rene" | "grok-4";
export type Theme = "system" | "light" | "dark";
export type QuickEntryStatus = "registered" | "taken" | "invalid" | "disabled";

export interface SettingsView {
  /** Última máquina aberta (pré-seleção do seletor); null antes da primeira escolha. */
  lastHost: string | null;
  /** Modelo padrão global para conversas novas; cada conversa pode trocar o seu. */
  backendModel: BackendModel;
  /** Modelo padrão já resolvido para a máquina da janela que pediu (por máquina vence o global). */
  backendModelForHost: BackendModel;
  /** Porta padrão do backend (máquinas sem porta própria). */
  backendPort: number;
  /** Porta já resolvida para a máquina da janela que pediu (por máquina vence a padrão). */
  backendPortForHost: number;
  /** Notificações das páginas do Navegador viram conversas com a instrução da pessoa. */
  navNotify: NavNotifyPref;
  /** Espaços de trabalho do Navegador da máquina da janela (para o tutorial saber antes de o Navegador abrir). */
  navEspacos: NavWorkspaces;
  fontSize: number;
  theme: Theme;
  /** Avisar com notificação do sistema quando uma resposta terminar em segundo plano. */
  notifications: boolean;
  /** Acima disso (tokens estimados), o meio da conversa vai resumido. */
  contextBudgetTokens: number;
  /** A cada N turnos do usuário, extrair memória em background (0 desliga). */
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  quickEntryShortcut: string;
  quickEntryStatus: QuickEntryStatus;
  /** Onboarding guiado: "pending" até concluir ("done") ou pular ("skipped"). */
  onboarding: "pending" | "done" | "skipped";
  /** true = a janela abre direto; false = abertura animada toda vez (caixinha do seletor). */
  openDirect: boolean;
  /** Abrir o app ao entrar no Mac (item de início do sistema; o sistema é a fonte da verdade). */
  openAtLogin: boolean;
  /** Só o app empacotado consegue se registrar como item de início. */
  openAtLoginAvailable: boolean;
  /** Apelido de cada máquina ("Renomear" no seletor). */
  hostNames: Record<string, string>;
}

/**
 * Notificações das páginas do Navegador (do REA do Rambox, com a camada do meu-bot por cima): cada notificação de
 * um site vira uma mensagem numa conversa, com a instrução da pessoa, e o agente a trata; a notificação do sistema
 * leva à conversa. `hosts` vazio = todo site; `mode` "site" = uma conversa por site, "each" = uma por notificação.
 */
/** Quando o Mac avisa: "tratado" = depois de o agente responder, com a resposta; "chegada" = na hora, com o aviso do site; "nunca" = só a conversa. */
export type NavNotifyWhen = "tratado" | "chegada" | "nunca";
export interface NavNotifyPref { enabled: boolean; instruction: string; hosts: string[]; mode: "site" | "each"; avisar: NavNotifyWhen }

export interface SettingsUpdate {
  backendModel?: BackendModel;
  /** Modelo padrão só para a máquina da janela que salvou. */
  backendModelForHost?: BackendModel;
  backendPort?: number;
  /** Porta só para a máquina da janela que salvou (igual à padrão tira a exceção). */
  backendPortForHost?: number;
  navNotify?: Partial<NavNotifyPref>;
  fontSize?: number;
  theme?: Theme;
  notifications?: boolean;
  contextBudgetTokens?: number;
  memoryEveryTurns?: number;
  quickEntryEnabled?: boolean;
  quickEntryShortcut?: string;
  /** URL do atalho do Navegador (clique no ícone de extensão sem popup); "" desliga. */
  /** O renderer marca concluído/pulado; "pending" é a ação "Rever onboarding" da paleta. */
  onboarding?: "pending" | "done" | "skipped";
  openAtLogin?: boolean;
}

export interface ContextEvent {
  conversationId: string;
  /** Mensagens do histórico enviadas ao vivo. */
  sent: number;
  total: number;
  mode: "full" | "summary" | "truncated";
  summarizing: boolean;
  summaryUpdatedAt?: string;
  /** Tokens estimados do que foi enviado e o orçamento (para a status line). */
  tokens?: number;
  budget?: number;
}

/** Conta e limites do Claude Code na máquina (cache do statusline.sh), via GET /v1/meu-bot/status. */
/** Atualização automática do app (src/main/updater.ts). */
export interface UpdateState {
  current: string;
  available: string | null;
  ready: string | null;
  checking: boolean;
  error: string | null;
  /** Fase para a tela: idle (dev/desligado), checking, up-to-date, available (baixando), ready, error. */
  phase: "idle" | "checking" | "up-to-date" | "available" | "ready" | "error";
  /** Última consulta ao GitHub (ISO); null antes da primeira. */
  checkedAt: string | null;
}
/** Avisos de segurança gravados na máquina (o backend envia): um Mac novo usou o meu-bot desta máquina. */
export interface AlertPrefs { whatsapp: boolean; email: string }

/**
 * Licença da conta (a máquina da pessoa): plano, status, validade e limite de devices. Mora em licenca.json na
 * máquina; o admin é o dono e grava por SSH. Mesmo esquema do backend-colima/licenca.js e do src/main/licenca.ts.
 */
/** Planos da licença: free e pro são do meu-bot; "personalizado" (sob consulta) libera tudo do pro e os produtos por assinatura (meu-bot-crm). */
export type PlanName = "free" | "pro" | "personalizado";
export interface License {
  plan: PlanName;
  status: "free" | "trialing" | "active" | "expired";
  /** Ciclo de cobrança; null (ex.: em trial) vira "-" na tela. */
  interval: "month" | "year" | null;
  /** "Membro desde" (ISO), carimbado na 1ª vez. */
  memberSince: string;
  trialEnd: string | null;
  expiresAt: string | null;
  deviceLimit: number;
  /** Produtos contratados por cima do plano, acumulativos (meu-bot-crm, meu-bot-fit…); vazio = só o plano. */
  produtos: string[];
  updatedAt: string;
  updatedBy: "admin" | "system";
}
/** Um device registrado na conta (uma entrada do maquinas.json). Pendente = a pessoa "levantou a mão". */
export interface LicenseDevice {
  id: string;
  name: string;
  user: string;
  platform: string;
  app: string;
  firstSeen: string;
  lastSeen: string;
  status: "active" | "pending";
  requestedAt: string | null;
  /** Apps que já se apresentaram deste device (meu-bot, meu-bot-crm…), com versão e último visto; vazio em registro antigo. */
  apps: Record<string, { version: string; lastSeen: string }>;
}
/** Licença + devices de uma conta, como o app da pessoa e o admin veem. */
export interface LicenseView {
  license: License;
  devices: LicenseDevice[];
  activeCount: number;
  pendingCount: number;
  deviceLimit: number;
}
/** O que o admin pode mudar na licença de uma pessoa (campos omitidos ficam como estão). */
export interface LicensePatch {
  plan?: PlanName;
  status?: "free" | "trialing" | "active" | "expired";
  interval?: "month" | "year" | null;
  trialEnd?: string | null;
  expiresAt?: string | null;
  deviceLimit?: number;
  /** A lista inteira de produtos contratados (substitui a atual). */
  produtos?: string[];
}

/** Segmentos da status line (barra do Claude Code na máquina e rodapé do app): ligar/desligar. */
export interface StatusLineSegments { model: boolean; ctx: boolean; account: boolean; session: boolean; weekly: boolean }

export interface AccountStatus {
  /** Preferência de segmentos gravada na máquina (~/.claude/statusline-segments.json); ausente/null = todos. */
  segments?: StatusLineSegments | null;
  email: string | null;
  assento: string | null;
  sessionPct: number | null;
  weeklyPct: number | null;
  /** Epoch em segundos. */
  sessionResets: number | null;
  weeklyResets: number | null;
  updated: number | null;
  /** Corrente de provedores do backend, em ordem de prioridade. */
  providers: { name: string; type: "claude" | "openai"; available: boolean }[];
  /** Modelo que o Claude Code da máquina usa agora ("Fable 5.1", ou "Opus 5.5" durante o limite); null = backend antigo. */
  modelName?: string | null;
}

export interface MemoryView {
  notas: string;
  perfil: string;
  updatedAt: string;
  limits: { notas: number; perfil: number };
}

/** Estado do túnel/backend, enviado ao renderer. */
export interface BackendStatusEvent {
  /** Host SSH a que o estado se refere (um túnel por host). */
  host: string;
  state: "idle" | "connecting" | "ready" | "degraded" | "error";
  detail: string;
}

/** Resultado da sondagem de um host SSH, para o seletor de máquinas. */
export interface HostProbe {
  host: string;
  reachable: boolean;
  user: string | null;
  os: string | null;
  arch: string | null;
  /** Há server.js e .env em ~/.hermes/agente-rene/backend-sdk-claude. */
  backendInstalled: boolean;
  /** Alguém escuta na porta do backend (a do .env dele quando existe; senão `appPort`). */
  backendListening: boolean;
  /** Porta que o app usa para esta máquina (a sondagem foi feita com ela). */
  appPort: number;
  /** Porta declarada no .env do backend instalado; null sem backend ou sem PORT no .env. */
  backendPort: number | null;
  /** Alguém escuta em `appPort` nesta máquina. Sem backend instalado, é outra conta ou outro programa. */
  portBusy: boolean;
  /** Primeira porta livre acima de `appPort` (até +30), para instalar sem conflito; null se nenhuma. */
  freePort: number | null;
  claudePath: string | null;
  claudeLoggedIn: boolean;
  node: string | null;
  systemd: boolean;
  /** Computador do Grok Bot (pod): PID 1 pod-daemon/tini ou cgroup pod-…; tem botão de alívio. */
  grokPod: boolean;
  /** O Tailscale SSH pediu a verificação extra (check mode): a pessoa precisa aprovar um link no navegador. */
  tailscaleCheck: boolean;
  /** ~/.claude/statusline.sh é o nosso: grava ~/.cache/claude-statusline/ratelimits.json, que a status line do app lê. */
  statusLine: boolean;
  /** OpenClaw: a guarda do WhatsApp do meu-bot (plugin meu-bot-guarda) está nesta máquina; null = sem OpenClaw. */
  guarda: boolean | null;
  /** Versão da guarda instalada (package.json do plugin); null = sem guarda ou desconhecida. */
  guardaVersion: string | null;
  /** OpenClaw: o agente do WhatsApp entende áudio (transcritor configurado); null = sem OpenClaw. */
  audioIn: boolean | null;
  /** Agente de chat da máquina (openclaw tem preferência quando os dois existem). */
  gateway: Gateway | null;
  /** Disco da home e memória da máquina, em MB (null quando a sondagem não trouxe). */
  diskFreeMb: number | null;
  diskTotalMb: number | null;
  memFreeMb: number | null;
  memTotalMb: number | null;
  /** Modelos que o backend desse host anuncia em /v1/models (vazio se não respondeu). */
  models: string[];
  error: string | null;
}

export interface InstallBackendResult {
  ok: boolean;
  log: string[];
}

export interface InstallProgressEvent {
  host: string;
  line: string;
}

/** Qual produto é este app: meu-bot (de cada pessoa), meu-bot-admin (suporte) ou meu-bot-crm (meu-bot + CRM próprio). Tabela em src/main/variant-core.ts. */
export type AppVariant = "client" | "admin" | "crm" | "client-staging" | "crm-staging";
/** Canal do app: estável (só o aprovado) ou staging (o que está em teste), como VS Code e VS Code Insiders. */
export type Canal = "estavel" | "staging";
/**
 * O que esta variante do app pode fazer. O main decide (variant-core.ts) e manda para a janela em WindowInfo;
 * o renderer esconde/mostra por capacidade, nunca por "é admin?". O admin tem tudo false menos supportAdmin.
 */
export interface Capabilities {
  variant: AppVariant;
  /** Conversar com o agente: compositor, abas de chat, entrada rápida. */
  chat: boolean;
  /** Parear/desconectar o WhatsApp, política de DM, áudio. */
  pair: boolean;
  /** Logins Claude e xAI, chave de API. */
  login: boolean;
  /** Mexer no espelho do WhatsApp: pausar, limpar, ramificar; menu "…" completo. */
  manageWa: boolean;
  /** Túnel para o backend da máquina (chat, conta). */
  tunnel: boolean;
  /** Instalar coisas na máquina pelo seletor e pelos tutoriais (status line, transcrição). */
  install: boolean;
  /** Configurações › Suporte, lado da pessoa. */
  supportClient: boolean;
  /** Página "Suporte" do admin e as ações de suporte. */
  supportAdmin: boolean;
  /** Aba Navegador (e o agente navegando por você). */
  navegador: boolean;
  /** Tutorial "CRM pelo WhatsApp" via API do Streak (só o meu-bot). */
  crmStreak: boolean;
  /** Extensão do Gmail embutida no app (CRM próprio) e o proxy local da API do CRM. */
  extensaoGmail: boolean;
  /**
   * Plano que a licença da máquina precisa ter para o app funcionar. "free" = app grátis com módulos Pro à parte
   * (etiqueta Pro, "pedir ao admin"); "personalizado" = assinatura do produto inteiro: sem etiqueta, tudo aberto
   * enquanto ativa, uma tela só quando ausente/vencida.
   */
  planoExigido: PlanName;
  /**
   * Nome do produto contratado ("meu-bot", "meu-bot-admin", "meu-bot-crm"): é o que a licença libera. No staging
   * continua o do estável (meu-bot-staging → "meu-bot"); o nome do app é outro (appTitle). O renderer nunca o deduz.
   */
  produto: string;
  /** Canal deste app (estável ou staging). */
  canal: Canal;
  /** Nome do app ("meu-bot-staging"): texto da atualização, nome do .app. */
  nome: string;
  /** Título da janela: o nome, e no staging a versão junto ("meu-bot-staging 0.2.0-staging.3"). */
  titulo: string;
}

/** O que a janela principal recebe ao nascer: a máquina a que está presa. */
export interface WindowInfo {
  host: string;
  /** O que esta variante pode fazer (ver Capabilities); o admin é `caps.supportAdmin`. */
  caps: Capabilities;
  /** No admin: nome da pessoa dona da máquina. */
  person: string | null;
  /** No admin: apelido que a pessoa usa para a máquina ("colima"); null se o código não trouxe. */
  machine: string | null;
  /** Versão deste app (package.json). */
  version: string;
  /** Modelos conhecidos dessa máquina (da última sondagem); vazio se desconhecido. */
  models: string[];
}

/** Dados iniciais do seletor de máquinas. */
export interface PickerInit {
  hosts: string[];
  /** meu-bot-admin: as pessoas (os hosts são os aliases delas, só as com suporte ligado). null = meu-bot normal. */
  support: { people: SupportPerson[]; adminKey: boolean } | null;
  /** Máquina a pré-selecionar (última aberta). */
  preselect: string;
  /** Máquinas que já têm janela aberta. */
  open: string[];
  /** Máquinas (e "seletor") com atalho na área de trabalho, com o emoji do ícone de cada um. */
  shortcuts: { host: string; emoji: string | null }[];
  /** Máquinas reconhecidas como computador do Grok Bot (lembradas entre sondagens). */
  pods: string[];
  /** Máquinas com o botão "aliviar <host>.app" na área de trabalho. */
  reliefShortcuts: string[];
  /** Caixinha "abrir direto": marcada = sem a abertura animada. */
  /** Apelidos das máquinas (host → nome mostrado). */
  names: Record<string, string>;
  openDirect: boolean;
  /** Primeira abertura do seletor nesta sessão do app: toca a chegada animada (logo que nasce grande e vai para o cabeçalho). */
  arrival: boolean;
  /** Caixinha "onboarding feito": marcada = respeita; desmarcada = força o onboarding na próxima janela. */
  onboardingDone: boolean;
  error: string | null;
}

/** Agente/gateway de chat que a máquina roda; o app detecta e se adapta, nunca pressupõe. */
export type Gateway = "hermes" | "openclaw";

/** WhatsApp do agente da máquina (Hermes: bridge em ~/.hermes/whatsapp; OpenClaw: `openclaw channels`). */
export interface WhatsappStatus {
  /** A máquina tem um agente com WhatsApp (Hermes ou OpenClaw). */
  present: boolean;
  gateway: Gateway | null;
  /** O que foi encontrado, para humanos: "OpenClaw 2026.9.9 em /usr/local/bin (global, todos os usuários)". */
  agent: string;
  /** Dá para parear: o Hermes tem o bridge; o OpenClaw tem o plugin do WhatsApp. */
  ready: boolean;
  /** O que falta quando `ready` é falso (pt-BR, com o comando quando há um). */
  missing: string | null;
  connected: boolean;
  /** Estado do bridge (open, connecting, close, "sem bridge"…). */
  state: string;
  /** Número pareado (só dígitos), se há sessão. */
  number: string | null;
  loggedOut: boolean;
  detail: string;
  /** OpenClaw: quem o agente responde nas DMs (`channels.whatsapp.dmPolicy`); null = Hermes ou desconhecido. */
  dmPolicy: WhatsappDmPolicy | null;
  /** OpenClaw: o bloco `channels.whatsapp` como está no openclaw.json (JSON), para "Ver configuração do canal". */
  channelConfig: string | null;
  /** OpenClaw: `channels.whatsapp.allowFrom` como está ("+55…" ou "*"); ausente = Hermes ou bloco sem a lista. */
  allowFrom?: string[];
  /** OpenClaw: o agente entende áudio (há transcritor em `tools.media.models`). Ausente = não se sabe (Hermes). */
  audioIn?: boolean;
  /** OpenClaw: quando o agente responde em áudio (`tts.auto`); null = sem voz configurada. */
  audioOut?: VoiceReplyMode | null;
  /** Voz das respostas em áudio instalada na máquina (null = nenhuma escolhida ainda; a faber de antes conta como faber). */
  audioVoice?: VozId | null;
  /** O que o app consertou sozinho nesta consulta (pt-BR), para a pessoa saber que a máquina mudou (ex.: gateway em porta própria). */
  repaired?: string;
}

/** Grok por OAuth em máquina sem Hermes: há backend do meu-bot nela? (é o que o "entrar"/tutorial 4 prepara). */
export interface XaiKeyStatus { backend: boolean }

/** Suporte (meu-bot-admin), lado da pessoa: estado na máquina desta janela. */
export interface SupportInfo {
  /** Este meu-bot veio com o pacote de suporte e a janela é de uma máquina por SSH. */
  available: boolean;
  /** Nome de quem dá o suporte ("Lucas"). */
  admin: string;
  /** A chave do admin está no authorized_keys da máquina. */
  on: boolean;
  /** Nome que a pessoa deu para si. */
  name: string;
  /** Sugestão para o campo vazio (nome do git ou do usuário do Mac): salvar liga com um clique. */
  suggestedName: string;
  /** Últimas linhas do registro de auditoria da máquina (mais nova primeiro); `tipo` = quem: dono, admin, agente, sistema ou legado. */
  log: { at: string; who: string; what: string; tipo: string }[];
  /** Última entrega do aviso na caixa do admin que deu certo (ISO); null = ainda nenhuma. */
  deliveredAt: string | null;
  /** O que a pessoa deixa o app do admin ver. */
  share: SupportShare;
  /** O admin desligou: o app não religa sozinho; "Ligar o suporte" pede de novo. */
  blockedByAdmin: boolean;
  /** O código gravado na máquina tem o id antigo (só a chave do servidor): o app regrava sozinho. */
  staleId: boolean;
}
/**
 * O que a pessoa escolhe compartilhar com o app do admin: progresso nos tutoriais, WhatsApp (estado e
 * conversas) e registros (journal). O app do admin respeita; o acesso SSH em si continua enquanto o suporte
 * está ligado (desligar o interruptor corta tudo). Fica na máquina dela, em ~/.local/share/meu-bot.
 */
/** `backup`: o admin pode fazer backup completo (sessão do WhatsApp e logins inclusive); padrão desligado. */
export interface SupportShare { progress: boolean; whatsapp: boolean; logs: boolean; chat: boolean; backup: boolean }

/** Suporte, lado do admin: uma pessoa (uma máquina) que entregou ou colou o código. */
export interface SupportPerson {
  /** Alias no ~/.ssh do admin (`suporte-<nome>-<4 hex>`): é o "host" da janela. */
  alias: string;
  /** Apelido do admin, se deu; senão o nome que ela escreveu. */
  name: string;
  /** Apelido que a pessoa usa para a máquina no ~/.ssh/config dela ("colima"); null em códigos antigos. */
  machine: string | null;
  hostname: string;
  port: number;
  /** Endereço local (127.0.0.1/localhost): só alcançável do próprio Mac onde a pessoa está (teste com VM). */
  local: boolean;
  /** A pessoa deixou o suporte ligado (desligado = sem acesso). */
  on: boolean;
  /** Última entrega na caixa (ISO): o "visto há". */
  seenAt: string;
  source: "caixa" | "colado";
  /** O admin tirou da lista (continua com suporte; o interruptor "arquivadas" mostra de volta). */
  archived: boolean;
  /** Último plano visto da conta (cache, para o selo no seletor); null = ainda desconhecido. */
  plan: PlanName | null;
}
/** Uma conversa da pessoa com o meu-bot, vista pela transcrição do Claude Code na máquina dela (meu-bot-admin). */
export interface BotChat {
  /** Sessão do Claude Code (nome do .jsonl) ou, com `source: "app"`, o id da conversa do app (diário do backend). */
  sessionId: string;
  /** Pasta do projeto em ~/.claude/projects (diz o modo: agent-workspace = agente, chat-workspace = chat); "conversas" no diário. */
  project: string;
  title: string;
  updatedAt: string;
  /** Quantas respostas o meu-bot deu. */
  replies: number;
  /** De onde vem: transcrição do Claude Code, ou o diário que o backend grava para Grok/Hermes (~/.local/share/meu-bot/conversas). */
  source: "claude" | "app";
  /** Último provedor que respondeu (só no diário): "grok-4"… */
  provider?: string;
}
export interface BotMessage { role: "person" | "agent" | "tool"; text: string; at: string; /** Quem respondeu (só no diário). */ provider?: string }
/** Saúde da máquina da pessoa; `whatsapp` e `progress` vêm null quando ela não compartilha (ver `share`). */
export interface AdminHealth { probe: HostProbe; whatsapp: WhatsappStatus | null; progress: SupportProgress | null; share: SupportShare; /** Conta da xAI no Hermes da máquina; null = sem Hermes. */ xai: ClaudeAuthInfo | null; /** Licença e devices da conta; null = máquina fora do ar ou backend antigo sem a rota. */ license: LicenseView | null }
/** Progresso da pessoa nos tutoriais (o meu-bot dela grava na máquina com o suporte ligado). */
export interface SupportProgress {
  at: string;
  tour: "done" | "skipped" | "pending";
  tutorials: { id: string; title: string; done: number; total: number; current: string | null; finished: boolean; comingSoon: boolean }[];
  /** O meu-bot dela: versão e quando esta sessão do app abriu (o admin vê se ela está atualizada e ativa). */
  app?: { version: string; openedAt: string };
}
/** Ações do admin na máquina da pessoa. "support-off" tira o próprio acesso (ex.: deixou de pagar); só o admin desliga. */
export type AdminAction = "install-backend" | "restart-gateway" | "restart-backend" | "transcription" | "transcription-off" | "support-off";

/** Quando o agente responde em áudio: nunca, só quando recebe áudio, ou sempre. */
export type VoiceReplyMode = "off" | "inbound" | "always";
/** Instaladores de áudio do agente do WhatsApp: ouvir (transcrição) ou falar (voz, com o modo). */
/** "in" liga a transcrição (padrão do app ao parear); `off: true` desliga. "out" é a voz, pelo modo. */
/** Voz das respostas em áudio: faber (masculina, Piper), dora (feminina, Kokoro), alex (masculina natural, Kokoro). */
export type VozId = "faber" | "dora" | "alex";
export type AudioSetup = { kind: "in"; off?: boolean } | { kind: "out"; mode: VoiceReplyMode; voz?: VozId };

export type WhatsappDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** Uma conversa do WhatsApp (OpenClaw) no espelho só-leitura: um contato, juntando as sessões dele. */
export interface WhatsappChat {
  /** Só dígitos, com DDI. */
  number: string;
  /** Último nome que o contato mandou (pushname): da leitura do histórico ou do cache na máquina (whatsapp-lista.json). */
  name: string | null;
  /** Apelido dado na tela ("Renomear"), guardado na máquina: vence o nome na lista e no título. */
  alias: string | null;
  /** O próprio número do aparelho (mensagens para si mesmo). */
  isSelf: boolean;
  /** Sessões do agente com mensagens desse contato (principal e/ou por contato). */
  sessionKeys: string[];
  /** Chave da sessão → UUID interno do OpenClaw (troca a cada "Limpar"); para "Copiar ID". */
  sessionIds: Record<string, string>;
  /** Tem sessão só dele (isolamento por contato): dá para pausar sem afetar os outros. */
  ownSession: boolean;
  /** O agente está pausado para este contato (não responde). */
  paused: boolean;
  /** ISO da atividade mais recente. */
  updatedAt: string;
  /** Arquivada na máquina (whatsapp-lista.json): os dois apps veem igual. */
  archived: boolean;
  /** Excluída na máquina e sem mensagem nova desde então (some da lista; volta se o contato escrever). */
  deleted: boolean;
}

/** Um ajuste de uma conversa do WhatsApp gravado na máquina: arquivado/excluído, nome em cache, apelido (vazio apaga); `at` só na migração. */
export interface WaMarkPatch { number: string; archived?: boolean; deleted?: boolean; name?: string; alias?: string; at?: string }

/** Tutorial 7 · objetivo do WhatsApp: a escolha da pessoa (rótulo do cartão + frase livre; "outro" exige a frase). */
export interface ObjectiveChoice { id: string; label: string; text: string }
/** Quanta liberdade o agente tem: só conversa, consulta e organiza, ou age pelo dono. */
export type FreedomLevel = "conversa" | "consulta" | "age";
/** Uma skill do workspace do OpenClaw na máquina (`<workspace>/skills/<nome>/SKILL.md`); `objective` = a do tutorial 7. */
export interface MachineSkill { name: string; description: string; objective: boolean; /** Skill aprendida/instalada para o Claude Code da máquina (~/.claude/skills), não do workspace do OpenClaw. */ learned?: boolean }
/** Estado do tutorial 7 na máquina (objetivo.json + skills do workspace). */
export interface ObjectiveInfo {
  /** Janela de máquina por SSH (neste Mac não há agente). */
  available: boolean;
  objective: ObjectiveChoice | null;
  level: FreedomLevel | null;
  /** Quando a skill foi salva pela última vez; null = ainda não. */
  savedAt: string | null;
  /** Nome fixo da skill do objetivo. */
  skill: string;
  /** O SKILL.md do objetivo existe no workspace. */
  skillPresent: boolean;
  /** Todas as skills do workspace (o Acervo lista; a do objetivo primeiro). */
  skills: MachineSkill[];
}

/** Tutorial 10 · CRM pelo WhatsApp (Pro): configuração na máquina (crm.json sem a chave) e instalação do plugin. */
export interface CrmInfo {
  /** Janela de máquina por SSH (neste Mac não há agente). */
  available: boolean;
  /** Plugin meu-bot-crm + streak.mjs na máquina. */
  installed: boolean;
  /** Há chave da API do Streak gravada (a chave nunca volta ao app). */
  configured: boolean;
  pipelineKey: string | null;
  pipelineName: string | null;
  /** Minutos de silêncio na conversa antes de o agente anotar. */
  silencioMin: number;
  /** Criar box e mudar etapa sem perguntar (padrão: propõe e espera "ok"). */
  criarSemPerguntar: boolean;
  savedAt: string | null;
}
/** `streak.mjs diag` na máquina: a chave funciona? quais pipelines existem? */
export interface CrmDiag { ok: boolean; erro: string | null; usuario: string | null; pipelines: { key: string; name: string }[]; pipeline: { name: string; stages: string[]; fields: string[] } | null }

/** Uma mensagem do espelho: do contato ou do agente; hora em ISO. */
export interface WhatsappThreadMessage { role: "contact" | "agent"; text: string; at: string }
/** Resultado de guardar a conversa no CRM antes de limpar (meu-bot-crm): onde ficou e se o resumo foi atualizado. */
export interface WhatsappArchive {
  /** Não havia mensagens para guardar (nada foi enviado ao CRM). */
  vazio: boolean;
  contato: string | null;
  box: { key: string; nome: string } | null;
  arquivo: string | null;
  mensagens: number;
  resumo: boolean;
  aviso: string | null;
}
/** De onde veio uma conversa do meu-bot criada a partir do WhatsApp: contato, quantas mensagens e até quando. */
export interface WhatsappOrigin {
  number: string; name: string; count: number; until: string;
  /** As mensagens trazidas, para a aba mostrar a conversa do WhatsApp antes da conversa com o meu-bot. */
  messages?: WhatsappThreadMessage[];
}
/** O que o app oferece: "self" = só você (allowlist + selfChatMode); "open" = todo mundo (open + allowFrom *). */
/** Cartão escolhido: "self" = só você; "open" = todo mundo; "list" = você e os números listados (allowlist com allowFrom). */
export type WhatsappReplyChoice = "self" | "open" | "list";

/** Eventos do pareamento por QR. */
export type WhatsappEvent =
  | { kind: "step"; text: string }
  | { kind: "log"; text: string }
  | { kind: "qr"; dataUrl: string }
  | { kind: "connected"; number: string | null }
  | { kind: "error"; text: string }
  | { kind: "done"; ok: boolean };

/** Conta do Claude Code na máquina. */
export interface ClaudeAuthInfo { loggedIn: boolean; email: string | null }

/** Eventos do login do Claude Code numa máquina (claude auth login por SSH). */
export type ClaudeLoginEvent =
  | { kind: "url"; url: string }
  | { kind: "waiting-code" }
  | { kind: "log"; text: string }
  | { kind: "done"; ok: boolean; text: string };

/** Credencial do OAuth client do Tailscale: só o estado, nunca o valor. */
export interface TailscaleCredentialState { configured: boolean; encryptionAvailable: boolean }

/** Resultado de editar a política do tailnet (ssh: check → accept) ou de restaurar um backup. */
export interface TailscaleSshResult {
  ok: boolean;
  changed: boolean;
  /** Não há OAuth client salvo: configurar no seletor. */
  needsCredential: boolean;
  detail: string;
  backupPath: string | null;
}

/** Resultado do botão "sincronizar ssh": o que entrou no ~/.ssh/config e o que faltava no Mac. */
export interface SshSyncResult {
  configPath: string;
  /** Aliases acrescentados. */
  added: string[];
  includesAdded: number;
  /** Aliases do modelo que já existiam (não tocados). */
  kept: string[];
  /** Aliases só deste Mac, que o modelo versionado não conhece. */
  onlyLocal: string[];
  backup: string | null;
  /** Chaves (IdentityFile) do modelo que não existem neste Mac. */
  missingKeys: string[];
}

/** Eventos da janela de alívio (aliviar <host>). */
export type ReliefEvent =
  | { kind: "init"; host: string }
  | { kind: "step"; step: "connect" | "clean" | "tailscale" | "open"; state: "doing" | "done" | "fail"; text: string }
  | { kind: "stats"; which: "before" | "after"; load: string; memMb: number | null }
  | { kind: "countdown"; seconds: number }
  /** Alívio falhou: contagem até abrir o app do Grok Bot no card Reset (Fechar cancela). */
  | { kind: "reset-countdown"; seconds: number }
  | { kind: "reset-opened"; ok: boolean }
  | { kind: "log"; text: string }
  | { kind: "done"; ok: boolean; text: string };

/** API exposta ao seletor de máquinas como window.picker. */
/** Seletor, os dois apps. */
export interface PickerSharedApi {
  list(): Promise<PickerInit>;
  /** Plano de cada host (lido por SSH, melhor esforço) para o selo "PRO" no seletor; hosts fora do ar ficam de fora. */
  plans(): Promise<Record<string, PlanName>>;
  probe(host: string): Promise<HostProbe>;
  choose(host: string): Promise<void>;
  /** O backend desta máquina está em outra porta: o app passa a usar `port` só para ela (configuração deste Mac; nada escrito na máquina, por isso o admin também pode). */
  usePort(host: string, port: number): Promise<void>;
  /** Cria (true) ou remove (false) o atalho "meu-bot <host>.app" na área de trabalho; devolve o estado final. */
  setShortcut(host: string, create: boolean): Promise<{ has: boolean; emoji: string | null }>;
  /** Abre a janela de alívio da máquina (computador do Grok Bot) e fecha o seletor. */
  relieve(host: string): Promise<void>;
  /** Cria (true) ou remove (false) o botão "aliviar <host>.app" na área de trabalho. */
  setReliefShortcut(host: string, create: boolean): Promise<{ has: boolean }>;
  /** Abre o app do Grok Bot no card "Reset computer" (pod congelado). false se não há quem atenda grokbot://. */
  openGrokbotReset(): Promise<boolean>;
  /** Estado da credencial do OAuth client do Tailscale (nunca o valor). */
  tailscaleCredential(): Promise<TailscaleCredentialState>;
  /** Abre no navegador uma página fixa (allowlist no main): "tailscale-keys". */
  openKnownUrl(which: "tailscale-keys"): Promise<void>;
  cancel(): void;
  on(channel: "picker:init" | "picker:install-progress", callback: (payload: unknown) => void): () => void;
}

/** Variante: cliente. Seletor do meu-bot normal: instalar, sincronizar o ~/.ssh/config, renomear, remover, Tailscale. */
export interface PickerClientApi {
  install(host: string): Promise<InstallBackendResult>;
  /** Instala a status line do Claude Code na máquina (statusline.sh + statusLine no settings.json); mesmo log de progresso. */
  installStatusLine(host: string): Promise<InstallBackendResult>;
  /** Liga a transcrição de áudio do agente do WhatsApp (OpenClaw) na máquina; mesmo log de progresso. */
  installTranscription(host: string): Promise<InstallBackendResult>;
  /** Ativa a guarda do WhatsApp (plugin meu-bot-guarda) no OpenClaw da máquina; mesmo log de progresso. */
  installGuarda(host: string): Promise<InstallBackendResult>;
  /** Instala o Claude Code na conta do alias (instalador oficial, ~/.local/bin); depois vêm o login e o backend. */
  installClaude(host: string): Promise<InstallBackendResult>;
  /** Tira a máquina do seletor e do ~/.ssh/config (backup em `backup`). */
  removeHost(host: string): Promise<{ backup: string }>;
  /** Apelido da máquina no app (vazio tira); a chave SSH não muda. */
  renameHost(host: string, name: string): Promise<void>;
  /** Acrescenta ao ~/.ssh/config as máquinas do modelo versionado que faltam (o Cursor lê o mesmo arquivo). */
  syncSsh(): Promise<SshSyncResult>;
  /** Caixinha "abrir direto" do rodapé. */
  setOpenDirect(value: boolean): Promise<void>;
  /** Caixinha "onboarding feito" do rodapé. */
  setOnboardingDone(value: boolean): Promise<void>;
  /** Verificação do Tailscale SSH: abre um ssh que espera, leva o link ao navegador e resolve quando a pessoa aprovar. */
  approveTailscale(host: string): Promise<{ ok: boolean; detail: string }>;
  saveTailscaleCredential(clientId: string, clientSecret: string): Promise<TailscaleCredentialState>;
  forgetTailscaleCredential(): Promise<TailscaleCredentialState>;
  /** Edita a política do tailnet (ssh: check → accept); `host` só invalida a sondagem em cache. */
  disableTailscaleCheck(host: string): Promise<TailscaleSshResult>;
  /** Abre a janela da máquina já no modal "Entrar no Claude Code". */
  claudeLogin(host: string): Promise<void>;
}

/** Variante: admin. Seletor de pessoas do meu-bot-admin. */
export interface PickerAdminApi {
  /** meu-bot-admin: lê a caixa de entrada e devolve as pessoas (warning se a caixa não respondeu). */
  supportRefresh(): Promise<{ people: SupportPerson[]; warning: string | null }>;
  /** meu-bot-admin: "Adicionar pessoa" colando o código de suporte. */
  supportAdd(code: string): Promise<SupportPerson>;
  /** meu-bot-admin: arquiva/desarquiva uma pessoa na lista; devolve as pessoas. */
  supportArchive(alias: string, archived: boolean): Promise<SupportPerson[]>;
  /** meu-bot-admin: apelido para a pessoa (vazio volta ao nome que ela deu); o alias não muda. */
  supportRename(alias: string, name: string): Promise<SupportPerson[]>;
  /**
   * meu-bot-admin: "Excluir máquina": limpa todo o histórico do WhatsApp na máquina dela, desliga o suporte e tira da
   * lista (e da caixa de entrada). Máquina fora do ar: erro e ela fica; `force` tira da lista mesmo assim.
   */
  supportRemove(alias: string, force: boolean): Promise<{ people: SupportPerson[]; cleared: number; detail: string }>;
  /** meu-bot-admin: MVPs de produtos (registro local do admin), também no seletor: é lá que um MVP nasce. */
  produtos(): Promise<ProdutoMvp[]>;
  produtoSave(patch: ProdutoMvpPatch): Promise<ProdutoMvp[]>;
  produtoRemove(nome: string): Promise<ProdutoMvp[]>;
  produtoExport(nome: string): Promise<{ json: string; checklist: string[] }>;
  /** Auditoria (só no app do super admin; `superAdmin: false` nos outros). */
  auditoriaMaquinas(): Promise<{ superAdmin: boolean; maquinas: AuditoriaMaquinaView[]; erro: string | null }>;
  auditoriaRegistro(maquina: string): Promise<AuditoriaVisao>;
  /** Salva a prova (JSON com os hashes + CSV legível); null = cancelou. */
  auditoriaExportar(maquina: string): Promise<{ path: string } | null>;
}

/** O que o renderer vê em `window.picker`: os três grupos juntos (o main recusa o que não é da variante). */
/** Auditoria (super admin): uma máquina na central, com quem é (pelas pessoas conhecidas do admin). */
export interface AuditoriaMaquinaView { maquina: string; nome: string | null; alias: string | null; on: boolean; registros: number; ultimo: string }
/** Uma ação no registro central de uma máquina, já com o texto da tela. */
export interface AuditoriaLinhaView {
  em: string; quemTipo: string; quemNome: string; app: string; acao: string; texto: string; detalhe: string;
  /** Quem entregou à central (carimbado pela chave SSH lá): "admin Fulano", "maquina pessoas"… */
  via: string; recebidoEm: string;
  /** false = a central tem e a máquina não tem mais (apagada lá); null = a máquina não foi lida. */
  naMaquina: boolean | null;
}
export interface AuditoriaVisao {
  maquina: string; nome: string | null; linhas: AuditoriaLinhaView[];
  /** Corrente da central: null = íntegra; senão o nº do primeiro registro adulterado. */
  centralQuebraEm: number | null;
  /** A cópia da máquina: lida (suporte ligado) ou não, e onde a corrente dela quebra. */
  maquinaLida: boolean; maquinaQuebraEm: number | null; faltamNaMaquina: number; maquinaErro: string | null;
}
export type PickerApi = PickerSharedApi & PickerClientApi & PickerAdminApi;

export interface DoneEvent {
  conversationId: string;
  stopReason: string;
  /** O backend retomou a sessão do Claude Code desta conversa. */
  resumed?: boolean;
  refusal?: { category: string | null; explanation: string };
  /** Duração do turno e tokens informados pelo backend (status line). */
  ms?: number;
  usage?: { prompt: number; completion: number };
  /** Quem respondeu de fato (X-Provider). */
  provider?: string;
  /** Houve fallback de provedor neste turno (aviso do backend), para ficar gravado na mensagem. */
  fallback?: string;
}

export type ErrorKind = "backend" | "unknown";

export interface ErrorEvent {
  conversationId: string;
  kind: ErrorKind;
  message: string;
}

export interface ConversationRef {
  conversationId: string;
}

/** Atividade do agente vinda do backend (x_meu_bot.tool): uso de ferramenta ou resultado. */
export type ToolEvent =
  | { kind: "use"; name: string; summary: string }
  | { kind: "result"; name: string | null; ok: boolean; text: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Quem produziu a resposta de fato (X-Provider do backend): "agente", "grok-4"… Só nas de assistant. */
  provider?: string;
  /** Houve fallback de provedor neste turno: o aviso do backend, guardado ("agente falhou (…); respondendo com grok-4"). */
  fallback?: string;
}

export interface StoredConversationView {
  id: string;
  /** Nome dado pelo usuário; ausente = título automático pela primeira mensagem. */
  title?: string;
  model: BackendModel;
  /** Host SSH (máquina) desta conversa; fixo desde a criação. */
  host: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Posição da aba; menor fica mais à esquerda. */
  order: number;
  archived: boolean;
  /** Está aberta como aba (fechar a aba não apaga a conversa). */
  openAsTab: boolean;
  branchedFrom?: { id: string; index: number };
  /** Trazida de uma conversa do WhatsApp. */
  fromWhatsapp?: WhatsappOrigin;
  /** O trecho trazido ainda não foi ao agente (vai com a primeira mensagem). */
  pendingNote?: string;
}

export type WhatsappMenuAction = "talk" | "export-md" | "export-json" | "copy-ref" | "rename" | "archive" | "unarchive" | "clear" | "delete" | "restore" | "pause" | "resume";
export type TabMenuAction = "rename" | "duplicate" | "export-md" | "export-json" | "copy-ref" | "archive" | "unarchive" | "close" | "delete";
/** Menu "…" de uma conversa dela com o meu-bot no espelho do admin. */
export type BotMenuAction = "copy-ref";
/** Sessão do Claude Code por trás de uma conversa do app (vem do backend; é o .jsonl na máquina). */
export interface ClaudeSessionRef { sessionId: string; file: string; profile: string }
export type ExportFormat = "md" | "json";

/**
 * Internet deste Mac (faixa OFFLINE): `online` null = ainda não sondado; `since` = desde quando está fora
 * (ms); `checkedAt` = última sondagem (ms).
 */
export interface NetState { online: boolean | null; checking: boolean; since: number | null; checkedAt: number | null }

/** Aba "Navegador" (módulo Pro): a sessão da máquina (partição dos `<webview>`) e as extensões instaladas nela. */
/** `icon` = data URL do ícone (para o botão na barra, como no Chrome/Rambox); `popup` = url chrome-extension:// do popup, se houver. */
export interface BrowserExtensionInfo { id: string; name: string; version: string; icon: string | null; popup: string | null; /** Vem com o app (extensão do CRM próprio): não se remove. */ embutida?: true }
export interface BrowserOpenInfo { partition: string; extensions: BrowserExtensionInfo[]; agent: BrowserAgentState; favoritos: NavFavorito[]; espacos: NavWorkspaces }
/**
 * Espaços de trabalho do Navegador (do REA do Rambox: grupos/workspaces com apps fixos num trilho). Por máquina.
 * O que cada espaço representa (um cliente, um projeto…) é a pessoa quem decide pelo nome; cada um tem os sites
 * fixos (serviços), que abrem em abas permanentes enquanto o Navegador existe (as notificações deles chegam).
 */
export interface NavService { id: string; nome: string; url: string; icone: string | null }
export interface NavWorkspace { id: string; nome: string; servicos: NavService[]; /** Oculto: fora do seletor e sem abas, sem apagar nada; volta pelo grupo "Ocultos". */ oculto?: true }
export interface NavWorkspaces { ativo: string | null; lista: NavWorkspace[] }
/** Favorito da barra do Navegador (por máquina; o agente também adiciona/remove pelas ações). */
export interface NavFavorito { id: string; titulo: string; url: string }
/** "Agente pode usar" o Navegador: ligado? o túnel reverso está de pé? em que porta da máquina? */
export interface BrowserAgentState { on: boolean; state: "up" | "down" | "connecting"; port: number | null }

export interface MainEvents {
  "chat:assistant-start": ConversationRef;
  "chat:delta": ConversationRef & { text: string };
  "chat:done": DoneEvent;
  "chat:error": ErrorEvent;
  "backend:status": BackendStatusEvent;
  /** Configurações mudaram em outra janela. */
  "settings:changed": SettingsView;
  /** Clique numa notificação: ativar esta conversa. */
  "ui:focus-conversation": ConversationRef;
  "chat:context": ContextEvent;
  "memory:changed": MemoryView;
  /** Texto vindo da janela de entrada rápida; responder com quickAck. */
  "ui:quick-submit": { correlationId: string; text: string };
  /** Menu meu-bot › Configurações… (Cmd+,): abre, ou fecha se já está aberto. */
  "ui:toggle-settings": Record<string, never>;
  /** Aviso do backend no meio de um turno (ex.: caiu para outro provedor). */
  "chat:notice": { conversationId: string; text: string };
  /** O agente usou uma ferramenta (modo agente): o que rodou/leu e o resultado resumido. */
  "chat:tool": { conversationId: string; tool: ToolEvent };
  /** Conta e limites do Claude na máquina, depois de cada turno. */
  "chat:account": { host: string; status: AccountStatus | null };
  /** Pareamento do WhatsApp do Hermes em andamento. */
  "whatsapp:event": WhatsappEvent;
  /** Linha de progresso do instalador da status line (tutorial). */
  "statusline:progress": { line: string };
  /** Linha de progresso do instalador da guarda do WhatsApp (tutorial). */
  "guarda:progress": { line: string };
  /** Linha de progresso do instalador do Navegador do agente (tutorial 9). */
  "navegador:progress": { line: string };
  /** Instalação do CRM pelo WhatsApp (tutorial 10): uma linha de progresso. */
  "crm:progress": { line: string };
  /** meu-bot-admin, backup e mudança de máquina: bytes recebidos ou uma linha da restauração. */
  "admin:backup-progress": { bytes?: number; line?: string };
  /** Login do Claude Code em andamento. */
  "claude-login:event": ClaudeLoginEvent;
  /** Login OAuth da xAI no Hermes em andamento (mesmo formato). */
  "xai-login:event": ClaudeLoginEvent;
  /** Terminal: bytes crus do shell (o xterm decodifica) e o fim da sessão. */
  "term:data": { id: string; data: Uint8Array };
  "term:exit": { id: string; code: number; detail: string | null };
  /** Uma versão nova do app foi baixada e preparada: "Reiniciar e atualizar" troca na hora. */
  "update:ready": { version: string };
  /** Cada fase da verificação de atualização (verificando, mais recente, baixando, pronta, erro). */
  "update:state": UpdateState;
  /** Seletor pediu: abrir o modal de login do Claude Code nesta janela. */
  "ui:claude-login": Record<string, never>;
  /** Internet deste Mac mudou ou foi sondada (faixa OFFLINE em todas as janelas). */
  "net:state": NetState;
  /** Navegador: a lista de extensões da sessão mudou (instalou pela Web Store, removeu). */
  "browser:extensions": BrowserExtensionInfo[];
  /** Navegador: uma página pediu janela nova (target=_blank): abrir como aba interna. */
  "browser:open-url": { url: string };
  /** A extensão do CRM (Gmail) pediu para abrir a aba da conversa do WhatsApp deste número (só dígitos, com DDI). */
  "whatsapp:abrir": { number: string };
  /** Navegador: atalho Cmd+<tecla> apertado com o foco dentro de um webview (o app trata). */
  "browser:key": { key: string; shift: boolean };
  /** Navegador: o agente (pelas ações) pede uma aba nova, ativar ou fechar uma aba (id do webContents). */
  "browser:ask": { kind: "new-tab"; url: string } | { kind: "activate" | "close"; wcId: number };
  /** Navegador: estado do "agente pode usar" (socket + túnel reverso). */
  "browser:agent": BrowserAgentState;
  /** Navegador: a barra de favoritos da máquina mudou (pela pessoa ou pelo agente). */
  "browser:favorites": NavFavorito[];
  "browser:workspaces": NavWorkspaces;
}

export type MainEventChannel = keyof MainEvents;

/** API exposta ao renderer via contextBridge como window.meuBot. */
/** Janela principal, os dois apps: leituras da máquina e o que é só deste Mac. */
export interface MeuBotSharedApi {
  getMemory(): Promise<MemoryView>;
  setMemory(update: { notas?: string; perfil?: string }): Promise<MemoryView>;
  getSettings(): Promise<SettingsView>;
  /** Máquina desta janela; null se a janela não está registrada (não deveria acontecer). */
  getWindowInfo(): Promise<WindowInfo | null>;
  /** Abre o seletor de máquinas (nova janela em outra máquina). */
  openPicker(): Promise<void>;
  /** WhatsApp do Hermes na máquina desta janela. */
  whatsappStatus(): Promise<WhatsappStatus>;
  xaiKeyStatus(): Promise<XaiKeyStatus>;
  /** Terminal na máquina desta janela (pty-broker por ssh; neste Mac, local). Os dois apps; no admin fica no registro da pessoa. */
  termOpen(cols: number, rows: number): Promise<{ id: string }>;
  termInput(id: string, data: string | Uint8Array): void;
  termResize(id: string, cols: number, rows: number): void;
  termClose(id: string): Promise<void>;
  termReplay(id: string): Promise<Uint8Array>;
  /** Atualização automática: estado (versão atual, disponível, pronta) e trocar + reiniciar. */
  updateState(): Promise<UpdateState>;
  /** "Verificar agora": consulta o GitHub fora do ciclo; devolve o estado ao fim. */
  checkUpdate(): Promise<UpdateState>;
  applyUpdate(): Promise<void>;
  /** Internet deste Mac: sonda (com `force`, mesmo com resultado fresco) e devolve o estado. */
  netCheck(force?: boolean): Promise<NetState>;
  /** A máquina desta janela é este próprio Mac (colima)? O túnel para ela não precisa de internet. */
  hostLocalAddr(): Promise<boolean>;
  /** Conversas do WhatsApp (OpenClaw) desta máquina, mais recente primeiro. Só leitura. */
  whatsappChats(): Promise<WhatsappChat[]>;
  /** Histórico de um contato (número só com dígitos). Só leitura. */
  whatsappThread(number: string): Promise<WhatsappThreadMessage[]>;
  /** Menu "…" de uma conversa do WhatsApp na lista. */
  showWhatsappMenu(number: string, state: { archived: boolean; paused: boolean; deleted: boolean }): Promise<WhatsappMenuAction | null>;
  /** Pausa (true) ou retoma (false) as respostas do agente a este contato. Os dois apps (no admin, registrado). */
  pauseWhatsapp(number: string, paused: boolean): Promise<void>;
  /** O que limpar o histórico deste contato vai zerar: só sessões dele, ou também a principal (de todos). Os dois apps. */
  whatsappClearPlan(number: string): Promise<{ own: number; shared: number }>;
  /** meu-bot-crm: guarda a conversa no CRM (transcrição + resumo) antes de limpar/excluir. */
  archiveWhatsappToCrm(number: string): Promise<WhatsappArchive>;
  /** Limpa na máquina o histórico do agente com este contato; `includeShared` confirma zerar a principal. */
  clearWhatsapp(number: string, includeShared: boolean): Promise<void>;
  /** Arquiva/desarquiva/exclui conversas na máquina (whatsapp-lista.json): os dois apps veem igual. No admin, registrado. */
  markWhatsapp(marks: WaMarkPatch[]): Promise<void>;
  /** Descobre o nome (pushname) de contatos sem nome lendo o histórico deles de uma vez (até 20) e guarda na máquina. Devolve só os achados. */
  learnWhatsappNames(numbers: string[]): Promise<Record<string, string>>;
  /** Salva a conversa toda num arquivo; null = cancelado. */
  exportWhatsapp(number: string, format: ExportFormat): Promise<{ path: string } | null>;
  /** Conta do Claude Code na máquina desta janela (null se não deu para consultar). */
  claudeAuth(): Promise<ClaudeAuthInfo | null>;
  /** OAuth da xAI no Hermes da máquina (credencial xai-oauth); null se a máquina não tem Hermes. */
  xaiAuth(): Promise<ClaudeAuthInfo | null>;
  setSettings(update: SettingsUpdate): Promise<SettingsView>;
  /** Abre um link http(s) no navegador do sistema. */
  openExternal(url: string): Promise<void>;
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void;
}

/** Variante: cliente. Só o meu-bot normal: conversar com o agente, parear e mexer no WhatsApp, logins, instalar, suporte do lado da pessoa. */
export interface MeuBotClientApi {
  send(conversationId: string, text: string): Promise<void>;
  /** Interrompe a resposta em andamento desta conversa. */
  cancel(conversationId: string): Promise<void>;
  newConversation(): Promise<ConversationRef>;
  closeConversation(conversationId: string): Promise<void>;
  /** Conversas salvas, em ordem de criação, para reabrir as abas. */
  listConversations(): Promise<StoredConversationView[]>;
  /** "" remove o nome e volta ao título automático. */
  renameConversation(conversationId: string, title: string): Promise<void>;
  /** Nova ordem das abas, da esquerda para a direita. */
  reorderConversations(conversationIds: string[]): Promise<void>;
  setConversationModel(conversationId: string, model: BackendModel): Promise<void>;
  /** Marca como aberta em aba e devolve a conversa completa. */
  openConversation(conversationId: string): Promise<StoredConversationView | null>;
  deleteConversation(conversationId: string): Promise<void>;
  archiveConversation(conversationId: string, archived: boolean): Promise<void>;
  duplicateConversation(conversationId: string): Promise<StoredConversationView | null>;
  /** Nova conversa com o histórico até a mensagem de índice `index` (inclusive). */
  branchConversation(conversationId: string, index: number): Promise<StoredConversationView | null>;
  /** Abre o diálogo de salvar; null se cancelado. */
  exportConversation(conversationId: string, format: ExportFormat): Promise<{ path: string } | null>;
  /** Sessão do Claude Code desta conversa (o .jsonl na máquina), para "Copiar ID"; null = ainda não há. */
  conversationReference(conversationId: string): Promise<{ claude: ClaudeSessionRef | null }>;
  /** Menu de contexto nativo da aba; null se fechado sem escolher. */
  showTabMenu(conversationId: string, state: { busy: boolean; archived: boolean }): Promise<TabMenuAction | null>;
  notify(conversationId: string, title: string, body: string): Promise<void>;
  /** Notificação de teste do sistema ("as notificações estão funcionando"); o macOS pede a permissão junto, na primeira. */
  notifyTest(): Promise<void>;
  /** Avisos de segurança desta máquina (backend); null = backend sem a rota ou fora do ar. */
  alertPrefs(): Promise<AlertPrefs | null>;
  setAlertPrefs(prefs: AlertPrefs): Promise<void>;
  quickAck(correlationId: string, ok: boolean, message?: string): void;
  /** Mostra/esconde a janela de entrada rápida (mesmo efeito do atalho global). */
  toggleQuickEntry(): Promise<void>;
  /** Conta e limites do Claude na máquina desta janela (null se o backend não tem o endpoint). */
  getAccountStatus(): Promise<AccountStatus | null>;
  /** Licença e devices desta conta (plano, status, membro desde, máquinas); null se o backend é antigo/fora do ar. */
  getLicense(): Promise<LicenseView | null>;
  /** Tailscale: ssh check → accept na política do tailnet (precisa da credencial salva no seletor). */
  disableTailscaleCheck(): Promise<TailscaleSshResult>;
  /** Tailscale: volta a política para o backup mais novo. */
  restoreTailscalePolicy(): Promise<TailscaleSshResult>;
  /** Pareia por QR (eventos em whatsapp:event). `reset` apaga a sessão atual antes. Resolve ao terminar. */
  whatsappPair(reset: boolean): Promise<void>;
  /** Desconecta o número da máquina (sem gerar QR novo). */
  whatsappLogout(): Promise<void>;
  /** Suporte (lado da pessoa): estado, ligar/desligar, código para copiar. */
  supportInfo(): Promise<SupportInfo>;
  setSupport(on: boolean, name: string): Promise<SupportInfo>;
  supportCode(): Promise<string>;
  /** Há backend do meu-bot nesta máquina? (decide se a linha "xAI (Grok)" aparece sem Hermes; o login é OAuth pelo Hermes). */
  /** Prepara o Grok por OAuth na máquina (Hermes + proxy local); progresso em xai-login:event (log). */
  xaiPrepare(): Promise<InstallBackendResult>;
  /** Status line do Claude na máquina desta janela: instalada? e instalar (progresso em statusline:progress). */
  statusLineInstalled(): Promise<boolean>;
  /** "Refazer do zero": desfaz a status line na máquina (script, settings.json, preferências). */
  uninstallStatusLine(): Promise<InstallBackendResult>;
  /** "Refazer do zero" do suporte: desliga e esquece o nome. */
  resetSupport(): Promise<SupportInfo>;
  /** Segmentos da status line nesta máquina (null = sem preferência gravada = todos). */
  statusLineSegments(): Promise<StatusLineSegments | null>;
  setStatusLineSegments(prefs: StatusLineSegments): Promise<StatusLineSegments>;
  installStatusLine(): Promise<InstallBackendResult>;
  /** Guarda do WhatsApp (plugin meu-bot-guarda no OpenClaw da máquina): instalada? (null = sem OpenClaw), instalar, desfazer. */
  /**
   * Aba "Navegador" (Pro), como no Rambox: as abas internas são `<webview>` do renderer na partição que
   * `browserOpen` devolve (exige plano Pro na máquina: erro "PRO_REQUIRED"); o main cuida da sessão e das extensões.
   */
  browserOpen(): Promise<BrowserOpenInfo>;
  browserExtensions(): Promise<BrowserExtensionInfo[]>;
  /** Liga/desliga "agente pode usar" (socket de ações + túnel reverso); estado em browser:agent. */
  browserAgent(on: boolean): Promise<BrowserAgentState>;
  /** Qual aba interna está ativa (id do webContents): as ações do agente sem `aba` caem nela. */
  browserActive(wcId: number): void;
  browserRemoveExtension(extId: string): Promise<BrowserExtensionInfo[]>;
  /** Free pediu o Pro: fica no registro do suporte da máquina. */
  browserRequestPro(): Promise<void>;
  /** Barra de favoritos do Navegador (por máquina): adicionar (url repetida só atualiza o título) e remover por id. */
  browserFavoriteAdd(f: { titulo: string; url: string }): Promise<NavFavorito[]>;
  browserFavoriteRemove(id: string): Promise<NavFavorito[]>;
  /** Grava os espaços de trabalho desta máquina (o main valida e devolve o que ficou). */
  browserWorkspacesSet(w: NavWorkspaces): Promise<NavWorkspaces>;
  guardaInstalled(): Promise<boolean | null>;
  /** Navegador do agente na máquina (MCP + regra): instalado? e instalar (progresso em navegador:progress). */
  navegadorInstalled(): Promise<boolean | null>;
  installNavegador(): Promise<InstallBackendResult>;
  installGuarda(): Promise<InstallBackendResult>;
  uninstallGuarda(): Promise<InstallBackendResult>;
  /** Tutorial 10 · CRM pelo WhatsApp (Pro): estado, instalar o plugin na máquina, gravar chave/pipeline/regras, testar a chave, refazer. */
  crmInfo(): Promise<CrmInfo>;
  installCrm(): Promise<InstallBackendResult>;
  setCrm(patch: { apiKey?: string; pipelineKey?: string | null; pipelineName?: string; silencioMin?: number; criarSemPerguntar?: boolean }): Promise<CrmInfo>;
  crmTest(): Promise<CrmDiag>;
  resetCrm(): Promise<CrmInfo>;
  /** Salva só o nome (passo 1 do tutorial), sem ligar nada. */
  setSupportName(name: string): Promise<SupportInfo>;
  /** Tutorial 7: estado na máquina (objetivo, nível, skill salva, skills do workspace). */
  objectiveInfo(): Promise<ObjectiveInfo>;
  /** Tutorial 7, passos 1 e 2: grava o objetivo e/ou o nível em objetivo.json na máquina. */
  setObjective(patch: { objective?: ObjectiveChoice; level?: FreedomLevel }): Promise<ObjectiveInfo>;
  /** Tutorial 7, passo 3: escreve a skill no workspace do OpenClaw e aplica a trava do nível. */
  saveObjectiveSkill(): Promise<ObjectiveInfo & { detail: string }>;
  /** "Refazer do zero" do tutorial 7: apaga a skill e o objetivo; o dono volta à liberdade total. */
  resetObjective(): Promise<ObjectiveInfo>;
  /** "Tentar de novo": entrega o aviso na caixa do admin agora. */
  supportDeliver(): Promise<SupportInfo>;
  /** Progresso nos tutoriais desta pessoa (vai para a máquina só com o suporte ligado). */
  reportProgress(p: SupportProgress): Promise<void>;
  /** O que o app do admin pode ver desta máquina (vale na hora). */
  setSupportShare(share: SupportShare): Promise<SupportInfo>;
  /** Instala/ajusta o áudio do agente do WhatsApp nesta máquina (transcrição ou voz). */
  whatsappAudio(setup: AudioSetup): Promise<InstallBackendResult>;
  whatsappCancel(): Promise<void>;
  /** OpenClaw: "self" = só você fala com o agente; "open" = responde todo mundo; "list" = você + `numbers` (só dígitos, com DDI). Vale sem reiniciar o gateway. */
  whatsappSetDmPolicy(policy: WhatsappReplyChoice, numbers?: readonly string[]): Promise<WhatsappStatus>;
  /** Conversa nova do meu-bot com a conversa do WhatsApp como contexto. */
  whatsappBranch(number: string): Promise<StoredConversationView>;
  /** Login do Claude Code na máquina desta janela (eventos em claude-login:event). Resolve ao terminar. */
  claudeLogin(): Promise<void>;
  /** Código colado pela pessoa; false se não há login em andamento. */
  claudeLoginCode(code: string): Promise<boolean>;
  claudeLoginCancel(): Promise<void>;
  /** `claude auth logout` na máquina; devolve o estado depois. */
  claudeLogout(): Promise<ClaudeAuthInfo | null>;
  /** `hermes auth add xai-oauth --type oauth --no-browser` (eventos em xai-login:event). */
  xaiLogin(): Promise<void>;
  xaiLoginCancel(): Promise<void>;
  xaiLogout(): Promise<ClaudeAuthInfo | null>;
}

/** Variante: admin. Só o meu-bot-admin: a página "Suporte" da máquina da pessoa. */
/** Variante: admin. Um MVP de produto derivado do meu-bot (meu-bot-fit, meu-bot-vendas…) registrado no meu-bot-admin. */
export type ProdutoStatus = "ideia" | "mvp" | "beta" | "lancado";
export interface ProdutoMvp {
  /** meu-bot-<slug>. */
  nome: string;
  vertical: string;
  pitch: string;
  publico: string;
  modulos: { chat: boolean; whatsapp: boolean; navegador: boolean; crm: boolean; extras: string };
  pipeline: { etapas: string[]; campos: { nome: string; tipo: "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "TAG" | "CHECKBOX" }[] };
  status: ProdutoStatus;
  notas: string;
  proximos: string;
  createdAt: string;
  updatedAt: string;
}
export type ProdutoMvpPatch = { nome: string } & Partial<Omit<ProdutoMvp, "nome" | "createdAt" | "updatedAt">>;

/** Um backup no Mac do admin (sem segredos: o pacote fica cifrado). */
export interface BackupIndiceView { arquivo: string; pessoa: string; maquina: string; criadoEm: string; tamanho: number; por: string; usuario: string; whatsapp: boolean; arquivos: number }
/** Pré-voo da restauração num destino: o que impede, o que pede atenção. */
export interface BackupRestauracao { bloqueios: string[]; avisos: string[]; podeRestaurar: boolean; destinoUsuario: string; whatsappNoDestino: boolean }
export interface MeuBotAdminApi {
  /** meu-bot-admin: MVPs de produtos (registro local do admin): listar, criar/editar, remover, exportar a definição. */
  adminProdutos(): Promise<ProdutoMvp[]>;
  adminProdutoSave(patch: ProdutoMvpPatch): Promise<ProdutoMvp[]>;
  adminProdutoRemove(nome: string): Promise<ProdutoMvp[]>;
  adminProdutoExport(nome: string): Promise<{ json: string; checklist: string[] }>;
  /** meu-bot-admin: saúde, registros e ações na máquina da pessoa desta janela. */
  adminHealth(): Promise<AdminHealth>;
  /** Backup completo e mudança de máquina (a desta janela). Restaurar e trocar o WhatsApp: só o super admin. */
  adminBackupListar(todos?: boolean): Promise<{ backups: BackupIndiceView[]; podeRestaurar: boolean; podeCriar: boolean }>;
  adminBackupCriar(): Promise<BackupIndiceView>;
  adminBackupConferir(arquivo: string, substituir: boolean): Promise<BackupRestauracao>;
  adminBackupRestaurar(arquivo: string, substituir: boolean): Promise<{ log: string[] }>;
  adminBackupWhatsapp(arquivo: string, antigaDesligada: boolean): Promise<{ log: string[] }>;
  adminLogs(): Promise<string>;
  adminAction(action: AdminAction): Promise<{ ok: boolean; detail: string }>;
  /** Conversas dela com o meu-bot (transcrições do Claude Code na máquina), só leitura. */
  adminBotChats(): Promise<BotChat[]>;
  adminBotThread(sessionId: string): Promise<BotMessage[]>;
  /** Apaga na máquina dela a transcrição de uma conversa com o meu-bot (travou, ficou lixo); fica no registro. */
  adminBotDelete(sessionId: string): Promise<void>;
  /** Menu "…" de uma conversa dela com o meu-bot no espelho. */
  showBotMenu(sessionId: string): Promise<BotMenuAction | null>;
  /** meu-bot-admin: muda a licença da pessoa (plano, status, validade, limite); grava licenca.json por SSH. */
  setLicense(patch: LicensePatch): Promise<LicenseView>;
  /** meu-bot-admin: libera um device pendente (sobe o limite se preciso e marca o device como ativo). */
  approveDevice(deviceId: string): Promise<LicenseView>;
  /** meu-bot-admin: revoga um device (tira do registro); ele volta no próximo hello se couber no limite. */
  removeDevice(deviceId: string): Promise<LicenseView>;
}

/** O que o renderer vê em `window.meuBot`: os três grupos juntos (o main recusa o que não é da variante). */
export type MeuBotApi = MeuBotSharedApi & MeuBotClientApi & MeuBotAdminApi;
