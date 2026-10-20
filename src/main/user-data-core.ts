/**
 * Parte pura da herança de dados entre produtos: um produto novo (meu-bot-crm, meu-bot-fit…) nasce como cópia do
 * meu-bot da mesma pessoa (tutoriais feitos, conversas, memória, favoritos, logins do Navegador), em vez de
 * vazio. Decide quando herdar e o que copiar. Testado.
 */

/** O que NÃO vale copiar: caches e logs do Electron, o backend local, travas de instância e o que é só do admin. */
const PULAR = [
  /^meu-bot\.log$/, /^backend-local(\.log)?$/, /^update$/, /^Singleton/, /^Crashpad$/, /^DevToolsActivePort$/,
  /Cache$/i, /^Code Cache$/, /^blob_storage$/, /^DIPS$/, /^Trust Tokens/, /^declarative_performance_observer\.db/,
  /^pessoas\.json$/, /^produtos\.json$/, /\.tmp$/,
];
export const entradaHerdavel = (nome: string): boolean => !PULAR.some((re) => re.test(nome));

/**
 * Herdar só numa pasta "nova": sem o carimbo e sem conversas de verdade (arquivo ausente, lista vazia, ou só a
 * conversa em branco que o app cria ao abrir). Com alguma mensagem já trocada, nunca sobrescreve.
 */
export function deveHerdar(carimboExiste: boolean, conversationsRaw: string | null): boolean {
  if (carimboExiste) return false;
  if (conversationsRaw === null) return true;
  try {
    const v: unknown = JSON.parse(conversationsRaw);
    const list = Array.isArray(v) ? v : v !== null && typeof v === "object" ? (v as { conversations?: unknown }).conversations : [];
    if (!Array.isArray(list)) return true;
    return !list.some((c) => c !== null && typeof c === "object" && Array.isArray((c as { messages?: unknown }).messages) && ((c as { messages: unknown[] }).messages).length > 0);
  } catch { return true; }
}
