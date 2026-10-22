/**
 * Acesso aos módulos Pro (aba Navegador, CRM pelo WhatsApp) a partir da licença da máquina. Puro, testado.
 * Produto free (meu-bot), `exige === "free"`:
 * - "ok": plano pro ou personalizado em vigor;
 * - "free": plano grátis → a aba abre bloqueada, com "Pedir o Pro ao admin";
 * - "expired": tinha o plano e venceu → bloqueada, com a data;
 * - "unknown": este Mac ou backend antigo/fora do ar (sem licença para ler) → bloqueada, "atualize o backend".
 * Produto por assinatura (meu-bot-crm, `exige === "personalizado"`): sem etiqueta Pro; ou está tudo aberto ("ok")
 * ou a assinatura falta/venceu ("assinatura"), uma tela só. Mesmas regras do src/main/licenca.ts (lado do main).
 */
import type { LicenseView, PlanName } from "../../shared/ipc";

export type ProAccess = "ok" | "free" | "expired" | "unknown" | "assinatura";

const RANK: Record<PlanName, number> = { free: 0, pro: 1, personalizado: 2 };
export const planoLibera = (tem: PlanName, exige: PlanName): boolean => RANK[tem] >= RANK[exige];
/** Plano que libera os módulos Pro (pro ou personalizado). */
export const planoLiberaPro = (p: PlanName): boolean => planoLibera(p, "pro");
const vencida = (l: LicenseView["license"], now: number): boolean => l.status === "expired" || (l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < now);

export type AcessoProduto = "ok" | "ausente" | "expirada" | "unknown";
/**
 * Produto por assinatura (meu-bot-crm…): produtos são acumulativos por cima do plano; basta estar em
 * `licenca.produtos` (ou plano personalizado em vigor, que libera todos) e a licença não estar vencida.
 * Produto free: sempre ok. Mesma regra do src/main/licenca.ts.
 */
export function acessoProduto(view: LicenseView | null, host: string, exige: PlanName, produto: string, now: number = Date.now()): AcessoProduto {
  if (exige === "free") return "ok";
  if (host === "local" || view === null) return "unknown";
  const l = view.license;
  // `produtos` pode faltar num backend antigo (licença sem o campo): trata como nenhum.
  const contratado = (l.produtos ?? []).includes(produto) || (l.plan === "personalizado" && (l.status === "active" || l.status === "trialing"));
  if (!contratado) return "ausente";
  return vencida(l, now) ? "expirada" : "ok";
}

/**
 * CRM próprio (no Gmail e no WhatsApp) nesta máquina: Pro ou superior em vigor, ou o produto meu-bot-crm contratado.
 * Decide o que a janela mostra (tutorial 10, home do Navegador, "guardar no CRM"); o main e o backend conferem de novo.
 */
export const crmProprioOk = (view: LicenseView | null, host: string, now: number = Date.now()): boolean =>
  host !== "local" && view !== null && ((planoLiberaPro(view.license.plan) && (view.license.status === "active" || view.license.status === "trialing") && !vencida(view.license, now)) || acessoProduto(view, host, "personalizado", "meu-bot-crm", now) === "ok");

export function browserAccess(view: LicenseView | null, host: string, exige: PlanName = "free", produto: string = "meu-bot", now: number = Date.now()): ProAccess {
  if (exige !== "free") { const a = acessoProduto(view, host, exige, produto, now); return a === "ok" ? "ok" : a === "unknown" ? "unknown" : "assinatura"; }
  if (host === "local" || view === null) return "unknown";
  const l = view.license;
  if (!planoLiberaPro(l.plan)) return "free";
  if (vencida(l, now)) return "expired";
  return "ok";
}

/** Texto do bloqueio, por situação. */
export type ProModule = "navegador" | "crm";
const MODULE_TEXT: Record<ProModule, { name: string; pitch: string; back: string }> = {
  navegador: { name: "Navegador", pitch: "Um navegador dentro do meu-bot, com abas, cookies separados por máquina e extensões do Chrome (como o Streak CRM no Gmail). E o agente da conversa pode navegar por você.", back: "a aba volta a abrir" },
  crm: { name: "CRM pelo WhatsApp", pitch: "O agente da máquina anota no seu Streak CRM, pela API, o que acontece nas conversas do WhatsApp: cria e atualiza boxes, campos e comentários, e pede sua confirmação antes de mudar de etapa.", back: "o tutorial continua" },
};
export function proBlockText(a: Exclude<ProAccess, "ok">, view: LicenseView | null, modulo: ProModule = "navegador", produto: string = "meu-bot"): { title: string; text: string; askAdmin: boolean } {
  const m = MODULE_TEXT[modulo];
  if (a === "assinatura") return { title: `${produto}: produto não liberado nesta máquina`, text: `O ${produto} é contratado por cima do seu plano${view !== null && (view.license.produtos ?? []).includes(produto) ? `, e a licença desta máquina venceu${view.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}` : ", e esta máquina ainda não o tem"}. Fale com o admin para liberar; assim que ele gravar, ${m.back}.`, askAdmin: true };
  if (a === "unknown") return { title: `${m.name} · Pro`, text: "Não consegui ler o plano desta máquina (backend antigo, fora do ar, ou este Mac). Reinstale o backend pelo seletor e tente de novo.", askAdmin: false };
  if (a === "expired") return { title: "Seu Pro venceu", text: `O plano Pro desta máquina venceu${view?.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}. Peça ao admin para renovar e ${m.back}.`, askAdmin: true };
  return { title: `${m.name} é do plano Pro`, text: `${m.pitch} Peça o Pro ao admin: ele libera e ${m.back} aqui mesmo.`, askAdmin: true };
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
