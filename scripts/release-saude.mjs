// Prova de saúde de um staging, lida do meu-bot-staging deste Mac (regras em saudeStaging, release-core.mjs): está na
// versão, veio da release, o atualizador confirmou que ficou de pé e não voltou para a anterior. A release automática
// (release-auto.mjs) só promove para estável o staging que passa aqui.
//   node scripts/release-saude.mjs 0.80.0-staging.2      → imprime o motivo; sai 0 se saudável, 1 se não
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { saudeStaging } from "./release-core.mjs";

const APP = "meu-bot-staging";
const ler = (f) => { try { return readFileSync(f, "utf8"); } catch { return null; } };

export function saudeDesteMac(versao, home = homedir()) {
  const bundle = join(home, "Applications", `${APP}.app`);
  let plistVersao = null;
  if (existsSync(bundle)) { try { plistVersao = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch { plistVersao = null; } }
  let origem = null; try { origem = JSON.parse(ler(join(bundle, "Contents", "Resources", "build.json")) ?? "{}").origem ?? null; } catch { /* sem build.json */ }
  const dados = join(home, "Library", "Application Support", APP);
  let pendente = null; try { pendente = JSON.parse(ler(join(dados, "update-pendente.json")) ?? "null"); } catch { pendente = null; }
  return saudeStaging({ versao, plistVersao, origem, log: ler(join(dados, "meu-bot.log")), pendente });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const v = (process.argv[2] ?? "").replace(/^v/, "");
  if (!v) { console.error("uso: node scripts/release-saude.mjs <versão staging>"); process.exit(64); }
  const s = saudeDesteMac(v);
  console.log(`${s.ok ? "✓" : "✗"} ${s.motivo}`);
  process.exit(s.ok ? 0 : 1);
}
