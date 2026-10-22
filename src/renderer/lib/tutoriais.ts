/**
 * Tutoriais: guias ao vivo do meu-bot, numa aba própria (como o Acervo). Cada um é um cartão com selo
 * ("COMECE POR AQUI · 4 PASSOS · 3 MIN"), título, resumo e "Começar". Ao começar, o cartão vira um guia no
 * estilo do onboarding: cada passo é uma ação da pessoa, o botão certo pulsa, e o passo se marca concluído
 * sozinho pelo estado real da máquina (QR já lido = concluído). Puro: as regras ficam aqui, testáveis.
 */
import type { CrmLocal, FreedomLevel, ObjectiveInfo, StatusLineSegments, SupportInfo, WhatsappGroup, WhatsappGroups, WhatsappStatus, CrmInfo } from "../../shared/ipc";

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
  /** Guarda do WhatsApp (plugin meu-bot-guarda no OpenClaw): instalada? null = não consultado ou máquina sem OpenClaw. */
  guarda: { installed: boolean | null };
  /**
   * Navegador (módulo Pro): `access` = acesso pela licença (null = não consultado); `installed` = lado da máquina
   * (MCP + regra); `tabs` = abas abertas agora; `extensions` = extensões na sessão; `agentOn` = "agente pode usar".
   */
  navegador: { access: "ok" | "free" | "expired" | "unknown" | "assinatura" | null; installed: boolean | null; tabs: number; extensions: number; agentOn: boolean; /** Sites fixos no espaço de trabalho ativo. */ servicos: number; /** A extensão do CRM próprio (meu-bot-crm) está carregada na sessão. */ extensaoEmbutida: boolean };
  /** Tutorial 11: notificações do Navegador ligadas nas Configurações e quantas conversas "🔔" já existem. */
  notify: { enabled: boolean; conversas: number };
  /**
   * Fallback entre contas: `primary` = modelo padrão desta máquina (quem responde sempre); `chain` = a corrente de
   * provedores que o backend informa (null = ainda não consultado), com quem está disponível.
   */
  fallback: { primary: string | null; chain: readonly FallbackProvider[] | null };
  /** Tutorial 7: objetivo e nível gravados na máquina e a skill salva (null = ainda não consultado). */
  objective: ObjectiveInfo | null;
  /** Tutorial 10 (Pro): acesso pela licença (como o Navegador) e o estado na máquina (null = não consultado). */
  crm: { access: "ok" | "free" | "expired" | "unknown" | "assinatura" | null; info: CrmInfo | null; /** meu-bot-crm: pipelines do CRM da máquina e o padrão do WhatsApp (null = ainda não lido). */ local: CrmLocal | null };
  /**
   * Tutorial 12: grupos da máquina (null = não consultado), o grupo que a pessoa escolheu (jid; null = nenhum) e se
   * o agente já respondeu nesse grupo.
   */
  grupos: { info: WhatsappGroups | null; alvo: string | null; respondeu: boolean };
  /** O produto desta janela (caps): decide quais tutoriais de CRM existem e se há etiqueta Pro. */
  produto: { planoExigido: "free" | "pro" | "personalizado"; extensaoGmail: boolean; crmStreak: boolean };
  /**
   * Que fontes já foram consultadas nesta janela. "Ainda não consultei" não é "não feito": um tutorial cujas fontes
   * não chegaram fica "verificando", fora da contagem e do selo, em vez de aparecer como pendente e sumir depois.
   */
  known: Record<GuideSource, boolean>;
}
/** De onde vêm os fatos que concluem passos; cada tutorial declara as suas em `needs`. */
export type GuideSource = "whatsapp" | "claude" | "statusline" | "xai" | "fallback" | "support" | "objective" | "guarda" | "navegador" | "crm" | "grupos";
export const GUIDE_SOURCES: readonly GuideSource[] = ["whatsapp", "claude", "statusline", "xai", "fallback", "support", "objective", "guarda", "navegador", "crm", "grupos"];
const noneKnown = (): Record<GuideSource, boolean> => ({ whatsapp: false, claude: false, statusline: false, xai: false, fallback: false, support: false, objective: false, guarda: false, navegador: false, crm: false, grupos: false });
export interface FallbackProvider { name: string; available: boolean }
export const emptyContext = (): GuideContext => ({
  support: null,
  statusLine: { installed: null, limits: false, segments: null },
  claude: { loggedIn: null, email: null, firstReply: false },
  xai: { possible: null, hermes: null, loggedIn: null, label: null },
  guarda: { installed: null },
  navegador: { access: null, installed: null, tabs: 0, extensions: 0, agentOn: false, servicos: 0, extensaoEmbutida: false },
  notify: { enabled: false, conversas: 0 },
  fallback: { primary: null, chain: null },
  objective: null,
  crm: { access: null, info: null, local: null },
  grupos: { info: null, alvo: null, respondeu: false },
  produto: { planoExigido: "free", extensaoGmail: false, crmStreak: true },
  known: noneKnown(),
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
export interface ReplyOption { id: "self" | "open" | "list"; title: string; text: string; isDefault: boolean }
export const REPLY_OPTIONS: readonly ReplyOption[] = [
  { id: "self", title: "Desativado: só eu falo com o agente", text: "O agente só responde mensagens que você manda para si mesmo. Ninguém mais recebe resposta nem código de pareamento.", isDefault: true },
  { id: "open", title: "Responder todo mundo", text: "Logo depois do pareamento, o agente responde qualquer pessoa que mandar mensagem para este número.", isDefault: false },
  { id: "list", title: "Só alguns contatos", text: "Você e os números que você listar. Quem não estiver na lista não recebe resposta nem código.", isDefault: false },
];
export const REPLY_NOTE = "Para atender clientes, as respostas precisam estar ativas. Você pode testar só com você agora e ativar depois no canal WhatsApp.";
/** Só dígitos de um número como o OpenClaw guarda ("+5511…", "5511…"). */
const digitsOf = (n: string): string => n.replace(/\D/g, "");
/** Números da allowlist além do dono (sem "*"): o que a pessoa listou. */
export function listedNumbers(allowFrom: readonly string[] | undefined, self: string | null): string[] {
  return [...new Set((allowFrom ?? []).filter((n) => n !== "*").map(digitsOf).filter((n) => n !== "" && n !== self))];
}
/**
 * A política gravada no OpenClaw → qual cartão está marcado (null = nenhum: pairing ou disabled). allowlist com
 * alguém além do dono em allowFrom é "list"; só o dono (ou vazio) é "self".
 */
export function replyChoiceOf(dmPolicy: WhatsappStatus["dmPolicy"], allowFrom?: readonly string[], self: string | null = null): "self" | "open" | "list" | null {
  if (dmPolicy === "open") return "open";
  if (dmPolicy !== "allowlist") return null;
  return listedNumbers(allowFrom, self).length > 0 ? "list" : "self";
}
/**
 * Texto digitado → números para a lista (um por linha, vírgula ou ponto e vírgula). Sem "+", 10 ou 11 dígitos
 * é número brasileiro com DDD e ganha o 55. `bad` são os que não viraram número (8 a 15 dígitos).
 */
export function parseWaNumbers(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = []; const bad: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const item = raw.trim(); if (item === "") continue;
    let d = digitsOf(item);
    if (!item.startsWith("+") && (d.length === 10 || d.length === 11)) d = `55${d}`;
    if (/^\d{8,15}$/.test(d)) { if (!ok.includes(d)) ok.push(d); } else bad.push(item);
  }
  return { ok, bad };
}

/** O que a pessoa marcou à mão (o app não tem como ver uma mensagem de teste chegar). */
export interface GuideFlags { policyChosen: boolean; tested: boolean; statusTested: boolean; claudeSeen: boolean; grokReplied: boolean; fallbackChosen: boolean; fallbackSeen: boolean; guardaSeen: boolean; navAgentUsed: boolean; crmSeen: boolean; crmImportSeen: boolean; notifySkipped: boolean; notifySeen: boolean; claudeReplied: boolean; gruposTested: boolean; number: string | null }
export const emptyFlags = (): GuideFlags => ({ policyChosen: false, tested: false, statusTested: false, claudeSeen: false, grokReplied: false, fallbackChosen: false, fallbackSeen: false, guardaSeen: false, navAgentUsed: false, crmSeen: false, crmImportSeen: false, notifySkipped: false, notifySeen: false, claudeReplied: false, gruposTested: false, number: null });
/**
 * Marcações que um passo pode pedir ("Testei, funcionou") ou que o app grava sozinho (`grokReplied`: resposta com
 * X-Provider grok-4; `fallbackChosen`: a pessoa escolheu o primário; `fallbackSeen`: uma resposta veio da reserva).
 */
export type GuideFlagName = "policyChosen" | "tested" | "statusTested" | "claudeSeen" | "grokReplied" | "fallbackChosen" | "fallbackSeen" | "guardaSeen" | "navAgentUsed" | "crmSeen" | "crmImportSeen" | "notifySkipped" | "notifySeen" | "claudeReplied" | "gruposTested";

export interface GuideStep {
  id: string;
  title: string;
  /** Instrução curta de uma ação. */
  text: string;
  target: GuideTarget;
  /** Corpo especial do passo no guia: cartões de quem responder, áudio, suporte ou a status line. */
  body?: "reply-choice" | "audio" | "support-name" | "support-switch" | "support-delivery" | "statusline-install" | "statusline-segments" | "statusline-test" | "claude-login" | "xai-prepare" | "xai-login" | "fallback-order" | "objective-choice" | "objective-level" | "objective-skill" | "guarda-install" | "navegador-pro" | "navegador-install" | "navegador-open" | "crm-pro" | "crm-install" | "crm-config" | "crm-test" | "crm-gmail" | "crm-importar" | "nav-ws" | "nav-notify-config" | "nav-notify-test" | "grupos-escolher" | "grupos-quem" | "grupos-modo" | "grupos-teste" | "crm-pipeline";
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
  /** Só no produto com o CRM pelo Streak (meu-bot); some no meu-bot-crm. */
  needsCrmStreak?: true;
  /** Só no produto com a extensão do Gmail embutida (meu-bot-crm). */
  needsExtensaoGmail?: true;
  /** Trilha em ordem: só aparece depois que este tutorial (id) foi concluído. */
  after?: string;
  /** Fontes do contexto que os passos consultam; enquanto alguma não chegou, o tutorial está "verificando". */
  needs: readonly GuideSource[];
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

/**
 * Grupo do tutorial 12: o que a pessoa escolheu (se ainda existe na máquina); sem escolha, o primeiro com o agente
 * ligado (máquina que já tem grupo configurado entra com os passos concluídos pelo estado real).
 */
export function grupoAlvo(info: WhatsappGroups | null, escolhido: string | null): WhatsappGroup | null {
  if (info === null) return null;
  return info.grupos.find((g) => g.jid === escolhido) ?? info.grupos.find((g) => g.agente !== "desligado") ?? null;
}
/** Quem aciona o agente nos grupos já foi escolhido de propósito (lista própria ou "todos"), não herdado das diretas. */
export const quemEscolhido = (info: WhatsappGroups | null): boolean =>
  info !== null && !info.quemAcionaHerdado && (info.quemAciona === "todos" || info.quemAciona.length > 0);
export const GRUPOS_AVISO = "Só grupos internos, com gente de casa. Nunca ligue o agente num grupo com clientes.";
export const GRUPOS_QUEM_NOTA = "Quem não está nesta lista pode escrever no grupo à vontade: o agente simplesmente não responde a essa pessoa. A lista vale para todos os grupos com o agente ligado.";

/** Os tutoriais, na ordem em que aparecem (e dos números). */
export const TUTORIAIS: readonly Tutorial[] = [
  {
    id: "claude-login",
    number: 1,
    needs: ["claude"],
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
        // A primeira resposta é um fato que não se desfaz: fica lembrada na flag (apagar as conversas não reabre o
        // tutorial). "Não exibir" marca a mesma flag à mão, para quem não quer passar por aqui.
        done: (_st, f, c) => c.claude.loggedIn === true && (c.claude.firstReply || f.claudeReplied),
        manual: { label: "Não exibir", flag: "claudeReplied" },
      },
    ],
  },
  {
    id: "whatsapp-openclaw",
    number: 2,
    needs: ["whatsapp"],
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
    needs: ["statusline"],
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
    needs: ["xai"],
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
    needs: ["claude", "xai", "fallback"],
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
    needs: ["support"],
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
    needs: ["objective"],
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
  {
    id: "guarda-whatsapp",
    number: 8,
    needs: ["guarda"],
    after: "whatsapp-openclaw",
    title: "Guarda do WhatsApp",
    short: "Guarda",
    summary: "Um plugin no agente desta máquina: avisos técnicos do OpenClaw nunca vão ao contato, e uma conversa bot-com-bot que entra em loop é pausada sozinha.",
    minutes: 2,
    icon: "target",
    reset: { what: "tira a guarda do OpenClaw desta máquina (o agente volta a entregar tudo e nada é pausado sozinho)" },
    steps: [
      {
        id: "ativar", title: "Ativar a guarda nesta máquina", target: "none", body: "guarda-install",
        text: "Ela já vem ligada: toda máquina com OpenClaw recebe a guarda sozinha quando o app a encontra. É um plugin pequeno do meu-bot no OpenClaw, roda 24 horas mesmo com o app fechado; se por algum motivo não estiver aqui, o botão instala.",
        done: (_st, _f, c) => c.guarda.installed === true,
      },
      {
        id: "entender", title: "O que ela faz por você", target: "none",
        text: "1) Linhas técnicas como \"↪️ Model Fallback: …\" (o OpenClaw trocou de modelo) não são entregues ao contato. 2) Se outro bot ficar trocando despedidas com o seu agente (\"Até mais!\" → \"Até.\" → …) por 3 ciclos em poucos minutos, a conversa é pausada sozinha: a resposta não sai, o contato aparece como \"pausado\" na lista do WhatsApp e o agente recebe uma nota explicando. Para voltar, é o menu \"…\" do contato › Retomar. Pessoas de verdade não são afetadas: a regra exige mensagens curtas, quase iguais ou de despedida, em menos de 3 minutos entre uma e outra.",
        done: (_st, f) => f.guardaSeen,
        manual: { label: "Entendi", flag: "guardaSeen" },
      },
    ],
  },
  {
    id: "navegador",
    number: 9,
    needs: ["navegador"],
    after: "claude-login",
    title: "Navegador do agente (Pro)",
    short: "Navegador",
    summary: "Um navegador dentro do meu-bot, com abas e cookies desta máquina. O agente da conversa pode abrir, ler e clicar por você, avisando antes.",
    reset: { what: "esquece \"o agente navegou\" nesta máquina (o plano, a instalação e as abas continuam)" },
    minutes: 4,
    icon: "chat",
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "navegador-pro",
        text: "O Navegador é do plano Pro. Se a sua máquina ainda é free, peça ao admin por aqui: ele libera e o tutorial continua sozinho.",
        done: (_st, _f, c) => c.navegador.access === "ok",
      },
      {
        id: "instalar", title: "Preparar a máquina para o agente", target: "none", body: "navegador-install",
        text: "Um arquivo pequeno na máquina apresenta as ações do navegador ao agente (abrir, ler, clicar, digitar…) e grava a regra de conduta: ele avisa antes de agir e nunca compra, paga ou envia nada sem você confirmar.",
        done: (_st, _f, c) => c.navegador.access === "ok" && c.navegador.installed === true,
      },
      {
        id: "abrir", title: "Abrir o Navegador e entrar num site", target: "none", body: "navegador-open",
        text: "Abra a aba Navegador, digite um endereço e navegue. Cookies e logins ficam guardados só nesta máquina; \"abrir no Mac\" leva a página para o seu navegador de sempre. ☆ guarda a página na barra de favoritos (Cmd+Shift+F mostra ou esconde a barra); o agente também pode favoritar um link para você.",
        done: (_st, _f, c) => c.navegador.access === "ok" && c.navegador.tabs > 0,
      },
      {
        id: "agente", title: "Deixar o agente navegar", target: "chat",
        text: "Na barra do Navegador, clique no 🤖 para ligar (ele acende quando o agente pode usar). Depois vá para a conversa e peça algo como \"abra o site example.com e me diga o título\": cada ação aparece na conversa com 🌐.",
        done: (_st, f, c) => c.navegador.access === "ok" && f.navAgentUsed,
      },
    ],
  },
  {
    id: "crm-gmail",
    number: 10,
    needs: ["crm", "navegador"],
    after: "navegador",
    needsExtensaoGmail: true,
    title: "CRM no Gmail e no WhatsApp",
    short: "CRM",
    summary: "O CRM do meu-bot-crm mora na sua máquina e aparece dentro do Gmail: pipelines, caixas e conversas. O agente anota pelo WhatsApp e pela conversa; sem Streak, sem chave de API.",
    minutes: 5,
    icon: "chat",
    steps: [
      {
        id: "instalar", title: "Instalar o CRM na máquina", target: "none", body: "crm-install",
        text: "Entra um plugin no OpenClaw da máquina (vê as conversas do WhatsApp e percebe o silêncio) e a ferramenta que o agente usa para anotar. Os dados ficam só na sua máquina; funciona com o app fechado.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.installed === true,
      },
      {
        id: "gmail", title: "Abrir o Gmail no Navegador", target: "none", body: "crm-gmail",
        text: "Abra o Navegador: o Gmail abre com a barra do CRM (entre na sua conta do Google, se ainda não entrou). Numa conversa, o painel \"CRM\" à direita mostra em que caixa ela está ou deixa adicionar a um pipeline; o botão \"CRM\" na lista abre o pipeline inteiro.",
        done: (_st, _f, c) => c.navegador.extensaoEmbutida && c.navegador.tabs > 0,
      },
      {
        id: "pipeline", title: "Criar o primeiro pipeline", target: "none", body: "crm-pipeline",
        text: "O CRM anota cada conversa do WhatsApp numa caixa de um pipeline (as etapas da sua operação de mídia paga). Sem pipeline, nada é anotado. Escolha um modelo, ajuste o nome e as etapas e crie: ele vira o pipeline do WhatsApp.",
        done: (_st, _f, c) => (c.crm.local?.padrao ?? null) !== null,
      },
      {
        id: "importar", title: "Trazer os dados do Streak (opcional)", target: "none", body: "crm-importar",
        text: "Tem pipelines no Streak? Peça ao agente: \"importa do Streak o pipeline X\" com a sua chave da API do Streak. É só uma vez, as chaves e os boxes são preservados, e a chave não fica gravada.",
        done: (_st, f) => f.crmImportSeen,
        manual: { label: "Importei (ou não preciso)", flag: "crmImportSeen" },
      },
      {
        id: "testar", title: "Testar pelo seu WhatsApp", target: "none", body: "crm-test",
        text: "No WhatsApp, abra a conversa com você mesmo e mande: \"anota no CRM: <nome do contato> <o que aconteceu>\". Em até um minuto chega a confirmação 📇; a mudança aparece no Gmail em segundos.",
        done: (_st, f) => f.crmSeen,
        manual: { label: "Recebi a confirmação", flag: "crmSeen" },
      },
    ],
  },
  {
    id: "crm-whatsapp",
    number: 10,
    needs: ["crm"],
    after: "navegador",
    needsCrmStreak: true,
    title: "CRM pelo WhatsApp (Pro)",
    short: "CRM",
    summary: "O agente da máquina anota no seu Streak CRM, pela API, o que acontece nas conversas do WhatsApp: comentários e campos sozinho; box novo e mudança de etapa só com o seu \"ok\".",
    minutes: 6,
    icon: "chat",
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "crm-pro",
        text: "O CRM pelo WhatsApp é do plano Pro, como o Navegador. Se já liberou o Navegador, este passo já está feito.",
        done: (_st, _f, c) => c.crm.access === "ok",
      },
      {
        id: "instalar", title: "Instalar o CRM na máquina", target: "none", body: "crm-install",
        text: "Entra um plugin no OpenClaw da máquina (vê as conversas e percebe quando uma fica em silêncio) e uma ferramenta que fala com o Streak pela API. Nada passa pelo seu computador: funciona com o app fechado.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.installed === true,
      },
      {
        id: "config", title: "Chave da API do Streak, pipeline e regras", target: "none", body: "crm-config",
        text: "Peça ao agente: ele gera a chave no Gmail pelo Navegador (botão do Streak › Integrações e Automações › Integrações personalizadas) e guarda direto na máquina. Ou faça você: copie a chave lá e cole aqui. Nos dois casos ela fica só na máquina (arquivo 0600) e nunca volta ao app. Depois escolha o pipeline (um só, o app escolhe sozinho) e quanto tempo de silêncio na conversa dispara a anotação.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.configured === true && c.crm.info.pipelineKey !== null,
      },
      {
        id: "testar", title: "Testar pelo seu WhatsApp", target: "none", body: "crm-test",
        text: "No WhatsApp, abra a conversa com você mesmo (seu próprio número) e mande: \"anota no CRM: <nome do contato> <o que aconteceu>\". Em até um minuto chega a confirmação 📇. Se ele propuser algo (mudar de etapa, criar box), responda \"ok\" ou \"não\".",
        done: (_st, f) => f.crmSeen,
        manual: { label: "Recebi a confirmação", flag: "crmSeen" },
      },
    ],
  },
  {
    id: "notificacoes-navegador",
    number: 11,
    needs: ["navegador"],
    // Sem `after`: não depende de o tutorial 9 estar concluído (o agente navegar não é pré-requisito); o Pro é o passo 1.
    title: "Notificações do Navegador (Pro)",
    short: "Notificações",
    summary: "Um site fixo no Navegador (o Gmail, por exemplo) avisa quando chega algo; o agente recebe o aviso numa conversa e faz o que você mandar: traduzir, explicar para leigo, resumir.",
    minutes: 4,
    icon: "chat",
    reset: { what: "desliga as notificações do Navegador e esquece \"pulei\" e \"vi funcionando\" (os espaços de trabalho e as conversas ficam)" },
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "navegador-pro",
        text: "As notificações são do Navegador, que é do plano Pro. Se já liberou o Navegador, este passo já está feito.",
        done: (_st, _f, c) => c.navegador.access === "ok",
      },
      {
        id: "fixar", title: "Fixar o site num espaço de trabalho", target: "none", body: "nav-ws",
        text: "No Navegador, crie um espaço de trabalho (um por cliente, por projeto, como preferir: o nome é seu) e fixe o site com 📌 ou \"＋ Adicionar site\". Site fixo fica aberto enquanto o Navegador existe; é assim que as notificações chegam.",
        done: (_st, _f, c) => c.navegador.access === "ok" && c.navegador.servicos > 0,
      },
      {
        id: "acao", title: "Decidir o que fazer com cada notificação", target: "none", body: "nav-notify-config",
        text: "Só o que chegar de novo conta: o que já está na caixa de entrada não dispara nada. Mesmo assim, se o site avisa muito, limite aos sites que importam e saiba que o app trata no máximo 3 por minuto por site. Se preferir, pule: fica desligado até você ligar nas Configurações.",
        done: (_st, f, c) => c.notify.enabled || f.notifySkipped,
      },
      {
        id: "ver", title: "Ver uma notificação virar conversa", target: "none", body: "nav-notify-test",
        text: "Com a função ligada, mande um e-mail para você mesmo (ou espere o próximo). A conversa \"🔔 <site>\" aparece sozinha com a resposta do agente, e a notificação do Mac leva até ela.",
        done: (_st, f, c) => f.notifySkipped || f.notifySeen || c.notify.conversas > 0,
        manual: { label: "Vi a conversa aparecer", flag: "notifySeen" },
      },
    ],
  },
  {
    id: "whatsapp-grupos",
    number: 12,
    needs: ["grupos"],
    after: "whatsapp-openclaw",
    title: "O agente nos grupos do WhatsApp",
    short: "Grupos",
    summary: "Ligue o agente num grupo interno sem virar bagunça: só quem você escolher conversa com ele, e ele responde só quando for chamado.",
    minutes: 3,
    icon: "chat",
    steps: [
      {
        id: "grupo", title: "Escolher o grupo", target: "none", body: "grupos-escolher",
        text: "Os grupos em que o número do agente está. Escolha um grupo interno; se ele não aparece, atualize a lista (o WhatsApp do agente fica parado uns 30 segundos).",
        done: (_st, _f, c) => grupoAlvo(c.grupos.info, c.grupos.alvo) !== null,
      },
      {
        id: "quem", title: "Quem pode conversar com o agente no grupo", target: "none", body: "grupos-quem",
        text: "Comece só por você: o número pessoal que você usa no grupo. Acrescente as pessoas de casa que também podem chamar o agente.",
        done: (_st, _f, c) => grupoAlvo(c.grupos.info, c.grupos.alvo) !== null && quemEscolhido(c.grupos.info),
      },
      {
        id: "modo", title: "Como ele responde", target: "none", body: "grupos-modo",
        text: "Ligue o agente neste grupo e diga quando ele fala. O padrão é o que evita bagunça: só quando alguém da lista o chama.",
        done: (_st, _f, c) => (grupoAlvo(c.grupos.info, c.grupos.alvo)?.agente ?? "desligado") !== "desligado",
      },
      {
        id: "teste", title: "Testar no grupo", target: "none", body: "grupos-teste",
        text: "De um número da lista, mande no grupo: \"@agente oi\" (mencione o número do agente ou responda a uma mensagem dele). O passo se marca sozinho quando a resposta aparecer.",
        done: (_st, f, c) => c.grupos.respondeu || f.gruposTested,
        manual: { label: "Testei, funcionou", flag: "gruposTested" },
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
/** Todas as fontes do tutorial já chegaram nesta janela? */
export const tutorialKnown = (t: Tutorial, ctx: GuideContext): boolean => t.needs.every((s) => ctx.known[s]);
export type TutorialState = "done" | "todo" | "unknown";
/**
 * Estado do tutorial para a lista e o selo: pelo estado real quando as fontes chegaram; antes disso, o que se lembra
 * da última vez nesta máquina (`remembered`: concluído ou não); sem lembrança, "unknown" (verificando). "Em breve"
 * nunca conta como feito.
 */
export function tutorialState(t: Tutorial, status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext, remembered: boolean | null): TutorialState {
  if (t.comingSoon === true) return "todo";
  if (!tutorialKnown(t, ctx)) return remembered === null ? "unknown" : remembered ? "done" : "todo";
  return guideView(t, status, flags, ctx).finished ? "done" : "todo";
}
/** Lembrança por máquina (`tutLembrado:<host>`): id → concluído na última vez em que as fontes chegaram. */
export function parseTutMemory(json: string | null): Record<string, boolean> {
  if (json === null || json === "") return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean" && /^[a-z0-9-]+$/.test(k)) out[k] = b;
    return out;
  } catch { return {}; }
}
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
    if (t.needsCrmStreak === true && !ctx.produto.crmStreak) return false;
    if (t.needsExtensaoGmail === true && !ctx.produto.extensaoGmail) return false;
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
