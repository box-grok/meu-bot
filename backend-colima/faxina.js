'use strict';
/**
 * Faxina diária dos arquivos do meu-bot que só crescem (testado). O server.js chama `faxinar` uma vez por dia.
 * - Linhas de evento (contas-claude-eventos.jsonl): ficam as últimas N; a leitura já usa só o fim.
 * - Logs de texto (backend.log do modo nohup, vigia-gateway.log): passou do teto, o conteúdo vai para `<arquivo>.1`
 *   (um só antigo) e o original é esvaziado no lugar: quem escreve com >> segue escrevendo no mesmo arquivo.
 * Ficam de fora de propósito: auditoria.jsonl (corrente com selo; cortar quebraria a prova), conversas/*.jsonl e
 * wa-cloud/*.jsonl (o histórico da pessoa) e o journald (o sistema já põe teto).
 */
const fs = require('node:fs');

/** Mantém só as últimas `max` linhas (tmp + rename, 0600). Devolve quantas linhas saíram (0 = nada a fazer). */
function cortarLinhas(arquivo, max) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (_) { return 0; }
  const linhas = texto.split('\n').filter((l) => l !== '');
  if (linhas.length <= max) return 0;
  const tmp = `${arquivo}.faxina.tmp`;
  fs.writeFileSync(tmp, `${linhas.slice(-max).join('\n')}\n`, { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
  return linhas.length - max;
}

/** Passou de `maxBytes`: copia para `<arquivo>.1` (substitui o antigo) e esvazia o original. true = rodou. */
function rodarLog(arquivo, maxBytes) {
  let st;
  try { st = fs.statSync(arquivo); } catch (_) { return false; }
  if (!st.isFile() || st.size <= maxBytes) return false;
  fs.copyFileSync(arquivo, `${arquivo}.1`);
  fs.truncateSync(arquivo, 0);
  return true;
}

/** Roda tudo; erro num arquivo não impede os outros. Devolve as frases do que mudou (para o log). */
function faxinar({ eventos = [], logs = [], maxLinhas = 2000, maxBytes = 5 * 1024 * 1024 } = {}) {
  const feito = [];
  for (const f of eventos) {
    try { const n = cortarLinhas(f, maxLinhas); if (n > 0) feito.push(`${f}: ${n} linhas antigas removidas`); } catch (e) { feito.push(`${f}: ${e.message}`); }
  }
  for (const f of logs) {
    try { if (rodarLog(f, maxBytes)) feito.push(`${f}: rodado para ${f}.1`); } catch (e) { feito.push(`${f}: ${e.message}`); }
  }
  return feito;
}

module.exports = { cortarLinhas, rodarLog, faxinar };
