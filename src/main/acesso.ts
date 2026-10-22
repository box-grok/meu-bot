/**
 * Um só ponto de gate dos módulos pagos no main (o renderer bloqueia na tela; na máquina o backend recusa de
 * novo: três camadas). Produto free (meu-bot): o módulo Pro exige pro/personalizado → "PRO_REQUIRED". Produto por
 * assinatura (meu-bot-crm): o produto precisa estar contratado (acumulado por cima do plano) e a licença em vigor
 * → "ASSINATURA_REQUIRED". Nunca decide por variante: só por caps().planoExigido e caps().produto.
 */
import { fetchLicense } from "./backend";
import { acessoProduto, crmProprioOk, proOk } from "./licenca";
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

/** CRM próprio nesta máquina (guardar conversa no CRM…): Pro ou superior em vigor, ou o produto meu-bot-crm. "CRM_REQUIRED". */
export async function assertCrmProprio(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("CRM_REQUIRED");
  const lic = await fetchLicense(host);
  if (!crmProprioOk(lic, host)) throw new Error("CRM_REQUIRED");
}
