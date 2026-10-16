/**
 * Qual app é este: o meu-bot (de cada pessoa) ou o meu-bot-admin (suporte). Mesmo código; o empacotamento
 * grava Resources/variant.json (`scripts/package.mjs --admin`). Em dev: MEU_BOT_VARIANT=admin.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type AppVariant = "client" | "admin";
let cached: AppVariant | null = null;

export function appVariant(): AppVariant {
  if (cached !== null) return cached;
  let v: AppVariant = "client";
  if (!app.isPackaged) v = process.env.MEU_BOT_VARIANT === "admin" ? "admin" : "client";
  else {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "variant.json"), "utf8")) as { variant?: unknown };
      if (raw.variant === "admin") v = "admin";
    } catch { /* sem arquivo: o meu-bot normal */ }
  }
  cached = v;
  return v;
}

export const isAdmin = (): boolean => appVariant() === "admin";
export const appTitle = (): string => (isAdmin() ? "meu-bot-admin" : "meu-bot");
