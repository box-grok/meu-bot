/**
 * Modo de depuração (31 out): o main conta à janela o que está acontecendo, para quem depura de fora (o agente da
 * máquina pelos sockets, o Claude Code pelo app-mcp, os hooks) ver na faixa do topo em vez de ler o log.
 * - `batimento`: tique de 1 s por broadcast. Uma chamada síncrona (safeStorage com o diálogo do Chaveiro na tela,
 *   spawn do ssh) prende o fio de JS do main e o tique para junto; a janela acusa "main sem responder há N s".
 * - `marcar`: a última coisa síncrona que o main anunciou antes de fazer; vai no tique (e num tique imediato), então
 *   já está na janela quando ele trava.
 * - `evento`: uma ação de fora (rota, dono, resultado). Sempre vai para o log; para a janela só com o modo ligado.
 * Ligado = `--depuracao` neste processo, senão o gravado nas configurações, senão o padrão da variante (staging).
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BatimentoDepuracao, EstadoDepuracao, EventoDepuracao } from "../../shared/ipc";
import { caps } from "./variant";
import { getDepuracaoGravado, updateSettings } from "./settings";
import type { broadcast as Broadcast } from "./windows";

/**
 * Quem manda para as janelas, injetado por `ligarDepuracao` (main.ts): importar windows.ts aqui fecharia um ciclo
 * (tunnel.ts → depuracao → windows → … → gmail-api → tunnel) e quebrava a subida. Antes de ligar, nada é enviado.
 */
let broadcast: typeof Broadcast = () => undefined;

const MAX_EVENTOS = 300;
const JANELA_MS = 15 * 60_000;
const eventos: EventoDepuracao[] = [];
let marca: string | null = null;
let marcaEm: number | null = null;
let tique: NodeJS.Timeout | null = null;

const forcado = (): boolean => app.commandLine.hasSwitch("depuracao");
/** No staging a faixa vem ligada: é o app de teste, e quem o usa está sempre conferindo alguma coisa. */
export const padraoDaVariante = (): boolean => caps().canal === "staging";
export function modoDepuracao(): boolean {
  if (forcado()) return true;
  return getDepuracaoGravado() ?? padraoDaVariante();
}
/** Mesmo arquivo do log do app; tag própria para filtrar. */
function logLinha(linha: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [depuracao] ${linha}\n`); } catch { /* sem log não se cai */ }
}
const batimento = (): BatimentoDepuracao => ({ em: Date.now(), marca, marcaEm });
function podar(): void {
  const limite = Date.now() - JANELA_MS;
  while (eventos.length > 0 && (eventos.length > MAX_EVENTOS || (eventos[0]?.em ?? 0) < limite)) eventos.shift();
}
export function estado(): EstadoDepuracao {
  podar();
  return { ligado: modoDepuracao(), gravado: getDepuracaoGravado(), padraoDaVariante: padraoDaVariante(), forcado: forcado(), eventos: [...eventos], batimento: batimento() };
}
/** Liga/desliga para todas as janelas (gravado nas configurações; null = volta ao padrão da variante). */
export function setDepuracao(v: boolean | null): EstadoDepuracao {
  updateSettings({ depuracao: v });
  logLinha(`modo ${modoDepuracao() ? "ligado" : "desligado"} (gravado: ${String(v)})`);
  const e = estado();
  broadcast("depuracao:estado", e);
  return e;
}
/** Anuncia a próxima chamada síncrona (Chaveiro, ssh): se o main travar nela, a faixa diz onde. */
export function marcar(texto: string): void {
  marca = texto; marcaEm = Date.now();
  if (modoDepuracao()) broadcast("depuracao:batimento", batimento());
}
/** Uma ação de fora: log sempre (resumo curto); janela só com o modo ligado. */
export function evento(e: Omit<EventoDepuracao, "em">): void {
  const ev: EventoDepuracao = { ...e, em: Date.now() };
  logLinha(`${ev.origem}${ev.dono !== null ? ` (${ev.dono})` : ""} ${ev.rota} ${ev.ok ? "ok" : "ERRO"}${ev.ms !== null ? ` ${ev.ms} ms` : ""}: ${ev.resumo.slice(0, 200)}`);
  if (!modoDepuracao()) return;
  eventos.push(ev); podar();
  broadcast("depuracao:evento", ev);
}
/** Sobe o tique; o main.ts chama uma vez, depois de abrir a primeira janela, passando o `broadcast` das janelas. */
export function ligarDepuracao(enviar: typeof Broadcast): void {
  broadcast = enviar;
  if (tique !== null) return;
  tique = setInterval(() => { if (modoDepuracao()) broadcast("depuracao:batimento", batimento()); }, 1000);
  logLinha(`modo ${modoDepuracao() ? "ligado" : "desligado"} na subida (variante ${caps().variant}, canal ${caps().canal}${forcado() ? ", --depuracao" : ""})`);
  // `--depuracao-travar=<ms>` (só com o modo ligado): prende o fio do main por esse tempo, 10 s depois de subir, para
  // conferir que a faixa acusa e volta. Nunca em produção: a flag só vale na linha de comando.
  const travar = Number(app.commandLine.getSwitchValue("depuracao-travar") || 0);
  if (modoDepuracao() && Number.isFinite(travar) && travar > 0) {
    setTimeout(() => {
      marcar(`teste: travar o main por ${travar} ms (--depuracao-travar)`);
      logLinha(`travando o main por ${travar} ms (--depuracao-travar)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(travar, 60_000));
      logLinha("main solto");
    }, 10_000);
  }
}
