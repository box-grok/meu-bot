/**
 * Qual app é este: o meu-bot (de cada pessoa) ou o meu-bot-admin (suporte). Mesmo código; o empacotamento
 * grava Resources/variant.json (`scripts/package.mjs --admin`). Em dev: MEU_BOT_VARIANT=admin.
 * A decisão em si é pura (variant-core.ts); aqui só a leitura do arquivo e o cache.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { capsFor, resolveVariant, titleFor, type AppVariant, type Capabilities } from "./variant-core";

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

export const isAdmin = (): boolean => appVariant() === "admin";
export const appTitle = (): string => titleFor(appVariant());
export const caps = (): Capabilities => capsFor(appVariant());
