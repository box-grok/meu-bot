/**
 * Clique numa notificação × seletor (parte pura). No macOS, clicar numa notificação "reabre" o app e dispara o evento
 * `activate`, que abre o seletor (é o que o clique no Dock deve fazer). O clique da notificação abre a janela da
 * máquina e foca a conversa, mas o seletor vinha por cima e roubava o foco: parecia que a notificação levava ao
 * seletor. A ordem dos dois eventos não é garantida, então a regra cobre as duas: por uma janela curta depois do
 * clique, o `activate` não abre o seletor; e se o seletor acabou de abrir nessa janela, ele é fechado.
 */
export const JANELA_NOTIFICACAO_MS = 1500;

/** Até quando o `activate` deve ser ignorado, a partir do clique na notificação. */
export const suprimirSeletorAte = (cliqueEm: number): number => cliqueEm + JANELA_NOTIFICACAO_MS;

/** O `activate` pode abrir o seletor agora? (false logo depois de um clique em notificação). */
export const seletorPodeAbrir = (suprimidoAte: number, agora: number): boolean => agora >= suprimidoAte;

/** O seletor que está aberto foi aberto agora há pouco (pelo `activate` da notificação, não pela pessoa)? */
export const seletorRecemAberto = (mostradoEm: number, agora: number): boolean => mostradoEm > 0 && agora - mostradoEm < JANELA_NOTIFICACAO_MS;
