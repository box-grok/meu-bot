/**
 * Suporte (meu-bot-admin): o "código de suporte" que a máquina de uma pessoa entrega ao admin, e os scripts
 * que mexem no authorized_keys dela. Puro (sem IO): a fronteira dona desse formato. O código não tem segredo:
 * nome, endereço, usuário, porta e a chave pública do servidor (para o admin não confiar às cegas na 1ª vez).
 *
 * Formato: `MBS1.<base64url(JSON)>`. `state: "off"` = a pessoa desligou o suporte.
 */
import { createHash } from "node:crypto";
import type { SupportProgress, SupportShare } from "../shared/ipc";

export type { SupportProgress, SupportShare };

export const SUPPORT_PREFIX = "MBS1.";
/** Teto do código (a caixa de entrada na agente-box também corta em 4 KB). */
export const SUPPORT_MAX = 4096;
/** Comentário que marca a linha do admin no authorized_keys da pessoa (é por ele que sai ao desligar). */
export const ADMIN_KEY_TAG = "meu-bot-admin";
/** Opções da linha do admin: shell normal (o suporte roda comandos), sem repassar agente nem X11. */
export const ADMIN_KEY_OPTIONS = "no-agent-forwarding,no-X11-forwarding";

export interface SupportCode {
  v: 1;
  /** Nome da pessoa, como ela escreveu no meu-bot dela. */
  name: string;
  /** Como o admin chega na máquina dela (o que o `ssh -G` dela resolve). */
  hostname: string;
  user: string;
  port: number;
  /** Chave pública do servidor dela ("ssh-ed25519 AAAA…"), vai para o known_hosts do admin. */
  hostKey: string;
  state: "on" | "off";
  /** Quando foi gerado (ISO). */
  at: string;
  /** Apelido que ela usa para a máquina no ~/.ssh/config dela ("colima"); o admin mostra em vez do alias. */
  machine?: string;
}

const HOSTNAME_RE = /^[A-Za-z0-9._:-]{1,253}$/;
const MACHINE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const HOSTKEY_RE = /^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/]+={0,3}$/;
const PUBKEY_RE = /^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/]+={0,3}( .*)?$/;

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

export function encodeSupportCode(c: SupportCode): string {
  return `${SUPPORT_PREFIX}${b64url(JSON.stringify(c))}`;
}

export type DecodeResult = { ok: true; code: SupportCode } | { ok: false; reason: string };

/** Lê um código colado ou entregue; recusa qualquer coisa fora do formato (vem de fora, é dado). */
export function decodeSupportCode(raw: string): DecodeResult {
  const text = raw.trim();
  if (text.length > SUPPORT_MAX) return { ok: false, reason: "código grande demais" };
  if (!text.startsWith(SUPPORT_PREFIX)) return { ok: false, reason: "não é um código de suporte do meu-bot (começa com MBS1.)" };
  let v: unknown;
  try { v = JSON.parse(Buffer.from(text.slice(SUPPORT_PREFIX.length), "base64url").toString("utf8")); } catch { return { ok: false, reason: "código corrompido" }; }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, reason: "código corrompido" };
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return { ok: false, reason: "versão de código desconhecida; atualize o meu-bot-admin" };
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
  if (name === "" || name.length > 40) return { ok: false, reason: "nome inválido" };
  if (typeof o.hostname !== "string" || !HOSTNAME_RE.test(o.hostname) || o.hostname.startsWith("-")) return { ok: false, reason: "endereço inválido" };
  if (typeof o.user !== "string" || !USER_RE.test(o.user)) return { ok: false, reason: "usuário inválido" };
  if (typeof o.port !== "number" || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) return { ok: false, reason: "porta inválida" };
  if (typeof o.hostKey !== "string" || !HOSTKEY_RE.test(o.hostKey)) return { ok: false, reason: "chave do servidor inválida" };
  if (o.state !== "on" && o.state !== "off") return { ok: false, reason: "estado inválido" };
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return { ok: false, reason: "data inválida" };
  const machine = typeof o.machine === "string" && MACHINE_RE.test(o.machine) ? o.machine : undefined;
  return { ok: true, code: { v: 1, name, hostname: o.hostname, user: o.user, port: o.port, hostKey: o.hostKey, state: o.state, at: o.at, ...(machine === undefined ? {} : { machine }) } };
}

/** Identidade estável da máquina: o hash da chave do servidor (nome e endereço podem mudar). */
/**
 * Identidade de uma conta numa máquina: chave do servidor + usuário + porta. Só a chave não bastava: duas contas
 * na mesma VM (root e box) têm o mesmo sshd e se sobrescreviam na caixa, no pessoas.json e no alias.
 */
export const machineId = (c: Pick<SupportCode, "hostKey" | "user" | "port">): string =>
  createHash("sha256").update(`${c.hostKey.trim()}\n${c.user}@${c.port}`).digest("hex").slice(0, 12);
/** O id antigo (só a chave), para o admin reconhecer avisos de meu-bots que ainda não atualizaram. */
export const legacyMachineId = (hostKey: string): string => createHash("sha256").update(hostKey.trim()).digest("hex").slice(0, 12);

/** Alias no ~/.ssh/config do admin: `suporte-<nome>-<4 hex da conta na máquina>` (nem máquinas nem contas colidem). */
export function supportAlias(c: Pick<SupportCode, "name" | "hostKey" | "user" | "port">): string {
  const slug = c.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "pessoa";
  return `suporte-${slug}-${machineId(c).slice(0, 4)}`;
}

/** Só a parte "tipo base64" de uma chave pública (sem comentário); null se não é chave pública. */
export function publicKeyBody(pub: string): string | null {
  const line = pub.trim().split("\n")[0]?.trim() ?? "";
  if (!PUBKEY_RE.test(line)) return null;
  const [type, body] = line.split(" ");
  return `${type} ${body}`;
}

/** Um admin do suporte no pacote das pessoas: nome (vai no comentário da chave) e a pública dele. */
export interface SupportAdmin { nome: string; chave: string }
/** Comentário da linha de um admin no authorized_keys: "meu-bot-admin:<nome>" (antes era só "meu-bot-admin"). */
export const adminKeyComment = (nome: string): string => `${ADMIN_KEY_TAG}:${nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "admin"}`;
/** Reconhece as linhas de admin do meu-bot no authorized_keys (formato antigo e novo), para o grep da máquina. */
export const ADMIN_KEY_LINE_RE = ` ${ADMIN_KEY_TAG}(:[A-Za-z0-9._-]*)?$`;

/**
 * Script remoto que liga/desliga as chaves dos admins no authorized_keys: tira toda linha marcada como admin do
 * meu-bot e, ligando, põe uma por admin da lista (quem saiu da lista perde o acesso aqui). Idempotente;
 * permissões do OpenSSH (700/600). Lista vazia = desligado.
 */
export function authorizedKeysScript(admins: readonly SupportAdmin[]): string {
  const lines = admins.map((a) => {
    const body = publicKeyBody(a.chave);
    if (body === null) throw new Error(`chave pública do admin ${a.nome} inválida`);
    return `${ADMIN_KEY_OPTIONS} ${body} ${adminKeyComment(a.nome)}`;
  });
  return [
    "set -e",
    "umask 077",
    'mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"',
    'AK="$HOME/.ssh/authorized_keys"; touch "$AK"',
    `grep -Ev '${ADMIN_KEY_LINE_RE}' "$AK" > "$AK.meu-bot.tmp" || true`,
    ...lines.map((l) => `printf '%s\\n' '${l}' >> "$AK.meu-bot.tmp"`),
    'chmod 600 "$AK.meu-bot.tmp"; mv "$AK.meu-bot.tmp" "$AK"',
  ].join("\n");
}

/** Bloco do ~/.ssh/config do admin para uma pessoa. */
export function adminSshBlock(c: SupportCode, identityFile: string): string {
  return [
    `Host ${supportAlias(c)}`,
    `    HostName ${c.hostname}`,
    `    User ${c.user}`,
    `    Port ${c.port}`,
    `    IdentityFile ${identityFile}`,
    "    IdentitiesOnly yes",
    `    HostKeyAlias ${supportAlias(c)}`,
    "",
  ].join("\n");
}

/** Linha do known_hosts do admin (pelo HostKeyAlias: endereço pode mudar sem quebrar a confiança). */
export const knownHostsLine = (c: SupportCode): string => `${supportAlias(c)} ${c.hostKey}`;
/** É um alias de pessoa do suporte (os `Host suporte-…` que o meu-bot-admin põe no ~/.ssh)? */
export const isSupportAlias = (h: string): boolean => /^suporte-[a-z0-9-]+-[0-9a-f]{4}$/.test(h);

/** Pasta do suporte na máquina dela: chave só de entrega, known_hosts da caixa, código e entregador. */
export const SUPPORT_DIR = "$HOME/.local/share/meu-bot/suporte";
/** O admin desligou: o meu-bot dela não religa sozinho (só se ela clicar em "Ligar o suporte"). Ligar apaga. */
export const SUPPORT_BLOCK_FILE = "$HOME/.local/share/meu-bot/suporte-desligado-pelo-admin";
/** Script remoto ao desligar: entrega "desligado" uma última vez e apaga timer, chave e código. */
export function removeDeliverySh(id: string, offText: string): string {
  return `umask 077
if [ -x "${SUPPORT_DIR}/entregar.sh" ]; then printf '%s\\n%s\\n' '${id}' '${offText}' > "${SUPPORT_DIR}/codigo"; "${SUPPORT_DIR}/entregar.sh" >/dev/null 2>&1 && echo ENTREGUE=1 || echo ENTREGUE=0; fi
systemctl --user disable --now meu-bot-suporte.timer >/dev/null 2>&1 || true
rm -f "$HOME/.config/systemd/user/meu-bot-suporte.service" "$HOME/.config/systemd/user/meu-bot-suporte.timer"
systemctl --user daemon-reload >/dev/null 2>&1 || true
( crontab -l 2>/dev/null | grep -v meu-bot-suporte ) | crontab - 2>/dev/null || true
rm -rf "${SUPPORT_DIR}"
`;
}
/**
 * Progresso da pessoa nos tutoriais (tipo em shared/ipc.ts), gravado pelo meu-bot dela na máquina (só com o
 * suporte ligado) e lido pelo admin: mostra quem está avançando e onde trava. Vem de fora: validado aqui.
 */

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 50 ? v : null);

export function parseSupportProgress(raw: unknown): SupportProgress | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = str(o.at, 40);
  if (at === null || Number.isNaN(Date.parse(at))) return null;
  if (o.tour !== "done" && o.tour !== "skipped" && o.tour !== "pending") return null;
  if (!Array.isArray(o.tutorials) || o.tutorials.length > 20) return null;
  const tutorials: SupportProgress["tutorials"] = [];
  for (const t of o.tutorials) {
    if (t === null || typeof t !== "object") return null;
    const r = t as Record<string, unknown>;
    const id = str(r.id, 60), title = str(r.title, 120), done = count(r.done), total = count(r.total);
    const current = r.current === null ? null : str(r.current, 120);
    if (id === null || title === null || done === null || total === null || done > total || (r.current !== null && current === null)) return null;
    tutorials.push({ id, title, done, total, current, finished: r.finished === true, comingSoon: r.comingSoon === true });
  }
  // O app dela (opcional; códigos antigos não trazem): versão curta e quando a sessão abriu.
  let appInfo: { version: string; openedAt: string } | undefined;
  if (o.app !== null && typeof o.app === "object") {
    const a = o.app as Record<string, unknown>;
    const version = str(a.version, 20), openedAt = str(a.openedAt, 40);
    if (version !== null && /^[0-9A-Za-z.+-]+$/.test(version) && openedAt !== null && !Number.isNaN(Date.parse(openedAt))) appInfo = { version, openedAt };
  }
  return { at, tour: o.tour, tutorials, ...(appInfo === undefined ? {} : { app: appInfo }) };
}

/** Onde a escolha do que compartilhar fica na máquina dela (fora da pasta do suporte: sobrevive a desligar/ligar). */
export const SHARE_FILE = "$HOME/.local/share/meu-bot/compartilha.json";
// O backup completo leva a sessão do WhatsApp e os logins: só com a pessoa ligando (padrão false, ao contrário do resto).
export const DEFAULT_SHARE: SupportShare = { progress: true, whatsapp: true, logs: true, chat: true, backup: false };
/** Lê a escolha gravada (ou vinda do renderer); o que falta ou não é booleano conta como compartilhado. */
export function parseSupportShare(raw: unknown): SupportShare {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { progress: o.progress !== false, whatsapp: o.whatsapp !== false, logs: o.logs !== false, chat: o.chat !== false, backup: o.backup === true };
}
