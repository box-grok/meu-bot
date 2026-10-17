/**
 * Texto da faixa OFFLINE (como no Rambox). O objetivo é a pessoa saber que o problema é na conexão dela, não
 * no app: a frase começa por isso e diz o que não responde enquanto a internet não volta. Puro, testado.
 * `localAddr` = a máquina desta janela é este próprio Mac (colima): o túnel segue, o Claude não.
 */
export interface OfflineTextInput { localAddr: boolean; checking: boolean; since: number | null; checkedAt: number | null; manual: boolean; now: number }

const forHow = (since: number | null, now: number): string => {
  if (since === null) return "";
  const s = Math.max(0, Math.round((now - since) / 1000));
  if (s < 60) return "";
  if (s < 3600) return ` Sem internet há ${Math.round(s / 60)} min.`;
  return ` Sem internet há ${Math.round(s / 3600)} h.`;
};

export function offlineBarText(i: OfflineTextInput): string {
  if (i.checking) return "OFFLINE · verificando a conexão…";
  // "Verificar agora" acabou de confirmar que continua fora: dizer isso, em vez de repetir a frase sem mudança.
  if (i.manual && i.checkedAt !== null && i.now - i.checkedAt < 10_000) return `OFFLINE · ainda sem internet (verificado agora).${forHow(i.since, i.now)}`;
  const what = i.localAddr
    ? "A máquina local responde, mas o Claude não, até a conexão voltar."
    : "O problema é na sua conexão, não no app: a máquina e o Claude não respondem até ela voltar.";
  return `OFFLINE · Você está sem internet. ${what}${forHow(i.since, i.now)}`;
}
