/**
 * Configurações › Controle remoto (MCP): a seção que liga o servidor MCP do app para um cliente deste Mac (Claude
 * Code, Cursor). Molde do Remote Control do Rambox: tudo vale na hora (sem Salvar); ligar gera o token, desligar
 * apaga; regenerar e trocar a porta reiniciam o servidor. A visão vem do main (ControleRemotoView) e chega também
 * por `controle-remoto:changed` quando outra janela mexe.
 */
import type { ControleRemotoView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

const ligadoInput = $<HTMLInputElement>("mcp-ligado");
const statusEl = $<HTMLElement>("mcp-status");
const sumEl = $<HTMLElement>("mcp-sum");
const tokenInput = $<HTMLInputElement>("mcp-token");
const mostrarBtn = $<HTMLButtonElement>("mcp-mostrar");
const copiarTokenBtn = $<HTMLButtonElement>("mcp-copiar-token");
const regenerarBtn = $<HTMLButtonElement>("mcp-regenerar");
const portaInput = $<HTMLInputElement>("mcp-porta");
const portaHint = $<HTMLElement>("mcp-porta-hint");
const copiarClaudeBtn = $<HTMLButtonElement>("mcp-copiar-claude");
const copiarCursorBtn = $<HTMLButtonElement>("mcp-copiar-cursor");
const avisoEl = $<HTMLElement>("mcp-aviso");

let view: ControleRemotoView | null = null;
let mostrando = false;
let avisoTimer: ReturnType<typeof setTimeout> | null = null;

/** Token sem expor tudo: só o fim (o "Mostrar" revela). */
export const tokenMascarado = (token: string): string => (token === "" ? "" : `${"•".repeat(12)}${token.slice(-6)}`);

function pintar(v: ControleRemotoView): void {
  view = v;
  ligadoInput.checked = v.ligado;
  const comToken = v.token !== "";
  tokenInput.value = comToken ? (mostrando ? v.token : tokenMascarado(v.token)) : "";
  mostrarBtn.textContent = mostrando ? "Ocultar" : "Mostrar";
  for (const b of [mostrarBtn, copiarTokenBtn, regenerarBtn, copiarClaudeBtn, copiarCursorBtn]) b.disabled = !comToken;
  if (document.activeElement !== portaInput) portaInput.value = String(v.porta);
  portaHint.textContent = v.porta === v.portaPadrao ? `padrão deste app: ${v.portaPadrao}` : `padrão deste app: ${v.portaPadrao} (em uso: ${v.porta})`;
  portaHint.className = "hint";
  if (!v.ligado) { statusEl.textContent = "Desligado."; statusEl.className = "hint"; sumEl.textContent = "deixe o Claude Code ou o Cursor controlarem este app"; }
  else if (v.rodando) { statusEl.textContent = `Ligado em ${v.url} (servidor ${v.nome}).`; statusEl.className = "hint ok"; sumEl.textContent = `ligado em ${v.url}`; }
  else { statusEl.textContent = `Ligado, mas o servidor não subiu: ${v.erro ?? "motivo desconhecido"}.`; statusEl.className = "hint bad"; sumEl.textContent = "ligado, mas sem subir"; }
}
function avisar(texto: string, ok = true): void {
  avisoEl.textContent = texto; avisoEl.className = `hint ${ok ? "ok" : "bad"}`; avisoEl.hidden = false;
  if (avisoTimer !== null) clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { avisoEl.hidden = true; }, 6000);
}
async function agir(fn: () => Promise<ControleRemotoView>, depois?: string): Promise<void> {
  try { pintar(await fn()); if (depois !== undefined) avisar(depois); }
  catch (err) { if (view !== null) pintar(view); avisar(ipcErrorText(err), false); }
}
function copiar(texto: string, oQue: string): void {
  void navigator.clipboard.writeText(texto).then(() => avisar(`${oQue} copiado. Cole e reconecte o cliente.`), () => avisar("Não consegui copiar.", false));
}

/** Ao abrir as Configurações: lê o estado atual (o main é a fonte da verdade). */
export function carregarControleRemoto(): void {
  void window.meuBot.controleRemotoStatus().then(pintar).catch((err: unknown) => { statusEl.textContent = `Não consegui ler: ${ipcErrorText(err)}`; statusEl.className = "hint bad"; });
}

/** Liga eventos uma vez; o renderer chama junto das outras partes das Configurações. */
export function ligarControleRemoto(): void {
  ligadoInput.addEventListener("change", () => { const ligar = ligadoInput.checked; void agir(() => window.meuBot.controleRemotoLigar(ligar), ligar ? "Controle remoto ativado. Copie a configuração para o seu cliente." : "Controle remoto desativado; o token foi apagado."); });
  mostrarBtn.addEventListener("click", () => { mostrando = !mostrando; if (view !== null) pintar(view); });
  copiarTokenBtn.addEventListener("click", () => { if (view !== null && view.token !== "") copiar(view.token, "Token"); });
  regenerarBtn.addEventListener("click", () => { void agir(() => window.meuBot.controleRemotoRegenerar(), "Token regenerado. Reconecte o cliente MCP com o novo token."); });
  const aplicarPorta = (): void => {
    const porta = Number(portaInput.value);
    if (view !== null && porta === view.porta) return;
    if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) { portaHint.textContent = "use um número de 1024 a 65535"; portaHint.className = "hint bad"; return; }
    void agir(() => window.meuBot.controleRemotoPorta(porta), `Porta ${porta} aplicada; reconecte o cliente com a configuração nova.`);
  };
  portaInput.addEventListener("change", aplicarPorta);
  portaInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); aplicarPorta(); } });
  copiarClaudeBtn.addEventListener("click", () => { if (view !== null && view.configClaudeCode !== "") copiar(view.configClaudeCode, "Comando do Claude Code"); });
  copiarCursorBtn.addEventListener("click", () => { if (view !== null && view.configCursor !== "") copiar(view.configCursor, "Trecho do mcp.json do Cursor"); });
  window.meuBot.on("controle-remoto:changed", pintar);
}
