/**
 * meu-bot-guarda: plugin do OpenClaw que roda no gateway da máquina (24 h, sem depender do app).
 * 1. Notas operacionais do OpenClaw ("↪️ Model Fallback…", "↪️ Retried on…") nunca vão ao contato do WhatsApp:
 *    o hook `message_sending` cancela a entrega (o estado de fallback do OpenClaw continua; só a linha não sai).
 * 2. Loop bot-com-bot: `message_received` abre um ciclo, `message_sending` fecha; no 3º ciclo suspeito
 *    (regras.mjs) cancela a resposta, aplica sendPolicy "deny" na sessão (a mesma pausa manual do meu-bot,
 *    que a lista do app mostra como "pausado") e injeta a nota ao agente, como a pausa manual faz.
 * Retomar é manual (menu "…" › Retomar no meu-bot). JS puro: plugin local não recebe npm install.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LoopTracker, autoPauseNoteText, closureVerdict, isOperationalNotice, loopVerdict } from "./regras.mjs";

const PLUGIN_ID = "meu-bot-guarda";
const tracker = new LoopTracker();
/** Sessões que a guarda pausou e ainda não viu retomadas (evita pausar duas vezes e deixa o tracker quieto). */
const pausedByUs = new Set();

/** Chave de sessão do contato: a do contexto, ou montada de `to` (nos envios do WhatsApp ela pode faltar). */
function sessionKeyOf(ctx, to) {
  if (typeof ctx.sessionKey === "string" && ctx.sessionKey !== "") return ctx.sessionKey;
  const num = String(to ?? "").replace(/@.*$/, "").replace(/[^\d+]/g, "");
  if (num === "") return null;
  return `agent:main:whatsapp:direct:${num.startsWith("+") ? num : `+${num}`}`;
}
const peerOf = (key) => key.split(":").pop() ?? key;
const whenText = () => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date());

/** A nota ao agente, como na pausa manual: um turno em segundo plano, sem --deliver (nada vai ao WhatsApp). */
function injectNote(key, text, logger) {
  try {
    const f = fs.mkdtempSync(path.join(os.tmpdir(), "meu-bot-nota-"));
    const file = path.join(f, "nota.txt");
    fs.writeFileSync(file, text, "utf8");
    const child = spawn("sh", ["-c", `timeout 180 openclaw agent --session-key "$1" --message-file "$2" >/dev/null 2>&1; rm -rf "$3"`, "sh", key, file, f], { detached: true, stdio: "ignore", env: { ...process.env, PATH: `${os.homedir()}/.openclaw/bin:${os.homedir()}/.local/bin:/opt/node/bin:${process.env.PATH ?? ""}` } });
    child.unref();
  } catch (e) { logger.warn(`${PLUGIN_ID}: nota ao agente não agendada: ${e instanceof Error ? e.message : String(e)}`); }
}

/** Registro de auditoria da máquina (quem: "agente"), pelo auditoria.py que o backend do meu-bot deixa na pasta dele. */
function auditar(peer, reason, logger) {
  const py = path.join(os.homedir(), ".local", "share", "meu-bot", "auditoria.py");
  if (!fs.existsSync(py)) return;
  const b64 = Buffer.from(JSON.stringify({ quem: { tipo: "agente", nome: "guarda do WhatsApp" }, app: "plugin", acao: "whatsapp.pausa-automatica", alvo: String(peer ?? ""), detalhe: String(reason ?? "").slice(0, 300) }), "utf8").toString("base64url");
  const p = spawn("python3", [py, "gravar", b64], { stdio: "ignore" });
  p.on("error", (e) => logger.warn(`${PLUGIN_ID}: auditoria: ${e.message}`));
}

export default {
  id: PLUGIN_ID,
  name: "meu-bot · guarda do WhatsApp",
  register(api) {
    const logger = api.logger;
    const agentIdOf = (key) => key.split(":")[1] || "main";

    async function pause(key, reason) {
      pausedByUs.add(key);
      tracker.forget(key);
      await api.runtime.agent.session.patchSessionEntry({ agentId: agentIdOf(key), sessionKey: key, preserveActivity: true, update: () => ({ sendPolicy: "deny" }) });
      logger.warn(`${PLUGIN_ID}: loop com ${peerOf(key)} (${reason}); conversa pausada (sendPolicy deny)`);
      injectNote(key, autoPauseNoteText(reason, whenText(), peerOf(key)), logger);
      auditar(peerOf(key), reason, logger);
    }

    // Confirmação no log de que o hook de entrada chega (exige plugins.entries.meu-bot-guarda.hooks.allowConversationAccess).
    const seenIn = new Set();
    api.on("message_received", (event, ctx) => {
      if (ctx.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, event.from);
      if (key === null || !key.includes(":direct:")) return;
      if (!seenIn.has(key)) { seenIn.add(key); logger.info(`${PLUGIN_ID}: observando ${peerOf(key)} (entrada recebida)`); }
      if (pausedByUs.has(key)) return;
      tracker.received(key, event.content ?? "", typeof event.timestamp === "number" ? event.timestamp : Date.now());
    });

    api.on("message_sending", async (event, ctx) => {
      if (ctx.channelId !== "whatsapp") return;
      const text = event.content ?? "";
      if (isOperationalNotice(text)) {
        logger.info(`${PLUGIN_ID}: nota operacional não entregue a ${event.to}: ${text.slice(0, 80)}`);
        return { cancel: true, cancelReason: `${PLUGIN_ID}: nota operacional do OpenClaw` };
      }
      const key = sessionKeyOf(ctx, event.to);
      if (key === null || !key.includes(":direct:")) return;
      if (pausedByUs.has(key)) return; // o gateway já descarta pelo sendPolicy; nada a fazer
      const r = tracker.sending(key, text, Date.now());
      if (!r.loop) return;
      try { await pause(key, r.reason); }
      catch (e) { logger.error(`${PLUGIN_ID}: não consegui pausar ${key}: ${e instanceof Error ? e.message : String(e)}`); return; }
      return { cancel: true, cancelReason: `${PLUGIN_ID}: ${r.reason}` };
    });

    // Fim de cada turno do agente: o OpenClaw entrega a conversa inteira (`event.messages`). É o único hook em que a
    // entrada do contato aparece (message_received não chega a plugins de fora), então o loop é reavaliado com os
    // dois lados (3 ciclos) e, além dele, a conversa encerrada: o agente se despediu e ficou em silêncio 2 vezes →
    // pausa de verdade (sendPolicy deny), que o app mostra como "pausado", como se o dono tivesse clicado.
    api.on("agent_end", async (event, ctx) => {
      if (ctx?.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, null);
      if (key === null || !key.includes(":direct:") || pausedByUs.has(key)) return;
      const msgs = Array.isArray(event?.messages) ? event.messages : [];
      if (msgs.length === 0) return;
      const loop = loopVerdict(msgs);
      const closed = loop.loop ? { closed: false } : closureVerdict(msgs);
      if (!loop.loop && !closed.closed) return;
      try { await pause(key, loop.loop ? loop.reason : closed.reason); }
      catch (e) { logger.error(`${PLUGIN_ID}: não consegui pausar ${key} (agent_end): ${e instanceof Error ? e.message : String(e)}`); }
    });
    // Retomada manual (sendPolicy volta a null pelo meu-bot): esquecer a sessão para a guarda voltar a observar.
    api.on("session_start", (_event, ctx) => { if (typeof ctx?.sessionKey === "string") pausedByUs.delete(ctx.sessionKey); });
    logger.info(`${PLUGIN_ID}: ativo (nota de fallback bloqueada; pausa automática em loop de 3 ciclos)`);
  },
};
