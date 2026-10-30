'use strict';
/**
 * Saúde da máquina (puro, testado): memória, swap, disco, atraso do backend e a própria box (o cgroup da fatia do
 * usuário: memória anônima perto do MemoryHigh, pressão de memória/CPU, teto batido, OOM), lidos a cada 30 s pelo
 * server.js e expostos no /health (`maquina`), que a página Suporte do admin mostra. Avisa o dono (alertas.json:
 * WhatsApp) quando a box dele está no limite em 3 leituras seguidas (OOM: na hora), a memória livre fica abaixo de
 * 10% em 3 leituras seguidas, o disco abaixo de 5% ou o backend trava (atraso > 2 s) em 3 leituras seguidas; no
 * máximo 1 aviso por tipo a cada 6 h. Só avisa: não reinicia nada. Numa VM com várias contas, cada backend avisa o seu dono.
 */
const PADRAO = Object.freeze({ memMinPct: 10, discoMinPct: 5, lagMaxMs: 2000, seguidas: 3, intervaloAvisoMs: 6 * 3600_000, boxPct: 95 });

/** /proc/self/cgroup → "/user.slice/user-<uid>.slice" (a fatia do usuário dono deste backend); null fora dela (root, sistema, fora do Linux). */
function caminhoDaBox(texto) {
  const m = /^0::(\/user\.slice\/user-\d+\.slice)(\/|$)/m.exec(String(texto || ''));
  return m ? m[1] : null;
}

/**
 * Textos dos arquivos do cgroup da fatia → leitura: memória total (com cache) e só a anônima (a que o kernel não solta),
 * MemoryHigh/Max (MB; null = sem teto), swap, eventos (high/max/oom_kill, cumulativos), PSI "some" avg60 de memória e
 * CPU (% do tempo parada esperando) e a cota de CPU. null sem memory.current ou anon (sem cgroup v2).
 */
function lerBox(t) {
  const n = (s) => { const v = Number(String(s == null ? '' : s).trim()); return Number.isFinite(v) && String(s).trim() !== '' ? v : null; };
  const mb = (b) => Math.round(b / 1048576);
  const cur = n(t.current);
  const am = /^anon (\d+)/m.exec(String(t.stat || ''));
  if (cur === null || am === null) return null;
  const teto = n(t.max), alto = n(t.high);
  const ev = {}; for (const m of String(t.events || '').matchAll(/^(\w+) (\d+)/gm)) ev[m[1]] = Number(m[2]);
  const psi = (txt) => { const m = /^some .*avg60=([\d.]+)/m.exec(String(txt || '')); return m ? Number(m[1]) : 0; };
  const cs = {}; for (const m of String(t.cpuStat || '').matchAll(/^(\w+) (\d+)/gm)) cs[m[1]] = Number(m[2]);
  return {
    usoMB: mb(cur), anonMB: mb(Number(am[1])), altoMB: alto === null ? null : mb(alto), tetoMB: teto === null ? null : mb(teto), swapMB: mb(n(t.swapCurrent) || 0),
    eventos: { high: ev.high || 0, max: ev.max || 0, oomKill: ev.oom_kill || 0 }, psiMem60: psi(t.pressure), psiCpu60: psi(t.cpuPressure),
    periodos: cs.nr_periods || 0, estranguladoUsec: cs.throttled_usec || 0,
  };
}

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
  box: (l) => l.boxMotivo === 'cpu'
    ? `seu meu-bot está sem fôlego de processador na sua box (${l.box.psiCpu60}% do tempo esperando): respostas e áudios demoram. Avise o admin em Configurações › Suporte para aumentar o processador da sua box.`
    : `seu meu-bot está no limite de memória da sua box (${l.box.anonMB} MB de ${l.box.tetoMB === null ? 'sem teto' : `${l.box.tetoMB} MB`}): ele fica lento e pode cair. Avise o admin em Configurações › Suporte para aumentar a memória da sua box.`,
  memoria: (l) => `a memória da sua máquina está quase no fim: ${l.memLivreMB} MB livres de ${l.memTotalMB} MB${l.swapTotalMB === 0 ? ' e ela não tem swap' : ''}. Se acabar, o sistema derruba programas (o agente do WhatsApp pode cair). Feche o que não usa ou peça ajuda ao admin em Configurações › Suporte.`,
  disco: (l) => `o disco da sua máquina está quase cheio: ${l.discoLivrePct}% livre. Sem espaço, o agente para de gravar conversas e pode cair. Peça ajuda ao admin em Configurações › Suporte.`,
  lag: (l) => `o backend da sua máquina está travando (respostas atrasadas ${(l.lagMs / 1000).toFixed(1)} s). Se continuar, peça ajuda ao admin em Configurações › Suporte.`,
};

/**
 * Acompanha as leituras e decide os avisos. `registrar(leitura, agora)` devolve `{ alerta, avisar }`: `alerta` é o
 * tipo em vigor ('box' | 'memoria' | 'disco' | 'lag' | null, nessa prioridade) e `avisar` a lista de {tipo, texto} a
 * enviar agora. `avisadoEm` vem de fora (persistido pelo server.js) para o intervalo de 6 h valer depois de reiniciar.
 * A box (leitura.box, de lerBox) conta como ruim quando a memória anônima passa de boxPct% do MemoryHigh, a PSI de
 * memória passa de 10%, a de CPU de 50%, ou bateu no teto desde a leitura anterior; 3 seguidas avisam, OOM avisa na hora.
 */
class Vigia {
  constructor(opts = {}, avisadoEm = {}) {
    this.o = { ...PADRAO, ...opts };
    this.seguidas = { box: 0, memoria: 0, lag: 0 };
    this.avisadoEm = { ...avisadoEm };
    this.ultima = null;
    this.boxAntes = null;
  }
  registrar(l, agora = Date.now()) {
    const b = l.box || null;
    const dMax = b && this.boxAntes ? b.eventos.max - this.boxAntes.eventos.max : 0;
    const dOom = b && this.boxAntes ? b.eventos.oomKill - this.boxAntes.eventos.oomKill : 0;
    const boxCpu = b !== null && b.psiCpu60 >= 50;
    const boxMem = b !== null && ((b.altoMB !== null && b.anonMB >= (b.altoMB * this.o.boxPct) / 100) || b.psiMem60 >= 10 || dMax > 0);
    const ruim = {
      box: boxMem || boxCpu,
      memoria: l.memTotalMB > 0 && l.memLivreMB !== null && (l.memLivreMB / l.memTotalMB) * 100 < this.o.memMinPct,
      disco: l.discoLivrePct !== null && l.discoLivrePct !== undefined && l.discoLivrePct < this.o.discoMinPct,
      lag: typeof l.lagMs === 'number' && l.lagMs > this.o.lagMaxMs,
    };
    for (const t of ['box', 'memoria', 'lag']) this.seguidas[t] = ruim[t] ? this.seguidas[t] + 1 : 0;
    const ativo = { box: this.seguidas.box >= this.o.seguidas || dOom > 0, memoria: this.seguidas.memoria >= this.o.seguidas, disco: ruim.disco, lag: this.seguidas.lag >= this.o.seguidas };
    const leitura = { ...l, boxMotivo: boxCpu && !boxMem ? 'cpu' : 'memoria' };
    const avisar = [];
    for (const t of ['box', 'memoria', 'disco', 'lag']) {
      if (!ativo[t]) continue;
      const antes = this.avisadoEm[t];
      if (typeof antes === 'number' && agora - antes < this.o.intervaloAvisoMs) continue;
      this.avisadoEm[t] = agora;
      avisar.push({ tipo: t, texto: TEXTOS[t](leitura) });
    }
    const alerta = ['box', 'memoria', 'disco', 'lag'].find((t) => ativo[t]) || null;
    this.boxAntes = b;
    this.ultima = { ...l, alerta };
    return { alerta, avisar };
  }
}

module.exports = { lerMeminfo, discoLivrePct, caminhoDaBox, lerBox, Vigia, PADRAO };
