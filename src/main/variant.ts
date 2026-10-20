/**
 * Qual produto é este app: meu-bot (de cada pessoa), meu-bot-admin (suporte) ou meu-bot-crm (meu-bot + CRM
 * próprio). Mesmo código; o empacotamento grava Resources/variant.json (`scripts/package.mjs --variant <x>`).
 * Em dev: MEU_BOT_VARIANT=admin|crm. A decisão em si é pura (variant-core.ts); aqui só a leitura e o cache.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { capsFor, produtoDe, resolveVariant, titleFor, userDataNameFor, type AppVariant, type Capabilities, type Produto } from "./variant-core";

export type { AppVariant, Capabilities };
let cached: AppVariant | null = null;

function readVariantJson(): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "variant.json"), "utf8")); } catch { return undefined; }
}

export function appVariant(): AppVariant {
  if (cached !== null) return cached;
  cached = resolveVariant({ packaged: app.isPackaged, env: process.env.MEU_BOT_VARIANT, variantJson: app.isPackaged ? readVariantJson() : undefined });
  return cached;
}

export const appTitle = (): string => titleFor(appVariant());
export const userDataName = (): string | null => userDataNameFor(appVariant());
export const caps = (): Capabilities => capsFor(appVariant());
export const produto = (): Produto => produtoDe(appVariant());
