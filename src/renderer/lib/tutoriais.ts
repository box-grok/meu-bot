/**
 * Tutoriais: guias ao vivo do meu-bot, numa aba própria (como o Acervo). Cada um é um cartão com selo
 * ("COMECE POR AQUI · 4 PASSOS · 3 MIN"), título, resumo e "Começar". Ao começar, o cartão vira um guia no
 * estilo do onboarding: cada passo é uma ação da pessoa, o botão certo pulsa, e o passo se marca concluído
 * sozinho pelo estado real da máquina (QR já lido = concluído). Puro: as regras ficam aqui, testáveis.
 */
import type { SupportInfo, WhatsappStatus } from "../../shared/ipc";

/** O que mais o guia sabe além do WhatsApp: o estado do suporte nesta máquina (null = ainda não consultado). */
export interface GuideContext { support: SupportInfo | null }
export const emptyContext = (): GuideContext => ({ support: null });

/** Onde o guia aponta: o botão que deve pulsar enquanto o passo está pendente. */
export type GuideTarget = "wa-line" | "wa-agent" | "wa-pair" | "wa-policy" | "none";

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
export interface GuideFlags { policyChosen: boolean; tested: boolean; number: string | null }
export const emptyFlags = (): GuideFlags => ({ policyChosen: false, tested: false, number: null });

export interface GuideStep {
  id: string;
  title: string;
  /** Instrução curta de uma ação. */
  text: string;
  target: GuideTarget;
  /** Corpo especial do passo no guia: cartões de quem responder, controles de áudio, ou os do suporte. */
  body?: "reply-choice" | "audio" | "support-name" | "support-switch" | "support-delivery";
  /** Concluído pelo estado real; `null` de status = ainda não consultado. */
  done: (status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext) => boolean;
  /** Passo que a pessoa conclui com um botão no próprio cartão ("Testei, funcionou"). */
  manual?: { label: string; flag: "policyChosen" | "tested" };
}

export interface Tutorial {
  /** Identificador estável (kebab-case). */
  id: string;
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
  requires?: "support";
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

/** Os tutoriais, na ordem em que aparecem. */
export const TUTORIAIS: readonly Tutorial[] = [
  {
    id: "whatsapp-openclaw",
    title: "Conectar o WhatsApp ao agente",
    short: "WhatsApp",
    summary: "Conecte um número ao agente da máquina, decida quem ele responde, faça ele entender áudios e teste de verdade.",
    minutes: 4,
    badge: "Próximo",
    icon: "target",
    steps: WHATSAPP_STEPS,
  },
  {
    id: "suporte",
    title: "Ligar o suporte",
    short: "Suporte",
    summary: "Deixe quem cuida do seu meu-bot ver a sua máquina e te ajudar. Você liga, desliga e vê tudo o que ele fizer.",
    minutes: 1,
    icon: "target",
    requires: "support",
    steps: [
      {
        id: "nome", title: "Dizer seu nome", target: "none", body: "support-name",
        text: "É como {admin} vai te ver na lista dele.",
        done: (_st, _f, c) => (c.support?.name ?? "") !== "",
      },
      {
        id: "permitir", title: "Permitir o suporte de {admin}", target: "none", body: "support-switch",
        text: "Ligado, {admin} consegue ver a saúde da máquina, o WhatsApp e os registros, e fazer ajustes de suporte. Tudo o que ele fizer fica registrado nas Configurações. Você desliga quando quiser.",
        done: (_st, _f, c) => c.support?.on === true,
      },
      {
        id: "entrega", title: "{admin} recebe o aviso", target: "none", body: "support-delivery",
        text: "A sua máquina avisa {admin} sozinha, sem você precisar mandar nada. Este passo se marca quando o aviso chegar.",
        done: (_st, _f, c) => c.support?.on === true && (c.support.deliveredAt ?? null) !== null,
      },
    ],
  },
  {
    id: "whatsapp-objetivo",
    title: "O que você quer resolver pelo WhatsApp?",
    short: "Objetivo",
    summary: "Escolha um objetivo, diga quanta liberdade o agente tem e salve como skill no Acervo.",
    minutes: 2,
    icon: "chat",
    comingSoon: true,
    steps: [
      { id: "objetivo", title: "Escolher o objetivo", text: "", target: "none", done: () => false },
      { id: "liberdade", title: "Dizer quanta liberdade o agente tem", text: "", target: "none", done: () => false },
      { id: "skill", title: "Salvar como skill no Acervo", text: "", target: "none", done: () => false },
    ],
  },
];

/** Selo do cartão: "COMECE POR AQUI · 4 PASSOS · 3 MIN" (o renderer põe em caixa alta). */
export function tutorialBadge(t: Tutorial, withBadge = true): string {
  const n = t.steps.length;
  return [withBadge ? t.badge : undefined, `${n} ${n === 1 ? "passo" : "passos"}`, `${t.minutes} min`].filter((x): x is string => x !== undefined && x !== "").join(" · ");
}

/** Rótulo do botão do passo atual, por alvo: o guia leva a pessoa ao lugar certo em vez de pedir para procurar. */
export const GUIDE_ACTION_LABEL: Record<Exclude<GuideTarget, "none">, string> = {
  "wa-line": "Abrir o WhatsApp", "wa-agent": "Abrir o WhatsApp", "wa-pair": "Gerar QR", "wa-policy": "Escolher no WhatsApp",
};

/** Título da aba do guia: "WhatsApp 2/4", ou "WhatsApp ✓" quando tudo está feito. */
export function guideTabTitle(t: Tutorial, v: GuideView): string {
  return v.finished ? `${t.short} ✓` : `${t.short} ${v.done.filter(Boolean).length}/${t.steps.length}`;
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

/** Os tutoriais desta janela: o do suporte só com o pacote de suporte disponível. */
export const visibleTutorials = (ctx: GuideContext): Tutorial[] =>
  TUTORIAIS.filter((t) => t.requires !== "support" || ctx.support?.available === true);

/** "{admin}" nos textos vira o nome de quem dá o suporte. */
export const withAdmin = (text: string, ctx: GuideContext): string => text.replace(/\{admin\}/g, ctx.support?.admin || "o suporte");
