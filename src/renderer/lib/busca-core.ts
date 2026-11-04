/**
 * Busca na página (Cmd+F) e folha de atalhos (Cmd+/), a parte pura: o que a barra escreve ao lado do campo e a
 * lista de atalhos que a folha mostra. Sem DOM: testável com node --test.
 */

/**
 * O contador ao lado do campo de busca. Enquanto o Chromium não respondeu, não se escreve "nenhum resultado":
 * seria mentira por um instante, e a frase piscaria em toda digitação.
 */
export function textoResultado(r: { atual: number; total: number } | null, texto: string): string {
  if (texto === "") return "";
  if (r === null) return "procurando…";
  if (r.total === 0) return "nenhum resultado";
  return `${r.atual} de ${r.total}`;
}

/** Um atalho da folha: as teclas já escritas como a pessoa as vê no Mac. */
export interface Atalho { teclas: string; o_que: string }
export interface GrupoAtalhos { titulo: string; atalhos: Atalho[] }

/**
 * A folha de atalhos (Cmd+/). É escrita à mão de propósito: o app registra atalhos em quatro lugares (menu do
 * aplicativo, o keydown da janela, o terminal e o Navegador) e nenhum deles sabe dos outros, então uma lista
 * "gerada" mentiria por omissão. O teste garante que não há tecla repetida dentro do mesmo grupo.
 */
export const ATALHOS: readonly GrupoAtalhos[] = [
  {
    titulo: "Em qualquer lugar",
    atalhos: [
      { teclas: "⌘K", o_que: "Paleta de comandos" },
      { teclas: "⌘F", o_que: "Localizar nesta página" },
      { teclas: "⌘/", o_que: "Esta folha de atalhos" },
      { teclas: "⌘,", o_que: "Configurações" },
      { teclas: "⌘B", o_que: "Recolher ou mostrar tudo: barra, atalhos e lista" },
      { teclas: "⌘⇧B", o_que: "Recolher ou mostrar só a barra de cima" },
      { teclas: "⌘⇧Espaço", o_que: "Entrada rápida, de dentro de qualquer app" },
    ],
  },
  {
    titulo: "Conversas e abas",
    atalhos: [
      { teclas: "⌘N", o_que: "Nova conversa" },
      { teclas: "⌘W", o_que: "Fechar a aba" },
      { teclas: "⌘\\", o_que: "Dividir a tela em duas" },
      { teclas: "⌘⇧N", o_que: "Nova janela em outra máquina" },
      { teclas: "⌘⇧W", o_que: "Fechar a janela" },
    ],
  },
  {
    titulo: "Terminal",
    atalhos: [
      { teclas: "⌘J", o_que: "Abrir o terminal desta máquina" },
      { teclas: "⌘⇧J", o_que: "Mais um terminal" },
      { teclas: "⌘F", o_que: "Buscar dentro do terminal (com ele em foco)" },
    ],
  },
  {
    titulo: "Navegador",
    atalhos: [
      { teclas: "⌘T", o_que: "Nova aba do Navegador" },
      { teclas: "⌘L", o_que: "Ir para o campo de endereço" },
      { teclas: "⌘⇧F", o_que: "Mostrar ou ocultar os favoritos" },
      { teclas: "⌘F", o_que: "Localizar na página aberta (com o Navegador em foco)" },
    ],
  },
  {
    titulo: "Zoom",
    atalhos: [
      { teclas: "⌘+", o_que: "Aumentar" },
      { teclas: "⌘−", o_que: "Diminuir" },
      { teclas: "⌘0", o_que: "Tamanho real" },
    ],
  },
];
