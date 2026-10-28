'use strict';
/**
 * Saúde da máquina (puro, testado): memória, swap, disco e atraso do backend, lidos a cada 30 s pelo server.js e
 * expostos no /health (`maquina`), que a página Suporte do admin mostra. Avisa o dono (alertas.json: WhatsApp e
 * e-mail) quando a memória livre fica abaixo de 10% em 3 leituras seguidas, o disco abaixo de 5% ou o backend
 * trava (atraso > 2 s) em 3 leituras seguidas; no máximo 1 aviso por tipo a cada 6 h. Só avisa: não reinicia nada.
 * Numa VM com várias contas, cada backend avisa o seu dono.
 */
const PADRAO = Object.freeze({ memMinPct: 10, discoMinPct: 5, lagMaxMs: 2000, seguidas: 3, intervaloAvisoMs: 6 * 3600_000 });

/** /proc/meminfo → {memTotalMB, memLivreMB, swapTotalMB, swapLivreMB}; null quando falta MemTotal/MemAvailable. */
function lerMeminfo(texto) {
  const kb = {};
  for (const linha of String(texto || '').split('\n')) {
    const m = /^(\w+):\s+(\d+)\s*kB/.exec(linha);
    if (m) kb[m[1]] = Number(m[2]);
  }
  if (!(kb.MemTotal > 0) || kb.MemAvailable === undefined) return null;
  const mb = (k) => Math.round((kb[k] || 0) / 1024);
  return { memTotalMB: mb('MemTotal'), memLivreMB: mb('MemAvailable'), swapTotalMB: mb('SwapTotal'), swapLivreMB: mb('SwapFree') };
}

/** statfs do HOME → % livre para usuários comuns (bavail), uma casa decimal; null sem dado. */
function discoLivrePct(st) {
  if (!st || !(st.blocks > 0)) return null;
  return Math.round((st.bavail / st.blocks) * 1000) / 10;
}

const TEXTOS = {
  memoria: (l) => `a memória da sua máquina está quase no fim: ${l.memLivreMB} MB livres de ${l.memTotalMB} MB${l.swapTotalMB === 0 ? ' e ela não tem swap' : ''}. Se acabar, o sistema derruba programas (o agente do WhatsApp pode cair). Feche o que não usa ou peça ajuda ao admin em Configurações › Suporte.`,
  disco: (l) => `o disco da sua máquina está quase cheio: ${l.discoLivrePct}% livre. Sem espaço, o agente para de gravar conversas e pode cair. Peça ajuda ao admin em Configurações › Suporte.`,
  lag: (l) => `o backend da sua máquina está travando (respostas atrasadas ${(l.lagMs / 1000).toFixed(1)} s). Se continuar, peça ajuda ao admin em Configurações › Suporte.`,
};

/**
 * Acompanha as leituras e decide os avisos. `registrar(leitura, agora)` devolve `{ alerta, avisar }`: `alerta` é o
 * tipo em vigor ('memoria' | 'disco' | 'lag' | null, nessa prioridade) e `avisar` a lista de {tipo, texto} a enviar
 * agora. `avisadoEm` vem de fora (persistido pelo server.js) para o intervalo de 6 h valer depois de reiniciar.
 */
class Vigia {
  constructor(opts = {}, avisadoEm = {}) {
    this.o = { ...PADRAO, ...opts };
    this.seguidas = { memoria: 0, lag: 0 };
    this.avisadoEm = { ...avisadoEm };
    this.ultima = null;
  }
  registrar(l, agora = Date.now()) {
    const ruim = {
      memoria: l.memTotalMB > 0 && l.memLivreMB !== null && (l.memLivreMB / l.memTotalMB) * 100 < this.o.memMinPct,
      disco: l.discoLivrePct !== null && l.discoLivrePct !== undefined && l.discoLivrePct < this.o.discoMinPct,
      lag: typeof l.lagMs === 'number' && l.lagMs > this.o.lagMaxMs,
    };
    for (const t of ['memoria', 'lag']) this.seguidas[t] = ruim[t] ? this.seguidas[t] + 1 : 0;
    const ativo = { memoria: this.seguidas.memoria >= this.o.seguidas, disco: ruim.disco, lag: this.seguidas.lag >= this.o.seguidas };
    const avisar = [];
    for (const t of ['memoria', 'disco', 'lag']) {
      if (!ativo[t]) continue;
      const antes = this.avisadoEm[t];
      if (typeof antes === 'number' && agora - antes < this.o.intervaloAvisoMs) continue;
      this.avisadoEm[t] = agora;
      avisar.push({ tipo: t, texto: TEXTOS[t](l) });
    }
    const alerta = ['memoria', 'disco', 'lag'].find((t) => ativo[t]) || null;
    this.ultima = { ...l, alerta };
    return { alerta, avisar };
  }
}

module.exports = { lerMeminfo, discoLivrePct, Vigia, PADRAO };
