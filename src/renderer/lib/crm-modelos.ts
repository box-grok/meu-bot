/**
 * Tutorial 10, passo "Criar o primeiro pipeline": os modelos prontos e a validação, puros (testáveis sem DOM).
 * O CRM anota cada conversa do WhatsApp numa caixa de um pipeline; sem nenhum, nada é anotado.
 */
export interface ModeloPipeline { id: string; titulo: string; texto: string; nome: string; etapas: readonly string[] }

export const MODELOS_PIPELINE: readonly ModeloPipeline[] = [
  { id: "vendas", titulo: "Vendas", texto: "Para quem vende pelo WhatsApp: do primeiro contato ao fechamento.", nome: "Vendas", etapas: ["Novo contato", "Conversando", "Proposta enviada", "Fechado", "Perdido"] },
  { id: "atendimento", titulo: "Atendimento", texto: "Para pedidos e suporte: acompanhe cada atendimento até resolver.", nome: "Atendimento", etapas: ["Novo pedido", "Em atendimento", "Aguardando o cliente", "Resolvido"] },
  { id: "agenda", titulo: "Agendamentos", texto: "Para quem marca horários: do interesse ao retorno.", nome: "Agendamentos", etapas: ["Interessado", "Agendado", "Atendido", "Retorno"] },
  { id: "livre", titulo: "Do meu jeito", texto: "Você dá o nome e escreve as etapas.", nome: "", etapas: [] },
];

export const ETAPAS_MIN = 2;
export const ETAPAS_MAX = 12;

/** Texto do campo de etapas (uma por linha) → lista limpa. */
export const etapasDoTexto = (texto: string): string[] => texto.split(/\n|,/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

/** Nome e etapas prontos para gravar, ou o motivo da recusa (em português, para a tela). */
export function validarPipeline(nome: string, etapas: readonly string[]): { ok: true; name: string; stages: string[] } | { ok: false; erro: string } {
  const name = nome.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, erro: "Dê um nome ao pipeline." };
  if (name.length > 60) return { ok: false, erro: "Nome comprido demais (até 60 letras)." };
  const stages = etapas.map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (stages.length < ETAPAS_MIN) return { ok: false, erro: `Escreva pelo menos ${ETAPAS_MIN} etapas.` };
  if (stages.length > ETAPAS_MAX) return { ok: false, erro: `No máximo ${ETAPAS_MAX} etapas.` };
  const visto = new Set<string>();
  for (const s of stages) {
    if (s.length > 40) return { ok: false, erro: `Etapa comprida demais: "${s.slice(0, 20)}…" (até 40 letras).` };
    const k = s.toLowerCase();
    if (visto.has(k)) return { ok: false, erro: `Etapa repetida: "${s}".` };
    visto.add(k);
  }
  return { ok: true, name, stages };
}
