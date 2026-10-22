/**
 * Um só ponto de gate dos módulos pagos no main (o renderer bloqueia na tela; na máquina o backend recusa de
 * novo: três camadas). Produto free (meu-bot): o módulo Pro exige o plano pro → "PRO_REQUIRED". Um app que exigisse
 * mais que o free precisaria do add-on `caps().produto` contratado e em vigor → "ASSINATURA_REQUIRED". Nunca decide
 * por variante: só por caps().planoExigido e caps().produto.
 */
import { fetchLicense } from "./backend";
import { acessoProduto, crmProprioOk, financeOk, proOk } from "./licenca";
import { LOCAL_HOST } from "./localBackend";
import { isValidHost } from "./settings";
import { caps } from "./variant";

export async function assertAcesso(host: string): Promise<void> {
  const exige = caps().planoExigido;
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error(exige === "free" ? "PRO_REQUIRED" : "ASSINATURA_REQUIRED");
  const lic = await fetchLicense(host);
  if (exige !== "free") {
    // Backend antigo/fora do ar ("unknown") não é bloqueio do admin: deixa passar; o backend da máquina recusa se for o caso.
    const a = acessoProduto(lic, host, exige, caps().produto);
    if (a === "ausente" || a === "expirada") throw new Error("ASSINATURA_REQUIRED");
    return;
  }
  if (lic === null || !proOk(lic.license)) throw new Error("PRO_REQUIRED");
}

/** Financeiro nesta máquina: o add-on meu-bot-finance contratado e em vigor. "FINANCE_REQUIRED". */
export async function assertFinance(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("FINANCE_REQUIRED");
  const lic = await fetchLicense(host);
  if (!financeOk(lic, host)) throw new Error("FINANCE_REQUIRED");
}

/** CRM próprio nesta máquina (guardar conversa no CRM…): plano Pro em vigor. "CRM_REQUIRED". */
export async function assertCrmProprio(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("CRM_REQUIRED");
  const lic = await fetchLicense(host);
  if (!crmProprioOk(lic, host)) throw new Error("CRM_REQUIRED");
}
