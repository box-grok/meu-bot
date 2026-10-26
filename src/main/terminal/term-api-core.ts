/**
 * Terminal do app controlado de fora (parte pura, testada): o que sai do PTY vira texto legível para quem pede
 * (`/ler`), e o que entra é validado antes de ir ao shell (`/digitar`).
 */

/** Saída crua → texto: tira as sequências, aplica \r (a linha recomeça) e devolve as últimas `linhas`. */
export function textoDoTerminal(bytes: Uint8Array, linhas = 60): string {
  const cru = Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
  const semAnsi = cru.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "").replace(/\x1b[@-Z\\-_]/g, "");
  const out = semAnsi.split("\n").map((l) => {
    const partes = l.split("\r");
    return (partes.filter((p) => p !== "").pop() ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trimEnd();
  });
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.slice(-Math.max(1, Math.min(linhas, 2000))).join("\n");
}

/** Teclas especiais aceitas em `/digitar {tecla}`. */
export const TECLAS: Readonly<Record<string, string>> = {
  enter: "\r", tab: "\t", esc: "\x1b", backspace: "\x7f", "ctrl+c": "\x03", "ctrl+d": "\x04", "ctrl+z": "\x1a", "ctrl+l": "\x0c",
  cima: "\x1b[A", baixo: "\x1b[B", direita: "\x1b[C", esquerda: "\x1b[D",
};
export const MAX_ENTRADA = 4000;

/** Pedido de `/digitar` → bytes para o PTY (ou o motivo da recusa). */
export function entradaDigitar(b: { texto?: unknown; enter?: unknown; tecla?: unknown }): { dados: string } | { erro: string } {
  if (typeof b.tecla === "string") {
    const t = TECLAS[b.tecla.toLowerCase()];
    return t === undefined ? { erro: `tecla desconhecida: use ${Object.keys(TECLAS).join(", ")}` } : { dados: t };
  }
  if (typeof b.texto !== "string" || b.texto === "") return { erro: "falta texto (ou tecla)" };
  if (b.texto.length > MAX_ENTRADA) return { erro: `texto acima de ${MAX_ENTRADA} caracteres` };
  // Só texto: controles e ESC não entram por aqui (teclas especiais vão por `tecla`); \n vira Enter como no teclado.
  const limpo = b.texto.replace(/\r\n?|\n/g, "\r").replace(/[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f]/g, "");
  if (limpo === "") return { erro: "texto só com caracteres de controle" };
  return { dados: limpo + (b.enter === true ? "\r" : "") };
}
