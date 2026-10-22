/**
 * finance-store.js — persistência do financeiro em ~/.local/share/meu-bot/finance/db/ (arquivos JSON, sem npm, sem
 * SQLite: o Node da máquina pode ser 18/20). Mesmo motor do crm-store.js: um único escritor (o server.js), tudo em
 * memória depois de `openStore`, cada mutação grava só o que tocou, de forma atômica (tmp + rename, 0600 em pasta
 * 0700), numa fila única; erro no meio restaura do disco. Backup diário na primeira escrita do dia (mantém 7).
 *
 *   db/meta.json                 { versao, seq, ultimoBackup }
 *   db/contas.json               { itens: { [key]: Conta } }
 *   db/categorias.json           { itens: { [key]: Categoria } }   (nasce com as categorias padrão em pt-BR)
 *   db/favorecidos.json          { itens: { [key]: Favorecido } }  (categoria aprendida na confirmação)
 *   db/meses.json                { itens: { [AAAA-MM]: { rendaPrevistaCent?, fechadoEm?, dinheiroInformadoEm? } } }
 *   db/lancamentos/AAAA-MM.json  { mes, itens: { [id]: Lancamento } }  (um arquivo por mês: não cresce sem limite)
 *   db/mudancas.jsonl            feed append-only de quem mudou o quê (rotação 20 000 → 5 000)
 *   db/lixeira/<tipo>/<key>.json o que foi apagado (descartar move, não destrói)
 *   db/comprovantes/<sha256>     fotos de comprovante (fora do backup diário: não mudam)
 *   db/backup/<AAAA-MM-DD>/      cópia diária
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CATEGORIAS_PADRAO, LINHAS_PADRAO, MES_RE, mesDe } = require('./finance-modelo');

const VERSAO = 1;
const FEED_MAX = 20000;
const FEED_KEEP = 5000;
const BACKUPS = 7;
const COLECOES = ['contas', 'categorias', 'favorecidos', 'meses', 'linhas'];

const readJson = (f, fallback) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : fallback; } catch (e) { if (e && e.code === 'ENOENT') return fallback; throw new Error(`arquivo do financeiro corrompido: ${f} (${e.message}); restaure de db/backup/`); } };
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); }
const dia = (now) => new Date(now).toISOString().slice(0, 10);

function openStore(dir, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const rnd = deps.rnd ?? ((n) => crypto.randomBytes(n));
  const log = deps.log ?? (() => {});
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const P = { meta: path.join(dir, 'meta.json'), lanc: path.join(dir, 'lancamentos'), feed: path.join(dir, 'mudancas.jsonl'), lixeira: path.join(dir, 'lixeira'), backup: path.join(dir, 'backup'), comprovantes: path.join(dir, 'comprovantes') };
  const arq = (col) => path.join(dir, `${col}.json`);

  // ---- carga -----------------------------------------------------------------------------------------------
  const state = { meta: null, cols: new Map(COLECOES.map((c) => [c, new Map()])), lanc: new Map(), mesDoId: new Map() };
  function load() {
    const m = readJson(P.meta, null);
    state.meta = m && Number.isInteger(m.seq) ? { versao: VERSAO, seq: m.seq, ultimoBackup: typeof m.ultimoBackup === 'string' ? m.ultimoBackup : '', linhasSemeadas: Array.isArray(m.linhasSemeadas) ? m.linhasSemeadas.map(String) : [] } : { versao: VERSAO, seq: 0, ultimoBackup: '', linhasSemeadas: [] };
    for (const c of COLECOES) {
      const map = state.cols.get(c); map.clear();
      const v = readJson(arq(c), { itens: {} });
      for (const [k, x] of Object.entries(v.itens ?? {})) if (x && typeof x === 'object') map.set(k, x);
    }
    // Primeira abertura: as categorias padrão já existem (a pessoa não começa do nada).
    // Categorias padrão: as que faltam entram (primeira abertura ou padrão novo, como os ganhos do ROI); as da pessoa ficam.
    for (const c of CATEGORIAS_PADRAO) { const cur = state.cols.get('categorias').get(c.key); if (cur === undefined) state.cols.get('categorias').set(c.key, { ...c }); else if (c.retorno && cur.retorno !== c.retorno) state.cols.get('categorias').set(c.key, { ...cur, retorno: c.retorno }); }
    // Linhas padrão (custos obrigatórios do produto): entram uma vez; se a pessoa apagar, não voltam.
    for (const l of LINHAS_PADRAO) if (!state.meta.linhasSemeadas.includes(l.key)) { if (!state.cols.get('linhas').has(l.key)) state.cols.get('linhas').set(l.key, { ...l, criadaEm: 0, atualizadaEm: 0 }); state.meta.linhasSemeadas.push(l.key); }
    state.lanc.clear(); state.mesDoId.clear();
    if (fs.existsSync(P.lanc)) for (const f of fs.readdirSync(P.lanc)) {
      const ym = f.replace(/\.json$/, '');
      if (!f.endsWith('.json') || !MES_RE.test(ym)) continue;
      const v = readJson(path.join(P.lanc, f), { itens: {} });
      const map = new Map();
      for (const [id, l] of Object.entries(v.itens ?? {})) if (l && typeof l === 'object' && typeof l.data === 'string') { map.set(id, l); state.mesDoId.set(id, ym); }
      state.lanc.set(ym, map);
    }
  }
  load();

  // ---- leitura ---------------------------------------------------------------------------------------------
  const list = (col) => [...state.cols.get(col).values()];
  const get = (col, key) => state.cols.get(col).get(key) ?? null;
  const getLanc = (id) => { const ym = state.mesDoId.get(id); return ym === undefined ? null : state.lanc.get(ym)?.get(id) ?? null; };
  /** Lançamentos de um mês (AAAA-MM) ou de todos, do mais novo para o mais antigo. */
  const listLanc = (ym) => {
    const fonte = ym === undefined ? [...state.lanc.values()].flatMap((m) => [...m.values()]) : [...(state.lanc.get(ym)?.values() ?? [])];
    return fonte.sort((a, b) => (b.data === a.data ? (b.criadoEm ?? 0) - (a.criadoEm ?? 0) : b.data.localeCompare(a.data)));
  };
  const meses = () => [...state.lanc.keys()].sort();
  const meta = () => ({ ...state.meta });

  // ---- escrita ---------------------------------------------------------------------------------------------
  let fila = Promise.resolve();
  function backupDiario(t) {
    const hoje = dia(t);
    if (state.meta.ultimoBackup === hoje) return;
    try {
      const dest = path.join(P.backup, hoje);
      fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
      for (const f of fs.readdirSync(dir)) { if (f === 'backup' || f === 'comprovantes' || f.endsWith('.tmp')) continue; fs.cpSync(path.join(dir, f), path.join(dest, f), { recursive: true }); }
      const dias = fs.readdirSync(P.backup).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      for (const d of dias.slice(0, Math.max(0, dias.length - BACKUPS))) fs.rmSync(path.join(P.backup, d), { recursive: true, force: true });
      state.meta.ultimoBackup = hoje;
    } catch (e) { log(`backup do financeiro falhou: ${e.message}`); }
  }
  function appendFeed(linhas) {
    fs.appendFileSync(P.feed, linhas.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 });
    let n = 0; try { n = fs.readFileSync(P.feed, 'utf8').split('\n').length - 1; } catch { n = 0; }
    if (n > FEED_MAX) { const all = fs.readFileSync(P.feed, 'utf8').split('\n').filter(Boolean); const tmp = `${P.feed}.tmp`; fs.writeFileSync(tmp, `${all.slice(-FEED_KEEP).join('\n')}\n`, { mode: 0o600 }); fs.renameSync(tmp, P.feed); }
  }
  /**
   * Uma transação: `fn(tx)` usa os getters, `set/trash` (coleções), `setLanc/trashLanc` (lançamentos; mudar a data de
   * mês move o lançamento de arquivo) e `mudar(tipo, refs)`. Sem nenhum `mudar`, nada é gravado. `por` = quem mudou
   * (agente | whatsapp | app | pessoa).
   */
  function mutate(por, fn) {
    const run = async () => {
      const t = now();
      const tocadas = new Set();
      const mesesTocados = new Set();
      const linhas = [];
      const tx = {
        now: t, rnd, list, get, getLanc, listLanc,
        set(col, x) { state.cols.get(col).set(x.key, x); tocadas.add(col); },
        trash(col, x) { state.cols.get(col).delete(x.key); tocadas.add(col); writeJson(path.join(P.lixeira, col, `${x.key}.json`), { ...x, apagadoEm: t }); },
        setLanc(l) {
          const novo = mesDe(l.data); const velho = state.mesDoId.get(l.id);
          if (velho !== undefined && velho !== novo) { state.lanc.get(velho)?.delete(l.id); mesesTocados.add(velho); }
          let m = state.lanc.get(novo); if (!m) { m = new Map(); state.lanc.set(novo, m); }
          m.set(l.id, l); state.mesDoId.set(l.id, novo); mesesTocados.add(novo);
        },
        trashLanc(l) { const ym = state.mesDoId.get(l.id); if (ym !== undefined) { state.lanc.get(ym)?.delete(l.id); state.mesDoId.delete(l.id); mesesTocados.add(ym); } writeJson(path.join(P.lixeira, 'lancamentos', `${l.id}.json`), { ...l, apagadoEm: t }); },
        mudar(tipo, refs = {}) { const seq = ++state.meta.seq; linhas.push({ seq, at: t, tipo, ...refs, por }); return seq; },
      };
      let out;
      try { out = await fn(tx); } catch (e) { load(); throw e; }
      if (linhas.length === 0) return out;
      try {
        backupDiario(t);
        // Categorias padrão ainda só na memória vão para o disco na primeira escrita.
        tocadas.add('categorias'); tocadas.add('linhas');
        for (const c of tocadas) writeJson(arq(c), { itens: Object.fromEntries(state.cols.get(c)) });
        for (const ym of mesesTocados) {
          const m = state.lanc.get(ym);
          if (!m || m.size === 0) { fs.rmSync(path.join(P.lanc, `${ym}.json`), { force: true }); state.lanc.delete(ym); }
          else writeJson(path.join(P.lanc, `${ym}.json`), { mes: ym, itens: Object.fromEntries(m) });
        }
        appendFeed(linhas);
        writeJson(P.meta, state.meta);
      } catch (e) { load(); throw new Error(`não consegui gravar o financeiro: ${e.message}`); }
      return out;
    };
    const p = fila.then(run, run);
    fila = p.catch(() => {});
    return p;
  }

  /** Guarda a foto de um comprovante (nome = sha256 do conteúdo; repetir a mesma foto não duplica). */
  function guardarComprovante(dados) {
    const sha256 = crypto.createHash('sha256').update(dados).digest('hex');
    const f = path.join(P.comprovantes, sha256);
    if (!fs.existsSync(f)) { fs.mkdirSync(P.comprovantes, { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, dados, { mode: 0o600 }); fs.renameSync(tmp, f); }
    return sha256;
  }
  const lerComprovante = (sha256) => { if (!/^[0-9a-f]{64}$/.test(sha256)) return null; try { return fs.readFileSync(path.join(P.comprovantes, sha256)); } catch { return null; } };
  /** Últimas mudanças do feed (para "o que o agente fez hoje"). */
  function ultimas(n = 50) { try { return fs.readFileSync(P.feed, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; } }

  return { dir, meta, list, get, getLanc, listLanc, meses, mutate, guardarComprovante, lerComprovante, ultimas, reload: load };
}

module.exports = { openStore, VERSAO };
