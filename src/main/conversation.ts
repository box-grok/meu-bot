import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface BackendMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  windowId: number;
  title?: string;
  /** Histórico no formato OpenAI-compatível do backend. */
  backendMessages: BackendMessage[];
  createdAt: string;
  updatedAt: string;
  /** Posição da aba; menor fica mais à esquerda. */
  order: number;
  busy: boolean;
  /** Aba fechada: um turno em andamento descarta a resposta. */
  closed: boolean;
}

/** Forma gravada em disco e enviada ao renderer na abertura. */
export interface StoredConversation {
  id: string;
  title?: string;
  messages: BackendMessage[];
  createdAt: string;
  updatedAt: string;
  order: number;
}

/** Uma conversa por aba, identificada pelo id que o renderer recebe. */
const conversations = new Map<string, Conversation>();
let counter = 0;

const storePath = (): string => path.join(app.getPath("userData"), "conversations.json");
const newId = (): string => `${new Date().toISOString().replace(/[:.]/g, "-")}-${++counter}`;

const toStored = (c: Conversation): StoredConversation => ({
  id: c.id, ...(c.title === undefined ? {} : { title: c.title }),
  messages: c.backendMessages, createdAt: c.createdAt, updatedAt: c.updatedAt, order: c.order,
});

const nextOrder = (): number => Math.max(-1, ...[...conversations.values()].map((c) => c.order)) + 1;

/** Reordena pelas ids recebidas; ids desconhecidas são ignoradas, conhecidas ausentes vão para o fim. */
export function reorderConversations(ids: string[]): void {
  const seen = new Set<string>();
  let i = 0;
  for (const id of ids) {
    const conv = conversations.get(id);
    if (conv === undefined || seen.has(id)) continue;
    seen.add(id);
    conv.order = i++;
  }
  for (const conv of [...conversations.values()].sort((a, b) => a.order - b.order)) {
    if (!seen.has(conv.id)) conv.order = i++;
  }
  persistConversations();
}

const MAX_TITLE = 60;

export function renameConversation(id: string, title: string): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  if (clean === "") delete conv.title;
  else conv.title = clean;
  persistConversations();
}

/** Grava todas as conversas de uma vez, atomicamente. Pequeno o bastante para isso. */
export function persistConversations(): void {
  try {
    const target = storePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const list = [...conversations.values()].map(toStored);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, conversations: list }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    /* persistência é cortesia; nunca derruba o chat */
  }
}

/** Carrega o que foi salvo na última execução. Chamar uma vez, após app.whenReady(). */
export function loadConversations(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as { conversations?: unknown };
    if (!Array.isArray(raw.conversations)) return;
    let fallbackOrder = 0;
    for (const item of raw.conversations as Partial<StoredConversation>[]) {
      if (typeof item.id !== "string" || !Array.isArray(item.messages)) continue;
      const order = typeof item.order === "number" && Number.isFinite(item.order) ? item.order : fallbackOrder;
      fallbackOrder = Math.max(fallbackOrder, order) + 1;
      const messages = item.messages.filter(
        (m): m is BackendMessage => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
      );
      const now = new Date().toISOString();
      conversations.set(item.id, {
        id: item.id, windowId: -1, backendMessages: messages,
        ...(typeof item.title === "string" && item.title.trim() !== "" ? { title: item.title.slice(0, MAX_TITLE) } : {}),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
        order,
        busy: false, closed: false,
      });
    }
  } catch {
    /* sem arquivo ou inválido: começa vazio */
  }
}

export function createConversation(windowId: number): Conversation {
  const now = new Date().toISOString();
  const conv: Conversation = { id: newId(), windowId, backendMessages: [], createdAt: now, updatedAt: now, order: nextOrder(), busy: false, closed: false };
  conversations.set(conv.id, conv);
  persistConversations();
  return conv;
}

export const getConversation = (id: string): Conversation | undefined => conversations.get(id);

/** Alguma conversa aguardando resposta do backend. */
export const anyConversationBusy = (): boolean => [...conversations.values()].some((c) => c.busy);

/** Conversas para reabrir numa janela: liga todas a ela e devolve em ordem de criação. */
export function listConversationsFor(windowId: number): StoredConversation[] {
  const list = [...conversations.values()].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  for (const c of list) c.windowId = windowId;
  return list.map(toStored);
}

export function touchConversation(conv: Conversation): void {
  conv.updatedAt = new Date().toISOString();
  persistConversations();
}

export function dropConversation(id: string): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  conv.closed = true;
  conversations.delete(id);
  persistConversations();
}

/** Janela fechada: só marca como ociosa; o histórico fica para a próxima abertura. */
export function releaseWindow(windowId: number): void {
  for (const conv of conversations.values()) if (conv.windowId === windowId) conv.busy = false;
}

/** Transcript em disco, só para consulta do usuário. Falhas são ignoradas. */
export function saveTranscript(conv: Conversation): void {
  touchConversation(conv);
  try {
    const dir = path.join(app.getPath("userData"), "transcripts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${conv.id}.json`), JSON.stringify(conv.backendMessages, null, 2), { mode: 0o600 });
  } catch {
    /* transcript é cortesia; nunca derruba o chat */
  }
}
