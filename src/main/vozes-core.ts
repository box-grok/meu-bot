/**
 * Vozes das respostas em áudio do agente do WhatsApp (todas locais, grátis, sem o texto sair da máquina). Fonte
 * única do catálogo: o install-voz.sh conhece os mesmos ids; o renderer tem uma cópia mínima (id e rótulo) que o
 * teste confere contra esta.
 */
import type { VozId } from "../shared/ipc";

export interface Voz { id: VozId; rotulo: string; motor: "piper" | "kokoro"; download: string; padrao: boolean }
export const VOZES: readonly Voz[] = [
  { id: "faber", rotulo: "Masculina", motor: "piper", download: "~70 MB", padrao: true },
  { id: "dora", rotulo: "Feminina", motor: "kokoro", download: "~350 MB", padrao: false },
  { id: "alex", rotulo: "Masculina natural", motor: "kokoro", download: "~350 MB", padrao: false },
];
export const isVozId = (v: unknown): v is VozId => typeof v === "string" && VOZES.some((x) => x.id === v);
