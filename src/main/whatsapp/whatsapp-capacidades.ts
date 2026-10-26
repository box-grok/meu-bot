/**
 * O que cada framework de agente sabe fazer no WhatsApp (puro, testável).
 *
 * O app é agnóstico: a tela não pergunta "é OpenClaw?", pergunta "esta máquina sabe listar
 * conversas?". Antes a decisão estava espalhada em vinte lugares, cada um comparando o nome do
 * gateway, e por isso uma máquina com Hermes via mensagens escritas como se o produto estivesse
 * faltando — quando o que falta é a capacidade, não o produto.
 *
 * Esta tabela é o único lugar que conhece nomes de framework. Ganhar suporte novo é mudar uma
 * linha aqui, não caçar comparações pela tela.
 */
import type { Gateway, WhatsappCapacidades } from "../../shared/ipc";

const NADA: WhatsappCapacidades = {
  parear: false, listarConversas: false, lerConversa: false, limparHistorico: false,
  pausar: false, grupos: false, guarda: false, politicaDm: false, audio: false, politicaReinicia: false,
};

/**
 * `ready` = dá para parear (tem bridge/plugin). `connected` = o número está vinculado. Capacidade
 * que depende de conversa existir só vale com o número conectado; sem isso a tela ofereceria algo
 * que falharia na primeira tentativa.
 */
export function capacidadesDe(gateway: Gateway | null, ready: boolean, connected: boolean): WhatsappCapacidades {
  if (gateway === null || !ready) return NADA;
  switch (gateway) {
    // OpenClaw guarda a conversa num banco próprio e expõe sessões pelo gateway: dá para tudo.
    case "openclaw":
      return {
        parear: true, listarConversas: connected, lerConversa: connected, limparHistorico: connected,
        pausar: connected, grupos: connected, guarda: true, politicaDm: true, audio: true, politicaReinicia: false,
      };
    // Hermes não tem banco de conversas; o histórico vem do hook `wa-mirror`, que grava em
    // ~/.hermes/wa-mirror/inbox.jsonl o que o agente atendeu (mensagem truncada em 500 caracteres,
    // limite do próprio Hermes). Dá para listar, ler e limpar (encerra as sessões do contato no state.db);
    // quem responde vive no ~/.hermes/.env (whatsapp-hermes-core.ts) e aplicar reinicia o gateway.
    // Grupos: ligar/desligar e "quando chamado" vão para o config.yaml (platforms.whatsapp) com reinício; quem aciona
    // é a lista única das conversas diretas. Pausar por contato e guarda não existem lá.
    // Pausar = tirar da lista de quem o agente responde enquanto durar (o agente nem vê as mensagens nesse período).
    case "hermes":
      return { ...NADA, parear: true, listarConversas: connected, lerConversa: connected, limparHistorico: connected, pausar: connected, grupos: connected, politicaDm: true, politicaReinicia: true };
    // PicoClaw: pareia e tem política de quem o agente responde; o resto ainda não foi mapeado.
    case "picoclaw":
      return { ...NADA, parear: true, politicaDm: true };
    default:
      return NADA;
  }
}
