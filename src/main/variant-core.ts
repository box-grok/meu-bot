/**
 * Qual produto é este app (meu-bot, meu-bot-admin, meu-bot-crm) e o que cada um pode fazer. Puro: testável com
 * node --test. Ler o variant.json e o ambiente é tarefa do variant.ts; aqui só a decisão e a tabela.
 *
 * PRODUTOS é a única fonte: o runtime (caps, título, userData) e os scripts de empacotamento
 * (scripts/produtos.mjs lê dist/main/variant-core.js) saem daqui. Produto novo (meu-bot-vendas,
 * meu-bot-imobiliaria…) = um membro em AppVariant, uma linha aqui e um ícone em assets/.
 */
import type { AppVariant, Capabilities, PlanName } from "../shared/ipc";

export type { AppVariant, Capabilities };

export interface Produto {
  variant: AppVariant;
  /** Nome do app: bundle (`<nome>.app`), título da janela, pasta de userData, asset da atualização. */
  nome: string;
  bundleId: string;
  /** Ícone .icns (o .svg de origem fica ao lado, mesmo nome). */
  icone: string;
  /** Pasta própria em ~/Library/Application Support; null = a padrão do Electron (productName "meu-bot"). */
  userData: string | null;
  /** Extensões embutidas (meu-bot CRM no Gmail, Autenticador): pastas de saída do build (relativas a build/ em dev, Resources/ empacotado). */
  extensoes: readonly string[];
  caps: Omit<Capabilities, "variant" | "produto">;
}

const PESSOA: Omit<Capabilities, "variant" | "produto"> = {
  chat: true, pair: true, login: true, manageWa: true, tunnel: true, install: true, supportClient: true, supportAdmin: false,
  navegador: true, crmStreak: true, extensaoGmail: false, planoExigido: "free",
};
const ADMIN: Omit<Capabilities, "variant" | "produto"> = {
  chat: false, pair: false, login: false, manageWa: false, tunnel: false, install: false, supportClient: false, supportAdmin: true,
  navegador: false, crmStreak: false, extensaoGmail: false, planoExigido: "free",
};

export const PRODUTOS: readonly Produto[] = [
  { variant: "client", nome: "meu-bot", bundleId: "local.meu-bot", icone: "assets/icon.icns", userData: null, extensoes: [], caps: PESSOA },
  { variant: "admin", nome: "meu-bot-admin", bundleId: "local.meu-bot-admin", icone: "assets/icon-admin.icns", userData: "meu-bot-admin", extensoes: [], caps: ADMIN },
  // meu-bot-crm: tudo do meu-bot, sem o CRM pelo Streak, com o CRM próprio no Gmail; só funciona no plano personalizado.
  { variant: "crm", nome: "meu-bot-crm", bundleId: "local.meu-bot-crm", icone: "assets/icon-crm.icns", userData: "meu-bot-crm", extensoes: ["extensao-crm", "extensao-autenticador"], caps: { ...PESSOA, crmStreak: false, extensaoGmail: true, planoExigido: "personalizado" } },
];

export function produtoDe(v: AppVariant): Produto {
  const p = PRODUTOS.find((x) => x.variant === v);
  if (p === undefined) throw new Error(`produto desconhecido: ${v}`);
  return p;
}
const isVariant = (v: unknown): v is AppVariant => typeof v === "string" && PRODUTOS.some((p) => p.variant === v);

export interface VariantInput {
  /** app.isPackaged: empacotado lê o variant.json; em dev vale a variável de ambiente. */
  packaged: boolean;
  /** MEU_BOT_VARIANT (só em dev). */
  env: string | undefined;
  /** Conteúdo do Resources/variant.json já parseado (undefined/null = sem arquivo ou inválido). */
  variantJson: unknown;
}

export function resolveVariant(i: VariantInput): AppVariant {
  if (!i.packaged) return isVariant(i.env) ? i.env : "client";
  const v = i.variantJson !== null && typeof i.variantJson === "object" ? (i.variantJson as { variant?: unknown }).variant : undefined;
  return isVariant(v) ? v : "client";
}

export const titleFor = (v: AppVariant): string => produtoDe(v).nome;
export const userDataNameFor = (v: AppVariant): string | null => produtoDe(v).userData;

/** O admin só lê e faz as ações de suporte; os outros produtos fazem tudo o mais (ver a tabela). */
export function capsFor(variant: AppVariant): Capabilities {
  const p = produtoDe(variant);
  return { variant, produto: p.nome, ...p.caps };
}
