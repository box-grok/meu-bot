/**
 * Barra do Navegador em área estreita (janela em meia tela, modo dividido): as ações secundárias (favorito, pino, zoom,
 * WhatsApp do agente, recortes, extensões, abrir fora) somem atrás de um "⋯" e o campo de endereço volta a ter
 * largura, como num navegador. Puro, testado; o renderer mede a barra e aplica.
 */
/** Abaixo desta largura (px) a barra fica compacta: é mais ou menos o que a barra inteira ocupa sem apertar o endereço. */
export const NAV_BARRA_COMPACTA_PX = 720;
export const barraCompacta = (larguraPx: number): boolean => larguraPx > 0 && larguraPx < NAV_BARRA_COMPACTA_PX;
