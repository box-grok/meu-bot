#!/usr/bin/env node
/**
 * streak.mjs — CLI do Streak CRM para o agente da máquina (meu-bot, módulo "CRM pelo WhatsApp", Pro).
 * Node puro (fetch nativo), sem npm. A chave fica em ~/.local/share/meu-bot/crm.json (0600) e NUNCA sai daqui.
 * Saída sempre JSON em uma linha; erro → {"erro": "..."} e código 1.
 *
 *   diag · pipelines · pipeline [key]
 *   box-find --phone +N | --name "x" | --query "x"
 *   box-create --name "x" --stage "Etapa" [--notes "…"] [--phone +N]
 *   box-update <box> [--name "x"] [--notes "…"] [--stage "Etapa"]
 *   field-set <box> "Campo" "valor"            (listas: pelo nome da opção; datas: dd/mm/aaaa ou ISO)
 *   comment <box> "texto"
 *   contact-upsert --phone +N [--name "x"] [--email e] [--box <box>]
 *   telefone-set +N <box>                       (lembra que este telefone é deste box)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = path.join(os.homedir(), ".local", "share", "meu-bot");
const CONFIG = path.join(BASE, "crm.json");
const API = "https://api.streak.com/api";

function loadConfig() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG, "utf8")); return c && typeof c === "object" ? c : {}; } catch { return {}; }
}
function saveConfig(c) { fs.mkdirSync(BASE, { recursive: true }); const tmp = `${CONFIG}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c, null, 1), { mode: 0o600 }); fs.renameSync(tmp, CONFIG); }
const cfg = loadConfig();
const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); };
const fail = (msg, code = 1) => { out({ erro: msg }); process.exit(code); };
const argv0 = process.argv[2] ?? "";
// `chave-set` é justamente o comando que configura: roda sem chave gravada.
if (argv0 !== "chave-set" && (typeof cfg.apiKey !== "string" || cfg.apiKey === "")) fail("CRM não configurado nesta máquina: falta a chave da API do Streak (tutorial 10 do meu-bot)", 2);

async function api(method, p, body, key = cfg.apiKey) {
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text === "" ? null : JSON.parse(text); } catch { json = { raw: text.slice(0, 300) } }
  if (!res.ok) { const e = new Error(res.status === 401 ? "chave da API recusada pelo Streak (confira em Streak › Configurações › API)" : `Streak respondeu ${res.status} em ${method} ${p}${json && json.error ? `: ${json.error}` : ""}`); e.status = res.status; throw e; }
  return json;
}
// ---- argumentos: posicionais + --chave valor / --flag
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const pos = []; const opt = {};
for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { opt[k] = v; i++; } else opt[k] = true; } else pos.push(a); }
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const pipelineKey = () => { const k = opt.pipeline ?? cfg.pipelineKey; if (typeof k !== "string" || k === "") throw new Error("nenhum pipeline escolhido: rode `pipelines` e salve no tutorial 11 (ou passe --pipeline <key>)"); return k; };

async function pipelineInfo(key) {
  const p = await api("GET", `/v1/pipelines/${encodeURIComponent(key)}`);
  const order = Array.isArray(p.stageOrder) ? p.stageOrder : Object.keys(p.stages ?? {});
  const stages = order.map((k) => ({ key: k, name: p.stages?.[k]?.name ?? k }));
  const fields = (Array.isArray(p.fields) ? p.fields : []).map((f) => ({ key: String(f.key), name: f.name, type: f.type, options: Array.isArray(f.dropdownSettings?.items) ? f.dropdownSettings.items.map((it) => ({ key: it.key, name: it.name })) : Array.isArray(f.tagSettings?.tags) ? f.tagSettings.tags.map((it) => ({ key: it.key, name: it.name })) : [] }));
  return { key: p.key ?? p.pipelineKey ?? key, name: p.name, teamKey: p.teamKey ?? null, stages, fields };
}
const findStage = (info, want) => { const w = norm(want); return info.stages.find((s) => norm(s.name) === w || s.key === want) ?? info.stages.find((s) => norm(s.name).startsWith(w)) ?? info.stages.find((s) => norm(s.name).includes(w)) ?? null; };
const findField = (info, want) => { const w = norm(want); return info.fields.find((f) => norm(f.name) === w || f.key === want) ?? info.fields.find((f) => norm(f.name).includes(w)) ?? null; };
function boxView(b, info) {
  const stage = info?.stages.find((s) => s.key === b.stageKey)?.name ?? b.stageKey ?? null;
  const fields = {};
  if (info && b.fields && typeof b.fields === "object") for (const [k, v] of Object.entries(b.fields)) { const f = info.fields.find((x) => x.key === String(k)); if (f) fields[f.name] = f.options.length > 0 ? (Array.isArray(v) ? v : [v]).map((vk) => f.options.find((o) => o.key === vk)?.name ?? vk).join(", ") : v; }
  return { key: b.boxKey ?? b.key, name: b.name, stage, notes: typeof b.notes === "string" ? b.notes.slice(0, 600) : "", fields, lastUpdated: b.lastUpdatedTimestamp ? new Date(b.lastUpdatedTimestamp).toISOString() : null };
}
async function listBoxes(key) { const r = await api("GET", `/v1/pipelines/${encodeURIComponent(key)}/boxes`); return Array.isArray(r) ? r : []; }
async function teamKey(info) {
  if (typeof cfg.teamKey === "string" && cfg.teamKey !== "") return cfg.teamKey;
  if (info?.teamKey) return info.teamKey;
  try { const t = await api("GET", "/v2/users/me/teams"); const k = (Array.isArray(t?.results) ? t.results : Array.isArray(t) ? t : [])[0]?.key; if (k) return k; } catch { /* abaixo */ }
  const me = await api("GET", "/v1/users/me"); if (Array.isArray(me.teamKeys) && me.teamKeys[0]) return me.teamKeys[0];
  throw new Error("não achei a equipe (teamKey) desta conta no Streak; salve teamKey no crm.json");
}
function parseValue(field, raw) {
  if (field.options.length > 0) {
    const w = norm(raw); const o = field.options.find((x) => norm(x.name) === w) ?? field.options.find((x) => norm(x.name).startsWith(w)) ?? field.options.find((x) => norm(x.name).includes(w));
    if (!o) throw new Error(`opção "${raw}" não existe em "${field.name}"; opções: ${field.options.map((x) => x.name).join(" | ")}`);
    return field.type === "TAG" ? [o.key] : o.key;
  }
  if (field.type === "DATE") { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw).trim()); const t = m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : Date.parse(raw); if (Number.isNaN(t)) throw new Error(`data inválida: ${raw} (use dd/mm/aaaa)`); return t; }
  if (field.type === "NUMBER") { const n = Number(String(raw).replace(/\./g, "").replace(",", ".")); if (Number.isNaN(n)) throw new Error(`número inválido: ${raw}`); return n; }
  if (field.type === "CHECKBOX") return /^(1|sim|true|yes|x)$/i.test(String(raw));
  return String(raw);
}

async function main() {
  switch (cmd) {
    case "diag": {
      const me = await api("GET", "/v1/users/me");
      const ps = await api("GET", "/v1/pipelines");
      const pipelines = (Array.isArray(ps) ? ps : []).map((p) => ({ key: p.key ?? p.pipelineKey, name: p.name, boxes: p.boxCount ?? null }));
      let pipeline = null; if (typeof cfg.pipelineKey === "string" && cfg.pipelineKey !== "") { try { pipeline = await pipelineInfo(cfg.pipelineKey); } catch (e) { pipeline = { erro: e.message }; } }
      return out({ ok: true, usuario: me.email ?? me.displayName ?? null, pipelines, pipeline, silencioMin: cfg.silencioMin ?? 10, criarSemPerguntar: cfg.criarSemPerguntar === true });
    }
    case "pipelines": { const ps = await api("GET", "/v1/pipelines"); return out({ pipelines: (Array.isArray(ps) ? ps : []).map((p) => ({ key: p.key ?? p.pipelineKey, name: p.name })) }); }
    case "pipeline": return out(await pipelineInfo(pos[0] ?? pipelineKey()));
    case "box-find": {
      const key = pipelineKey(); const info = await pipelineInfo(key); const boxes = await listBoxes(key);
      let hits = [];
      if (typeof opt.phone === "string") { const d = digits(opt.phone); const mapped = cfg.telefones?.[`+${d}`]; hits = boxes.filter((b) => (mapped && (b.boxKey ?? b.key) === mapped) || digits(b.notes ?? "").includes(d) || digits(b.name ?? "").includes(d)); }
      else if (typeof opt.name === "string") { const w = norm(opt.name); hits = boxes.filter((b) => norm(b.name).includes(w)); }
      else if (typeof opt.query === "string") { const w = norm(opt.query); hits = boxes.filter((b) => norm(b.name).includes(w) || norm(b.notes ?? "").includes(w)); }
      else throw new Error("use --phone, --name ou --query");
      const views = hits.slice(0, 10).map((b) => boxView(b, info));
      if (views.length === 1) { try { const cs = await api("GET", `/v1/boxes/${encodeURIComponent(views[0].key)}/comments`); views[0].comentarios = (Array.isArray(cs) ? cs : []).slice(-5).map((c) => ({ em: c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16) : null, texto: String(c.message ?? "").slice(0, 300) })); } catch { /* sem comentários */ } }
      return out({ boxes: views, total: hits.length });
    }
    case "box-create": {
      const key = pipelineKey(); const info = await pipelineInfo(key);
      if (typeof opt.name !== "string" || opt.name.trim() === "") throw new Error("--name é obrigatório");
      const body = { name: opt.name.trim() };
      if (typeof opt.stage === "string") { const s = findStage(info, opt.stage); if (!s) throw new Error(`etapa "${opt.stage}" não existe; etapas: ${info.stages.map((x) => x.name).join(" | ")}`); body.stageKey = s.key; }
      if (typeof opt.notes === "string") body.notes = opt.notes;
      const b = await api("POST", `/v2/pipelines/${encodeURIComponent(key)}/boxes`, body);
      const view = boxView(b, info);
      if (typeof opt.phone === "string") { const d = digits(opt.phone); if (d) { cfg.telefones = { ...(cfg.telefones ?? {}), [`+${d}`]: view.key }; saveConfig(cfg); } }
      return out({ ok: true, box: view });
    }
    case "box-update": {
      const box = pos[0]; if (!box) throw new Error("informe a chave do box");
      const info = await pipelineInfo(pipelineKey());
      const body = {};
      if (typeof opt.name === "string") body.name = opt.name;
      if (typeof opt.notes === "string") body.notes = opt.notes;
      if (typeof opt.stage === "string") { const s = findStage(info, opt.stage); if (!s) throw new Error(`etapa "${opt.stage}" não existe; etapas: ${info.stages.map((x) => x.name).join(" | ")}`); body.stageKey = s.key; }
      if (Object.keys(body).length === 0) throw new Error("nada para mudar (--name, --notes, --stage)");
      const b = await api("POST", `/v1/boxes/${encodeURIComponent(box)}`, body);
      return out({ ok: true, box: boxView(b, info) });
    }
    case "field-set": {
      const [box, campo, ...rest] = pos; const valor = rest.join(" ");
      if (!box || !campo || valor === "") throw new Error("uso: field-set <box> \"Campo\" \"valor\"");
      const info = await pipelineInfo(pipelineKey());
      const f = findField(info, campo); if (!f) throw new Error(`campo "${campo}" não existe; campos: ${info.fields.map((x) => x.name).join(" | ")}`);
      const value = parseValue(f, valor);
      await api("POST", `/v1/boxes/${encodeURIComponent(box)}/fields/${encodeURIComponent(f.key)}`, { value });
      return out({ ok: true, box, campo: f.name, valor });
    }
    case "comment": {
      const [box, ...rest] = pos; const texto = rest.join(" ").trim();
      if (!box || texto === "") throw new Error("uso: comment <box> \"texto\"");
      const c = await api("POST", `/v2/boxes/${encodeURIComponent(box)}/comments`, { message: texto });
      return out({ ok: true, box, comentario: c.key ?? c.commentKey ?? null });
    }
    case "contact-upsert": {
      if (typeof opt.phone !== "string" && typeof opt.email !== "string") throw new Error("informe --phone ou --email");
      const info = await pipelineInfo(pipelineKey()); const team = await teamKey(info);
      const [givenName, ...fam] = String(opt.name ?? "").trim().split(/\s+/).filter(Boolean);
      const body = {};
      if (givenName) body.givenName = givenName; if (fam.length > 0) body.familyName = fam.join(" ");
      if (typeof opt.email === "string") body.emailAddresses = [opt.email];
      if (typeof opt.phone === "string") body.phoneNumbers = [opt.phone];
      const c = await api("POST", `/v2/teams/${encodeURIComponent(team)}/contacts?getIfExisting=true`, body);
      const contactKey = c.key ?? c.contactKey;
      let linked = false;
      if (typeof opt.box === "string" && contactKey) {
        const b = await api("GET", `/v1/boxes/${encodeURIComponent(opt.box)}`);
        const cur = Array.isArray(b.contacts) ? b.contacts.map((x) => ({ key: x.key, isStarred: x.isStarred === true })) : [];
        if (!cur.some((x) => x.key === contactKey)) cur.push({ key: contactKey, isStarred: false });
        await api("POST", `/v1/boxes/${encodeURIComponent(opt.box)}`, { contacts: cur });
        linked = true;
        if (typeof opt.phone === "string") { const d = digits(opt.phone); if (d) { cfg.telefones = { ...(cfg.telefones ?? {}), [`+${d}`]: opt.box }; saveConfig(cfg); } }
      }
      return out({ ok: true, contato: contactKey, vinculado: linked });
    }
    // Guarda a chave da API (gerada no Gmail: botão do Streak › Integrações e Automações › Integrações personalizadas)
    // depois de conferir no Streak que ela vale. Para o agente do meu-bot configurar o CRM sem a pessoa colar nada no
    // app. A chave só entra no crm.json (0600); a saída nunca a repete.
    case "chave-set": {
      const k = String(pos[0] ?? "").trim();
      if (k.length < 16 || /\s/.test(k)) throw new Error("uso: chave-set <chave da API do Streak> (a chave tem pelo menos 16 caracteres, sem espaços)");
      let me; try { me = await api("GET", "/v1/users/me", undefined, k); } catch { throw new Error("o Streak recusou essa chave; gere outra em Integrações e Automações › Integrações personalizadas"); }
      cfg.apiKey = k; cfg.savedAt = new Date().toISOString(); saveConfig(cfg);
      return out({ ok: true, usuario: me?.email ?? me?.displayName ?? null, configurado: true });
    }
    case "telefone-set": { const d = digits(pos[0]); if (!d || !pos[1]) throw new Error("uso: telefone-set +N <box>"); cfg.telefones = { ...(cfg.telefones ?? {}), [`+${d}`]: pos[1] }; saveConfig(cfg); return out({ ok: true }); }
    default: throw new Error(`comando desconhecido: ${cmd || "(vazio)"}; veja o cabeçalho do streak.mjs`);
  }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
