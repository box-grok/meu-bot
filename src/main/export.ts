import type { StoredConversation } from "./conversation";

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
};

export const conversationTitle = (conv: StoredConversation): string =>
  (conv.title ?? conv.messages.find((m) => m.role === "user")?.content ?? "Conversa").replace(/\s+/g, " ").trim().slice(0, 60);

/** Nome de arquivo seguro a partir do título. */
export const slugify = (title: string): string =>
  title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "conversa";

/** Markdown legível de uma conversa. Puro, testável. */
export function conversationToMarkdown(conv: StoredConversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversationTitle(conv)}`, "");
  lines.push(`- Modelo: ${conv.model}`);
  lines.push(`- Máquina: ${conv.host}`);
  lines.push(`- Criada em: ${fmtDate(conv.createdAt)}`);
  lines.push(`- Última mensagem: ${fmtDate(conv.updatedAt)}`);
  if (conv.branchedFrom !== undefined) lines.push(`- Ramificada da conversa ${conv.branchedFrom.id}, mensagem ${conv.branchedFrom.index + 1}`);
  lines.push("", "---", "");
  for (const m of conv.messages) {
    const who = m.role === "user" ? "**Você:**" : `**Assistente${m.provider !== undefined ? ` (${m.provider})` : ""}:**`;
    lines.push(who, ...(m.fallback !== undefined ? [`_${m.fallback}_`] : []), "", m.content.trim(), "", "---", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
