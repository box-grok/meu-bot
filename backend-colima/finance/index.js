/**
 * meu-bot-finance: plugin do OpenClaw (24 h, na máquina) do agente financeiro no WhatsApp (produto meu-bot-finance).
 * Só no chat do dono consigo mesmo:
 *  - frase fechada ("gastei 48 no mercado", "recebi 3.000 do salário") vira lançamento na hora, sem modelo
 *    (regras.mjs → POST /v1/finance/lancamentos); "desfaz"/"errado" apaga o último em até 30 min;
 *  - antes de o agente responder, `before_prompt_build` põe no prompt o que o módulo acabou de lançar (para o agente
 *    confirmar numa frase e não lançar de novo) e, quando a conversa é de dinheiro ou chegou foto, o estado
 *    financeiro (GET /v1/finance/contexto). Frase livre, várias compras, correção e foto ficam com o agente, que tem
 *    a skill finance-api e a CLI finance.mjs. Uma resposta só: quem fala com o dono é sempre o agente;
 *  - uma vez por dia (9h–21h) cobra o que depende só do dono: pendências, renda do mês, fechar o mês anterior,
 *    gastos em dinheiro (regras.avisoDevido; estado dos avisos em finance/avisos.json).
 * "ok"/"não" ficam com o plugin do CRM. Sem o produto (403) ou backend fora: nada acontece. JS puro, sem npm.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { avisoDevido, ehChatDoDono, falaDeDinheiro, intencaoDono, normalizePhone, textoLancado } from "./regras.mjs";
import { financeApi } from "./backend.mjs";

const PLUGIN_ID = "meu-bot-finance";
const HOME = os.homedir();
const DIR = path.join(HOME, ".local", "share", "meu-bot", "finance");
const AVISOS = path.join(DIR, "avisos.json");
const PATH_EXTRA = `${HOME}/.openclaw/bin:${HOME}/.local/bin:/opt/node/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const DESFAZER_MS = 30 * 60_000;
const RECENTE_MS = 3 * 60_000;
const readJson = (f) => { try { const v = JSON.parse(fs.readFileSync(f, "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const writeJsonAtomico = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(tmp, f); };
const comTempo = (p, ms) => Promise.race([p, new Promise((r) => { const t = setTimeout(() => r(undefined), ms); if (typeof t.unref === "function") t.unref(); })]);

export default {
  id: PLUGIN_ID,
  name: "meu-bot · Financeiro no WhatsApp",
  register(api) {
    const logger = api.logger;
    const owner = normalizePhone(readJson(path.join(HOME, ".openclaw", "credentials", "whatsapp", "default", "creds.json"))?.me?.id ?? "");
    const fin = (m, c, b, timeoutMs = 8000) => financeApi(m, c, b, { por: "whatsapp", timeoutMs });
    let semProduto = false;
    const falhou = (e, oQue) => {
      if (e?.code === "finance_license") { if (!semProduto) logger.info(`${PLUGIN_ID}: sem o produto meu-bot-finance nesta máquina; parado`); semProduto = true; return; }
      logger.warn(`${PLUGIN_ID}: ${oQue}: ${e instanceof Error ? e.message : String(e)}`);
    };
    /** Por conversa do dono: a última mensagem dele, o que o módulo fez com ela e a promessa em andamento. */
    const sessoes = new Map();
    let ultimoLancado = null; // { id, linha, em }

    api.on("message_received", (event, ctx) => {
      if (ctx?.channelId !== "whatsapp" && ctx?.channel !== "whatsapp") return;
      if (owner === null || normalizePhone(event?.from) !== owner) return;
      const key = typeof ctx?.sessionKey === "string" && ctx.sessionKey !== "" ? ctx.sessionKey : `agent:main:whatsapp:direct:${owner}`;
      const texto = typeof event?.content === "string" ? event.content : "";
      const s = { texto, em: Date.now(), feito: null, promessa: null, midia: texto.trim() === "" || /<media:|\[(image|imagem|foto|media)/i.test(texto) };
      sessoes.set(key, s);
      const it = intencaoDono(texto);
      if (it === null || semProduto) return;
      if (it.tipo === "desfazer") {
        if (ultimoLancado === null || Date.now() - ultimoLancado.em > DESFAZER_MS) return;
        const alvo = ultimoLancado; ultimoLancado = null;
        s.promessa = fin("POST", `/lancamentos/${encodeURIComponent(alvo.id)}/descartar`, {})
          .then(() => { s.feito = `Desfeito: ${alvo.linha}.`; logger.info(`${PLUGIN_ID}: desfeito ${alvo.id}`); })
          .catch((e) => falhou(e, "desfazer"));
        return;
      }
      const corpo = { valor: it.valor, favorecido: it.favorecido, tipo: it.tipo, origem: "whatsapp", ...(it.retorno ? { retorno: it.retorno } : {}), ...(it.data ? { data: it.data } : {}), ...(it.forma ? { formaPagamento: it.forma } : {}) };
      s.promessa = fin("POST", it.tipo === "renda" ? "/renda" : "/lancamentos", it.tipo === "renda" ? { ...corpo, fonte: it.favorecido } : corpo)
        .then((r) => {
          const linha = r.linha ?? `${r.lancamento.data} · ${r.lancamento.categoriaNome} · ${r.lancamento.valor}`;
          s.feito = textoLancado({ ...r, linha });
          ultimoLancado = { id: r.lancamento.id, linha, em: Date.now() };
          logger.info(`${PLUGIN_ID}: lançado ${r.lancamento.id} (${r.lancamento.status})`);
        })
        .catch((e) => { falhou(e, "lançar"); if (e?.code !== "finance_license") s.feito = `O módulo de finanças não conseguiu lançar sozinho (${e.message}); lance você com finance.mjs.`; });
    });

    const cacheCtx = { texto: null, em: 0 };
    api.on("before_prompt_build", async (_event, ctx) => {
      if (semProduto || !ehChatDoDono(ctx, owner)) return undefined;
      const s = sessoes.get(ctx.sessionKey) ?? [...sessoes.values()].pop();
      if (s === undefined || Date.now() - s.em > RECENTE_MS) return undefined;
      if (s.promessa !== null) await comTempo(s.promessa, 1500);
      const partes = [];
      if (s.feito !== null) partes.push(`O módulo de finanças do meu-bot JÁ registrou a partir da última mensagem do dono: ${s.feito} Responda confirmando em uma frase curta em pt-BR. Não lance de novo e não invente valores.`);
      if (s.feito !== null || s.midia || falaDeDinheiro(s.texto)) {
        if (Date.now() - cacheCtx.em > 30_000 || s.feito !== null) {
          try { cacheCtx.texto = (await fin("GET", "/contexto", undefined, 1500))?.texto ?? null; cacheCtx.em = Date.now(); } catch (e) { falhou(e, "contexto"); }
        }
        if (cacheCtx.texto) partes.push(cacheCtx.texto);
        if (s.midia) partes.push("Se a mensagem do dono for foto de comprovante, nota ou recibo: leia estabelecimento, data, valor total e forma de pagamento e lance com finance.mjs lancar --origem foto --comprovante <caminho da foto> (fica pendente); responda o que leu e peça para ele corrigir se algo estiver errado.");
      }
      s.feito = null;
      if (partes.length === 0) return undefined;
      return { prependContext: partes.join("\n\n") };
    }, { timeoutMs: 2500 });

    // ---- cobrança diária -----------------------------------------------------------------------------------------
    const enviar = (texto) => new Promise((resolve) => {
      execFile("openclaw", ["message", "send", "--channel", "whatsapp", "--target", owner, "--message", texto, "--json"], { timeout: 90_000, env: { ...process.env, PATH: PATH_EXTRA } }, (err) => { if (err) logger.warn(`${PLUGIN_ID}: aviso não saiu: ${err.message}`); resolve(!err); });
    });
    let rodando = false;
    const tick = async () => {
      if (rodando || owner === null) return; rodando = true;
      try {
        const agora = new Date();
        const avisos = readJson(AVISOS);
        let estado;
        try { estado = await fin("GET", "/estado"); semProduto = false; } catch (e) { falhou(e, "estado"); return; }
        const a = avisoDevido(estado, avisos, agora.getTime(), agora.getHours(), agora.getDate());
        if (a === null) return;
        if (await enviar(a.texto)) { for (const k of a.assuntos) avisos[k] = agora.getTime(); writeJsonAtomico(AVISOS, avisos); logger.info(`${PLUGIN_ID}: aviso enviado (${a.assuntos.join(", ")})`); }
      } finally { rodando = false; }
    };
    let timer = null;
    const start = () => { if (timer !== null) return; timer = setInterval(() => { void tick(); }, 30 * 60_000); if (typeof timer.unref === "function") timer.unref(); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    api.on("gateway_start", (_e, ctx) => { start(); if (ctx?.abortSignal && typeof ctx.abortSignal.addEventListener === "function") ctx.abortSignal.addEventListener("abort", stop, { once: true }); });
    api.on("gateway_stop", () => stop());
    const partida = setTimeout(start, 5_000);
    if (typeof partida.unref === "function") partida.unref();
    logger.info(`${PLUGIN_ID}: ativo (dono ${owner ?? "?"})`);
  },
};
