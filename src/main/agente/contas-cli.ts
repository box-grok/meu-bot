/**
 * Contas de CLI na máquina da janela (tutorial 13): roda o login por SSH, manda o link (e o código, quando há) para a
 * janela abrir no Navegador do app e espera a ferramenta terminar. O retorno do Cloudflare para o localhost da
 * máquina é entregue pelo Navegador (`retornoParaMaquina`, browser.ts). As regras de cada ferramenta: contas-cli-core.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { ContaEvento } from "../../shared/ipc";
import { log } from "../maquina/backend";
import { sairDoSite } from "../navegador/browser";
import { comandoEntrar, comandoSair, comandoSairDoGithub, GITHUB_OUTRA_CONTA, INSTALAR_GH_SH, lerLink, SAIR_DO_SITE, lerStatus, loginConcluiu, NOME_CONTA, STATUS_SH, type ContaEstado, type ContaId } from "./contas-cli-core";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];
// npx (wrangler) pode estar só no node do backend (~/.local/node/bin) ou em /opt/node.
const REMOTE_PATH = "export PATH=$HOME/.local/bin:$HOME/bin:$HOME/.local/node/bin:/opt/node/bin:/usr/local/bin:$PATH";

let atual: { host: string; id: ContaId; child: ChildProcess } | null = null;

function ssh(host: string, cmd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, `${REMOTE_PATH}; ${cmd}`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: null, out }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const remota = (host: string): boolean => host !== LOCAL_HOST && isValidHost(host);

/** null = máquina fora do alcance (ou este Mac). Conta que não respondeu fica de fora da lista. */
export async function contasStatus(host: string): Promise<ContaEstado[] | null> {
  if (!remota(host)) return null;
  const r = await ssh(host, STATUS_SH, 90_000);
  const lista = lerStatus(r.out);
  return lista.length === 0 ? null : lista;
}

/**
 * `navegador`: a janela abre o link no Navegador do app (senão Cloudflare vai por código, como o GitHub). `trocar`:
 * entrar com outra conta (a página não pode cair direto na conta que já está logada no Navegador).
 */
export async function entrarConta(host: string, id: ContaId, navegador: boolean, trocar: boolean, send: (ev: ContaEvento) => void): Promise<void> {
  const nome = NOME_CONTA[id];
  if (!remota(host)) { send({ kind: "done", id, ok: false, text: "só numa máquina por SSH" }); return Promise.resolve(); }
  if (atual !== null) { send({ kind: "done", id, ok: false, text: `já há um login (${NOME_CONTA[atual.id]}) em andamento` }); return Promise.resolve(); }
  const { cmd, tty } = comandoEntrar(id, navegador);
  // GitHub guarda várias contas: a de antes sai quando outra entra (uma conta por máquina, sem dúvida de qual vale).
  const antes = id === "github" ? (await contasStatus(host))?.find((c) => c.id === id)?.conta ?? null : null;
  const dominio = SAIR_DO_SITE[id];
  if (trocar && navegador && dominio !== null) {
    const n = await sairDoSite(host, dominio);
    log(`[contas] ${host}: trocar ${id}: ${n} cookies de ${dominio} saíram do Navegador`);
  }
  return new Promise((resolve) => {
    // Com `-tt` o stdin fica aberto (o pty precisa dele) e é fechado quando o processo termina ou a pessoa cancela.
    const child = spawn("ssh", [...(tty ? ["-tt"] : []), ...SSH_OPTS, "--", host, `${REMOTE_PATH}; ${cmd}`], { stdio: [tty ? "pipe" : "ignore", "pipe", "pipe"] });
    child.stdin?.on("error", () => { /* pty fechou */ });
    atual = { host, id, child };
    let saida = ""; let enviado = false;
    send({ kind: "log", id, text: `pedindo o login do ${nome} na máquina…` });
    const onData = (d: Buffer): void => {
      saida = (saida + d.toString("utf8")).slice(-20_000);
      if (enviado) return;
      const { url, codigo } = lerLink(id, saida);
      if (url !== null) { enviado = true; send({ kind: "url", id, url: trocar && id === "github" ? GITHUB_OUTRA_CONTA : url, codigo }); }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => { send({ kind: "log", id, text: "tempo esgotado (10 min)" }); child.kill("SIGTERM"); }, 600_000);
    child.on("error", (e) => { send({ kind: "done", id, ok: false, text: `não consegui iniciar: ${e.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      atual = null;
      try { child.stdin?.end(); } catch { /* ok */ }
      void (async () => {
        const disse = loginConcluiu(id, saida);
        let st = (await contasStatus(host))?.find((c) => c.id === id) ?? null;
        const sairCmd = antes !== null && st?.conectado === true && st.conta !== antes ? comandoSairDoGithub(antes) : null;
        if (sairCmd !== null) {
          await ssh(host, sairCmd, 60_000);
          log(`[contas] ${host}: GitHub ${antes} saiu (entrou ${st?.conta ?? "?"})`);
          st = (await contasStatus(host))?.find((c) => c.id === id) ?? st;
        }
        const ok = st?.conectado === true;
        log(`[contas] ${host}: login ${id} saiu com ${code}; concluiu=${disse} conectado=${ok}`);
        const falha = !enviado && /command not found|not found/i.test(saida) ? `o ${nome} não está instalado nesta máquina` : `o login do ${nome} não concluiu`;
        send({ kind: "done", id, ok, text: ok ? `${nome} conectado nesta máquina${st?.conta !== null && st?.conta !== undefined ? ` (${st.conta})` : ""}.` : falha, estado: st });
        resolve();
      })();
    });
  });
}

export function cancelarConta(): void {
  if (atual === null) return;
  try { atual.child.kill("SIGTERM"); } catch { /* ok */ }
}

/** Botão "Instalar o GitHub CLI" (tutorial 13): instala o gh na máquina e devolve o estado novo das contas. */
export async function instalarGh(host: string): Promise<ContaEstado[] | null> {
  if (!remota(host)) throw new Error("só numa máquina por SSH");
  const r = await ssh(host, INSTALAR_GH_SH, 300_000);
  const ultima = r.out.trim().split("\n").at(-1) ?? "";
  if (r.code !== 0) throw new Error(ultima !== "" ? ultima : "a instalação do gh não terminou");
  log(`[contas] ${host}: gh instalado (${ultima})`);
  return contasStatus(host);
}

export async function sairConta(host: string, id: ContaId): Promise<ContaEstado[] | null> {
  if (!remota(host)) return null;
  await ssh(host, comandoSair(id), 60_000);
  log(`[contas] ${host}: saiu do ${id}`);
  return contasStatus(host);
}
