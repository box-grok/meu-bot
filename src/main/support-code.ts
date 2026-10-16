/**
 * Suporte (meu-bot-admin): o "código de suporte" que a máquina de uma pessoa entrega ao admin, e os scripts
 * que mexem no authorized_keys dela. Puro (sem IO): a fronteira dona desse formato. O código não tem segredo:
 * nome, endereço, usuário, porta e a chave pública do servidor (para o admin não confiar às cegas na 1ª vez).
 *
 * Formato: `MBS1.<base64url(JSON)>`. `state: "off"` = a pessoa desligou o suporte.
 */
import { createHash } from "node:crypto";
import type { SupportProgress } from "../shared/ipc";

export type { SupportProgress };

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
}

const HOSTNAME_RE = /^[A-Za-z0-9._:-]{1,253}$/;
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
  return { ok: true, code: { v: 1, name, hostname: o.hostname, user: o.user, port: o.port, hostKey: o.hostKey, state: o.state, at: o.at } };
}

/** Identidade estável da máquina: o hash da chave do servidor (nome e endereço podem mudar). */
export const machineId = (hostKey: string): string => createHash("sha256").update(hostKey.trim()).digest("hex").slice(0, 12);

/** Alias no ~/.ssh/config do admin: `suporte-<nome>-<4 hex da máquina>` (duas máquinas da mesma pessoa não colidem). */
export function supportAlias(c: Pick<SupportCode, "name" | "hostKey">): string {
  const slug = c.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "pessoa";
  return `suporte-${slug}-${machineId(c.hostKey).slice(0, 4)}`;
}

/** Só a parte "tipo base64" de uma chave pública (sem comentário); null se não é chave pública. */
export function publicKeyBody(pub: string): string | null {
  const line = pub.trim().split("\n")[0]?.trim() ?? "";
  if (!PUBKEY_RE.test(line)) return null;
  const [type, body] = line.split(" ");
  return `${type} ${body}`;
}

/**
 * Script remoto que liga/desliga a chave do admin no authorized_keys: tira qualquer linha marcada com o
 * comentário do admin e, ligando, acrescenta a linha nova. Idempotente; permissões do OpenSSH (700/600).
 */
export function authorizedKeysScript(adminPub: string | null): string {
  const body = adminPub === null ? null : publicKeyBody(adminPub);
  if (adminPub !== null && body === null) throw new Error("chave pública do admin inválida");
  const line = body === null ? "" : `${ADMIN_KEY_OPTIONS} ${body} ${ADMIN_KEY_TAG}`;
  return [
    "set -e",
    "umask 077",
    'mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"',
    'AK="$HOME/.ssh/authorized_keys"; touch "$AK"',
    `grep -v ' ${ADMIN_KEY_TAG}$' "$AK" > "$AK.meu-bot.tmp" || true`,
    ...(line === "" ? [] : [`printf '%s\\n' '${line}' >> "$AK.meu-bot.tmp"`]),
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

/** Registro de suporte na máquina da pessoa (ela vê nas Configurações; o admin anota as ações dele aqui). */
export const SUPPORT_LOG = "$HOME/.local/share/meu-bot/suporte.log";
/** Linha do registro de suporte: "2026-10-16T12:00:00Z|quem|o quê" (o texto é só letras, números e " .,:()-"). */
export const supportLogSh = (who: string, what: string): string => {
  const clean = (s: string): string => s.replace(/[^\p{L}\p{N} .,:()-]/gu, "").slice(0, 120);
  return `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s|%s|%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '${clean(who)}' '${clean(what)}' >> "${SUPPORT_LOG}"`;
};

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
  return { at, tour: o.tour, tutorials };
}
