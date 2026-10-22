/**
 * licenca-crm.mjs — a decisão de licença do CRM, pura e sem disco. O crm-job.mjs (copiado para
 * ~/.local/share/meu-bot/crm, longe do licenca.js do backend) e o streakSh do app aplicam a mesma regra no
 * licenca.json cru, sem esperar o server.js migrar o arquivo.
 * Espelha `crmOk` e `legadoCrmContratado` de backend-colima/licenca.js: "personalizado" em vigor conta como Pro;
 * o add-on antigo meu-bot-crm, sozinho, não libera. O teste crm-regras compara os dois.
 */
const PLANS = ["free", "pro"];
const STATUSES = ["free", "trialing", "active", "expired"];
const isIso = (v) => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));

/** Os campos que decidem o CRM, com o mesmo fallback do parseLicense (o resto da licença não entra aqui). */
function normaliza(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { plan: "free", status: "free", expiresAt: null };
  return {
    plan: raw.plan === "personalizado" ? "pro" : PLANS.includes(raw.plan) ? raw.plan : "free",
    status: STATUSES.includes(raw.status) ? raw.status : "free",
    expiresAt: isIso(raw.expiresAt) ? raw.expiresAt : null,
  };
}

/** Plano Pro em vigor. Validade: status active/trialing e, se houver expiresAt, a data ainda não passou. */
export const crmProprio = (l, now = Date.now()) => {
  const n = normaliza(l);
  if (n.plan !== "pro" || (n.status !== "active" && n.status !== "trialing")) return false;
  return !(n.expiresAt !== null && Date.parse(n.expiresAt) < now);
};

/** Licença crua de antes de 22 out que tinha o CRM contratado (personalizado ou o add-on meu-bot-crm). */
const legadoCrmContratado = (raw) => raw !== null && typeof raw === "object" && (raw.plan === "personalizado" || (Array.isArray(raw.produtos) && raw.produtos.includes("meu-bot-crm")));

/**
 * Motor do CRM: o gravado ("proprio" | "streak"); sem ele, quem ainda tem o CRM contratado e o Pro em vigor
 * segue no próprio mesmo com a chave do Streak. Senão, chave do Streak → streak; Pro em vigor → próprio; o resto → streak.
 */
export const motorCrm = (l, c = {}, now = Date.now()) =>
  c.motor === "proprio" || c.motor === "streak" ? c.motor
    : legadoCrmContratado(l) && crmProprio(l, now) ? "proprio"
    : typeof c.apiKey === "string" && c.apiKey !== "" ? "streak"
    : crmProprio(l, now) ? "proprio" : "streak";
