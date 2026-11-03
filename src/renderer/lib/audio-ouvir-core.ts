/**
 * Linha "Ouvir áudios" do painel do WhatsApp: que estado mostrar, com que texto e qual ação. Puro, testado. Molde do
 * painel Computador (computador-core.ts): a máquina sem o necessário não vira erro técnico, vira "é com o admin".
 */
import type { WhatsappStatus } from "../../shared/ipc";

export type OuvirKind = "ativo" | "ligando" | "precisa-admin" | "ativar";
export interface EstadoOuvir {
  kind: OuvirKind;
  /** Linha em destaque (vazia no "ativo", que é só o ✓). */
  titulo: string;
  texto: string;
  /** Rótulo do botão (null = sem botão). */
  botao: string | null;
  acao: "ativar" | "conferir" | null;
}
type Entrada = Pick<WhatsappStatus, "audioIn" | "audioMaquina" | "audioLigando" | "audioErro">;

/** `ligandoAqui` = esta janela pediu agora; `precisaAdminAqui` = a última tentativa daqui saiu com código 3. */
export function estadoOuvir(st: Entrada | null, ligandoAqui = false, precisaAdminAqui = false): EstadoOuvir {
  if (st?.audioIn === true) return { kind: "ativo", titulo: "", texto: "✓ ativo: a transcrição roda na própria máquina", botao: null, acao: null };
  if (ligandoAqui || st?.audioLigando === true) return { kind: "ligando", titulo: "", texto: "Ligando a transcrição… (com o transcritor da máquina é rápido; sem ele, baixa ~500 MB na primeira vez)", botao: null, acao: null };
  if (precisaAdminAqui || st?.audioMaquina === false) return { kind: "precisa-admin", titulo: "A transcrição precisa do admin para ligar", texto: "Esta máquina não deixa instalar programas sem senha. O admin prepara a máquina uma vez (pelo app dele: Preparar máquina › Transcritor de áudio) e aí o agente passa a entender e responder áudios aqui, sozinho.", botao: "Conferir de novo", acao: "conferir" };
  const erro = st?.audioErro;
  return { kind: "ativar", titulo: "", texto: erro !== undefined && erro !== "" ? `A transcrição não ligou sozinha: ${erro}` : "O meu-bot liga a transcrição sozinho depois de parear; se não ligou, ative aqui.", botao: "Ativar transcrição", acao: "ativar" };
}
