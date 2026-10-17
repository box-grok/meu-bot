/**
 * "Copiar ID": uma linha por conversa, legível por gente e por IA, apontando onde ela mora na máquina.
 * Puro (sem DOM): o renderer copia e avisa. Três formas:
 *   meu-bot · colima · ~/.claude/projects/-home-box-chat-workspace/<uuid>.jsonl
 *   whatsapp · colima · +5516992294486 · agent:main:whatsapp:direct:+5516992294486 · sessão <uuid>
 *   meu-bot · colima · conversa <id do app> (ainda sem transcrição na máquina: mande uma mensagem e copie de novo)
 */
import type { BotChat, ClaudeSessionRef, WhatsappChat } from "../../shared/ipc";

/** Conversa dela com o meu-bot vista no espelho do admin: o .jsonl pela pasta do projeto e a sessão. */
export const botReferenceText = (chat: Pick<BotChat, "project" | "sessionId">, machine: string): string =>
  `meu-bot · ${machine} · ~/.claude/projects/${chat.project}/${chat.sessionId}.jsonl`;

/** Caminho absoluto da máquina (vem do backend) encurtado para ~ quando está na home. */
const tildify = (file: string): string => file.replace(/^\/root(?=\/)/, "~").replace(/^\/(?:home|Users)\/[^/]+(?=\/)/, "~");

/** Conversa deste app: a sessão do Claude Code quando o backend já a conhece; senão o plano B com o id do app. */
export const conversationReferenceText = (conversationId: string, machine: string, claude: ClaudeSessionRef | null): string =>
  claude === null
    ? `meu-bot · ${machine} · conversa ${conversationId} (ainda sem transcrição na máquina: mande uma mensagem e copie de novo)`
    : `meu-bot · ${machine} · ${tildify(claude.file)}`;

/** Conversa do WhatsApp: número, chave da sessão do OpenClaw e o UUID atual; uma linha por sessão (principal inclusive). */
export function waReferenceText(chat: Pick<WhatsappChat, "number" | "sessionKeys" | "sessionIds">, machine: string): string {
  const head = `whatsapp · ${machine} · +${chat.number}`;
  if (chat.sessionKeys.length === 0) return `${head} · (sem sessão no OpenClaw ainda)`;
  return chat.sessionKeys.map((k) => { const id = chat.sessionIds[k]; return `${head} · ${k}${id === undefined ? "" : ` · sessão ${id}`}`; }).join("\n");
}
