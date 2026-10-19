/**
 * Recortes do Navegador: partes de um site que a pessoa pode ocultar para sobrar tela para o que interessa (no
 * Gmail com o Streak: o painel lateral da extensão, o menu Mail/Chat/Meet e a barra superior). Cada recorte é um
 * CSS injetado no webview (`insertCSS`), reaplicado a cada documento; a escolha fica em `localStorage`
 * (`navRecortes`), por recorte, valendo para todas as máquinas. Puro, sem DOM: o renderer aplica.
 */
export interface Recorte {
  id: string;
  /** Hosts onde o recorte existe (igualdade exata). */
  hosts: string[];
  titulo: string;
  /** Glifo do botão na barra. */
  icone: string;
  css: string;
  /** Oculto por padrão? */
  padrao: boolean;
  /** O site mede a tela por JS: depois de aplicar/tirar, dispara `resize` para ele recalcular. */
  resize?: boolean;
}

export const RECORTES: Recorte[] = [
  { id: "gmail-painel", hosts: ["mail.google.com"], titulo: "Painel lateral (pastas do Gmail / pipelines do Streak)", icone: "◧", css: ".bkL > .aqn{display:none!important}", padrao: true, resize: true },
  { id: "gmail-menu", hosts: ["mail.google.com"], titulo: "Menu lateral (Mail, Streak, Chat, Meet)", icone: "⋮", css: ".aeN.WR{display:none!important}", padrao: true, resize: true },
  { id: "gmail-topo", hosts: ["mail.google.com"], titulo: "Barra superior (logo, busca, conta)", icone: "⬒", css: "header#gb{display:none!important}", padrao: true, resize: true },
  // Gemini (painel do Workspace à direita): ocupa uma coluna inteira e espreme a planilha do Streak. Oculto por padrão.
  { id: "gmail-gemini", hosts: ["mail.google.com"], titulo: "Painel do Gemini", icone: "✦", css: '.aUx:has([aria-label="Gemini"]){display:none!important}', padrao: true, resize: true },
  // Painel lateral direito (Agenda, Keep, Tarefas, Contatos e complementos, inclusive o do Streak). Visível por padrão.
  { id: "gmail-lateral", hosts: ["mail.google.com"], titulo: "Painel lateral direito (Agenda, Keep, Tarefas, complementos)", icone: "◨", css: '.bAw:has([role="complementary"]),.WN9Ejb.br3{display:none!important}', padrao: false, resize: true },
];

export type RecortesPref = Record<string, boolean>;

export function recortesPara(url: string): Recorte[] {
  let host: string;
  try { host = new URL(url).hostname; } catch { return []; }
  return RECORTES.filter((r) => r.hosts.includes(host));
}

/** `true` = oculto. Sem escolha salva vale o padrão do recorte. */
export const recorteOculto = (pref: RecortesPref, r: Recorte): boolean => (typeof pref[r.id] === "boolean" ? pref[r.id]! : r.padrao);

export function parseRecortesPref(json: string | null): RecortesPref {
  if (json === null || json === "") return {};
  try {
    const v: unknown = JSON.parse(json);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: RecortesPref = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean" && RECORTES.some((r) => r.id === k)) out[k] = b;
    return out;
  } catch { return {}; }
}

export const recorteTitulo = (r: Recorte, oculto: boolean): string => `${oculto ? "Mostrar" : "Ocultar"}: ${r.titulo}`;
