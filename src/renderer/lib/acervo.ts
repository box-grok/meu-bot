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
  /**
   * Skill que já vem com o meu-bot (instalada sozinha na máquina): o cartão é para USAR. Pedido pronto ao agente e o
   * texto do botão; sem isto, o cartão pede para instalar.
   */
  usar?: { botao: string; pedido: string };
}

/** As skills do acervo, na ordem em que aparecem. */
export const ACERVO_SKILLS: readonly Skill[] = [
  {
    id: "cloudflare-token",
    name: "Token do Cloudflare (só leitura)",
    summary: "O agente cria pelo Navegador um token do Cloudflare que só lê o DNS de um domínio, guarda na máquina sem o valor passar pela conversa e testa. Ele para antes de criar para você conferir.",
    install: ["A skill vem com o Navegador do meu-bot: confira ~/.claude/skills/cloudflare-token/SKILL.md. Se faltar, peça ao dono para abrir a aba Navegador no app (ela é instalada junto)."],
    check: "test -f ~/.claude/skills/cloudflare-token/SKILL.md",
    usar: {
      botao: "Criar o token",
      pedido: "Use a skill cloudflare-token: crie um token do Cloudflare só de leitura (DNS e zona) para o meu domínio. Se não souber qual domínio, me pergunte. Pare antes do \"Create Token\" para eu conferir o resumo, e nunca mostre o valor do token.",
    },
  },
  {
    id: "subir-site-cloudflare",
    name: "Site num subdomínio (Cloudflare)",
    summary: "O agente publica uma página no seu domínio, como teste.seudominio.com, pelo Cloudflare Pages: cria o site, liga o subdomínio e testa o HTTPS. Nunca mexe em registros que já existem.",
    install: ["A skill vem com o Navegador do meu-bot: confira ~/.claude/skills/subir-site-cloudflare/SKILL.md. Se faltar, peça ao dono para abrir a aba Navegador no app (ela é instalada junto)."],
    check: "test -f ~/.claude/skills/subir-site-cloudflare/SKILL.md",
    usar: {
      botao: "Subir um site",
      pedido: "Use a skill subir-site-cloudflare: quero publicar uma página num subdomínio do meu domínio. Me pergunte o nome do subdomínio e o que a página deve ter, se eu não disse. Se o token de edição do Cloudflare ainda não existir, pare no resumo antes de criar para eu conferir, e nunca mostre o valor dele.",
    },
  },
];

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
