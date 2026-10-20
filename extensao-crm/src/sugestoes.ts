/** Pessoas de uma conversa do Gmail que ainda não são contatos da caixa (puro; o Streak faz o mesmo na lateral). */
export interface Participante { email: string; nome: string }

const automatico = (e: string): boolean => /^(no-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?)([+.-]|@)/i.test(e);

/** Sem você mesmo, endereços automáticos, quem já está na caixa e repetidos; nome do remetente quando houver. */
export function sugestoesDaConversa(ps: Participante[], meuEmail: string, jaNaCaixa: string[]): Participante[] {
  const eu = meuEmail.trim().toLowerCase(); const ja = new Set(jaNaCaixa.map((e) => e.toLowerCase()));
  const out = new Map<string, Participante>();
  for (const p of ps) {
    const e = p.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e === eu || ja.has(e) || automatico(e)) continue;
    const prev = out.get(e); const nome = p.nome.trim();
    if (!prev) out.set(e, { email: e, nome }); else if (prev.nome === "" && nome !== "") prev.nome = nome;
  }
  return [...out.values()];
}

/**
 * O que a pessoa digitou no "Adicionar contato": "Manager Martins +55 (11) 98869-8139", "Ana ana@acme.com",
 * só o telefone, só o e-mail ou só o nome. Telefone = trecho com 8 a 15 dígitos (com +, espaços, (), - e .).
 */
export function separarContato(texto: string): { nome: string; email?: string; telefone?: string } {
  let resto = ` ${texto.trim()} `;
  const em = /\s<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?\s/.exec(resto); let email: string | undefined;
  if (em) { email = (em[1] as string).toLowerCase(); resto = resto.replace(em[0], " "); }
  let telefone: string | undefined;
  const tel = /(\+?\d[\d\s().-]{6,}\d)/.exec(resto);
  if (tel) { const d = (tel[1] as string).replace(/\D/g, ""); if (d.length >= 8 && d.length <= 15) { telefone = (tel[1] as string).trim(); resto = resto.replace(tel[1] as string, " "); } }
  const nome = resto.replace(/[·|,;-]+/g, " ").replace(/\s+/g, " ").trim();
  return { nome, ...(email ? { email } : {}), ...(telefone ? { telefone } : {}) };
}
