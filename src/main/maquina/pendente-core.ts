/**
 * Uma operação por vez para um dono (o túnel de um host): quem chega enquanto ela roda recebe a mesma promessa.
 *
 * O jeito ingênuo, `dono.pending = (async () => { try { … } finally { dono.pending = undefined } })()`, falha quando a
 * função termina sem nenhum `await` (o caminho rápido do túnel já pronto): o `finally` roda antes da atribuição, e a
 * promessa já resolvida fica presa em `pending` para sempre. Daí em diante toda chamada recebe a porta local antiga,
 * mesmo depois de o forward morrer, e o túnel nunca mais é refeito (box-2, 6 nov: Mac dormiu, o forward caiu e o app
 * acusou "backend parado" por horas com o backend de pé). Aqui a vaga só é solta depois que a promessa assenta, e só
 * se ainda for a dela.
 */
export function pendenteUnico<T>(dono: { pending: Promise<T> | undefined }, fn: () => Promise<T>): Promise<T> {
  if (dono.pending !== undefined) return dono.pending;
  const p = fn();
  dono.pending = p;
  const soltar = (): void => { if (dono.pending === p) dono.pending = undefined; };
  p.then(soltar, soltar);
  return p;
}
