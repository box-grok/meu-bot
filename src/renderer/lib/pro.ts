/**
 * Acesso ao módulo Pro (aba Navegador) a partir da licença da máquina. Puro, testado.
 * - "ok": plano Pro ativo (ou em teste);
 * - "free": plano grátis → a aba abre bloqueada, com "Pedir o Pro ao admin";
 * - "expired": era Pro e venceu → bloqueada, com a data;
 * - "unknown": este Mac ou backend antigo/fora do ar (sem licença para ler) → bloqueada, "atualize o backend".
 */
import type { LicenseView } from "../../shared/ipc";

export type ProAccess = "ok" | "free" | "expired" | "unknown";

export function browserAccess(view: LicenseView | null, host: string): ProAccess {
  if (host === "local" || view === null) return "unknown";
  const l = view.license;
  if (l.plan !== "pro") return "free";
  if (l.status === "expired") return "expired";
  if (l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < Date.now()) return "expired";
  return "ok";
}

/** Texto do bloqueio, por situação. */
export function proBlockText(a: Exclude<ProAccess, "ok">, view: LicenseView | null): { title: string; text: string; askAdmin: boolean } {
  if (a === "unknown") return { title: "Navegador · Pro", text: "Não consegui ler o plano desta máquina (backend antigo, fora do ar, ou este Mac). Reinstale o backend pelo seletor e tente de novo.", askAdmin: false };
  if (a === "expired") return { title: "Seu Pro venceu", text: `O plano Pro desta máquina venceu${view?.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}. Peça ao admin para renovar e a aba volta a abrir.`, askAdmin: true };
  return { title: "Navegador é do plano Pro", text: "Um navegador dentro do meu-bot, com abas, cookies separados por máquina e extensões do Chrome (como o Streak CRM no Gmail). E o agente da conversa pode navegar por você. Peça o Pro ao admin: ele libera e a aba abre aqui mesmo.", askAdmin: true };
}

/** Título curto de uma aba interna (favicon à parte): o título da página, senão o domínio, senão "Nova aba". */
export function tabLabel(title: string, url: string): string {
  const t = title.trim();
  if (t !== "" && t !== url) return t.length > 28 ? `${t.slice(0, 27)}…` : t;
  try { const h = new URL(url).hostname.replace(/^www\./, ""); if (h !== "") return h; } catch { /* sem url */ }
  return "Nova aba";
}
/** O que aparece no campo de endereço: sem "https://" e sem a barra final solitária. */
export const displayUrl = (url: string): string => url.replace(/^https:\/\//, "").replace(/\/$/, "");
