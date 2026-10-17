/**
 * O agente sabe que foi pausado e que voltou. A pausa do meu-bot é só `sendPolicy: "deny"` na sessão do contato:
 * o agente continua rodando e o gateway descarta a entrega, sem avisar ninguém. Aqui, as duas peças que dão o
 * contexto a ele, iguais em todas as máquinas (a regra é do meu-bot, que é quem pausa):
 *
 * 1. uma nota na própria conversa ao pausar e ao retomar, como um turno de verdade do agente
 *    (`openclaw agent --session-key … --message-file …`, sem entregar nada ao WhatsApp): com o runtime
 *    claude-cli o contexto do modelo é a sessão do Claude Code, e só um turno chega lá. O `chat.inject` do
 *    gateway grava uma linha "visível ao operador" no transcript, mas o modelo nunca a vê (testado: o agente
 *    disse que nenhum aviso chegou). A de retomada aponta para a de pausa, então não há estado a guardar;
 * 2. um bloco padrão no AGENTS.md do workspace do agente explicando o que as notas significam e como agir.
 *
 * Puro (sem Electron): whatsapp.ts e ipc/client.ts rodam os scripts por SSH.
 */

export type PauseBy = "dono" | "admin";

/** Só chaves que o próprio OpenClaw gera entram no script remoto (as mesmas de whatsapp.ts). */
const SAFE_KEY = /^[A-Za-z0-9:+._-]{1,200}$/;

export const PAUSE_RULE_VERSION = 1;
const RULE_START = `<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} inicio -->`;
const RULE_END = `<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} fim -->`;
export const PAUSE_RULE_BLOCK = `${RULE_START}
## Pausa pelo meu-bot
O app meu-bot pode pausar você para um contato. Você sabe pelas notas "Nota do meu-bot: … pausado …" e
"… pausa encerrada …" no histórico desta conversa.
- Enquanto pausado: as mensagens do contato continuam chegando e você pode pensar e responder, mas nada do
  que responder é entregue. Não insista, não repita, não tente outro canal.
- Ao ver "pausa encerrada": tudo o que você respondeu entre as duas notas não chegou. Na próxima mensagem do
  contato, responda ao que ficou pendente numa mensagem só, resumida. Não repita as respostas antigas.
- Não fale da pausa com o contato a menos que ajude a explicar um silêncio longo.
${RULE_END}
`;

/** "17/10/2026 00:20 (Horário Padrão de Brasília)": a hora do Mac de quem clicou, porque a VM costuma estar em UTC. */
export function localWhenText(d: Date, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "long", ...(timeZone === undefined ? {} : { timeZone }) };
  const parts = new Intl.DateTimeFormat("pt-BR", opts).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} (${get("timeZoneName")})`;
}

/**
 * A nota que entra na conversa como mensagem para o agente. Começa com "Nota do meu-bot:" (não é o contato
 * falando) e pede uma resposta de uma palavra: a resposta não é entregue, só fecha o turno.
 */
export function pauseNoteText(kind: "pause" | "resume", whenText: string, by: PauseBy): string {
  const who = by === "admin" ? "pelo suporte" : "pelo dono do número";
  const tail = " Não responda a esta nota ao contato; apenas registre com uma palavra.";
  return kind === "pause"
    ? `Nota do meu-bot: o agente foi pausado para este contato em ${whenText} ${who}. A partir daqui, nada do que você responder será entregue ao contato. Você pode continuar raciocinando; a resposta não chega.${tail}`
    : `Nota do meu-bot: pausa encerrada em ${whenText} ${who}. Nada do que você respondeu desde a nota "pausado" acima chegou ao contato; ele só vê o que você mandar a partir de agora. Na próxima mensagem dele, responda ao que ficou pendente de forma resumida, sem repetir tudo.${tail}`;
}

/**
 * Um turno do agente na sessão com a nota, em segundo plano na máquina (a pausa em si volta na hora; a nota
 * entra uns segundos depois). `openclaw agent` sem `--deliver` não manda nada ao WhatsApp; a mensagem vai por
 * arquivo (base64 → mktemp) para texto com aspas e acentos não passar pelo shell. Imprime NOTA=agendada.
 */
export function pauseNoteSh(key: string, text: string): string {
  if (!SAFE_KEY.test(key)) throw new Error("chave de sessão inválida");
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return `F=$(mktemp /tmp/meu-bot-nota.XXXXXX) && printf '%s' '${b64}' | base64 -d > "$F" && ( nohup sh -c 'timeout 180 openclaw agent --session-key "$1" --message-file "$2" >/dev/null 2>&1; rm -f "$2"' sh '${key}' "$F" >/dev/null 2>&1 & ) && echo "NOTA=agendada" || echo "NOTA=erro"`;
}

/**
 * Garante o bloco da pausa no AGENTS.md do workspace do agente (o configurado, senão ~/.openclaw/workspace).
 * Idempotente: sem bloco acrescenta no fim; bloco de outra versão é trocado; igual, nada. Imprime REGRA=1
 * (gravou/trocou), REGRA=0 (já estava) ou REGRA=erro.
 */
export function pauseRuleSh(): string {
  const b64 = Buffer.from(PAUSE_RULE_BLOCK, "utf8").toString("base64");
  return `W="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '\\n')"; case "$W" in /*) ;; *) W="$HOME/.openclaw/workspace" ;; esac
mkdir -p "$W" && printf '%s' '${b64}' | base64 -d | python3 -c '
import re, sys, os
f = sys.argv[1]
block = sys.stdin.read()
try:
    cur = open(f, encoding="utf-8").read()
except FileNotFoundError:
    cur = ""
pat = re.compile(r"\\n?<!-- meu-bot:pausa v\\d+ inicio -->.*?<!-- meu-bot:pausa v\\d+ fim -->\\n?", re.S)
m = pat.search(cur)
if m and m.group(0).strip() == block.strip():
    print("REGRA=0"); sys.exit(0)
new = (cur[:m.start()] + "\\n" + block + cur[m.end():]) if m else (cur + ("" if cur == "" or cur.endswith("\\n") else "\\n") + "\\n" + block)
tmp = f + ".tmp"
open(tmp, "w", encoding="utf-8").write(new)
os.replace(tmp, f)
print("REGRA=1")
' "$W/AGENTS.md" 2>/dev/null || echo "REGRA=erro"`;
}
