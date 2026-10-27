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
import type { Gateway, WhatsappAgente, WhatsappCapacidades } from "../../shared/ipc";

/** Arquivo da máquina com o agente escolhido para o WhatsApp (uma palavra: openclaw ou hermes). */
export const WA_AGENTE_FILE = "$HOME/.local/share/meu-bot/whatsapp-agente";
/** O conteúdo do arquivo de escolha → o agente; qualquer outra coisa é "não escolheu". */
export const agenteEscolhido = (raw: string | undefined): WhatsappAgente | null => {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "openclaw" || v === "hermes" ? v : null;
};
/**
 * Trecho de shell que deixa em $ESC a escolha gravada e diz se o Hermes atende: escolhido, ou sem escolha e com o
 * WhatsApp dele já configurado (como era antes da escolha existir). Status e pareamento usam o mesmo critério.
 */
export const WA_ESCOLHA_SH = `ESC=$(tr -d ' \n' < "${WA_AGENTE_FILE}" 2>/dev/null); usa_hermes() { [ "$ESC" = hermes ] || { [ "$ESC" != openclaw ] && [ -d "$HOME/.hermes/whatsapp" ]; }; }`;

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
    // Áudio: o app grava `stt` e `voice.auto_tts` no config.yaml (hermes-audio.ts); só não há escolha de voz.
    case "hermes":
      return { ...NADA, parear: true, listarConversas: connected, lerConversa: connected, limparHistorico: connected, pausar: connected, grupos: connected, politicaDm: true, audio: true, politicaReinicia: true };
    // PicoClaw: pareia e tem política de quem o agente responde; o resto ainda não foi mapeado.
    case "picoclaw":
      return { ...NADA, parear: true, politicaDm: true };
    default:
      return NADA;
  }
}
