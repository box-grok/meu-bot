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
  backendPort: number;
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
}

export interface SettingsUpdate {
  backendModel?: BackendModel;
  /** Modelo padrão só para a máquina da janela que salvou. */
  backendModelForHost?: BackendModel;
  backendPort?: number;
  fontSize?: number;
  theme?: Theme;
  notifications?: boolean;
  contextBudgetTokens?: number;
  memoryEveryTurns?: number;
  quickEntryEnabled?: boolean;
  quickEntryShortcut?: string;
  /** O renderer marca concluído/pulado; "pending" é a ação "Rever onboarding" da paleta. */
  onboarding?: "pending" | "done" | "skipped";
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
export interface AccountStatus {
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
  /** Alguém escuta na porta do backend. */
  backendListening: boolean;
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
  /** Agente de chat da máquina (openclaw tem preferência quando os dois existem). */
  gateway: Gateway | null;
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

/** O que a janela principal recebe ao nascer: a máquina a que está presa. */
export interface WindowInfo {
  host: string;
  /** Modelos conhecidos dessa máquina (da última sondagem); vazio se desconhecido. */
  models: string[];
}

/** Dados iniciais do seletor de máquinas. */
export interface PickerInit {
  hosts: string[];
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
}

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
export interface PickerApi {
  list(): Promise<PickerInit>;
  probe(host: string): Promise<HostProbe>;
  install(host: string): Promise<InstallBackendResult>;
  /** Instala a status line do Claude Code na máquina (statusline.sh + statusLine no settings.json); mesmo log de progresso. */
  installStatusLine(host: string): Promise<InstallBackendResult>;
  choose(host: string): Promise<void>;
  /** Cria (true) ou remove (false) o atalho "meu-bot <host>.app" na área de trabalho; devolve o estado final. */
  setShortcut(host: string, create: boolean): Promise<{ has: boolean; emoji: string | null }>;
  /** Acrescenta ao ~/.ssh/config as máquinas do modelo versionado que faltam (o Cursor lê o mesmo arquivo). */
  syncSsh(): Promise<SshSyncResult>;
  /** Abre a janela de alívio da máquina (computador do Grok Bot) e fecha o seletor. */
  relieve(host: string): Promise<void>;
  /** Cria (true) ou remove (false) o botão "aliviar <host>.app" na área de trabalho. */
  setReliefShortcut(host: string, create: boolean): Promise<{ has: boolean }>;
  /** Caixinha "abrir direto" do rodapé. */
  setOpenDirect(value: boolean): Promise<void>;
  /** Caixinha "onboarding feito" do rodapé. */
  setOnboardingDone(value: boolean): Promise<void>;
  /** Abre o app do Grok Bot no card "Reset computer" (pod congelado). false se não há quem atenda grokbot://. */
  openGrokbotReset(): Promise<boolean>;
  /** Verificação do Tailscale SSH: abre um ssh que espera, leva o link ao navegador e resolve quando a pessoa aprovar. */
  approveTailscale(host: string): Promise<{ ok: boolean; detail: string }>;
  /** Estado da credencial do OAuth client do Tailscale (nunca o valor). */
  tailscaleCredential(): Promise<TailscaleCredentialState>;
  saveTailscaleCredential(clientId: string, clientSecret: string): Promise<TailscaleCredentialState>;
  forgetTailscaleCredential(): Promise<TailscaleCredentialState>;
  /** Edita a política do tailnet (ssh: check → accept); `host` só invalida a sondagem em cache. */
  disableTailscaleCheck(host: string): Promise<TailscaleSshResult>;
  /** Abre no navegador uma página fixa (allowlist no main): "tailscale-keys". */
  openKnownUrl(which: "tailscale-keys"): Promise<void>;
  /** Abre a janela da máquina já no modal "Entrar no Claude Code". */
  claudeLogin(host: string): Promise<void>;
  cancel(): void;
  on(channel: "picker:init" | "picker:install-progress", callback: (payload: unknown) => void): () => void;
}

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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
}

export type TabMenuAction = "rename" | "duplicate" | "export-md" | "export-json" | "archive" | "unarchive" | "close" | "delete";
export type ExportFormat = "md" | "json";

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
  /** Conta e limites do Claude na máquina, depois de cada turno. */
  "chat:account": { host: string; status: AccountStatus | null };
  /** Pareamento do WhatsApp do Hermes em andamento. */
  "whatsapp:event": WhatsappEvent;
  /** Login do Claude Code em andamento. */
  "claude-login:event": ClaudeLoginEvent;
  /** Login OAuth da xAI no Hermes em andamento (mesmo formato). */
  "xai-login:event": ClaudeLoginEvent;
  /** Seletor pediu: abrir o modal de login do Claude Code nesta janela. */
  "ui:claude-login": Record<string, never>;
}

export type MainEventChannel = keyof MainEvents;

/** API exposta ao renderer via contextBridge como window.meuBot. */
export interface MeuBotApi {
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
  /** Menu de contexto nativo da aba; null se fechado sem escolher. */
  showTabMenu(conversationId: string, state: { busy: boolean; archived: boolean }): Promise<TabMenuAction | null>;
  notify(conversationId: string, title: string, body: string): Promise<void>;
  getMemory(): Promise<MemoryView>;
  quickAck(correlationId: string, ok: boolean, message?: string): void;
  /** Mostra/esconde a janela de entrada rápida (mesmo efeito do atalho global). */
  toggleQuickEntry(): Promise<void>;
  setMemory(update: { notas?: string; perfil?: string }): Promise<MemoryView>;
  getSettings(): Promise<SettingsView>;
  /** Máquina desta janela; null se a janela não está registrada (não deveria acontecer). */
  getWindowInfo(): Promise<WindowInfo | null>;
  /** Abre o seletor de máquinas (nova janela em outra máquina). */
  openPicker(): Promise<void>;
  /** Conta e limites do Claude na máquina desta janela (null se o backend não tem o endpoint). */
  getAccountStatus(): Promise<AccountStatus | null>;
  /** Tailscale: ssh check → accept na política do tailnet (precisa da credencial salva no seletor). */
  disableTailscaleCheck(): Promise<TailscaleSshResult>;
  /** Tailscale: volta a política para o backup mais novo. */
  restoreTailscalePolicy(): Promise<TailscaleSshResult>;
  /** WhatsApp do Hermes na máquina desta janela. */
  whatsappStatus(): Promise<WhatsappStatus>;
  /** Pareia por QR (eventos em whatsapp:event). `reset` apaga a sessão atual antes. Resolve ao terminar. */
  whatsappPair(reset: boolean): Promise<void>;
  whatsappCancel(): Promise<void>;
  /** Login do Claude Code na máquina desta janela (eventos em claude-login:event). Resolve ao terminar. */
  claudeLogin(): Promise<void>;
  /** Código colado pela pessoa; false se não há login em andamento. */
  claudeLoginCode(code: string): Promise<boolean>;
  claudeLoginCancel(): Promise<void>;
  /** Conta do Claude Code na máquina desta janela (null se não deu para consultar). */
  claudeAuth(): Promise<ClaudeAuthInfo | null>;
  /** `claude auth logout` na máquina; devolve o estado depois. */
  claudeLogout(): Promise<ClaudeAuthInfo | null>;
  /** OAuth da xAI no Hermes da máquina (credencial xai-oauth); null se a máquina não tem Hermes. */
  xaiAuth(): Promise<ClaudeAuthInfo | null>;
  /** `hermes auth add xai-oauth --type oauth --no-browser` (eventos em xai-login:event). */
  xaiLogin(): Promise<void>;
  xaiLoginCancel(): Promise<void>;
  xaiLogout(): Promise<ClaudeAuthInfo | null>;
  setSettings(update: SettingsUpdate): Promise<SettingsView>;
  /** Abre um link http(s) no navegador do sistema. */
  openExternal(url: string): Promise<void>;
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void;
}
