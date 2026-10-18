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
import type { AdminAction, AdminHealth, BotChat, BotMessage, LicensePatch, LicenseView, SupportPerson, SupportProgress, SupportShare } from "../../shared/ipc";
import { applyLicensePatch, buildLicenseView } from "../licenca";
import { APP_CONVERSAS_DIR, APP_CONV_ID_RE, PROJECT_DIR_RE, SESSION_ID_RE, isBotChatId, parseAppTranscript, parseBotChatList, parseClaudeTranscript } from "../bot-chats";
import { SHARE_FILE, SUPPORT_BLOCK_FILE, adminSshBlock, authorizedKeysScript, decodeSupportCode, knownHostsLine, legacyMachineId, machineId, parseSupportProgress, parseSupportShare, removeDeliverySh, supportAlias, supportLogSh, type SupportCode } from "../support-code";
import { runSsh, whatsappChats, whatsappClearSessions, whatsappStatus } from "../whatsapp";
import { installAudio, probeHost } from "../hostProbe";
import { xaiAuthInfo } from "../xaiLogin";
import { getBackendPort, isValidHost } from "../settings";
import { log } from "../backend";

interface AdminConfig { admin: string; inbox: { alias: string } }
interface Stored { code: SupportCode; seenAt: string; source: "caixa" | "colado"; archived: boolean; /** Apelido que o admin deu (vence o nome do código; vazio = nenhum). */ nickname: string; /** Último plano visto da conta (cache para o selo do seletor, sem SSH); ausente = desconhecido. */ plan?: "free" | "pro" }

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
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Record<string, { code?: unknown; seenAt?: unknown; source?: unknown; archived?: unknown; nickname?: unknown; plan?: unknown }>;
    const m = new Map<string, Stored>();
    for (const [id, v] of Object.entries(raw)) {
      const d = typeof v.code === "string" ? decodeSupportCode(v.code) : null;
      if (d?.ok !== true || !/^[0-9a-f]{12}$/.test(id)) continue;
      // Entradas gravadas com o id antigo (só a chave) passam para o id novo (chave + usuário + porta).
      const key = machineId(d.code);
      const prev = m.get(key);
      if (prev !== undefined && prev.seenAt >= (typeof v.seenAt === "string" ? v.seenAt : "")) continue;
      m.set(key, { code: d.code, seenAt: typeof v.seenAt === "string" ? v.seenAt : "", source: v.source === "colado" ? "colado" : "caixa", archived: v.archived === true, nickname: typeof v.nickname === "string" ? v.nickname.slice(0, 40) : "", ...(v.plan === "pro" || v.plan === "free" ? { plan: v.plan } : {}) });
    }
    return m;
  } catch {
    return new Map();
  }
}
function save(m: Map<string, Stored>): void {
  const out: Record<string, { code: string; seenAt: string; source: string; archived: boolean; nickname: string; plan?: "free" | "pro" }> = {};
  for (const [id, s] of m) out[id] = { code: encode(s.code), seenAt: s.seenAt, source: s.source, archived: s.archived, nickname: s.nickname, ...(s.plan === undefined ? {} : { plan: s.plan }) };
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
  // Sem ninguém conhecido e sem caixa de entrada configurada (um admin ainda não preparado, ou um dev de teste com
  // userData novo), não há o que escrever: apagar o conf de um admin de verdade neste mesmo Mac derrubaria as pessoas dele.
  if (m.size === 0 && adminConfig().inbox.alias === "") return;
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
    // O id do arquivo tem de bater com o código: o novo (chave + usuário + porta) ou o antigo (só a chave, de meu-bots
    // que ainda não regravaram); guarda sempre sob o novo.
    if (!d.ok || (machineId(d.code) !== id && legacyMachineId(d.code.hostKey) !== id)) continue;
    const key = machineId(d.code);
    const seenAt = new Date(Number(mtime) * 1000).toISOString();
    const prev = m.get(key);
    if (prev === undefined || seenAt >= prev.seenAt) m.set(key, { code: d.code, seenAt, source: "caixa", archived: prev?.archived === true, nickname: prev?.nickname ?? "" });
  }
  return null;
}

const isLocalAddr = (h: string): boolean => /^(localhost|127\.|::1$)/.test(h);
const toPerson = (s: Stored): SupportPerson => ({ alias: supportAlias(s.code), name: s.nickname !== "" ? s.nickname : s.code.name, machine: s.code.machine ?? null, hostname: s.code.hostname, port: s.code.port, local: isLocalAddr(s.code.hostname), on: s.code.state === "on", seenAt: s.seenAt, source: s.source, archived: s.archived, plan: s.plan ?? null });

/** Guarda o último plano visto da pessoa (pelo alias) para o selo do seletor; só grava se mudou. */
function rememberPlan(alias: string, plan: "free" | "pro"): void {
  const m = load();
  let changed = false;
  for (const s of m.values()) if (supportAlias(s.code) === alias && s.plan !== plan) { s.plan = plan; changed = true; }
  if (changed) save(m);
}

/** Pessoas do suporte (atualiza pela caixa de entrada); `warning` explica se a caixa não respondeu. */
export async function supportPeople(): Promise<{ people: SupportPerson[]; warning: string | null }> {
  const m = load();
  const warning = await pullInbox(m).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  // Atualiza o plano em cache de cada pessoa ligada (melhor esforço, para o selo "PRO" do seletor refletir a conta).
  await Promise.all([...m.values()].filter((s) => s.code.state === "on").map(async (s) => {
    const plan = await readPlan(supportAlias(s.code));
    if (plan !== null && s.plan !== plan) s.plan = plan;
  }));
  save(m);
  writeSshFiles(m);
  return { people: [...m.values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name)), warning };
}

/** Lê só o plano da licença da máquina (SSH curto, melhor esforço); null = fora do ar, ausente ou inválido. */
async function readPlan(host: string): Promise<"free" | "pro" | null> {
  const r = await runSsh(host, `cat "${LICENSE_PATH}" 2>/dev/null; echo\n`, 10_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  try { const v = JSON.parse(r.stdout.trim() || "null"); return v && (v.plan === "pro" || v.plan === "free") ? v.plan : null; } catch { return null; }
}

/** Pessoas já conhecidas (sem ler a caixa): a lista do seletor abre na hora. */
export const knownPeople = (): SupportPerson[] => [...load().values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name));

/** "Adicionar pessoa" colando o código (plano B da entrega automática). */
export function addSupportCode(text: string): SupportPerson {
  const d = decodeSupportCode(text);
  if (!d.ok) throw new Error(d.reason);
  const m = load();
  const s: Stored = { code: d.code, seenAt: new Date().toISOString(), source: "colado", archived: false, nickname: "" };
  m.set(machineId(d.code), s);
  save(m);
  writeSshFiles(m);
  return toPerson(s);
}

/** Apelido do admin para a pessoa (vence o nome que veio no código; vazio tira). O alias não muda. */
export function renamePerson(alias: string, nickname: string): SupportPerson[] {
  const m = load();
  const nick = nickname.replace(/\s+/g, " ").trim().slice(0, 40);
  for (const s of m.values()) if (supportAlias(s.code) === alias) s.nickname = nick;
  save(m);
  return knownPeople();
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
  for (const s of load().values()) if (supportAlias(s.code) === alias) return { name: s.nickname !== "" ? s.nickname : s.code.name, machine: s.code.machine ?? null };
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
  const [probe, wa, progress, xai, license] = await Promise.all([
    probeHost(host, getBackendPort()),
    share.whatsapp ? whatsappStatus(host).catch(() => null) : Promise.resolve(null),
    share.progress ? readProgress(host) : Promise.resolve(null),
    xaiAuthInfo(host).catch(() => null),
    readLicenseView(host).catch(() => null),
  ]);
  if (license !== null) rememberPlan(host, license.license.plan);
  return { probe, whatsapp: wa, progress, share, xai, license };
}

/** Licença (billing/plano) não é conteúdo pessoal: é a administração da conta, então não passa pelo compartilha.json. */
const LICENSE_PATH = "$HOME/.local/share/meu-bot/licenca.json";
const MACHINES_PATH = "$HOME/.local/share/meu-bot/maquinas.json";

/** Licença + devices da conta, como o admin vê. null = máquina fora do ar; arquivos ausentes viram defaults. */
async function readLicenseView(host: string): Promise<LicenseView | null> {
  const r = await runSsh(host, `cat "${LICENSE_PATH}" 2>/dev/null; echo "<<<REA-SEP>>>"; cat "${MACHINES_PATH}" 2>/dev/null; echo\n`, 20_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  const [licPart = "", maqPart = ""] = r.stdout.split("<<<REA-SEP>>>");
  let licRaw: unknown = null; let maqRaw: unknown = null;
  try { licRaw = JSON.parse(licPart.trim() || "null"); } catch { licRaw = null; }
  try { maqRaw = JSON.parse(maqPart.trim() || "null"); } catch { maqRaw = null; }
  return buildLicenseView(licRaw, maqRaw);
}

/** Lê um JSON cru (preservando todos os campos, ex.: ips) para alterar e regravar; lança se a máquina não responde. */
async function fetchJson(host: string, remotePath: string): Promise<Record<string, unknown>> {
  const r = await runSsh(host, `cat "${remotePath}" 2>/dev/null; echo\n`, 15_000);
  if (r.code !== 0) throw new Error(`máquina fora do ar: ${lastLine(r)}`);
  try { const v = JSON.parse(r.stdout.trim() || "null"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
}

/** Grava um JSON na máquina da pessoa de forma atômica (base64 pela stdin do bash, 700/600 como o backend). */
async function writeJson(host: string, remotePath: string, value: unknown): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(value, null, 1), "utf8").toString("base64");
  const script = `set -e\numask 077\nmkdir -p "$HOME/.local/share/meu-bot"\nprintf '%s' '${b64}' | base64 -d > "${remotePath}.tmp"\nchmod 600 "${remotePath}.tmp"\nmv "${remotePath}.tmp" "${remotePath}"\n`;
  const r = await runSsh(host, script, 20_000);
  if (r.code !== 0) throw new Error(`não consegui gravar na máquina: ${lastLine(r)}`);
}

/** meu-bot-admin: muda a licença da pessoa (plano, status, validade, limite). Grava licenca.json por SSH. */
export async function setLicense(host: string, patch: LicensePatch): Promise<LicenseView> {
  const current = await fetchJson(host, LICENSE_PATH);
  const next = applyLicensePatch(Object.keys(current).length ? current : null, patch);
  await writeJson(host, LICENSE_PATH, next);
  await runSsh(host, `${supportLogSh(adminName(), "licença atualizada pelo admin")}\n`, 15_000).catch(() => null);
  const view = await readLicenseView(host);
  if (view === null) throw new Error("gravei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
}

/** meu-bot-admin: libera um device pendente (marca ativo no maquinas.json e sobe o limite se preciso). */
export async function approveDevice(host: string, deviceId: string): Promise<LicenseView> {
  if (!/^[a-f0-9]{12}$/.test(deviceId)) throw new Error("device inválido");
  const machines = await fetchJson(host, MACHINES_PATH);
  const entry = machines[deviceId] as Record<string, unknown> | undefined;
  if (entry === undefined) throw new Error("device não encontrado na máquina");
  entry.status = "active";
  delete entry.requestedAt;
  await writeJson(host, MACHINES_PATH, machines);
  const activeNow = Object.values(machines).filter((e) => e !== null && typeof e === "object" && (e as { status?: unknown }).status !== "pending").length;
  const curLic = await fetchJson(host, LICENSE_PATH);
  const curLimit = Number.isInteger((curLic as { deviceLimit?: unknown }).deviceLimit) ? (curLic.deviceLimit as number) : 1;
  const nextLic = applyLicensePatch(Object.keys(curLic).length ? curLic : null, { deviceLimit: Math.max(activeNow, curLimit) });
  await writeJson(host, LICENSE_PATH, nextLic);
  await runSsh(host, `${supportLogSh(adminName(), "device liberado pelo admin")}\n`, 15_000).catch(() => null);
  const view = await readLicenseView(host);
  if (view === null) throw new Error("liberei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
}

/** meu-bot-admin: revoga um device (tira do maquinas.json). Revogar ≠ banir: ele volta no próximo hello se couber. */
export async function removeDevice(host: string, deviceId: string): Promise<LicenseView> {
  if (!/^[a-f0-9]{12}$/.test(deviceId)) throw new Error("device inválido");
  const machines = await fetchJson(host, MACHINES_PATH);
  if (machines[deviceId] === undefined) throw new Error("device não encontrado na máquina");
  delete machines[deviceId];
  await writeJson(host, MACHINES_PATH, machines);
  await runSsh(host, `${supportLogSh(adminName(), "device revogado pelo admin")}\n`, 15_000).catch(() => null);
  const view = await readLicenseView(host);
  if (view === null) throw new Error("revoguei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
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

/**
 * Conversas dela com o meu-bot: as sessões do Claude Code que o backend abre (pastas *chat-workspace e
 * *agent-workspace em ~/.claude/projects). Só se ela compartilha. Uma linha por sessão; o parse é puro.
 */
export async function adminBotChats(host: string): Promise<BotChat[]> {
  if (!(await readShare(host)).chat) throw new Error("a pessoa preferiu não compartilhar as conversas com o meu-bot");
  const r = await runSsh(host, `for d in "$HOME/.claude/projects/"*chat-workspace "$HOME/.claude/projects/"*agent-workspace; do
  [ -d "$d" ] || continue
  for f in "$d"/*.jsonl; do
    [ -f "$f" ] || continue
    printf 'F\t%s\t%s\t%s\t%s\t' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")" "$(basename "$d")" "$(grep -c '"type":"assistant"' "$f")"
    grep -m1 '"type":"user"' "$f" | head -c 2000 | tr -d '\n\t'
    echo
  done
done
# Diário do backend para provedores fora do Claude Code (Grok, Hermes): uma conversa por arquivo.
for f in "${APP_CONVERSAS_DIR}"/*.jsonl; do
  [ -f "$f" ] || continue
  printf 'A\t%s\t%s\t%s\t%s\t' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")" "$(grep -o '"provider":"[^"]*"' "$f" | tail -n1 | cut -d'"' -f4)" "$(grep -c '"role":"assistant"' "$f")"
  grep -m1 '"role":"user"' "$f" | head -c 2000 | tr -d '\n\t'
  echo
done
`, 30_000);
  if (r.code !== 0 && r.stdout.trim() === "") throw new Error(r.stderr.trim() || "não consegui ler as conversas na máquina");
  return parseBotChatList(r.stdout);
}

/** Uma conversa: só as linhas user/assistant do jsonl (o resto é ruído), cada uma cortada em 30 KB. */
export async function adminBotThread(host: string, sessionId: string): Promise<BotMessage[]> {
  if (!isBotChatId(sessionId)) throw new Error("conversa inválida");
  if (!(await readShare(host)).chat) throw new Error("a pessoa preferiu não compartilhar as conversas com o meu-bot");
  const chat = (await adminBotChats(host)).find((c) => c.sessionId === sessionId);
  if (chat === undefined) return [];
  if (chat.source === "app") {
    if (!APP_CONV_ID_RE.test(sessionId)) return [];
    const r = await runSsh(host, `cut -c1-30000 "${APP_CONVERSAS_DIR}/${sessionId}.jsonl"\n`, 30_000);
    return parseAppTranscript(r.stdout);
  }
  if (!PROJECT_DIR_RE.test(chat.project) || !SESSION_ID_RE.test(sessionId)) return [];
  const r = await runSsh(host, `grep -E '"type":"(user|assistant)"' "$HOME/.claude/projects/${chat.project}/${sessionId}.jsonl" | cut -c1-30000\n`, 30_000);
  return parseClaudeTranscript(r.stdout);
}

/** Apaga a transcrição de uma conversa na máquina dela (o backend abre outra sessão no próximo turno). Registrado. */
export async function adminBotDelete(host: string, sessionId: string): Promise<void> {
  if (!isBotChatId(sessionId)) throw new Error("conversa inválida");
  const chat = (await adminBotChats(host)).find((c) => c.sessionId === sessionId);
  if (chat === undefined || (chat.source === "claude" && (!PROJECT_DIR_RE.test(chat.project) || !SESSION_ID_RE.test(sessionId))) || (chat.source === "app" && !APP_CONV_ID_RE.test(sessionId))) throw new Error("conversa não encontrada");
  const file = chat.source === "app" ? `${APP_CONVERSAS_DIR}/${sessionId}.jsonl` : `$HOME/.claude/projects/${chat.project}/${sessionId}.jsonl`;
  const r = await runSsh(host, `rm -f "${file}"\n${supportLogSh("admin", "apagou uma conversa dela com o meu-bot")}\n`, 20_000);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "não consegui apagar na máquina");
  log(`[suporte] ${host}: conversa ${sessionId} apagada pelo admin`);
}

const ACTIONS: Record<AdminAction, { what: string; sh: string }> = {
  "restart-gateway": { what: "reiniciou o gateway do OpenClaw", sh: "systemctl --user restart openclaw-gateway 2>&1 || openclaw gateway restart 2>&1" },
  "restart-backend": { what: "reiniciou o backend do meu-bot", sh: "systemctl --user restart meu-bot-backend 2>&1" },
  transcription: { what: "ativou a transcrição de áudio", sh: "" },
  "transcription-off": { what: "desativou a transcrição de áudio", sh: "" },
  "support-off": { what: "desligou o suporte", sh: "" },
};

/**
 * Só o admin desliga o suporte (a pessoa não tem interruptor): na máquina dela, o mesmo script do antigo
 * "desligar" (tira a chave do admin do authorized_keys, entrega "off" na caixa, apaga timer e pasta) e, aqui,
 * a pessoa fica "off" (sai do ~/.ssh/meu-bot-suporte.conf). Ela volta se salvar o nome de novo no tutorial.
 */
/** Script que desliga o suporte na máquina dela: tira a chave do admin, entrega "off" na caixa, apaga timer/pasta e marca o bloqueio. */
function supportOffSh(off: SupportCode, what: string): string {
  return `${authorizedKeysScript(null)}\n${supportLogSh("admin", what)}\n${removeDeliverySh(machineId(off), encode(off))}\nrm -f "$HOME/.local/share/meu-bot/progresso.json"\nmkdir -p "$HOME/.local/share/meu-bot" && touch "${SUPPORT_BLOCK_FILE}"\n`;
}
const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou";

async function turnSupportOff(host: string): Promise<{ ok: boolean; detail: string }> {
  const m = load();
  const entry = [...m.values()].find((s) => supportAlias(s.code) === host);
  if (entry === undefined) return { ok: false, detail: "pessoa desconhecida" };
  const off: SupportCode = { ...entry.code, state: "off", at: new Date().toISOString() };
  const r = await runSsh(host, supportOffSh(off, "desligou o suporte"), 60_000);
  if (r.code !== 0) return { ok: false, detail: lastLine(r) };
  entry.code = off; save(m); writeSshFiles(m);
  log(`[suporte] ${host}: suporte desligado pelo admin`);
  return { ok: true, detail: "o acesso a esta máquina acabou; a janela pode ser fechada" };
}

/**
 * "Excluir máquina" no seletor do admin: na máquina dela, limpa todo o histórico do WhatsApp (todas as sessões do
 * OpenClaw, o mesmo "Limpar histórico" de cada conversa, de uma vez) e desliga o suporte (o mesmo do `support-off`);
 * aqui ela sai de pessoas.json, do ~/.ssh/meu-bot-suporte.conf e do arquivo dela na caixa de entrada. Com a máquina
 * fora do ar nada é limpo e ela fica na lista; `force` é o "excluir mesmo assim", que só tira da lista.
 */
export async function removePerson(alias: string, force: boolean): Promise<{ people: SupportPerson[]; cleared: number; detail: string }> {
  const m = load();
  const found = [...m.entries()].find(([, s]) => supportAlias(s.code) === alias);
  if (found === undefined) throw new Error("pessoa desconhecida");
  const [id, entry] = found;
  let cleared = 0;
  let detail = "";
  if (entry.code.state === "on") {
    try {
      const keys = [...new Set((await whatsappChats(alias)).flatMap((c) => c.sessionKeys))];
      if (keys.length > 0) { await whatsappClearSessions(alias, keys); cleared = keys.length; }
      const off: SupportCode = { ...entry.code, state: "off", at: new Date().toISOString() };
      const r = await runSsh(alias, supportOffSh(off, `excluiu esta máquina do suporte: limpou todo o histórico do WhatsApp (${cleared} ${cleared === 1 ? "conversa" : "conversas"}) e desligou o suporte`), 60_000);
      if (r.code !== 0) throw new Error(lastLine(r));
      detail = cleared === 0 ? "não havia histórico do WhatsApp para limpar; o suporte foi desligado" : `histórico do WhatsApp limpo (${cleared} ${cleared === 1 ? "conversa" : "conversas"}) e suporte desligado`;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (!force) throw new Error(`a máquina não respondeu (${why}); nada foi limpo e ela continua na lista`);
      detail = `a máquina não respondeu (${why}); só saiu da lista`;
    }
  } else {
    detail = "o suporte já estava desligado; a máquina só saiu da lista";
  }
  // O arquivo dela na caixa de entrada sai também (o "off" recém-entregue inclusive), senão a próxima leitura a traz de volta.
  const inbox = adminConfig().inbox.alias;
  if (inbox !== "") await runSsh(inbox, `rm -f "$HOME/suporte-inbox/${id}.code" "$HOME/suporte-inbox/${legacyMachineId(entry.code.hostKey)}.code"\n`, 20_000).catch(() => null);
  m.delete(id); save(m); writeSshFiles(m);
  log(`[suporte] ${alias}: excluída pelo admin (${detail})`);
  return { people: knownPeople(), cleared, detail };
}

/** Ação de suporte: roda na máquina da pessoa e fica no registro que ela vê. */
export async function adminAction(host: string, action: AdminAction): Promise<{ ok: boolean; detail: string }> {
  const a = ACTIONS[action];
  if (action === "support-off") return turnSupportOff(host);
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
