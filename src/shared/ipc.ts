/** Contrato IPC entre renderer, preload e processo principal. Só tipos e constantes. */

/** Modelos expostos pelo backend OpenAI-compatível da VM. */
export const BACKEND_MODELS = ["rene-dm", "rene", "claudecode"] as const;
export type BackendModel = (typeof BACKEND_MODELS)[number];

export interface SettingsView {
  sshHost: string;
  backendModel: BackendModel;
  backendPort: number;
}

export interface SettingsUpdate {
  /** Host SSH (alias do ~/.ssh/config ou hostname). */
  sshHost?: string;
  backendModel?: BackendModel;
  backendPort?: number;
}

/** Estado do túnel/backend, enviado ao renderer. */
export interface BackendStatusEvent {
  state: "idle" | "connecting" | "ready" | "error";
  detail: string;
}

export interface DoneEvent {
  conversationId: string;
  stopReason: string;
  refusal?: { category: string | null; explanation: string };
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
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Posição da aba; menor fica mais à esquerda. */
  order: number;
}

export interface MainEvents {
  "chat:assistant-start": ConversationRef;
  "chat:delta": ConversationRef & { text: string };
  "chat:done": DoneEvent;
  "chat:error": ErrorEvent;
  "backend:status": BackendStatusEvent;
}

export type MainEventChannel = keyof MainEvents;

/** API exposta ao renderer via contextBridge como window.meuBot. */
export interface MeuBotApi {
  send(conversationId: string, text: string): Promise<void>;
  newConversation(): Promise<ConversationRef>;
  closeConversation(conversationId: string): Promise<void>;
  /** Conversas salvas, em ordem de criação, para reabrir as abas. */
  listConversations(): Promise<StoredConversationView[]>;
  /** "" remove o nome e volta ao título automático. */
  renameConversation(conversationId: string, title: string): Promise<void>;
  /** Nova ordem das abas, da esquerda para a direita. */
  reorderConversations(conversationIds: string[]): Promise<void>;
  getSettings(): Promise<SettingsView>;
  /** Aliases "Host" do ~/.ssh/config (e Includes), sem curingas, em ordem alfabética. */
  listSshHosts(): Promise<string[]>;
  setSettings(update: SettingsUpdate): Promise<SettingsView>;
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void;
}
