/**
 * Qual app é este (meu-bot ou meu-bot-admin) e o que cada um pode fazer. Puro: testável com node --test.
 * Ler o variant.json e o ambiente é tarefa do variant.ts; aqui só a decisão e a tabela de capacidades.
 */
import type { AppVariant, Capabilities } from "../shared/ipc";

export type { AppVariant, Capabilities };

export interface VariantInput {
  /** app.isPackaged: empacotado lê o variant.json; em dev vale a variável de ambiente. */
  packaged: boolean;
  /** MEU_BOT_VARIANT (só em dev). */
  env: string | undefined;
  /** Conteúdo do Resources/variant.json já parseado (undefined/null = sem arquivo ou inválido). */
  variantJson: unknown;
}

export function resolveVariant(i: VariantInput): AppVariant {
  if (!i.packaged) return i.env === "admin" ? "admin" : "client";
  const v = i.variantJson !== null && typeof i.variantJson === "object" ? (i.variantJson as { variant?: unknown }).variant : undefined;
  return v === "admin" ? "admin" : "client";
}

export const titleFor = (v: AppVariant): string => (v === "admin" ? "meu-bot-admin" : "meu-bot");

/** O admin só lê e faz as ações de suporte; o meu-bot normal faz tudo o mais. */
export function capsFor(variant: AppVariant): Capabilities {
  const client = variant === "client";
  return { variant, chat: client, pair: client, login: client, manageWa: client, tunnel: client, install: client, supportClient: client, supportAdmin: !client };
}
