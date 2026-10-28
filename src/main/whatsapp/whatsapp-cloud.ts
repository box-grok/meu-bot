/**
 * WhatsApp pela API oficial (Cloud API da Meta): o I/O do lado do app. Conectar confere as credenciais na Graph API
 * (deste Mac) antes de gravar, liga o receptor na máquina (install-wa-cloud.sh), grava as credenciais (0600) e o dono,
 * e reinicia o receptor. O puro (validação, trechos de shell, leitura) está em whatsapp-cloud-core.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { backendBundleDir } from "../maquina/hostProbe";
import { log } from "../maquina/backend";
import { runSsh } from "./whatsapp";
import { CLOUD_RESTART_SH, envSetSh, envUnsetSh, estadoPatchSh, GRAPH_VERSAO, lerInstalacao, validarCredenciais } from "./whatsapp-cloud-core";

const ultima = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "sem resposta";

/** O número e o nome verificado que a Meta associa ao ID, pelo token (confere token + ID de uma vez). */
async function conferirNaMeta(token: string, phoneNumberId: string): Promise<{ numero: string; nome: string }> {
  let r: Response;
  try {
    r = await fetch(`https://graph.facebook.com/${GRAPH_VERSAO}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (e) { throw new Error(`não consegui falar com a Meta deste Mac: ${e instanceof Error ? e.message : String(e)}`); }
  const v = (await r.json().catch(() => null)) as { display_phone_number?: unknown; verified_name?: unknown; error?: { message?: unknown } } | null;
  if (!r.ok) throw new Error(`a Meta recusou: ${typeof v?.error?.message === "string" ? v.error.message : `HTTP ${r.status}`}`);
  return { numero: String(v?.display_phone_number ?? ""), nome: String(v?.verified_name ?? "") };
}

/**
 * Conecta a máquina à API oficial. Devolve o que a pessoa precisa colar na Meta (verify token) e o número confirmado.
 * Ordem pensada para não deixar meio-estado: confere na Meta, liga o receptor, só então grava credenciais e dono.
 */
export async function cloudConectar(host: string, raw: unknown): Promise<{ numero: string; nome: string; verifyToken: string; porta: number }> {
  const v = validarCredenciais(raw);
  if (!v.ok) throw new Error(v.erro);
  const c = v.c;
  const meta = await conferirNaMeta(c.token, c.phoneNumberId);
  const script = fs.readFileSync(path.join(backendBundleDir(), "install-wa-cloud.sh"), "utf8");
  const inst = await runSsh(host, script, 120_000);
  const lido = lerInstalacao(inst.stdout);
  if (!lido.ok) throw new Error(lido.erro === "" ? `não consegui ligar o receptor: ${ultima(inst)}` : lido.erro);
  const grava = await runSsh(host, `set -e\n${envSetSh({ WA_TOKEN: c.token, WA_APP_SECRET: c.appSecret, WA_PHONE_NUMBER_ID: c.phoneNumberId, WA_WABA_ID: c.wabaId, WA_DISPLAY_PHONE: meta.numero, WA_VERIFIED_NAME: meta.nome })}\n${estadoPatchSh({ dono: `+${c.dono}` })}\n${CLOUD_RESTART_SH}\n`, 30_000);
  if (!/^ENV=ok$/m.test(grava.stdout) || !/^ESTADO=ok$/m.test(grava.stdout)) throw new Error(`não consegui gravar as credenciais na máquina: ${ultima(grava)}`);
  log(`[whatsapp] ${host}: API oficial conectada (${meta.numero || c.phoneNumberId})`);
  return { numero: meta.numero, nome: meta.nome, verifyToken: lido.verifyToken, porta: lido.porta };
}

/** Desconecta: o receptor para e o token/App Secret saem da máquina (porta, verify token e histórico ficam). */
export async function cloudDesconectar(host: string): Promise<void> {
  const script = fs.readFileSync(path.join(backendBundleDir(), "uninstall-wa-cloud.sh"), "utf8");
  const r = await runSsh(host, `${script}\n${envUnsetSh(["WA_TOKEN", "WA_APP_SECRET"])}\n`, 60_000);
  if (!/^ENV=ok$/m.test(r.stdout)) throw new Error(`não consegui desconectar a API oficial: ${ultima(r)}`);
  log(`[whatsapp] ${host}: API oficial desconectada`);
}

/** Só para o receptor (trocar de agente): credenciais ficam, voltar à API oficial é só religar. */
export async function cloudParar(host: string): Promise<void> {
  const script = fs.readFileSync(path.join(backendBundleDir(), "uninstall-wa-cloud.sh"), "utf8");
  await runSsh(host, script, 60_000);
}

/** "Quem o agente responde" (self/open/list) no wa-cloud.json; o receptor relê a cada mensagem, sem reiniciar. */
export async function cloudPolitica(host: string, choice: "self" | "open" | "list", numeros: string[]): Promise<void> {
  const lista = [...new Set(numeros.map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 8 && n.length <= 15))].map((n) => `+${n}`);
  const r = await runSsh(host, `${estadoPatchSh(choice === "list" ? { politica: "list", lista } : { politica: choice })}\n`, 20_000);
  if (!/^ESTADO=ok$/m.test(r.stdout)) throw new Error(`não consegui gravar quem o agente responde: ${ultima(r)}`);
}
