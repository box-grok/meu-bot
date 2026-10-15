/**
 * Onboarding guiado da primeira vez: a pessoa executa cada ação e o app só orienta. Puro (sem DOM):
 * passos, avanço por evento e o sorteio do feedback, testáveis com node --test.
 */

/** O que o renderer observa acontecer; cada passo espera um deles. */
export type OnboardEvent = "sidebar" | "palette-open" | "palette-close" | "settings-closed" | "new-tab";

export interface OnboardStep {
  id: "sidebar" | "palette" | "settings" | "new";
  title: string;
  text: string;
  /** Evento que conclui o passo. */
  completes: OnboardEvent;
  /** Evento que precisa ter acontecido antes (ex.: abrir a paleta antes de fechá-la contar). */
  after?: OnboardEvent;
}

export const ONBOARD_STEPS: readonly OnboardStep[] = [
  { id: "sidebar", title: "Lista de conversas", text: "Ela fica recolhida por padrão. Abra com o botão ☰ no topo ou com Cmd + B.", completes: "sidebar" },
  { id: "palette", title: "Paleta de comandos", text: "Aperte Cmd + K DUAS vezes: a primeira abre a paleta, que acha conversas e ações pelo nome; a segunda fecha. O passo só conclui quando ela fechar.", completes: "palette-close", after: "palette-open" },
  { id: "settings", title: "Configurações", text: "Aperte Cmd + vírgula (⌘ ,) DUAS vezes: a primeira abre as Configurações, o mesmo atalho de preferências de todo app do Mac; a segunda fecha. Entre uma e outra, espie as seções.", completes: "settings-closed" },
  { id: "new", title: "Primeira conversa", text: "Aperte Cmd + N, ou clique no botão Novo, para criar a primeira conversa. A primeira mensagem vai sozinha.", completes: "new-tab" },
];

/** Primeira mensagem da primeira conversa: enviada sozinha quando o último passo conclui. */
export const EXAMPLE_MESSAGE = "Oi! Em uma frase: o que você consegue fazer nesta máquina?";
/** Aviso ao pular: deixa claro que acabou e como refazer. */
export const SKIPPED_MESSAGE = { title: "Onboarding ignorado", text: "Tudo bem. Para refazer depois: ligue \"Onboarding\" no rodapé do seletor, ou use \"Rever onboarding\" na paleta (Cmd + K)." };
/** Transição de encerramento, mostrada no cartão por alguns segundos. */
export const FINAL_MESSAGE = { title: "Isso é tudo", text: "Fim do onboarding. A partir daqui é só conversar: cada máquina é uma janela, e a lista guarda o resto." };

export interface OnboardState { step: number; armed: boolean }
export const initialOnboardState = (): OnboardState => ({ step: 0, armed: false });

export interface OnboardAdvance { state: OnboardState; advanced: boolean; finished: boolean }

/** Aplica um evento ao estado: só o evento do passo atual avança; os outros são ignorados. */
export function advanceOnboard(state: OnboardState, ev: OnboardEvent): OnboardAdvance {
  const step = ONBOARD_STEPS[state.step];
  if (step === undefined) return { state, advanced: false, finished: true };
  if (step.after !== undefined && ev === step.after) return { state: { ...state, armed: true }, advanced: false, finished: false };
  if (ev !== step.completes || (step.after !== undefined && !state.armed)) return { state, advanced: false, finished: false };
  const next = state.step + 1;
  return { state: { step: next, armed: false }, advanced: true, finished: next >= ONBOARD_STEPS.length };
}

export type Feedback = { kind: "text"; text: string } | { kind: "icon"; text: string } | { kind: "none" };

const PHRASES = ["Isso.", "Boa.", "Simples assim.", "Mais um.", "Fluiu.", "Já era.", "Era só isso."];
const ICONS = ["✓", "✨", "👌", "🎯", "🙌", "⚡"];

/** Feedback pequeno e variado: às vezes frase, às vezes ícone, às vezes nada; nunca repete o anterior. */
export function pickFeedback(rand: () => number = Math.random, previous?: Feedback): Feedback {
  const r = rand();
  const pool = (list: readonly string[]): readonly string[] => (previous !== undefined && previous.kind !== "none" ? list.filter((x) => x !== previous.text) : list);
  const pick = (list: readonly string[]): string => list[Math.min(list.length - 1, Math.floor(rand() * list.length))] ?? list[0]!;
  if (r < 0.4) return { kind: "text", text: pick(pool(PHRASES)) };
  if (r < 0.7) return { kind: "icon", text: pick(pool(ICONS)) };
  if (previous?.kind === "none") return { kind: "icon", text: pick(ICONS) };
  return { kind: "none" };
}
