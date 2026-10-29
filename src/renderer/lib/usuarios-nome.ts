/**
 * Puro (testado): o nome sugerido ao criar um usuário na aba Usuários do admin. Os usuários criados ali são
 * box-<algo>; a sugestão é o próximo número da sequência (box-1 e box-2 existem → "3"). Nomes que não são
 * box-<número> não contam.
 */
export function proximoBox(nomes: readonly string[]): string {
  const nums = nomes.map((n) => /^box-(\d+)$/.exec(n)?.[1]).filter((d): d is string => d !== undefined).map(Number);
  return String(nums.length === 0 ? 1 : Math.max(...nums) + 1);
}
