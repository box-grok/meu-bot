/**
 * meu-bot-crm: plugin do OpenClaw (24 h, na máquina) do "CRM pelo WhatsApp" (meu-bot, módulo Pro).
 * Observa as conversas diretas do WhatsApp e, quando uma fica em silêncio por N minutos (config `silencioMin`,
 * 10 por padrão), roda `crm-job.mjs <sessionKey>` em segundo plano: o agente anota no Streak pela API.
 * No chat do dono consigo mesmo: "anota no CRM: …" / "crm: …" roda o job na hora; "ok" / "ok 2" / "não" respondem
 * à última proposta. JS puro: plugin local não recebe npm install. Estado do silêncio em crm/tracker.json.
 * No sentido contrário (CRM → WhatsApp), antes de cada resposta a um contato o hook `before_prompt_build` põe no
 * prompt o essencial da caixa dele (GET /v1/crm/contexto: caixa, etapa, próximo passo, visão geral). Sem caixa,
 * CRM desligado (`contextoWhatsapp: false`) ou backend fora: nada é acrescentado e a resposta segue normal.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SilenceTracker, confirmIndex, deveInjetarContexto, mesclarContatoWhatsapp, isConfirm, isDirectWhatsapp, isReject, normalizePhone, ownerCommand, phoneOfSessionKey } from "./regras.mjs";
import { crmApi } from "./backend.mjs";

const PLUGIN_ID = "meu-bot-crm";
const HOME = os.homedir();
const DIR = path.join(HOME, ".local", "share", "meu-bot", "crm");
const JOB = path.join(DIR, "crm-job.mjs");
const TRACKER = path.join(DIR, "tracker.json");
const CONTATOS_WA = path.join(DIR, "whatsapp-contatos.json");
const writeJsonAtomico = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(tmp, f); };
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
      // Contato novo do WhatsApp: anotado para ir para o Google Contatos (o app do Mac salva lá).
      if (isDirectWhatsapp(key)) {
        const md = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
        const nome = [md.senderName, md.pushName, md.notifyName, md.senderLabel, ctx?.senderName].find((x) => typeof x === "string" && x.trim() !== "");
        try { const atual = readJson(CONTATOS_WA); writeJsonAtomico(CONTATOS_WA, { contatos: mesclarContatoWhatsapp(atual.contatos ?? {}, { telefone: phoneOfSessionKey(key), nome, em: Date.now() }) }); } catch { /* cortesia */ }
      }
    });
    api.on("message_sending", (event, ctx) => {
      if (ctx?.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, event?.to); if (key === null) return;
      touch(key, Date.now());
    });

    // CRM → WhatsApp: contexto da caixa antes de cada resposta (cache curto: respostas seguidas não refazem a consulta).
    const cacheCtx = new Map(); let falhou = false;
    const CACHE_MS = 60_000;
    let diagnosticado = false;
    api.on("before_prompt_build", async (_event, ctx) => {
      // Uma vez por subida: que campos o OpenClaw manda (canal e forma da sessão, sem conteúdo) — para diagnóstico.
      if (!diagnosticado) { diagnosticado = true; logger.info(`${PLUGIN_ID}: before_prompt_build ativo (channel=${ctx?.channel ?? "-"} provider=${ctx?.messageProvider ?? "-"} sessão=${String(ctx?.sessionKey ?? "-").replace(/\+?\d{6,}/g, "+N")})`); }
      const tel = deveInjetarContexto(ctx, owner); if (tel === null) return undefined;
      const c = cacheCtx.get(tel);
      let texto = c && Date.now() - c.em < CACHE_MS ? c.texto : undefined;
      if (texto === undefined) {
        try { texto = (await crmApi("GET", `/contexto?phone=${encodeURIComponent(tel)}`, undefined, { por: "whatsapp", timeoutMs: 1500 }))?.texto ?? null; falhou = false; }
        catch (e) { if (!falhou) logger.warn(`${PLUGIN_ID}: contexto do CRM indisponível (${e instanceof Error ? e.message : String(e)}); respondendo sem ele`); falhou = true; return undefined; }
        cacheCtx.set(tel, { texto, em: Date.now() });
        if (cacheCtx.size > 500) cacheCtx.delete(cacheCtx.keys().next().value);
      }
      if (typeof texto !== "string" || texto === "") return undefined;
      logger.info(`${PLUGIN_ID}: contexto CRM para ${tel} (${texto.length} chars)`);
      return { prependContext: texto };
    }, { timeoutMs: 2000 });

    let timer = null;
    const tick = () => { for (const key of tracker.due(Date.now(), silenceMs)) { persist(); runJob([key], "silêncio"); } };
    const start = () => { if (timer !== null) return; timer = setInterval(tick, 30_000); if (typeof timer.unref === "function") timer.unref(); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    api.on("gateway_start", (_e, ctx) => { start(); if (ctx?.abortSignal && typeof ctx.abortSignal.addEventListener === "function") ctx.abortSignal.addEventListener("abort", stop, { once: true }); });
    api.on("gateway_stop", () => stop());
    const partida = setTimeout(start, 5_000); // se o gateway já estava de pé quando o plugin carregou
    if (typeof partida.unref === "function") partida.unref();
    logger.info(`${PLUGIN_ID}: ativo (silêncio ${silenceMs / 60_000} min; dono ${owner ?? "?"})`);
  },
};
