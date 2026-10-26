/**
 * Licença da máquina lida pelo app (os dois): primeiro pelo backend (`GET /v1/meu-bot/license`, backend-colima),
 * e, quando ele não tem a rota (a máquina do Hermes roda o backend original dele) ou está fora do ar, direto dos
 * arquivos por SSH (`licenca.json` + `maquinas.json`), do mesmo jeito que o admin lê e grava. Sem isso, o Pro que o
 * admin libera numa máquina sem backend-colima nunca chegava à tela da pessoa.
 */
import type { LicenseView } from "../../shared/ipc";
import { fetchLicense } from "../maquina/backend";
import { buildLicenseView, type LicencaDaMaquina } from "./licenca";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { runSsh } from "../whatsapp/whatsapp";

export const LICENSE_PATH = "$HOME/.local/share/meu-bot/licenca.json";
export const MACHINES_PATH = "$HOME/.local/share/meu-bot/maquinas.json";

/** licenca.json + maquinas.json da máquina por SSH; null se ela não responde. Sem arquivo = licença padrão (free). */
export async function readLicenseViewSsh(host: string): Promise<LicenseView | null> {
  const r = await runSsh(host, `cat "${LICENSE_PATH}" 2>/dev/null; echo "<<<REA-SEP>>>"; cat "${MACHINES_PATH}" 2>/dev/null; echo\n`, 20_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  const [licPart = "", maqPart = ""] = r.stdout.split("<<<REA-SEP>>>");
  let licRaw: unknown = null; let maqRaw: unknown = null;
  try { licRaw = JSON.parse(licPart.trim() || "null"); } catch { licRaw = null; }
  try { maqRaw = JSON.parse(maqPart.trim() || "null"); } catch { maqRaw = null; }
  return buildLicenseView(licRaw, maqRaw);
}

/**
 * A licença como o app da pessoa deve ver, com a origem: backend (`viaBackend`), senão os arquivos por SSH; `view`
 * null só quando nada responde. Quem decide sobre o CRM próprio precisa da origem (crmDaMaquinaOk): a API do CRM
 * mora no nosso backend, e licença lida por SSH não prova que ele existe na máquina.
 */
export async function lerLicencaDaMaquina(host: string): Promise<LicencaDaMaquina> {
  const pelaApi = await fetchLicense(host);
  if (pelaApi !== null) return { view: pelaApi, viaBackend: true };
  if (host === LOCAL_HOST || !isValidHost(host)) return { view: null, viaBackend: false };
  return { view: await readLicenseViewSsh(host), viaBackend: false };
}
/** Só a vista da licença (telas e gates que não dependem do backend). */
export async function lerLicenca(host: string): Promise<LicenseView | null> { return (await lerLicencaDaMaquina(host)).view; }
