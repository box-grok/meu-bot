/** Regras puras do terminal (testáveis em Node): o que o botão "Rodar no terminal" digita e o tema do xterm. */

/** Linguagens de bloco de código que viram "Rodar no terminal". */
export const SHELL_LANGS = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);
export const isShellLang = (lang: string): boolean => SHELL_LANGS.has(lang.trim().toLowerCase());

/**
 * Texto que vai para o shell quando a pessoa clica em "Rodar no terminal": o comando sem o Enter final,
 * embrulhado em bracketed paste (ESC[200~ … ESC[201~) para o shell tratar várias linhas como um colado
 * só e esperar o Enter da pessoa. Em blocos `console`, tira o prompt (`$ `, `# `, `% `) e descarta as
 * linhas de saída (as sem prompt), quando há pelo menos uma linha com prompt.
 */
export function shellBlockToPaste(code: string, lang: string): string {
  let lines = code.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lang.trim().toLowerCase() === "console" || lines.some((l) => /^\s*[$#%] /.test(l))) {
    const prompted = lines.filter((l) => /^\s*[$#%] /.test(l));
    if (prompted.length > 0) lines = prompted.map((l) => l.replace(/^\s*[$#%] /, ""));
  }
  return `\u001b[200~${lines.join("\n")}\u001b[201~`;
}

export interface TermThemeVars { bg: string; fg: string; muted: string; accent: string; dark: boolean }
/** Tema do xterm a partir das variáveis do app (claro/escuro): fundo e texto do app, ANSI padrão legível. */
export function xtermTheme(v: TermThemeVars): Record<string, string> {
  return v.dark
    ? { background: v.bg, foreground: v.fg, cursor: v.accent, cursorAccent: v.bg, selectionBackground: "rgba(108,156,255,.35)",
      black: "#1a1d23", red: "#ff6b6b", green: "#4ccb7f", yellow: "#f0b24a", blue: "#6c9cff", magenta: "#c792ea", cyan: "#5fd7d7", white: "#e8eaed",
      brightBlack: "#6a737d", brightRed: "#ff8a8a", brightGreen: "#7ee2a1", brightYellow: "#f6c86f", brightBlue: "#8fb3ff", brightMagenta: "#d7adf5", brightCyan: "#8ae8e8", brightWhite: "#ffffff" }
    : { background: v.bg, foreground: v.fg, cursor: v.accent, cursorAccent: v.bg, selectionBackground: "rgba(47,111,237,.25)",
      black: "#1c1f23", red: "#c62828", green: "#1f8a4c", yellow: "#b26a00", blue: "#2f6fed", magenta: "#8e44ad", cyan: "#0b7285", white: "#dfe3e8",
      brightBlack: "#6a737d", brightRed: "#e05252", brightGreen: "#2eaa64", brightYellow: "#d18a1a", brightBlue: "#4d86f5", brightMagenta: "#a66bbe", brightCyan: "#1a9aae", brightWhite: "#ffffff" };
}
