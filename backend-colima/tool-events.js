/**
 * tool-events.js — o que o agente está fazendo, a partir do stream-json da CLI do Claude: cada `tool_use`
 * (Bash: o comando; Read/Write/Edit: o arquivo…) e cada `tool_result` (primeiras linhas). Vira um chunk SSE
 * próprio (`x_meu_bot.tool`), que o app mostra na conversa e na aba "Agente · atividade". Puro, testável.
 */
'use strict';

const MAX_SUMMARY = 240;
const MAX_RESULT_LINES = 20;
const MAX_RESULT_CHARS = 2000;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Resumo legível da entrada de uma ferramenta. */
function summarize(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const str = (k) => (typeof i[k] === 'string' ? i[k] : null);
  switch (name) {
    case 'Bash': return typeof i.command === 'string' && /streak\.mjs\s+\S/.test(i.command) ? crmSummary(i.command) : (str('command') || '');
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return str('file_path') || str('notebook_path') || '';
    case 'Glob': case 'Grep': return [str('pattern'), str('path')].filter(Boolean).join(' em ');
    case 'WebFetch': return str('url') || '';
    case 'WebSearch': return str('query') || '';
    case 'Task': return str('description') || str('prompt') || '';
    case 'TodoWrite': return Array.isArray(i.todos) ? `${i.todos.length} itens` : '';
    default: {
      if (name.startsWith('mcp__navegador__')) return navegadorSummary(name.slice('mcp__navegador__'.length), i);
      try { return JSON.stringify(i); } catch (_) { return ''; }
    }
  }
}

/** Comandos do streak.mjs (CRM pelo WhatsApp) em uma linha: "📇 CRM: box-find --phone +595…". */
function crmSummary(command) {
  const m = /streak\.mjs\s+(\S+)(.*)$/s.exec(command);
  if (!m) return '📇 CRM';
  const rest = m[2].replace(/\s+/g, ' ').trim().slice(0, 70);
  return `📇 CRM: ${m[1]}${rest ? ` ${rest}` : ''}`;
}
/** Ações do agente no Navegador da pessoa, em uma linha. "digitar" nunca mostra o texto (pode ser senha). */
function navegadorSummary(tool, i) {
  const s = (k) => (typeof i[k] === 'string' ? i[k] : null);
  const alvo = typeof i.n === 'number' ? `o elemento ${i.n}` : (s('texto') && tool === 'clicar') ? `"${i.texto.slice(0, 40)}"` : s('seletor') ? `\`${i.seletor.slice(0, 40)}\`` : null;
  switch (tool) {
    case 'abrir': return `🌐 abriu ${s('url') || ''}${i.nova === true ? ' (aba nova)' : ''}`;
    case 'ler': return '🌐 leu a página';
    case 'clicar': return `🌐 clicou em ${alvo || 'um elemento'}`;
    case 'digitar': return `🌐 digitou em ${alvo || 'um campo'}${i.enter === true ? ' e apertou Enter' : ''}`;
    case 'tecla': return `🌐 tecla ${s('tecla') || ''}`;
    case 'print': return '🌐 tirou um print';
    case 'voltar': return '🌐 voltou';
    case 'avancar': return '🌐 avançou';
    case 'recarregar': return '🌐 recarregou';
    case 'abas': return '🌐 listou as abas';
    case 'js': return '🌐 rodou um script na página';
    case 'favoritos': return '⭐ listou os favoritos';
    case 'favoritar': return `⭐ favoritou ${s('url') || ''}`;
    case 'desfavoritar': return `⭐ tirou dos favoritos ${s('url') || s('id') || ''}`;
    default: return `🌐 ${tool}`;
  }
}

/** Texto de um tool_result (string ou partes de texto), cortado em linhas e caracteres. */
function resultText(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.length > MAX_RESULT_LINES;
  let out = lines.slice(0, MAX_RESULT_LINES).join('\n');
  if (out.length > MAX_RESULT_CHARS) out = `${out.slice(0, MAX_RESULT_CHARS)}…`;
  return cut ? `${out}\n… (+${lines.length - MAX_RESULT_LINES} linhas)` : out;
}

/**
 * Eventos de ferramenta de um evento do stream-json. `names` (Map tool_use_id → nome) é do chamador: o
 * tool_result não traz o nome, só o id. Devolve [] para eventos sem ferramenta.
 */
function toolEventsFrom(ev, names) {
  const out = [];
  if (!ev || typeof ev !== 'object' || !ev.message || !Array.isArray(ev.message.content)) return out;
  if (ev.type === 'assistant') {
    for (const b of ev.message.content) {
      if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
      if (typeof b.id === 'string') names.set(b.id, b.name);
      out.push({ kind: 'use', name: b.name, summary: clip(summarize(b.name, b.input).replace(/\s+/g, ' ').trim(), MAX_SUMMARY) });
    }
  } else if (ev.type === 'user') {
    for (const b of ev.message.content) {
      if (!b || b.type !== 'tool_result') continue;
      const name = (typeof b.tool_use_id === 'string' && names.get(b.tool_use_id)) || null;
      out.push({ kind: 'result', name, ok: b.is_error !== true, text: resultText(b.content) });
    }
  }
  return out;
}

/** Chunk SSE (formato OpenAI, delta vazio) que carrega o evento de ferramenta. */
function toolChunk(id, created, model, tool) {
  return { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: null }], x_meu_bot: { tool } };
}

module.exports = { toolEventsFrom, toolChunk, summarize, resultText };
