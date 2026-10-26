/**
 * Edição textual da política do tailnet (HuJSON: JSON com comentários e vírgulas finais) para
 * trocar a ação das regras de SSH do Tailscale ("check" ↔ "accept"), preservando comentários,
 * espaços e tudo o mais byte a byte. Puro: sem fs, sem Electron; testável com node --test.
 *
 * Por que texto e não JSON.parse/stringify: a política tem comentários e formatação da pessoa;
 * reserializar apagaria tudo isso. Um scanner acha os tokens (strings, pontuação, palavras),
 * um parser mínimo monta a árvore com os spans, e as edições são aplicadas por índice, de trás
 * para a frente. Só o bloco `"ssh"` de nível raiz é tocado; qualquer `"action"` em outro lugar
 * (acls, grants com app/capabilities, comentários, strings) fica como está, por construção.
 */

export type SshAction = "accept" | "check";

export interface PolicyEditStats { rules: number; changed: number; alreadyTarget: number; other: number; inserted: boolean }
export interface PolicyEdit { changed: boolean; text: string; summary: string; stats: PolicyEditStats }

interface Token { kind: "string" | "punct" | "word"; start: number; end: number; raw: string }

/** Tokens significativos (sem espaços nem comentários), com posição no texto original. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && text[i + 1] === "/") { const j = text.indexOf("\n", i); i = j === -1 ? n : j + 1; continue; }
    if (c === "/" && text[i + 1] === "*") { const j = text.indexOf("*/", i + 2); i = j === -1 ? n : j + 2; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') { if (text[j] === "\\") j++; j++; }
      const end = Math.min(n, j + 1);
      out.push({ kind: "string", start: i, end, raw: text.slice(i + 1, Math.max(i + 1, end - 1)) });
      i = end;
      continue;
    }
    if ("{}[]:,".includes(c)) { out.push({ kind: "punct", start: i, end: i + 1, raw: c }); i++; continue; }
    let j = i;
    while (j < n && !" \t\n\r{}[]:,\"".includes(text[j]!) && !(text[j] === "/" && (text[j + 1] === "/" || text[j + 1] === "*"))) j++;
    if (j === i) j = i + 1;
    out.push({ kind: "word", start: i, end: j, raw: text.slice(i, j) });
    i = j;
  }
  return out;
}

interface Member { key: string; keyTok: Token; value: Node; commaAfter: Token | null }
interface Node { type: "object" | "array" | "string" | "word"; start: number; end: number; tok?: Token; members?: Member[]; items?: Node[]; closeTok?: Token }

/** Parser mínimo: só a estrutura e os spans; valores viram folhas. */
function parse(tokens: Token[]): Node {
  let p = 0;
  const peek = (): Token | undefined => tokens[p];
  const fail = (msg: string): never => { throw new Error(`política inválida: ${msg}`); };
  const value = (): Node => {
    const t = peek();
    if (t === undefined) return fail("fim inesperado");
    if (t.kind === "punct" && t.raw === "{") return object();
    if (t.kind === "punct" && t.raw === "[") return array();
    if (t.kind === "punct") return fail(`'${t.raw}' inesperado na posição ${t.start}`);
    p++;
    return { type: t.kind === "string" ? "string" : "word", start: t.start, end: t.end, tok: t };
  };
  const object = (): Node => {
    const open = tokens[p++]!;
    const members: Member[] = [];
    for (;;) {
      const t = peek();
      if (t === undefined) return fail("objeto sem fechamento");
      if (t.kind === "punct" && t.raw === "}") { p++; return { type: "object", start: open.start, end: t.end, members, closeTok: t }; }
      if (t.kind !== "string") return fail(`chave esperada na posição ${t.start}`);
      p++;
      const colon = peek();
      if (colon === undefined || colon.raw !== ":") return fail(`':' esperado depois de "${t.raw}"`);
      p++;
      const v = value();
      const member: Member = { key: t.raw, keyTok: t, value: v, commaAfter: null };
      const after = peek();
      if (after !== undefined && after.kind === "punct" && after.raw === ",") { member.commaAfter = after; p++; }
      members.push(member);
    }
  };
  const array = (): Node => {
    const open = tokens[p++]!;
    const items: Node[] = [];
    for (;;) {
      const t = peek();
      if (t === undefined) return fail("lista sem fechamento");
      if (t.kind === "punct" && t.raw === "]") { p++; return { type: "array", start: open.start, end: t.end, items, closeTok: t }; }
      items.push(value());
      const after = peek();
      if (after !== undefined && after.kind === "punct" && after.raw === ",") p++;
    }
  };
  const root = value();
  return root;
}

const DEFAULT_INDENT = "    ";

/** Indentação da primeira chave de nível raiz (o que vem entre a última quebra de linha e ela). */
function rootIndent(text: string, root: Node): string {
  const first = root.members?.[0];
  if (first === undefined) return DEFAULT_INDENT;
  const nl = text.lastIndexOf("\n", first.keyTok.start);
  const ws = text.slice(nl + 1, first.keyTok.start);
  return /^[ \t]+$/.test(ws) ? ws : DEFAULT_INDENT;
}

/** Regra de SSH inserida quando a política não tem bloco ssh (equivale à padrão do Tailscale, com accept). */
export function defaultSshRule(action: SshAction, ind: string): string {
  return [
    `${ind}${ind}{`,
    `${ind}${ind}${ind}"action": "${action}",`,
    `${ind}${ind}${ind}"src":    ["autogroup:member"],`,
    `${ind}${ind}${ind}"dst":    ["autogroup:self"],`,
    `${ind}${ind}${ind}"users":  ["autogroup:nonroot", "root"],`,
    `${ind}${ind}},`,
  ].join("\n");
}

interface Edit { start: number; end: number; text: string }

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * Troca a ação das regras ssh de nível raiz para `target`. Só muda regras cuja ação é a oposta
 * ("check" quando o alvo é "accept" e vice-versa); ao ir para accept remove o `checkPeriod` da
 * regra (só faz sentido com check). Sem bloco ssh, insere a regra padrão com `target`.
 */
export function applySshAction(hujson: string, target: SshAction): PolicyEdit {
  const opposite: SshAction = target === "accept" ? "check" : "accept";
  const tokens = tokenize(hujson);
  if (tokens.length === 0) throw new Error("política vazia ou sem objeto raiz");
  const root = parse(tokens);
  if (root.type !== "object" || root.members === undefined || root.closeTok === undefined) throw new Error("política vazia ou sem objeto raiz");
  const stats: PolicyEditStats = { rules: 0, changed: 0, alreadyTarget: 0, other: 0, inserted: false };
  const edits: Edit[] = [];
  const notes: string[] = [];
  const ind = rootIndent(hujson, root);
  const ssh = root.members.find((m) => m.key === "ssh");

  if (ssh === undefined || (ssh.value.type === "array" && (ssh.value.items?.length ?? 0) === 0)) {
    // Sem regra nenhuma: a padrão do Tailscale é check; escrevemos a mesma regra com o alvo.
    const block = `${ind}// meu-bot: Tailscale SSH com "${target}" nos próprios dispositivos.\n${ind}"ssh": [\n${defaultSshRule(target, ind)}\n${ind}],\n`;
    if (ssh === undefined) {
      const close = root.closeTok;
      const idx = tokens.indexOf(close);
      const prev = tokens[idx - 1]!;
      const prefix = prev.kind === "punct" && (prev.raw === "{" || prev.raw === ",") ? "" : ",";
      // Começa numa linha nova depois do último membro; o "}" final volta para a própria linha.
      edits.push({ start: prev.end, end: close.start, text: `${prefix}\n\n${block}` });
    } else {
      edits.push({ start: ssh.value.start, end: ssh.value.end, text: `[\n${defaultSshRule(target, ind)}\n${ind}]` });
    }
    stats.inserted = true;
    stats.rules = 1;
    stats.changed = 1;
    return { changed: true, text: applyEdits(hujson, edits), summary: `bloco ssh criado com ${target}`, stats };
  }
  if (ssh.value.type !== "array" || ssh.value.items === undefined) throw new Error('o campo "ssh" da política não é uma lista; não mexo');

  ssh.value.items.forEach((rule, i) => {
    if (rule.type !== "object" || rule.members === undefined) return;
    stats.rules++;
    const action = rule.members.find((m) => m.key === "action");
    if (action === undefined || action.value.type !== "string" || action.value.tok === undefined) { stats.other++; notes.push(`regra ${i + 1} sem "action" textual, mantida`); return; }
    const cur = action.value.tok.raw;
    if (cur === target) { stats.alreadyTarget++; return; }
    if (cur !== opposite) { stats.other++; notes.push(`regra ${i + 1} com "${cur}", mantida`); return; }
    edits.push({ start: action.value.start, end: action.value.end, text: `"${target}"` });
    stats.changed++;
    notes.push(`regra ${i + 1}: ${cur} → ${target}`);
    if (target === "accept") {
      const period = rule.members.find((m) => m.key === "checkPeriod");
      if (period !== undefined) {
        const idx = rule.members.indexOf(period);
        const next = rule.members[idx + 1];
        const prev = rule.members[idx - 1];
        if (period.commaAfter !== null && next !== undefined) edits.push({ start: period.keyTok.start, end: next.keyTok.start, text: "" });
        else if (prev !== undefined) edits.push({ start: prev.value.end, end: period.commaAfter?.end ?? period.value.end, text: prev.commaAfter !== null && period.commaAfter !== null ? "," : "" });
        else edits.push({ start: period.keyTok.start, end: period.commaAfter?.end ?? period.value.end, text: "" });
        notes.push(`regra ${i + 1}: checkPeriod removido`);
      }
    }
  });

  if (stats.changed === 0) {
    const why = stats.alreadyTarget > 0 ? `já estava com ${target}` : "nenhuma regra ssh para mudar";
    return { changed: false, text: hujson, summary: `${why}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`, stats };
  }
  return { changed: true, text: applyEdits(hujson, edits), summary: notes.join("; "), stats };
}

/** HuJSON → JSON estrito (sem comentários nem vírgulas finais), para validar/inspecionar com JSON.parse. */
export function stripHujson(text: string): string {
  const tokens = tokenize(text);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (t.kind === "punct" && t.raw === "," && next !== undefined && next.kind === "punct" && (next.raw === "}" || next.raw === "]")) continue;
    parts.push(t.kind === "string" ? `"${t.raw}"` : t.raw);
  }
  return parts.join("");
}
