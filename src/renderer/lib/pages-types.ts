/** Uma "página" da janela principal (Acervo, Tutoriais, Suporte do admin): painel com aba própria, fora das conversas. */
export interface PageTab {
  id: string;
  title: string;
  panel: HTMLElement;
  render: () => void;
  tabEl: HTMLElement | null;
}
