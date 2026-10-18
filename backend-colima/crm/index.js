/**
 * meu-bot-crm: plugin do OpenClaw (24 h, na máquina) do "CRM pelo WhatsApp" (meu-bot, módulo Pro).
 * Observa as conversas diretas do WhatsApp e, quando uma fica em silêncio por N minutos (config `silencioMin`,
 * 10 por padrão), roda `crm-job.mjs <sessionKey>` em segundo plano: o agente anota no Streak pela API.
 * No chat do dono consigo mesmo: "anota no CRM: …" / "crm: …" roda o job na hora; "ok" / "ok 2" / "não" respondem
 * à última proposta. JS puro: plugin local não recebe npm install. Estado do silêncio em crm/tracker.json.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SilenceTracker, confirmIndex, isConfirm, isDirectWhatsapp, isReject, normalizePhone, ownerCommand, phoneOfSessionKey } from "./regras.mjs";

const PLUGIN_ID = "meu-bot-crm";
const HOME = os.homedir();
const DIR = path.join(HOME, ".local", "share", "meu-bot", "crm");
const JOB = path.join(DIR, "crm-job.mjs");
const TRACKER = path.join(DIR, "tracker.json");
const PATH_EXTRA = `${HOME}/.openclaw/bin:${HOME}/.local/bin:/opt/node/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

const readJson = (f) => { try { const v = JSON.parse(fs.readFileSync(f, "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
function sessionKeyOf(ctx, other) {
  if (typeof ctx?.sessionKey === "string" && ctx.sessionKey !== "") return ctx.sessionKey;
  const p = normalizePhone(other); return p === null ? null : `agent:main:whatsapp:direct:${p}`;
}

export default {
  id: PLUGIN_ID,
  name: "meu-bot · CRM pelo WhatsApp",
  register(api) {
    const logger = api.logger;
    const conf = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};
    const silenceMs = (typeof conf.silencioMin === "number" && conf.silencioMin >= 1 ? conf.silencioMin : 10) * 60_000;
    const owner = normalizePhone(readJson(path.join(HOME, ".openclaw", "credentials", "whatsapp", "default", "creds.json"))?.me?.id ?? "");
    const tracker = new SilenceTracker(readJson(TRACKER));
    const persist = () => { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(TRACKER, JSON.stringify(tracker.toJSON())); } catch { /* cortesia */ } };
    const runJob = (args, why) => {
      try {
        if (!fs.existsSync(JOB)) { logger.warn(`${PLUGIN_ID}: ${JOB} não existe; reinstale o CRM pelo meu-bot`); return; }
        const child = spawn("node", [JOB, ...args], { detached: true, stdio: "ignore", env: { ...process.env, PATH: PATH_EXTRA } });
        child.unref();
        logger.info(`${PLUGIN_ID}: job (${why}): ${args.join(" ").slice(0, 120)}`);
      } catch (e) { logger.warn(`${PLUGIN_ID}: job não iniciou: ${e instanceof Error ? e.message : String(e)}`); }
    };
    const touch = (key, at) => { if (!isDirectWhatsapp(key) || phoneOfSessionKey(key) === owner) return; tracker.touch(key, at); persist(); };

    api.on("message_received", (event, ctx) => {
      if (ctx?.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, event?.from); if (key === null) return;
      const from = normalizePhone(event?.from);
      const text = typeof event?.content === "string" ? event.content : "";
      if (owner !== null && from === owner) {
        // Chat do dono consigo mesmo: comandos e respostas às propostas.
        const cmd = ownerCommand(text);
        if (cmd !== null) { runJob(["--dono", "--comando", cmd], "pedido do dono"); return; }
        if (isConfirm(text) || confirmIndex(text) !== null) { const n = confirmIndex(text); runJob(n === null ? ["--aplicar"] : ["--aplicar", String(n)], "confirmação"); return; }
        if (isReject(text)) { runJob(["--descartar"], "descarte"); return; }
        return;
      }
      touch(key, typeof event?.timestamp === "number" ? event.timestamp : Date.now());
    });
    api.on("message_sending", (event, ctx) => {
      if (ctx?.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, event?.to); if (key === null) return;
      touch(key, Date.now());
    });

    let timer = null;
    const tick = () => { for (const key of tracker.due(Date.now(), silenceMs)) { persist(); runJob([key], "silêncio"); } };
    const start = () => { if (timer !== null) return; timer = setInterval(tick, 30_000); if (typeof timer.unref === "function") timer.unref(); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    api.on("gateway_start", (_e, ctx) => { start(); if (ctx?.abortSignal && typeof ctx.abortSignal.addEventListener === "function") ctx.abortSignal.addEventListener("abort", stop, { once: true }); });
    api.on("gateway_stop", () => stop());
    setTimeout(start, 5_000); // se o gateway já estava de pé quando o plugin carregou
    logger.info(`${PLUGIN_ID}: ativo (silêncio ${silenceMs / 60_000} min; dono ${owner ?? "?"})`);
  },
};
