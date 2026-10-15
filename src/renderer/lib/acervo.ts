/**
 * Acervo: a biblioteca de skills do meu-bot. Mesma dinâmica do WhatsApp: cada item descreve o que faz e,
 * ao clicar, o app abre uma conversa e manda ao agente da máquina (Claude Code em bypass) o pedido pronto
 * de instalação. O app não instala nada por SSH; quem executa é o agente, com o acesso que já tem.
 * Começo do conceito: a lista está vazia de propósito; as skills mais usadas entram aqui aos poucos.
 * Puro: testável com node --test.
 */
export interface Skill {
  /** Identificador estável (kebab-case), usado como chave na interface. */
  id: string;
  name: string;
  /** Uma frase: o que a skill faz para quem usa. */
  summary: string;
  /** Como instalar, em passos para o agente (comandos exatos quando houver). */
  install: string[];
  /** Como o agente confere que ficou instalada (comando ou arquivo esperado). */
  check: string;
}

/** As skills do acervo, na ordem em que aparecem. Vazio por enquanto. */
export const ACERVO_SKILLS: readonly Skill[] = [];

/** Pedido pronto ao agente da máquina: instalar a skill sem interação e relatar. */
export function installPrompt(skill: Skill, hostLabel: string): string {
  return [
    `Instale a skill "${skill.name}" nesta máquina (${hostLabel}), sem interação.`,
    `O que ela faz: ${skill.summary}`,
    "",
    "Passos (pule o que já estiver feito):",
    ...skill.install.map((step, i) => `${i + 1}. ${step}`),
    "",
    `Confira: ${skill.check}`,
    "No fim, resuma o que fez e o que ainda falta. Não instale nem atualize nada além do pedido.",
  ].join("\n");
}
