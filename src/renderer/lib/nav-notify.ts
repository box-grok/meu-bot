/**
 * Notificações das páginas do Navegador viram conversas: o que a página notificou (título, corpo, site) entra numa
 * conversa com a instrução da pessoa ("traduza e explique para um leigo", por exemplo) e o agente trata. Puro, sem
 * DOM: o renderer aplica. A escolha fica nas Configurações (`navNotify`).
 */
import type { NavNotifyPref } from "../../shared/ipc";

export interface PageNotification { title: string; body: string; icon: string; tag: string; url: string; site: string }

export const NAV_NOTIFY_DEFAULT_INSTRUCTION = "Chegou uma notificação de um site que acompanho. Traduza para português, se estiver em outra língua, e explique em termos simples, para quem não é técnico, o que ela significa e se preciso fazer alguma coisa. Seja breve: no máximo cinco linhas.";
export const NAV_NOTIFY_DEFAULT: NavNotifyPref = { enabled: false, instruction: NAV_NOTIFY_DEFAULT_INSTRUCTION, hosts: [], mode: "site", avisar: "tratado" };

/** O que veio da página (via ponte): só os campos esperados, como texto, com limites. */
export function parsePageNotification(raw: unknown): PageNotification | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, max: number): string => (typeof r[k] === "string" ? (r[k] as string).replace(/\s+/g, " ").trim().slice(0, max) : "");
  const title = str("title", 200); const body = str("body", 2000);
  const site = str("site", 253).toLowerCase();
  if (site === "" || (title === "" && body === "")) return null;
  const url = str("url", 2048); const icon = str("icon", 2048);
  return { title, body, icon: /^(https?:|data:image\/)/i.test(icon) ? icon : "", tag: str("tag", 120), url: /^https?:\/\//i.test(url) ? url : "", site };
}

/** Só os sites com o sino ligado (o host ou um subdomínio dele); lista vazia = nenhum. */
export function navNotifyAllowed(hosts: readonly string[], site: string): boolean {
  return hosts.some((h) => site === h || site.endsWith(`.${h}`));
}
/** Liga/desliga o sino de um site na lista (sem repetição; o host como a página informa). */
export function toggleNotifyHost(hosts: readonly string[], site: string, on: boolean): string[] {
  const s = site.toLowerCase();
  return on ? (hosts.includes(s) ? [...hosts] : [...hosts, s]) : hosts.filter((h) => h !== s);
}

/** Título da conversa que trata o site (modo "site": uma por site; "each": uma por notificação). */
export function navNotifyTitle(n: PageNotification, mode: NavNotifyPref["mode"]): string {
  return mode === "each" ? `🔔 ${n.site} · ${(n.title || n.body).slice(0, 40)}` : `🔔 ${n.site}`;
}

/** A mensagem que vai ao agente: a instrução da pessoa e, abaixo, o que a página notificou. */
export function navNotifyMessage(instruction: string, n: PageNotification): string {
  const inst = instruction.trim() === "" ? NAV_NOTIFY_DEFAULT_INSTRUCTION : instruction.trim();
  return [inst, "", `Notificação de ${n.site}${n.url !== "" ? ` (${n.url})` : ""}:`, `Título: ${n.title || "(sem título)"}`, ...(n.body !== "" ? [`Texto: ${n.body}`] : [])].join("\n");
}

/** A mesma notificação repetida (mesmo site, tag/título e corpo) dentro da janela não vira conversa de novo. */
export class NavNotifyDedup {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs = 60_000) {}
  /** true = inédita (e registrada agora). */
  fresh(n: PageNotification, now = Date.now()): boolean {
    const key = `${n.site}|${n.tag !== "" ? n.tag : n.title}|${n.body}`;
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }
}

/**
 * Trava de volume por site: até `max` notificações por janela; as demais são contadas e o próximo aviso diz quantas
 * ficaram de fora. Uma caixa de entrada cheia (ou um site que dispara em rajada) não vira dezenas de conversas.
 */
export class NavNotifyBudget {
  private readonly win = new Map<string, { start: number; n: number; skipped: number }>();
  constructor(private readonly max = 3, private readonly windowMs = 60_000) {}
  /** `ok` = pode tratar; `skipped` = quantas ficaram de fora nesta janela antes desta (zera ao devolver). */
  take(site: string, now = Date.now()): { ok: boolean; skipped: number } {
    let w = this.win.get(site);
    if (w === undefined || now - w.start >= this.windowMs) { w = { start: now, n: 0, skipped: w?.skipped ?? 0 }; this.win.set(site, w); } // o excedente da janela anterior é dito no próximo aviso
    if (w.n >= this.max) { w.skipped += 1; return { ok: false, skipped: 0 }; }
    w.n += 1; const skipped = w.skipped; w.skipped = 0;
    return { ok: true, skipped };
  }
}
/** Hosts digitados ("mail.google.com, web.whatsapp.com") → lista limpa, sem repetição. */
export function parseNotifyHosts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (h !== "" && /^[a-z0-9.-]+$/.test(h) && !out.includes(h)) out.push(h);
  }
  return out;
}
