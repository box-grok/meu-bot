/**
 * Qual produto é este app (meu-bot, meu-bot-admin e os staging) e o que cada um pode fazer. Puro: testável com
 * node --test. Ler o variant.json e o ambiente é tarefa do variant.ts; aqui só a decisão e a tabela.
 *
 * PRODUTOS é a única fonte: o runtime (caps, título, userData) e os scripts de empacotamento
 * (scripts/produtos.mjs lê dist/main/app/variant-core.js) saem daqui. Produto novo (meu-bot-vendas,
 * meu-bot-imobiliaria…) = um membro em AppVariant, uma linha aqui e um ícone em assets/.
 *
 * Canais (modelo VS Code / Insiders): o meu-bot tem cópias staging lado a lado, com nome, ícone,
 * dados e porta próprios, que recebe o que está em teste; a linha staging sai da estável (`staging()`), não é
 * escrita à mão. O meu-bot-admin é só estável.
 */
import type { AppVariant, Canal, Capabilities, PlanName } from "../../shared/ipc";

export type { AppVariant, Canal, Capabilities };

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
  canal: Canal;
  /** Produto contratado que a licença libera (no staging, o do estável): vira `caps.produto`. */
  licenca: string;
  /** Pasta de dados de onde a primeira abertura copia (uma vez só); null = começa vazio. */
  herdaDe: string | null;
  /** Porta do backend local deste Mac (host "local"): apps abertos juntos não podem dividir. */
  portaLocal: number;
  /** Pasta de dados de um app antecessor que a primeira abertura funde (união, sem apagar a origem); null = nenhum. */
  fundeDe: string | null;
  caps: Omit<Capabilities, "variant" | "produto" | "canal" | "nome" | "titulo">;
}

const PESSOA: Produto["caps"] = {
  chat: true, pair: true, login: true, manageWa: true, tunnel: true, install: true, supportClient: true, supportAdmin: false,
  navegador: true, planoExigido: "free",
};
const ADMIN: Produto["caps"] = {
  chat: false, pair: false, login: false, manageWa: false, tunnel: false, install: false, supportClient: false, supportAdmin: true,
  navegador: false, planoExigido: "free",
};

// meu-bot: o app da pessoa. Traz as duas extensões; o CRM próprio no Gmail abre pela licença da máquina (Pro ou superior,
// ou o produto meu-bot-crm contratado), nunca por variante. Funde a pasta do antigo meu-bot-crm na primeira abertura.
const CLIENT: Produto = { variant: "client", nome: "meu-bot", bundleId: "local.meu-bot", icone: "assets/icon.icns", userData: null, extensoes: ["extensao-crm", "extensao-autenticador"], canal: "estavel", licenca: "meu-bot", herdaDe: null, portaLocal: 8790, fundeDe: "meu-bot-crm", caps: PESSOA };

/** A cópia staging de um app estável: "<nome>-staging", ícone com a faixa, dados próprios herdados dele, porta própria. */
function staging(base: Produto, variant: AppVariant, portaLocal: number): Produto {
  const nome = `${base.nome}-staging`;
  return { ...base, variant, nome, bundleId: `${base.bundleId}.staging`, icone: base.icone.replace(/\.icns$/, "-staging.icns"), userData: nome, canal: "staging", herdaDe: base.nome, portaLocal, fundeDe: base.fundeDe === null ? null : `${base.fundeDe}-staging` };
}

export const PRODUTOS: readonly Produto[] = [
  CLIENT,
  { variant: "admin", nome: "meu-bot-admin", bundleId: "local.meu-bot-admin", icone: "assets/icon-admin.icns", userData: "meu-bot-admin", extensoes: [], canal: "estavel", licenca: "meu-bot-admin", herdaDe: null, portaLocal: 8790, fundeDe: null, caps: ADMIN },
  staging(CLIENT, "client-staging", 8791),
  // meu-bot-finance-staging: o meu-bot em teste com o financeiro na frente (abre na página Finanças). O financeiro em si
  // é liberado pela licença da máquina (produto meu-bot-finance), como o CRM próprio; o app só tem nome, ícone, dados
  // e porta próprios para conviver com o meu-bot e o meu-bot-staging. Nasce como cópia dos dados do meu-bot-staging.
  { ...staging(CLIENT, "finance-staging", 8792), nome: "meu-bot-finance-staging", bundleId: "local.meu-bot-finance.staging", icone: "assets/icon-finance-staging.icns", userData: "meu-bot-finance-staging", herdaDe: "meu-bot-staging", fundeDe: null },
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

/** Nome do app; no staging com a versão junto ("meu-bot-staging 0.2.0-staging.3"): a janela diz qual build está aberto. */
export const titleFor = (v: AppVariant, versao?: string): string => { const p = produtoDe(v); return p.canal === "staging" && versao !== undefined && versao !== "" ? `${p.nome} ${versao}` : p.nome; };
export const userDataNameFor = (v: AppVariant): string | null => produtoDe(v).userData;

/** O admin só lê e faz as ações de suporte; os outros produtos fazem tudo o mais (ver a tabela). */
export function capsFor(variant: AppVariant, versao?: string): Capabilities {
  const p = produtoDe(variant);
  return { variant, produto: p.licenca, canal: p.canal, nome: p.nome, titulo: titleFor(variant, versao), ...p.caps };
}
