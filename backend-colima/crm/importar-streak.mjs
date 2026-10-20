#!/usr/bin/env node
/**
 * importar-streak.mjs — traz um pipeline do Streak (API pública, chave pessoal) para o CRM próprio desta máquina,
 * uma vez. As chaves do Streak (pipeline, etapas, campos, opções, boxes, contatos, comentários) são preservadas:
 * rodar de novo não duplica (o backend faz upsert por chave). A chave do Streak só vive na memória deste processo.
 *
 *   node importar-streak.mjs --chave <apiKey> [--pipeline <keyStreak>] [--definir-padrao] [--dry-run] [--forcar]
 *   (sem --pipeline: lista os pipelines do Streak e sai; a chave também pode vir em STREAK_API_KEY)
 * Saída: JSON em uma linha (relatório). Erro → {"erro": "..."} e código 1.
 */
import { crmApi } from "./backend.mjs";

const API = "https://api.streak.com/api";
const argv = process.argv.slice(2);
const opt = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { opt[k] = v; i++; } else opt[k] = true; } }
const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); };
const fail = (m) => { out({ erro: m }); process.exit(1); };
const chave = typeof opt.chave === "string" ? opt.chave : process.env.STREAK_API_KEY ?? "";

async function streak(p, key = chave) {
  for (let tent = 0; ; tent++) {
    const res = await fetch(`${API}${p}`, { headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, Accept: "application/json" } });
    if ((res.status === 429 || res.status >= 500) && tent < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** tent)); continue; }
    const text = await res.text(); let json = null; try { json = text === "" ? null : JSON.parse(text); } catch { json = null; }
    if (!res.ok) throw new Error(res.status === 401 ? "chave da API recusada pelo Streak" : `Streak respondeu ${res.status} em GET ${p}`);
    return json;
  }
}
/** Mapa de tipos do Streak → tipos do CRM próprio; o que não cabe vira TEXT com aviso. */
export function mapearTipo(t) {
  const m = { TEXT_INPUT: "TEXT", TEXT: "TEXT", NUMBER: "NUMBER", DATE: "DATE", DROPDOWN: "DROPDOWN", TAG: "TAG", CHECKBOX: "CHECKBOX" };
  return { type: m[t] ?? "TEXT", aviso: m[t] === undefined ? `campo do tipo ${t ?? "?"} virou texto` : null };
}
/** Puro: o que o Streak devolveu → bundle do POST /v1/crm/import. `comentarios`/`threads`/`contatos` por box. */
export function normalizarStreak({ pipeline, boxes, comentariosPorBox = {}, threadsPorBox = {}, contatos = {} }) {
  const avisos = [];
  const order = Array.isArray(pipeline.stageOrder) ? pipeline.stageOrder : Object.keys(pipeline.stages ?? {});
  const stages = order.map((k) => ({ key: String(k), name: String(pipeline.stages?.[k]?.name ?? k) }));
  const fields = (Array.isArray(pipeline.fields) ? pipeline.fields : []).map((f) => {
    const { type, aviso } = mapearTipo(f.type); if (aviso) avisos.push(`${f.name}: ${aviso}`);
    const items = Array.isArray(f.dropdownSettings?.items) ? f.dropdownSettings.items : Array.isArray(f.tagSettings?.tags) ? f.tagSettings.tags : [];
    return { key: String(f.key), name: String(f.name ?? f.key), type, options: items.map((it) => ({ key: String(it.key), name: String(it.name ?? it.key) })) };
  });
  const tipoDe = Object.fromEntries(fields.map((f) => [f.key, f.type]));
  const contatosOut = new Map();
  const bxs = (Array.isArray(boxes) ? boxes : []).map((b) => {
    const key = String(b.boxKey ?? b.key);
    const fv = {};
    for (const [k, v] of Object.entries(b.fields ?? {})) {
      if (v === null || v === undefined || v === "") continue;
      const t = tipoDe[String(k)]; if (t === undefined) continue;
      if (t === "TAG") fv[k] = Array.isArray(v) ? v.map(String) : [String(v)];
      else if (t === "DROPDOWN") fv[k] = String(Array.isArray(v) ? v[0] : v);
      else if (t === "NUMBER") { const n = Number(v); if (Number.isFinite(n)) fv[k] = n; }
      else if (t === "DATE") { const n = Number(v); if (Number.isFinite(n)) fv[k] = n; }
      else if (t === "CHECKBOX") fv[k] = v === true || v === "true";
      else fv[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    const contatoKeys = [];
    for (const c of Array.isArray(b.contacts) ? b.contacts : []) {
      const ck = String(c.key ?? ""); if (ck === "") continue;
      const full = contatos[ck];
      if (full && !contatosOut.has(ck)) contatosOut.set(ck, { key: ck, nome: [full.givenName, full.familyName].filter(Boolean).join(" "), emails: Array.isArray(full.emailAddresses) ? full.emailAddresses : [], telefones: Array.isArray(full.phoneNumbers) ? full.phoneNumbers : [], origem: { streak: ck } });
      if (full) contatoKeys.push(ck);
    }
    const comentarios = (Array.isArray(comentariosPorBox[key]) ? comentariosPorBox[key] : []).map((c) => ({ key: String(c.key ?? c.commentKey ?? ""), at: Number(c.timestamp) || 0, autor: "streak", texto: String(c.message ?? "") })).filter((c) => c.texto.trim() !== "");
    const threads = (Array.isArray(threadsPorBox[key]) ? threadsPorBox[key] : []).map((t) => ({ threadGmailId: String(t.threadGmailId ?? "").toLowerCase(), assunto: String(t.subject ?? t.name ?? ""), emails: Array.isArray(t.emailAddresses) ? t.emailAddresses : [], nomes: Array.isArray(t.names) ? t.names : [], mensagens: Number.isInteger(t.numberOfEmails) ? t.numberOfEmails : null, em: Number(t.lastUpdatedTimestamp) || 0 })).filter((t) => /^[0-9a-f]{10,20}$/.test(t.threadGmailId));
    return { key, name: String(b.name ?? key), stageKey: String(b.stageKey ?? stages[0]?.key ?? ""), notes: typeof b.notes === "string" ? b.notes : "", fields: fv, updatedAt: Number(b.lastUpdatedTimestamp) || 0, origem: { streak: key }, contatoKeys, comentarios, threads };
  });
  return { pipeline: { key: String(pipeline.key ?? pipeline.pipelineKey), name: String(pipeline.name ?? ""), stages, fields, origem: { streak: String(pipeline.key ?? pipeline.pipelineKey) } }, boxes: bxs, contatos: [...contatosOut.values()], avisos };
}
/** Roda N promessas por vez. */
async function lote(itens, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); } })); return out; }

async function main() {
  if (chave.length < 16) throw new Error("uso: --chave <chave da API do Streak> (ou STREAK_API_KEY)");
  if (typeof opt.pipeline !== "string") {
    const ps = await streak("/v1/pipelines");
    return out({ pipelines: (Array.isArray(ps) ? ps : []).map((p) => ({ key: p.key ?? p.pipelineKey, name: p.name, boxes: p.boxCount ?? null })), dica: "rode de novo com --pipeline <key>" });
  }
  const pipeline = await streak(`/v1/pipelines/${encodeURIComponent(opt.pipeline)}`);
  const boxes = await streak(`/v1/pipelines/${encodeURIComponent(opt.pipeline)}/boxes`);
  const lista = Array.isArray(boxes) ? boxes : [];
  process.stderr.write(`▸ ${pipeline.name}: ${lista.length} boxes; lendo comentários e threads…\n`);
  const comentariosPorBox = {}; const threadsPorBox = {}; const contatos = {};
  await lote(lista, 4, async (b) => {
    const k = b.boxKey ?? b.key;
    try { comentariosPorBox[k] = await streak(`/v1/boxes/${encodeURIComponent(k)}/comments`); } catch { comentariosPorBox[k] = []; }
    try { threadsPorBox[k] = await streak(`/v1/boxes/${encodeURIComponent(k)}/threads`); } catch { threadsPorBox[k] = []; }
    for (const c of Array.isArray(b.contacts) ? b.contacts : []) if (c.key && !contatos[c.key]) { try { contatos[c.key] = await streak(`/v2/contacts/${encodeURIComponent(c.key)}`); } catch { /* sem contato */ } }
  });
  const bundle = normalizarStreak({ pipeline, boxes: lista, comentariosPorBox, threadsPorBox, contatos });
  if (opt["dry-run"] === true) return out({ dryRun: true, pipeline: bundle.pipeline.name, etapas: bundle.pipeline.stages.length, campos: bundle.pipeline.fields.length, boxes: bundle.boxes.length, contatos: bundle.contatos.length, comentarios: bundle.boxes.reduce((n, b) => n + b.comentarios.length, 0), threads: bundle.boxes.reduce((n, b) => n + b.threads.length, 0), avisos: bundle.avisos });
  const rel = await crmApi("POST", "/import", { ...bundle, forcar: opt.forcar === true }, { por: "importador", timeoutMs: 10 * 60_000 });
  if (opt["definir-padrao"] === true) { const c = await crmApi("GET", "/config", undefined, { por: "importador" }); if (!c.pipelineKey) await crmApi("PUT", "/config", { pipelineKey: bundle.pipeline.key }, { por: "importador" }); rel.padrao = bundle.pipeline.key; }
  return out(rel);
}
if (process.argv[1] && /importar-streak\.mjs$/.test(process.argv[1])) main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
