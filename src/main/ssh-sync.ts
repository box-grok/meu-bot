/**
 * Sincronização do modelo de máquinas (config/ssh-hosts.conf) com o ~/.ssh/config: calcula o que
 * falta e o texto a acrescentar. Puro (sem fs, sem Electron): testável com node --test.
 *
 * Regras: um Host que já existe no arquivo local nunca é alterado; só entram os Host e os Include
 * ausentes, sempre no fim do arquivo, sob um comentário com a data. Hosts que existem só no Mac são
 * relatados, para quem quiser levá-los para o modelo versionado.
 */

export interface SshBlock { aliases: string[]; text: string }
export interface SshConfigParsed { includes: string[]; blocks: SshBlock[] }

const WILDCARD = /[*?!]/;

/** Divide o texto em linhas de Include (em qualquer nível) e blocos `Host …` com seu texto. */
export function parseSshConfig(text: string): SshConfigParsed {
  const includes: string[] = [];
  const blocks: SshBlock[] = [];
  let current: { aliases: string[]; lines: string[] } | null = null;
  const flush = (): void => {
    if (current === null) return;
    while (current.lines.length > 0 && current.lines[current.lines.length - 1]!.trim() === "") current.lines.pop();
    blocks.push({ aliases: current.aliases, text: current.lines.join("\n") });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(\S+)\s*(?:=|\s)\s*(.*)$/.exec(line);
    const key = m?.[1]?.toLowerCase();
    const value = m?.[2]?.trim() ?? "";
    if (key === "host") {
      flush();
      current = { aliases: value.split(/\s+/).filter((a) => a !== ""), lines: [raw] };
      continue;
    }
    if (key === "include") { for (const p of value.split(/\s+/)) if (p !== "") includes.push(p); }
    if (current !== null) current.lines.push(raw);
  }
  flush();
  return { includes, blocks };
}

/** Caminho de Include normalizado para comparar: `~` → home, relativo → ~/.ssh/. */
export function normalizeInclude(pattern: string, home: string): string {
  if (pattern.startsWith("~/")) return `${home}/${pattern.slice(2)}`;
  if (pattern === "~") return home;
  if (pattern.startsWith("/")) return pattern;
  return `${home}/.ssh/${pattern}`;
}

export interface SshSyncPlan {
  /** Linhas `Include …` do modelo que faltam no arquivo local (texto original do modelo). */
  includesToAdd: string[];
  /** Blocos do modelo cujos aliases não existem no arquivo local. */
  hostsToAdd: SshBlock[];
  /** Aliases do modelo que já existiam (mantidos como estão). */
  kept: string[];
  /** Aliases só do arquivo local, sem curinga, que o modelo não conhece. */
  onlyLocal: string[];
}

const plainAliases = (blocks: SshBlock[]): string[] => blocks.flatMap((b) => b.aliases).filter((a) => !WILDCARD.test(a));

export function planSshSync(templateText: string, currentText: string, home: string): SshSyncPlan {
  const tpl = parseSshConfig(templateText);
  const cur = parseSshConfig(currentText);
  const curIncludes = new Set(cur.includes.map((p) => normalizeInclude(p, home)));
  const includesToAdd = tpl.includes.filter((p) => !curIncludes.has(normalizeInclude(p, home)));
  const curAliases = new Set(plainAliases(cur.blocks));
  const hostsToAdd: SshBlock[] = [];
  const kept: string[] = [];
  for (const b of tpl.blocks) {
    const plain = b.aliases.filter((a) => !WILDCARD.test(a));
    if (plain.length === 0) continue;
    if (plain.some((a) => curAliases.has(a))) kept.push(...plain.filter((a) => curAliases.has(a)));
    else hostsToAdd.push(b);
  }
  const tplAliases = new Set(plainAliases(tpl.blocks));
  const onlyLocal = [...curAliases].filter((a) => !tplAliases.has(a));
  return { includesToAdd, hostsToAdd, kept, onlyLocal };
}

/** Texto a acrescentar no fim do ~/.ssh/config (vazio se não há nada a fazer). */
export function renderSshAppend(plan: SshSyncPlan, stamp: string): string {
  if (plan.includesToAdd.length === 0 && plan.hostsToAdd.length === 0) return "";
  const parts: string[] = [`# meu-bot: máquinas sincronizadas em ${stamp}`];
  for (const inc of plan.includesToAdd) parts.push(`Include ${inc}`);
  for (const b of plan.hostsToAdd) parts.push("", b.text);
  return `\n${parts.join("\n")}\n`;
}

/** Valores de IdentityFile do modelo, com `~` expandido, para avisar se a chave não está no Mac. */
export function identityFiles(templateText: string, home: string): string[] {
  const out = new Set<string>();
  for (const raw of templateText.split(/\r?\n/)) {
    const m = /^\s*IdentityFile\s*(?:=|\s)\s*(\S+)/i.exec(raw);
    if (m === null) continue;
    const p = m[1]!;
    out.add(p.startsWith("~/") ? `${home}/${p.slice(2)}` : p);
  }
  return [...out];
}
