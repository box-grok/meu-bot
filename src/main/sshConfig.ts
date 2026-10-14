import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidHost } from "./settings";

const MAX_DEPTH = 3;

/** Expande um padrão de Include do ssh: ~, relativo a ~/.ssh, e um único * no nome do arquivo. */
function expandInclude(pattern: string): string[] {
  const home = os.homedir();
  let p = pattern.startsWith("~") ? path.join(home, pattern.slice(1)) : pattern;
  if (!path.isAbsolute(p)) p = path.join(home, ".ssh", p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (!base.includes("*")) return [p];
  try {
    const re = new RegExp(`^${base.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)).sort();
  } catch {
    return [];
  }
}

function collect(file: string, depth: number, seen: Set<string>, out: Set<string>): void {
  if (depth > MAX_DEPTH || seen.has(file)) return;
  seen.add(file);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(\S+)\s*(?:=|\s)\s*(.*)$/.exec(line);
    if (m === null) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "include") {
      for (const pat of value.split(/\s+/)) for (const f of expandInclude(pat)) collect(f, depth + 1, seen, out);
    } else if (key === "host") {
      for (const alias of value.split(/\s+/)) {
        if (/[*?!]/.test(alias)) continue;
        if (isValidHost(alias)) out.add(alias);
      }
    }
  }
}

/** Hosts do ~/.ssh/config que podem ser usados como alias, sem curingas. */
export function listSshHosts(): string[] {
  const out = new Set<string>();
  collect(path.join(os.homedir(), ".ssh", "config"), 0, new Set(), out);
  return [...out].sort((a, b) => a.localeCompare(b));
}
