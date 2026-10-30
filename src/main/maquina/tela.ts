/**
 * Tela do bot (painel "Computador"): pergunta à máquina, acorda o serviço e abre o forward do noVNC. As regras e os
 * prazos moram em tela-core.ts; o túnel (master SSH e forwards) é do tunnel.ts.
 */
import type { TelaEndereco, TelaStatus } from "../../shared/ipc";
import { PRAZO_STATUS_MS, TENTATIVAS_ACORDAR, esperaAcordar, TELA_ACORDAR_SH, TELA_STATUS_SH, parseTelaStatus, particaoComputador, urlNoVnc } from "./tela-core";
import { ensureForwardExtra, execNaMaquina, log } from "./tunnel";
import { LOCAL_HOST } from "./localBackend";

/** Aspas simples do shell: o script vai inteiro como um argumento do `bash -c`, qualquer que seja o shell de login. */
const bashC = (script: string): string => `bash -c '${script.replace(/'/g, "'\\''")}'`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ultimaLinha = (s: string): string => s.trim().split("\n").filter((l) => l !== "").pop() ?? "";

async function lerTela(host: string): Promise<{ status: TelaStatus; webPort: number | null }> {
  if (host === LOCAL_HOST) return { status: { instalada: false, rodando: false, erro: "a tela do bot mora numa máquina por SSH" }, webPort: null };
  try {
    const r = await execNaMaquina(host, bashC(TELA_STATUS_SH), PRAZO_STATUS_MS);
    const lida = r.code === 0 ? parseTelaStatus(r.stdout) : null;
    if (lida === null) return { status: { instalada: false, rodando: false, erro: r.code === null ? "a máquina não respondeu a tempo" : `não consegui ler a tela (${ultimaLinha(r.stderr) || `código ${r.code}`})` }, webPort: null };
    return { status: { instalada: lida.instalada, rodando: lida.rodando, erro: null }, webPort: lida.webPort };
  } catch (e) {
    return { status: { instalada: false, rodando: false, erro: e instanceof Error ? e.message : String(e) }, webPort: null };
  }
}

export async function telaStatus(host: string): Promise<TelaStatus> {
  return (await lerTela(host)).status;
}

/** Liga a tela e espera ela responder: até 3 tentativas, esperando 2 s e depois 4 s. Devolve o último status lido. */
export async function telaAcordar(host: string): Promise<TelaStatus> {
  let atual = await lerTela(host);
  const pronta = (): boolean => atual.status.erro !== null || !atual.status.instalada || atual.status.rodando;
  for (let tentativa = 0; tentativa < TENTATIVAS_ACORDAR && !pronta(); tentativa++) {
    const r = await execNaMaquina(host, bashC(TELA_ACORDAR_SH), PRAZO_STATUS_MS).catch((e: unknown) => ({ code: null, stdout: "", stderr: String(e) }));
    if (r.code !== 0) log(`[${host}] tela: acordar saiu com ${r.code ?? "timeout"}: ${ultimaLinha(r.stderr)}`);
    await sleep(esperaAcordar(tentativa));
    atual = await lerTela(host);
  }
  return atual.status;
}

/** Endereço do noVNC por um forward local e a partição do <webview> (o main é o dono das duas regras). Lança se a tela não está no ar (o painel só pede com ela rodando). */
export async function telaUrl(host: string): Promise<TelaEndereco> {
  const { status, webPort } = await lerTela(host);
  if (status.erro !== null) throw new Error(status.erro);
  if (!status.rodando || webPort === null) throw new Error("a tela desta máquina não está ligada");
  const porta = await ensureForwardExtra(host, webPort);
  return { url: urlNoVnc(porta), particao: particaoComputador(host) };
}
