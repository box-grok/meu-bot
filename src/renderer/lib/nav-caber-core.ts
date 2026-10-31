/**
 * "Caber na largura" do Navegador: sites de largura fixa (o Gmail web não encolhe abaixo de uns 800 px CSS) estouram
 * pela direita numa área estreita (janela em meia tela, modo dividido). Para esses hosts o Navegador mede a página
 * (scrollWidth × innerWidth) e reduz o zoom sozinho até ela caber; quando a área alarga, o zoom volta a crescer.
 * Um zoom escolhido pela pessoa (Cmd+= / Cmd+-) manda mais que o automático; Cmd+0 devolve ao automático.
 * Puro, testado; o renderer mede e aplica.
 */
export const NAV_ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
/** Hosts que ganham o ajuste automático (os outros ficam em 100% até a pessoa mexer no zoom). */
export const CABER_HOSTS: ReadonlySet<string> = new Set(["mail.google.com"]);
export const caberAuto = (host: string | null): boolean => host !== null && CABER_HOSTS.has(host);
/** Folga (px CSS) abaixo da qual a sobra não conta como estouro (barra de rolagem, arredondamento). */
export const FOLGA_PX = 4;
/** Medida absurda (a página ainda montando): acima disto a medida é ignorada, senão o zoom despencaria para sempre. */
export const ESTOURO_MAX = 3;

/**
 * Largura mínima do site em px CSS, atualizada por uma medida: `scrollWidth` maior que `innerWidth` é estouro e a
 * largura mínima passa a ser pelo menos essa; sem estouro a medida não diz nada e a anterior fica. Só cresce: a página
 * que coube numa medida não prova que caberia mais estreita.
 */
export function larguraMinima(anterior: number | null, scrollWidth: number, innerWidth: number): number | null {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(innerWidth) || innerWidth <= 0) return anterior;
  if (!(scrollWidth > innerWidth + FOLGA_PX) || scrollWidth > innerWidth * ESTOURO_MAX) return anterior;
  return Math.max(anterior ?? 0, Math.round(scrollWidth));
}

/** O maior degrau de zoom (até 100%) em que `minimoCss` cabe em `largura` px da área; sem mínimo conhecido, 100%. */
export function zoomParaCaber(largura: number, minimoCss: number | null, passos: readonly number[] = NAV_ZOOM_STEPS): number {
  if (minimoCss === null || minimoCss <= 0 || largura <= 0) return 1;
  const alvo = Math.min(1, largura / minimoCss);
  const cabem = passos.filter((p) => p <= alvo + 0.001);
  return cabem.length > 0 ? cabem[cabem.length - 1]! : passos[0]!;
}
