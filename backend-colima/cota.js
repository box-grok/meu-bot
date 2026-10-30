'use strict';
/**
 * Cota de disco por usuário (puro, testado): cada conta da VM tem uma cota (quota do Linux) e, quando o espaço
 * acaba, o agente para de guardar áudios, imagens e conversas novas sem que a pessoa saiba por quê. Este módulo
 * interpreta `quota -wu <usuario>` e `du -sk` (quem roda os comandos é o server.js; aqui não há fs nem exec),
 * monta a lista "o que está ocupando" que a página Espaço mostra, e decide os avisos ao dono em 80%, 95% e 100%.
 * Cada nível avisa uma vez e só rearma quando o uso cai 5 pontos abaixo dele, para não encher o WhatsApp da pessoa
 * oscilando em volta do limite. Só avisa e mostra: não apaga nada sozinho.
 */
const path = require('path');

/**
 * Saída de `quota -wu <usuario>` → {usadoKb, softKb, hardKb, grace, acimaDoSoft}; null sem cota (soft e hard 0,
 * "none", vazio ou lixo). Lê a primeira linha cujo primeiro token começa com `/` (o filesystem). Quando o uso
 * passou do soft, `blocks` termina em `*` e aparece a coluna grace (`6days`, `23:59`, `none`); senão ela não existe.
 */
function lerQuota(texto) {
  const t = String(texto || '');
  if (!t.trim() || /:\s*none\s*$/m.test(t.split('\n')[0] || '')) return null;
  for (const linha of t.split('\n')) {
    const tok = linha.trim().split(/\s+/);
    if (!tok[0] || !tok[0].startsWith('/') || tok.length < 4) continue;
    const acimaDoSoft = tok[1].endsWith('*');
    const usadoKb = Number(tok[1].replace(/\*$/, ''));
    const softKb = Number(tok[2]);
    const hardKb = Number(tok[3]);
    if (![usadoKb, softKb, hardKb].every(Number.isFinite)) return null;
    if (softKb === 0 && hardKb === 0) return null;
    const grace = acimaDoSoft && tok[4] && !/^\d+$/.test(tok[4]) ? tok[4] : null;
    return { usadoKb, softKb, hardKb, grace, acimaDoSoft };
  }
  return null;
}

/** Limite que vale para a pessoa: o soft; quando só há hard, o hard. */
function limiteKbDe(q) {
  return q.softKb > 0 ? q.softKb : q.hardKb;
}

/**
 * O que ocupa o HOME, na ordem em que a página mostra. `dela` = é coisa da pessoa (não do sistema);
 * `apagavel` = o botão Liberar espaço pode apagar; `seguirLink` = medir através do link simbólico (`publico`
 * aponta para /var/www/publico/<usuario>).
 */
const PASTAS = Object.freeze([
  { id: 'imagens', rotulo: 'imagens', dela: true, apagavel: true, rel: ['.hermes/cache/images', '.hermes/image_cache'] },
  { id: 'audios', rotulo: 'áudios', dela: true, apagavel: true, rel: ['.hermes/cache/audio', '.hermes/audio_cache'] },
  { id: 'whatsapp', rotulo: 'WhatsApp (sessão e mídia)', dela: true, apagavel: false, rel: ['.hermes/whatsapp'] },
  { id: 'conversas', rotulo: 'conversas do meu-bot', dela: true, apagavel: false, rel: ['.claude/projects', '.hermes/sessions', '.local/share/meu-bot'] },
  { id: 'publico', rotulo: 'publicações no seu link', dela: true, apagavel: false, rel: ['publico'], seguirLink: true },
  { id: 'arquivos', rotulo: 'arquivos do agente', dela: true, apagavel: true, rel: ['agent-workspace', 'chat-workspace'] },
  { id: 'programas', rotulo: 'programas do agente (fixos)', dela: false, apagavel: false, rel: ['.hermes/tools', '.hermes/installs', '.hermes/cache/uv', '.hermes/cache/piper-voices', '.local/node', '.npm', '.cache'] },
]);

/** Argumentos para rodar `du` duas vezes (sem e com -L para as pastas que são link); quem chama junta os stdouts. */
function duArgs(home) {
  const normal = [];
  const link = [];
  for (const p of PASTAS) for (const rel of p.rel) (p.seguirLink ? link : normal).push(path.join(home, rel));
  return { normal: ['-sk', ...normal], link: ['-skL', ...link] };
}

/** Saída de `du -sk` (linhas `kb<TAB>caminho`) → Map caminho → kb; linhas malformadas (erros, vazias) são ignoradas. */
function lerDu(texto) {
  const mapa = new Map();
  for (const linha of String(texto || '').split('\n')) {
    const m = /^(\d+)\s+(\S.*)$/.exec(linha.trim());
    if (m) mapa.set(m[2], Number(m[1]));
  }
  return mapa;
}

/**
 * Lista para a página: soma por entrada de PASTAS; some as vazias (menos `programas`, que a pessoa deve ver sempre
 * para saber que é fixo) e acrescenta `outros` (o resto do uso que a cota conta e nenhuma pasta explica) quando > 0.
 */
function montarItens(duMap, home, usadoKb) {
  const itens = [];
  let soma = 0;
  for (const p of PASTAS) {
    const kb = p.rel.reduce((acc, rel) => acc + (duMap.get(path.join(home, rel)) || 0), 0);
    soma += kb;
    if (kb > 0 || p.id === 'programas') itens.push({ id: p.id, rotulo: p.rotulo, kb, dela: p.dela, apagavel: p.apagavel });
  }
  const outros = Number(usadoKb) - soma;
  if (outros > 0) itens.push({ id: 'outros', rotulo: 'outros', kb: outros, dela: true, apagavel: false });
  return itens;
}

/** Percentual inteiro do uso (0 sem limite), teto 999 para não estourar a página com cota minúscula. */
function pctDe(usadoKb, limiteKb) {
  if (!(limiteKb > 0)) return 0;
  return Math.min(999, Math.round((usadoKb / limiteKb) * 100));
}

const NIVEIS = Object.freeze([80, 95, 100]);
/** Pontos abaixo do nível em que o aviso rearma (80% avisa de novo só depois de cair para menos de 75%). */
const REARME_PCT = 5;

function nivelDe(pct) {
  if (pct >= 100) return 'cheio';
  if (pct >= 95) return 'critico';
  if (pct >= 80) return 'perto';
  return 'ok';
}

/** KB → texto em pt-BR: '3,9 GB', '650 MB', '512 KB'. */
function fmtGb(kb) {
  const n = Number(kb) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} GB`;
  if (n >= 1024) return `${Math.round(n / 1024)} MB`;
  return `${Math.round(n)} KB`;
}

/** Os n maiores itens em uma frase ('áudios 900 MB, imagens 300 MB'); `outros` só entra quando é o único. */
function resumoItens(itens, n = 4) {
  const lista = Array.isArray(itens) ? itens : [];
  let base = lista.filter((i) => i.id !== 'outros');
  if (base.length === 0) base = lista;
  const top = [...base].sort((a, b) => b.kb - a.kb).slice(0, n);
  if (top.length === 0) return 'nada medido ainda';
  return top.map((i) => `${i.rotulo} ${fmtGb(i.kb)}`).join(', ');
}

const mais = (link) => link || 'fale com o admin em Configurações › Suporte';

const TEXTOS = {
  80: (l, link) => [
    `meu-bot: seu espaço na máquina chegou a ${l.pct}% (${fmtGb(l.usadoKb)} de ${fmtGb(l.limiteKb)}).`,
    `Ocupando: ${resumoItens(l.itens)}.`,
    'Para liberar: no meu-bot, Configurações › Espaço › Liberar espaço (áudios, imagens e arquivos antigos). Para apagar conversas, exclua-as na lista do meu-bot.',
    `Para ter mais espaço: ${mais(link)}.`,
  ].join('\n'),
  95: (l, link) => [
    `meu-bot: seu espaço na máquina está quase no fim: ${l.pct}% (${fmtGb(l.usadoKb)} de ${fmtGb(l.limiteKb)}). Em 100% o agente para de guardar áudios, imagens e conversas novas.`,
    `Ocupando: ${resumoItens(l.itens)}.`,
    `Libere agora em Configurações › Espaço › Liberar espaço, ou peça mais: ${mais(link)}.`,
  ].join('\n'),
  100: (l, link) => [
    `meu-bot: seu espaço na máquina acabou (${fmtGb(l.usadoKb)} de ${fmtGb(l.limiteKb)}). O agente ainda funciona por ${l.grace ?? 'alguns dias'} com uma folga pequena; depois para de gravar.`,
    `Ocupando: ${resumoItens(l.itens)}.`,
    `Libere em Configurações › Espaço › Liberar espaço ou peça mais espaço: ${mais(link)}.`,
  ].join('\n'),
};

/**
 * Acompanha as leituras da cota e decide os avisos. `registrar(leitura, agora, {link})` devolve `{ nivel, avisar }`:
 * `nivel` é o estado atual ('ok' | 'perto' | 'critico' | 'cheio') e `avisar` tem no máximo um {nivel, texto}: o
 * maior nível cruzado ainda não avisado (cruzar 80 e 95 de uma vez manda só o de 95, mas marca os dois). `avisado`
 * vem de fora (persistido pelo server.js) para não repetir o aviso depois de reiniciar; rearma quando o uso cai
 * REARME_PCT pontos abaixo do nível. Leitura null (quota indisponível) limpa `ultima` e não mexe em `avisado`.
 */
class VigiaCota {
  constructor(avisado = {}) {
    this.avisado = { ...avisado };
    this.ultima = null;
  }
  registrar(leitura, agora = Date.now(), opts = {}) {
    if (!leitura) {
      this.ultima = null;
      return { nivel: 'ok', avisar: [] };
    }
    this.ultima = leitura;
    const pct = Number(leitura.pct) || 0;
    for (const L of NIVEIS) if (pct < L - REARME_PCT) delete this.avisado[L];
    const cruzados = NIVEIS.filter((L) => pct >= L && !this.avisado[L]);
    const avisar = [];
    if (cruzados.length > 0) {
      for (const L of cruzados) this.avisado[L] = agora;
      const maior = cruzados[cruzados.length - 1];
      avisar.push({ nivel: maior, texto: TEXTOS[maior](leitura, opts.link ?? null) });
    }
    return { nivel: nivelDe(pct), avisar };
  }
}

module.exports = { lerQuota, limiteKbDe, PASTAS, duArgs, lerDu, montarItens, pctDe, NIVEIS, REARME_PCT, nivelDe, fmtGb, resumoItens, TEXTOS, VigiaCota };
