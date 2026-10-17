/**
 * Tutoriais: guias ao vivo do meu-bot, numa aba própria (como o Acervo). Cada um é um cartão com selo
 * ("COMECE POR AQUI · 4 PASSOS · 3 MIN"), título, resumo e "Começar". Ao começar, o cartão vira um guia no
 * estilo do onboarding: cada passo é uma ação da pessoa, o botão certo pulsa, e o passo se marca concluído
 * sozinho pelo estado real da máquina (QR já lido = concluído). Puro: as regras ficam aqui, testáveis.
 */
import type { FreedomLevel, ObjectiveInfo, StatusLineSegments, SupportInfo, WhatsappStatus } from "../../shared/ipc";

/**
 * O que mais o guia sabe além do WhatsApp: o suporte nesta máquina (null = ainda não consultado), a status
 * line do Claude (instalada? null = não consultado; `limits` = a conta já mostra Sessão/Semanal) e a conta do
 * Claude Code (`loggedIn` null = não consultado; `firstReply` = alguma conversa desta máquina já teve resposta).
 */
export interface GuideContext {
  support: SupportInfo | null;
  statusLine: { installed: boolean | null; limits: boolean; segments: StatusLineSegments | null };
  claude: { loggedIn: boolean | null; email: string | null; firstReply: boolean };
  /**
   * Grok pelo Hermes da máquina: `possible` = janela de máquina por SSH com o backend do meu-bot (false esconde o
   * tutorial 4); `hermes` = o Hermes está instalado; `loggedIn` = conta da xAI; `label` = rótulo da credencial.
   */
  xai: { possible: boolean | null; hermes: boolean | null; loggedIn: boolean | null; label: string | null };
  /**
   * Fallback entre contas: `primary` = modelo padrão desta máquina (quem responde sempre); `chain` = a corrente de
   * provedores que o backend informa (null = ainda não consultado), com quem está disponível.
   */
  fallback: { primary: string | null; chain: readonly FallbackProvider[] | null };
  /** Tutorial 7: objetivo e nível gravados na máquina e a skill salva (null = ainda não consultado). */
  objective: ObjectiveInfo | null;
}
export interface FallbackProvider { name: string; available: boolean }
export const emptyContext = (): GuideContext => ({
  support: null,
  statusLine: { installed: null, limits: false, segments: null },
  claude: { loggedIn: null, email: null, firstReply: false },
  xai: { possible: null, hermes: null, loggedIn: null, label: null },
  fallback: { primary: null, chain: null },
  objective: null,
});

/** Modelos que entram na corrente de fallback (os outros respondem sozinhos, sem reserva). */
export const FALLBACK_PRIMARIES: readonly string[] = ["agente", "grok-4"];
/** A reserva de um primário: quem mais está disponível na corrente, em ordem (vazio = sem reserva). */
export const fallbackReserve = (primary: string, chain: readonly FallbackProvider[]): string[] => chain.filter((p) => p.available && p.name !== primary).map((p) => p.name);
/** A linha "Primário: … Reserva: …" das Configurações e do tutorial 5, a partir do que o backend informa. */
export function fallbackOrderText(primary: string, chain: readonly FallbackProvider[] | null): string {
  if (chain === null || chain.length === 0) return "O backend desta máquina ainda não informa a corrente de provedores.";
  if (!chain.some((p) => p.name === primary)) return `${primary} fica fora da corrente: sem reserva. Com agente ou grok-4 como primário a reserva é automática.`;
  const reserve = fallbackReserve(primary, chain);
  return reserve.length === 0 ? `Primário: ${primary}. Sem reserva disponível nesta máquina.` : `Primário: ${primary}. Reserva: ${reserve.join(" → ")}, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.`;
}

/** Onde o guia aponta: o botão que deve pulsar enquanto o passo está pendente. */
/** `chat` leva à conversa do meu-bot (passo que se conclui vendo algo no rodapé). */
export type GuideTarget = "wa-line" | "wa-agent" | "wa-pair" | "wa-policy" | "chat" | "none";

/** Quem o agente responde, como o guia e o modal oferecem (os mesmos dois cartões). */
export interface ReplyOption { id: "self" | "open"; title: string; text: string; isDefault: boolean }
export const REPLY_OPTIONS: readonly ReplyOption[] = [
  { id: "self", title: "Desativado: só eu falo com o agente", text: "O agente só responde mensagens que você manda para si mesmo. Ninguém mais recebe resposta nem código de pareamento.", isDefault: true },
  { id: "open", title: "Responder todo mundo", text: "Logo depois do pareamento, o agente responde qualquer pessoa que mandar mensagem para este número.", isDefault: false },
];
export const REPLY_NOTE = "Para atender clientes, as respostas precisam estar ativas. Você pode testar só com você agora e ativar depois no canal WhatsApp.";
/** A política gravada no OpenClaw → qual cartão está marcado (null = nenhum dos dois: pairing ou disabled). */
export function replyChoiceOf(dmPolicy: WhatsappStatus["dmPolicy"]): "self" | "open" | null {
  return dmPolicy === "allowlist" ? "self" : dmPolicy === "open" ? "open" : null;
}

/** O que a pessoa marcou à mão (o app não tem como ver uma mensagem de teste chegar). */
export interface GuideFlags { policyChosen: boolean; tested: boolean; statusTested: boolean; claudeSeen: boolean; grokReplied: boolean; fallbackChosen: boolean; fallbackSeen: boolean; number: string | null }
export const emptyFlags = (): GuideFlags => ({ policyChosen: false, tested: false, statusTested: false, claudeSeen: false, grokReplied: false, fallbackChosen: false, fallbackSeen: false, number: null });
/**
 * Marcações que um passo pode pedir ("Testei, funcionou") ou que o app grava sozinho (`grokReplied`: resposta com
 * X-Provider grok-4; `fallbackChosen`: a pessoa escolheu o primário; `fallbackSeen`: uma resposta veio da reserva).
 */
export type GuideFlagName = "policyChosen" | "tested" | "statusTested" | "claudeSeen" | "grokReplied" | "fallbackChosen" | "fallbackSeen";

export interface GuideStep {
  id: string;
  title: string;
  /** Instrução curta de uma ação. */
  text: string;
  target: GuideTarget;
  /** Corpo especial do passo no guia: cartões de quem responder, áudio, suporte ou a status line. */
  body?: "reply-choice" | "audio" | "support-name" | "support-switch" | "support-delivery" | "statusline-install" | "statusline-segments" | "statusline-test" | "claude-login" | "xai-prepare" | "xai-login" | "fallback-order" | "objective-choice" | "objective-level" | "objective-skill";
  /** Concluído pelo estado real; `null` de status = ainda não consultado. */
  done: (status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext) => boolean;
  /** Passo que a pessoa conclui com um botão no próprio cartão ("Testei, funcionou"). */
  manual?: { label: string; flag: GuideFlagName };
}

export interface Tutorial {
  /** Identificador estável (kebab-case). */
  id: string;
  /** Número fixo do tutorial ("tutorial 3" é o mesmo no app da pessoa, no admin e no GUIA), na ordem da trilha. */
  number: number;
  title: string;
  /** Nome curto para a aba do guia ("WhatsApp"). */
  short: string;
  /** Uma frase: o que a pessoa vai conseguir fazer. */
  summary: string;
  /** Tempo estimado, em minutos. */
  minutes: number;
  /** Selo em caixa alta antes dos passos ("Comece por aqui", "Próximo"); opcional. */
  badge?: string;
  /** Ícone do cartão. */
  icon?: "target" | "chat";
  /** Ainda não existe: o cartão aparece com "Em breve" e não abre guia. */
  comingSoon?: boolean;
  /** Só aparece quando o meu-bot veio com o pacote de suporte (e a janela é de máquina por SSH). */
  needsSupport?: true;
  /** Só aparece onde o Grok é possível (máquina por SSH com o backend do meu-bot); some neste Mac. */
  needsXai?: true;
  /** Trilha em ordem: só aparece depois que este tutorial (id) foi concluído. */
  after?: string;
  /** "Refazer do zero" (tutorial concluído): o que é desfeito na máquina antes de voltar ao passo 1. */
  reset?: { what: string };
  steps: GuideStep[];
}

const WHATSAPP_STEPS: GuideStep[] = [
  {
    id: "preparar", title: "Preparar o OpenClaw nesta máquina", target: "wa-agent",
    text: "O agente da máquina configura o OpenClaw e instala o plugin do WhatsApp. Abra o WhatsApp e clique em \"Pedir ao agente para preparar\".",
    done: (st) => st !== null && st.present && st.ready,
  },
  {
    id: "qr", title: "Conectar o número pelo QR", target: "wa-pair",
    text: "No celular do número: WhatsApp › Aparelhos conectados › Conectar aparelho › aponte para o QR. O app mostra o ✓ verde ao vincular.",
    done: (st) => st !== null && st.connected,
  },
  {
    id: "quem", title: "Quem o agente responde no WhatsApp?", target: "wa-policy", body: "reply-choice",
    text: "Vale assim que o WhatsApp é pareado. Seus contatos não recebem nenhuma mensagem automática enquanto as respostas estiverem desativadas.",
    done: (st, f) => f.policyChosen || (st !== null && st.dmPolicy === "open"),
  },
  {
    id: "audio", title: "Fazer o agente entender áudios", target: "none", body: "audio",
    text: "Sem isso, quem manda áudio ouve do agente que ele não consegue escutar. A transcrição roda na própria máquina: sem custo e sem mandar o áudio para fora. Se quiser, escolha também quando ele responde em áudio.",
    done: (st) => st !== null && st.audioIn === true,
  },
  {
    id: "teste", title: "Testar com uma mensagem e um áudio", target: "none",
    text: "Com \"só eu\", mande para o seu próprio número; com \"todo mundo\", mande de outro celular. Mande um texto e depois um áudio curto: o agente deve responder sobre o que você falou.",
    done: (_st, f) => f.tested,
    manual: { label: "Testei, funcionou", flag: "tested" },
  },
];

/** Os tutoriais, na ordem em que aparecem (e dos números). */
export const TUTORIAIS: readonly Tutorial[] = [
  {
    id: "claude-login",
    number: 1,
    title: "Entrar no Claude Code",
    short: "Claude",
    summary: "O agente desta máquina responde pela sua conta do Claude. Entre nela, confira quem está logado e receba a primeira resposta.",
    minutes: 2,
    icon: "chat",
    reset: { what: "sai da conta do Claude Code nesta máquina (o agente para de responder até entrar de novo)" },
    steps: [
      {
        id: "entrar", title: "Entrar na conta do Claude", target: "none", body: "claude-login",
        text: "Clique em Entrar: o link de autorização abre no navegador, você entra na conta e cola aqui o código que a página mostra. Leva um minuto.",
        done: (_st, _f, c) => c.claude.loggedIn === true,
      },
      {
        id: "conferir", title: "Conferir quem está logado", target: "none",
        text: "Na lateral, a linha \"Claude Code\" passa a mostrar o e-mail da conta. É essa conta que paga as respostas do agente nesta máquina.",
        done: (_st, f, c) => c.claude.loggedIn === true && (c.claude.email !== null || f.claudeSeen),
        manual: { label: "Vi minha conta", flag: "claudeSeen" },
      },
      {
        id: "resposta", title: "Primeira resposta do agente", target: "chat",
        text: "Vá para a conversa e mande uma mensagem: a resposta vem da sua conta do Claude, nesta máquina.",
        done: (_st, _f, c) => c.claude.loggedIn === true && c.claude.firstReply,
      },
    ],
  },
  {
    id: "whatsapp-openclaw",
    number: 2,
    title: "Conectar o WhatsApp ao agente",
    short: "WhatsApp",
    summary: "Conecte um número ao agente da máquina, decida quem ele responde, faça ele entender áudios e teste de verdade.",
    minutes: 4,
    icon: "target",
    reset: { what: "desconecta o número desta máquina (o agente para de responder no WhatsApp) e esquece \"escolhi\" e \"testei\"" },
    steps: WHATSAPP_STEPS,
  },
  {
    id: "statusline",
    number: 3,
    after: "claude-login",
    title: "Status line do Claude",
    short: "Status line",
    summary: "Veja no rodapé de cada conversa quanto da sua sessão e da sua semana do Claude você já usou, e escolha o que aparece.",
    minutes: 3,
    icon: "target",
    reset: { what: "desinstala a status line desta máquina (o settings.json anterior volta) e apaga a escolha de segmentos" },
    steps: [
      {
        id: "instalar", title: "Instalar a status line nesta máquina", target: "none", body: "statusline-install",
        text: "É um pequeno script do Claude Code que anota os seus limites de uso. O meu-bot lê essa anotação e mostra no rodapé.",
        done: (_st, _f, c) => c.statusLine.installed === true,
      },
      {
        id: "segmentos", title: "Escolher o que aparece", target: "none", body: "statusline-segments",
        text: "Ligue e desligue cada parte da barra: modelo, contexto, conta, sessão (5 horas) e semanal (7 dias). Vale na barra do Claude Code no terminal desta máquina e no rodapé do meu-bot, ao mesmo tempo.",
        done: (_st, _f, c) => c.statusLine.installed === true && c.statusLine.segments !== null,
      },
      {
        id: "conferir", title: "Conferir no terminal", target: "none", body: "statusline-test",
        text: "O botão abre um terminal desta máquina e roda um teste do script com um JSON de exemplo; a linha aparece com as cores. Avisos de \"/dev/tty\" nesse teste são normais fora do Claude Code.",
        done: (_st, f) => f.statusTested,
        manual: { label: "Apareceu certo", flag: "statusTested" },
      },
      {
        id: "limites", title: "Ver os limites na conversa", target: "chat",
        text: "Vá para a conversa e mande uma mensagem ao agente: quando a resposta chegar, o rodapé dela mostra Sessão e Semanal, os limites da sua conta do Claude nesta máquina.",
        done: (_st, _f, c) => c.statusLine.installed === true && c.statusLine.limits,
      },
    ],
  },
  {
    id: "xai-login",
    number: 4,
    after: "claude-login",
    needsXai: true,
    title: "Entrar na xAI (Grok)",
    short: "Grok",
    summary: "Com a conta da xAI logada nesta máquina, o modelo grok-4 responde e pode servir de reserva do Claude.",
    minutes: 3,
    icon: "chat",
    reset: { what: "sai da conta da xAI no Hermes desta máquina (o Hermes e o proxy ficam) e esquece a resposta de teste" },
    steps: [
      {
        id: "preparar", title: "Preparar o Grok nesta máquina", target: "none", body: "xai-prepare",
        text: "O Grok responde pelo Hermes desta máquina, com a sua conta da xAI. Na primeira vez o app instala o Hermes e um proxy local; pode levar alguns minutos.",
        done: (_st, _f, c) => c.xai.hermes === true,
      },
      {
        id: "entrar", title: "Entrar na conta da xAI", target: "none", body: "xai-login",
        text: "Clique em Entrar: a página da xAI abre no navegador com um código já preenchido; você aprova por lá e volta. Aqui não há nada para colar.",
        done: (_st, _f, c) => c.xai.hermes === true && c.xai.loggedIn === true,
      },
      {
        id: "resposta", title: "Ver o grok-4 responder", target: "chat",
        text: "Vá para a conversa: ela muda para o modelo grok-4 e manda uma mensagem; a resposta vem da xAI, e a pill do túnel mostra \"respondeu grok-4\".",
        done: (_st, f, c) => c.xai.loggedIn === true && f.grokReplied,
      },
    ],
  },
  {
    id: "fallback-contas",
    number: 5,
    after: "xai-login",
    needsXai: true,
    title: "Fallback: Claude e Grok",
    short: "Fallback",
    summary: "Com as duas contas logadas nesta máquina, se uma falhar a outra responde. Escolha quem é o primário e quem é a reserva.",
    minutes: 2,
    icon: "chat",
    reset: { what: "esquece a escolha do primário e a reserva vista (as contas continuam logadas; o modelo padrão não muda)" },
    steps: [
      {
        id: "contas", title: "As duas contas nesta máquina", target: "none",
        text: "O fallback precisa das duas contas logadas nesta máquina: Claude (tutorial 1) e xAI (tutorial 4). Se uma falhar antes de responder, a outra assume sem você fazer nada.",
        done: (_st, _f, c) => c.claude.loggedIn === true && c.xai.loggedIn === true,
      },
      {
        id: "ordem", title: "Escolher primário e reserva", target: "none", body: "fallback-order",
        text: "O primário responde sempre e gasta o orçamento da conta dele. A reserva só entra se o primário falhar antes de começar a responder, e não gasta nada até lá. Escolha quem é o primário; a reserva é quem sobrar.",
        done: (_st, f, c) => f.fallbackChosen && c.fallback.primary !== null && FALLBACK_PRIMARIES.includes(c.fallback.primary),
      },
      {
        id: "reserva", title: "Ver a reserva assumir", target: "none",
        text: "Nada a fazer agora. Na primeira vez que o primário falhar antes de responder, a conversa recebe um aviso amarelo e a resposta vem da reserva, com \"fallback\" no pé da mensagem. Este passo se marca sozinho quando isso acontecer; se preferir, marque que entendeu.",
        done: (_st, f) => f.fallbackSeen,
        manual: { label: "Entendi como funciona", flag: "fallbackSeen" },
      },
    ],
  },
  {
    id: "suporte",
    number: 6,
    title: "Ligar o suporte",
    short: "Suporte",
    summary: "Deixe o admin do seu meu-bot ver a sua máquina e te ajudar. Você escolhe o que ele vê e acompanha tudo o que ele fizer; só o admin desliga.",
    minutes: 1,
    icon: "target",
    needsSupport: true,
    steps: [
      {
        id: "nome", title: "Dizer seu nome", target: "none", body: "support-name",
        text: "Como você prefere ser chamado. Ao salvar, o admin passa a poder entrar nesta máquina para ver a saúde, o WhatsApp e os registros, e fazer ajustes de suporte. Tudo o que ele fizer aparece no passo seguinte.",
        done: (_st, _f, c) => (c.support?.name ?? "") !== "" && c.support?.on === true,
      },
      {
        id: "entrega", title: "O que o admin recebe", target: "none", body: "support-delivery",
        text: "A sua máquina avisa o admin sozinha, sem você precisar mandar nada; este passo se marca quando o aviso chegar. Abaixo, tudo o que o suporte fez aqui.",
        done: (_st, _f, c) => c.support?.on === true && (c.support.deliveredAt ?? null) !== null,
      },
    ],
  },
  {
    id: "whatsapp-objetivo",
    number: 7,
    title: "O que você quer resolver pelo WhatsApp?",
    short: "Objetivo",
    summary: "Escolha um objetivo, diga quanta liberdade o agente tem e salve como skill no Acervo: o agente passa a trabalhar em cima disso.",
    minutes: 2,
    icon: "chat",
    reset: { what: "apaga a skill do objetivo no workspace do agente e devolve a liberdade total ao dono (os outros contatos continuam sem ferramentas)" },
    steps: [
      {
        id: "objetivo", title: "Escolher o objetivo", target: "none", body: "objective-choice",
        text: "O que o agente resolve pelo WhatsApp. Escolha um cartão e, se quiser, complete em uma frase (em \"Outro\" a frase é obrigatória). Fica gravado na máquina.",
        done: (_st, _f, c) => c.objective?.objective !== null && c.objective?.objective !== undefined,
      },
      {
        id: "liberdade", title: "Dizer quanta liberdade o agente tem", target: "none", body: "objective-level",
        text: "Até onde o agente vai sozinho. Vale para você, o dono do número; os outros contatos nunca têm ferramentas que mudem a máquina.",
        done: (_st, _f, c) => c.objective?.level !== null && c.objective?.level !== undefined,
      },
      {
        id: "skill", title: "Salvar como skill no Acervo", target: "none", body: "objective-skill",
        text: "Grava uma skill de verdade no workspace do agente (o OpenClaw carrega sozinho) e ajusta as ferramentas ao nível escolhido. Ela aparece no Acervo; salvar de novo substitui.",
        done: (_st, _f, c) => c.objective?.savedAt !== null && c.objective?.savedAt !== undefined && c.objective.skillPresent,
      },
    ],
  },
];

/** Tutorial 7, passo 1: os cartões de objetivo (o rótulo vai para o SKILL.md; "outro" exige a frase). */
export interface ObjectiveOption { id: string; label: string; text: string; needsText: boolean }
export const OBJECTIVE_OPTIONS: readonly ObjectiveOption[] = [
  { id: "atendimento", label: "Atender clientes", text: "Tirar dúvidas, dar informações e encaminhar o que não resolver.", needsText: false },
  { id: "vendas", label: "Vender", text: "Apresentar produtos ou serviços, tirar objeções e fechar pedidos.", needsText: false },
  { id: "agenda", label: "Marcar horários", text: "Agendar, confirmar e remarcar compromissos.", needsText: false },
  { id: "suporte", label: "Dar suporte", text: "Ajudar quem já é cliente a resolver problemas passo a passo.", needsText: false },
  { id: "outro", label: "Outro", text: "Descreva em uma frase o que você quer resolver.", needsText: true },
];
/** Tutorial 7, passo 2: os três níveis de liberdade (os mesmos ids do main, que grava a trava). */
export const LEVEL_OPTIONS: readonly { id: FreedomLevel; title: string; text: string; isDefault: boolean }[] = [
  { id: "conversa", title: "Só conversa", text: "Responde, orienta e combina coisas, mas não mexe em nada: não roda comandos, não grava arquivos, não agenda.", isDefault: true },
  { id: "consulta", title: "Consulta e organiza", text: "Lê arquivos e a internet, anota e organiza no workspace dele, mas não roda comandos nem agenda.", isDefault: false },
  { id: "age", title: "Age por mim", text: "Faz o que for preciso: roda comandos, mexe em arquivos e agenda, como se fosse você.", isDefault: false },
];

/** Selo do cartão: "TUTORIAL 3 · 4 PASSOS · 3 MIN" (o renderer põe em caixa alta); sem número, só passos e minutos. */
export function tutorialBadge(t: Tutorial, withNumber = true): string {
  const n = t.steps.length;
  return [withNumber ? `Tutorial ${t.number}` : undefined, t.badge, `${n} ${n === 1 ? "passo" : "passos"}`, `${t.minutes} min`].filter((x): x is string => x !== undefined && x !== "").join(" · ");
}
/** Número fixo de um tutorial pelo id (o admin recebe só ids); null para id desconhecido. */
export const tutorialNumber = (id: string): number | null => TUTORIAIS.find((t) => t.id === id)?.number ?? null;

/** Rótulo do botão do passo atual, por alvo: o guia leva a pessoa ao lugar certo em vez de pedir para procurar. */
export const GUIDE_ACTION_LABEL: Record<Exclude<GuideTarget, "none">, string> = {
  "wa-line": "Abrir o WhatsApp", "wa-agent": "Abrir o WhatsApp", "wa-pair": "Gerar QR", "wa-policy": "Escolher no WhatsApp", "chat": "Ir para a conversa",
};

/** Título da aba do guia: "2 · WhatsApp 2/4", ou "2 · WhatsApp ✓" quando tudo está feito. */
export function guideTabTitle(t: Tutorial, v: GuideView): string {
  return v.finished ? `${t.number} · ${t.short} ✓` : `${t.number} · ${t.short} ${v.done.filter(Boolean).length}/${t.steps.length}`;
}

export interface GuideView { done: boolean[]; current: number; finished: boolean }

/**
 * Estado do guia: quais passos estão concluídos e qual é o atual (o primeiro pendente). Sequencial: um passo
 * só conta como concluído se todos os anteriores também estão; assim uma marcação antiga ("testei") não
 * acende o passo 4 enquanto o número está desconectado.
 */
export function guideView(t: Tutorial, status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext = emptyContext()): GuideView {
  const done: boolean[] = [];
  let chain = true;
  for (const s of t.steps) { chain = chain && s.done(status, flags, ctx); done.push(chain); }
  const current = done.indexOf(false);
  return { done, current, finished: current === -1 };
}

/**
 * Os tutoriais desta janela: o do suporte só com o pacote de suporte disponível; o do Grok só onde ele é
 * possível (null = ainda não consultado = mostra); os da trilha (`after`) só depois que o anterior foi
 * concluído (`finished` é do chamador: concluir depende de flags e da máquina). Um `after` escondido esconde
 * quem depende dele (o 5 some junto com o 4).
 */
export function visibleTutorials(ctx: GuideContext, finished: (t: Tutorial) => boolean = () => false): Tutorial[] {
  const visible = (t: Tutorial): boolean => {
    if (t.needsSupport === true && ctx.support?.available !== true) return false;
    if (t.needsXai === true && ctx.xai.possible === false) return false;
    if (t.after === undefined) return true;
    const prev = TUTORIAIS.find((x) => x.id === t.after);
    return prev !== undefined && visible(prev) && finished(prev);
  };
  return TUTORIAIS.filter(visible);
}

/**
 * Selo ao lado de "Tutoriais" na lateral. Duas notificações distintas: o número são as pendências (tutoriais
 * disponíveis não concluídos; o interruptor "avisar na lateral" desliga isso) e o pulso é novidade (tutorial
 * que apareceu depois da última vez que a pessoa abriu Tutoriais). A novidade não obedece ao interruptor:
 * com o aviso desligado, o selo mostra só as novidades, pulsando, até a pessoa abrir Tutoriais. null = nada.
 */
export function sidebarBadge(c: { todo: number; novos: number; avisar: boolean }): { text: string; pulse: boolean } | null {
  if (c.avisar) return c.todo > 0 ? { text: String(c.todo), pulse: c.novos > 0 } : null;
  return c.novos > 0 ? { text: String(c.novos), pulse: true } : null;
}
