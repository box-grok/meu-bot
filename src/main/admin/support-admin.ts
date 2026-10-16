/**
 * Variante: admin. Suporte, lado do admin (meu-bot-admin). Sem servidor: as pessoas aparecem pela caixa de entrada na máquina
 * do admin (entregue máquina com máquina) ou colando o código. Cada pessoa vira um `Host suporte-…` num
 * arquivo só do suporte (~/.ssh/meu-bot-suporte.conf, incluído no topo do ~/.ssh/config) com known_hosts
 * próprio: o admin entra pela chave ~/.ssh/meu-bot-admin, que só funciona enquanto a pessoa deixar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AdminAction, AdminHealth, SupportPerson, SupportProgress, SupportShare } from "../../shared/ipc";
import { SHARE_FILE, adminSshBlock, decodeSupportCode, knownHostsLine, machineId, parseSupportProgress, parseSupportShare, supportAlias, supportLogSh, type SupportCode } from "../support-code";
import { runSsh, whatsappStatus } from "../whatsapp";
import { installAudio, probeHost } from "../hostProbe";
import { getBackendPort, isValidHost } from "../settings";
import { log } from "../backend";

interface AdminConfig { admin: string; inbox: { alias: string } }
interface Stored { code: SupportCode; seenAt: string; source: "caixa" | "colado"; archived: boolean }

const configPath = (): string => (app.isPackaged ? path.join(process.resourcesPath, "config", "suporte.json") : path.join(app.getAppPath(), "build", "suporte", "suporte.json"));
function adminConfig(): AdminConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as { admin?: unknown; inbox?: { alias?: unknown } };
    const alias = raw.inbox?.alias;
    return { admin: typeof raw.admin === "string" ? raw.admin : "suporte", inbox: { alias: typeof alias === "string" && isValidHost(alias) ? alias : "" } };
  } catch {
    return { admin: "suporte", inbox: { alias: "" } };
  }
}
export const adminName = (): string => adminConfig().admin;

const storePath = (): string => path.join(app.getPath("userData"), "pessoas.json");
function load(): Map<string, Stored> {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Record<string, { code?: unknown; seenAt?: unknown; source?: unknown; archived?: unknown }>;
    const m = new Map<string, Stored>();
    for (const [id, v] of Object.entries(raw)) {
      const d = typeof v.code === "string" ? decodeSupportCode(v.code) : null;
      if (d?.ok === true && /^[0-9a-f]{12}$/.test(id)) m.set(id, { code: d.code, seenAt: typeof v.seenAt === "string" ? v.seenAt : "", source: v.source === "colado" ? "colado" : "caixa", archived: v.archived === true });
    }
    return m;
  } catch {
    return new Map();
  }
}
function save(m: Map<string, Stored>): void {
  const out: Record<string, { code: string; seenAt: string; source: string; archived: boolean }> = {};
  for (const [id, s] of m) out[id] = { code: encode(s.code), seenAt: s.seenAt, source: s.source, archived: s.archived };
  fs.writeFileSync(storePath(), JSON.stringify(out, null, 2), { mode: 0o600 });
}
const encode = (c: SupportCode): string => `MBS1.${Buffer.from(JSON.stringify(c), "utf8").toString("base64url")}`;

const SSH_DIR = path.join(os.homedir(), ".ssh");
const SUPPORT_CONF = path.join(SSH_DIR, "meu-bot-suporte.conf");
const SUPPORT_KNOWN = path.join(SSH_DIR, "meu-bot-suporte_known_hosts");
const ADMIN_KEY = path.join(SSH_DIR, "meu-bot-admin");
const INCLUDE = "Include ~/.ssh/meu-bot-suporte.conf";

/**
 * Regrava o arquivo do suporte e o known_hosts dele a partir das pessoas com suporte ligado, e garante o
 * Include no topo do ~/.ssh/config (antes de qualquer Host, senão vale só dentro do bloco anterior).
 */
function writeSshFiles(m: Map<string, Stored>): void {
  fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  const on = [...m.values()].filter((s) => s.code.state === "on");
  const blocks = on.map((s) => adminSshBlock(s.code, "~/.ssh/meu-bot-admin").replace(/\n$/, `\n    UserKnownHostsFile ~/.ssh/meu-bot-suporte_known_hosts\n    StrictHostKeyChecking yes\n`));
  fs.writeFileSync(SUPPORT_CONF, `# Gerado pelo meu-bot-admin: pessoas com suporte ligado. Não edite à mão.\n\n${blocks.join("\n")}`, { mode: 0o600 });
  fs.writeFileSync(SUPPORT_KNOWN, on.map((s) => knownHostsLine(s.code)).join("\n") + (on.length > 0 ? "\n" : ""), { mode: 0o600 });
  const cfg = path.join(SSH_DIR, "config");
  let cur = "";
  try { cur = fs.readFileSync(cfg, "utf8"); } catch { /* sem config ainda */ }
  if (!cur.split("\n").some((l) => l.trim() === INCLUDE)) {
    if (cur !== "") fs.copyFileSync(cfg, `${cfg}.antes-do-meu-bot-admin`);
    fs.writeFileSync(cfg, `${INCLUDE}\n\n${cur}`, { mode: 0o600 });
  }
}

/** Lê a caixa de entrada (na máquina do admin) e junta ao que já se conhecia. Caixa fora do ar: segue o salvo. */
async function pullInbox(m: Map<string, Stored>): Promise<string | null> {
  const alias = adminConfig().inbox.alias;
  if (alias === "") return "sem caixa de entrada configurada (rode scripts/suporte-setup.mjs e reempacote o admin)";
  const r = await runSsh(alias, `for f in "$HOME"/suporte-inbox/*.code; do [ -f "$f" ] || continue; printf 'F\\t%s\\t%s\\t' "$(basename "$f" .code)" "$(stat -c %Y "$f")"; head -c 4096 "$f" | tr -d '\\n'; echo; done\n`, 20_000);
  if (r.code !== 0) return `não consegui ler a caixa de entrada em ${alias}`;
  for (const line of r.stdout.split("\n")) {
    const [tag, id, mtime, text] = line.split("\t");
    if (tag !== "F" || id === undefined || text === undefined || !/^[0-9a-f]{12}$/.test(id)) continue;
    const d = decodeSupportCode(text);
    if (!d.ok || machineId(d.code.hostKey) !== id) continue; // o id tem de bater com a chave do servidor do código
    const seenAt = new Date(Number(mtime) * 1000).toISOString();
    const prev = m.get(id);
    if (prev === undefined || seenAt >= prev.seenAt) m.set(id, { code: d.code, seenAt, source: "caixa", archived: prev?.archived === true });
  }
  return null;
}

const isLocalAddr = (h: string): boolean => /^(localhost|127\.|::1$)/.test(h);
const toPerson = (s: Stored): SupportPerson => ({ alias: supportAlias(s.code), name: s.code.name, machine: s.code.machine ?? null, hostname: s.code.hostname, port: s.code.port, local: isLocalAddr(s.code.hostname), on: s.code.state === "on", seenAt: s.seenAt, source: s.source, archived: s.archived });

/** Pessoas do suporte (atualiza pela caixa de entrada); `warning` explica se a caixa não respondeu. */
export async function supportPeople(): Promise<{ people: SupportPerson[]; warning: string | null }> {
  const m = load();
  const warning = await pullInbox(m).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  save(m);
  writeSshFiles(m);
  return { people: [...m.values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name)), warning };
}

/** Pessoas já conhecidas (sem ler a caixa): a lista do seletor abre na hora. */
export const knownPeople = (): SupportPerson[] => [...load().values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name));

/** "Adicionar pessoa" colando o código (plano B da entrega automática). */
export function addSupportCode(text: string): SupportPerson {
  const d = decodeSupportCode(text);
  if (!d.ok) throw new Error(d.reason);
  const m = load();
  const s: Stored = { code: d.code, seenAt: new Date().toISOString(), source: "colado", archived: false };
  m.set(machineId(d.code.hostKey), s);
  save(m);
  writeSshFiles(m);
  return toPerson(s);
}

/** Arquiva/desarquiva uma pessoa na lista do seletor (o acesso dela não muda). Devolve as pessoas. */
export function archivePerson(alias: string, archived: boolean): SupportPerson[] {
  const m = load();
  for (const s of m.values()) if (supportAlias(s.code) === alias) s.archived = archived;
  save(m);
  return knownPeople();
}

/** Nome da pessoa e o apelido dela para a máquina, pelo alias (títulos e a página Suporte). */
export function personInfo(alias: string): { name: string; machine: string | null } | null {
  for (const s of load().values()) if (supportAlias(s.code) === alias) return { name: s.code.name, machine: s.code.machine ?? null };
  return null;
}
export const adminKeyExists = (): boolean => fs.existsSync(ADMIN_KEY);

/** O que ela deixa este app ver (compartilha.json na máquina dela); sem arquivo, tudo. */
async function readShare(host: string): Promise<SupportShare> {
  const r = await runSsh(host, `cat "${SHARE_FILE}" 2>/dev/null\n`, 15_000).catch(() => null);
  try { return parseSupportShare(JSON.parse(r?.stdout ?? "")); } catch { return parseSupportShare({}); }
}

/** Saúde da máquina da pessoa: a sondagem do seletor + (se ela deixa) o WhatsApp e o progresso nos tutoriais. */
export async function adminHealth(host: string): Promise<AdminHealth> {
  const share = await readShare(host);
  const [probe, wa, progress] = await Promise.all([
    probeHost(host, getBackendPort()),
    share.whatsapp ? whatsappStatus(host).catch(() => null) : Promise.resolve(null),
    share.progress ? readProgress(host) : Promise.resolve(null),
  ]);
  return { probe, whatsapp: wa, progress, share };
}

/** O que o meu-bot dela gravou (~/.local/share/meu-bot/progresso.json); dado de fora, validado. */
async function readProgress(host: string): Promise<SupportProgress | null> {
  const r = await runSsh(host, `head -c 16384 "$HOME/.local/share/meu-bot/progresso.json" 2>/dev/null\n`, 20_000).catch(() => null);
  if (r === null || r.stdout.trim() === "") return null;
  try { return parseSupportProgress(JSON.parse(r.stdout)); } catch { return null; }
}

/** Últimos registros do gateway e do backend (só leitura). */
export async function adminLogs(host: string): Promise<string> {
  if (!(await readShare(host)).logs) throw new Error("a pessoa preferiu não compartilhar os registros");
  const r = await runSsh(host, "journalctl --user -u openclaw-gateway -u meu-bot-backend -n 200 --no-pager -o short-iso 2>&1 | tail -n 200\n", 30_000);
  return r.stdout.trim() || r.stderr.trim() || "sem registros";
}

const ACTIONS: Record<AdminAction, { what: string; sh: string }> = {
  "restart-gateway": { what: "reiniciou o gateway do OpenClaw", sh: "systemctl --user restart openclaw-gateway 2>&1 || openclaw gateway restart 2>&1" },
  "restart-backend": { what: "reiniciou o backend do meu-bot", sh: "systemctl --user restart meu-bot-backend 2>&1" },
  transcription: { what: "ativou a transcrição de áudio", sh: "" },
  "transcription-off": { what: "desativou a transcrição de áudio", sh: "" },
};

/** Ação de suporte: roda na máquina da pessoa e fica no registro que ela vê. */
export async function adminAction(host: string, action: AdminAction): Promise<{ ok: boolean; detail: string }> {
  const a = ACTIONS[action];
  // No registro que a pessoa vê, quem fez é "admin" (sem o nome de quem dá o suporte).
  const who = "admin";
  if (action === "transcription" || action === "transcription-off") {
    const r = await installAudio(host, { kind: "in", ...(action === "transcription-off" ? { off: true } : {}) });
    await runSsh(host, `${supportLogSh(who, a.what)}\n`, 15_000);
    return { ok: r.ok, detail: r.log.at(-1) ?? "" };
  }
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${supportLogSh(who, a.what)}\n${a.sh}\n`, 60_000);
  log(`[suporte] ${host}: ${a.what} (código ${r.code})`);
  return { ok: r.code === 0, detail: (r.stdout.trim() || r.stderr.trim()).split("\n").pop() ?? "" };
}
