/**
 * Backend local órfão (sem electron: testável). A troca de versão saía por `app.exit` sem fechar o backend local, que
 * ficava vivo (adotado pelo launchd) segurando a porta; o app reaberto via "a porta já está em uso por outro programa"
 * e desistia. Quem está na porta é o nosso quando o comando do processo roda o server.js DESTA pasta (a do userData
 * desta variante): aí é seguro encerrá-lo e subir o novo. Qualquer outro programa na porta continua intocado.
 */
export function ehNossoOrfao(comando: string, serverJs: string): boolean {
  const c = comando.trim();
  if (c === "" || serverJs === "") return false;
  // O argumento tem de ser exatamente o caminho (fim do comando ou seguido de espaço): ".../server.js.bak" não conta.
  const i = c.indexOf(serverJs);
  if (i < 0) return false;
  const depois = c.slice(i + serverJs.length);
  return depois === "" || depois.startsWith(" ");
}

/** PIDs que o `lsof -t` devolveu (um por linha); ignora lixo e o próprio processo. */
export function pidsDoLsof(saida: string, proprio: number): number[] {
  return saida.split("\n").map((l) => Number.parseInt(l.trim(), 10)).filter((p) => Number.isInteger(p) && p > 1 && p !== proprio);
}
