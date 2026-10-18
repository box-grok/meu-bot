#!/usr/bin/env node
/**
 * navegador-mcp.mjs — servidor MCP (stdio) do Navegador do meu-bot, um arquivo só, sem dependências.
 * Apresenta ao Claude as ações do navegador da pessoa e repassa cada uma por HTTP para 127.0.0.1:<porta>,
 * onde o túnel SSH reverso entrega ao app no Mac. Uso: node navegador-mcp.mjs --port 19123
 * Protocolo: JSON-RPC 2.0, uma mensagem por linha (initialize, tools/list, tools/call, ping, notifications).
 */
import http from 'node:http';
import readline from 'node:readline';

const port = Number((process.argv.find((a, i) => process.argv[i - 1] === '--port')) || process.env.MEU_BOT_BROWSER_PORT || 0);
if (!port) { process.stderr.write('navegador-mcp: falta --port\n'); process.exit(2); }

const TOOLS = [
  { name: 'abas', description: 'Lista as abas abertas no Navegador da pessoa (id, url, título, qual está ativa).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'abrir', description: 'Abre uma url (http/https) na aba ativa, ou numa aba nova com nova=true. Espera carregar e devolve título/url.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, nova: { type: 'boolean' }, aba: { type: 'number' } }, required: ['url'], additionalProperties: false } },
  { name: 'ler', description: 'Lê a página: título, url, texto visível e a lista numerada de links, botões e campos. Use os números em clicar/digitar. Leia de novo depois de cada ação.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'clicar', description: 'Clica num elemento: por número da última leitura (n), por texto visível (texto) ou por seletor CSS (seletor).', inputSchema: { type: 'object', properties: { n: { type: 'number' }, texto: { type: 'string' }, seletor: { type: 'string' }, aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'digitar', description: 'Digita texto num campo (por número n, seletor, ou no campo focado), apagando o que havia; enter=true confirma com Enter.', inputSchema: { type: 'object', properties: { texto: { type: 'string' }, n: { type: 'number' }, seletor: { type: 'string' }, enter: { type: 'boolean' }, aba: { type: 'number' } }, required: ['texto'], additionalProperties: false } },
  { name: 'tecla', description: 'Aperta uma tecla na página: enter, tab, esc, backspace, space, up, down, left, right, pageup, pagedown ou um caractere.', inputSchema: { type: 'object', properties: { tecla: { type: 'string' }, aba: { type: 'number' } }, required: ['tecla'], additionalProperties: false } },
  { name: 'print', description: 'Tira uma captura da aba (imagem PNG), para ver o layout quando o texto não basta.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'voltar', description: 'Volta uma página no histórico da aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'avancar', description: 'Avança uma página no histórico da aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'recarregar', description: 'Recarrega a aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'favoritos', description: 'Lista a barra de favoritos do Navegador da pessoa (id, título, url).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'favoritar', description: 'Adiciona uma url à barra de favoritos do Navegador da pessoa (título opcional; url repetida só atualiza o título).', inputSchema: { type: 'object', properties: { url: { type: 'string' }, titulo: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'desfavoritar', description: 'Tira um favorito da barra, pelo id (veja favoritos) ou pela url.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' } }, additionalProperties: false } },
  { name: 'js', description: 'Roda JavaScript na página e devolve o resultado (último recurso; prefira ler/clicar/digitar).', inputSchema: { type: 'object', properties: { codigo: { type: 'string' }, aba: { type: 'number' } }, required: ['codigo'], additionalProperties: false } },
];

function call(route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ host: '127.0.0.1', port, path: `/${route}`, method: route === 'abas' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 60_000 }, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', (c) => { out += c; });
      res.on('end', () => { try { const j = JSON.parse(out || '{}'); if (res.statusCode !== 200) reject(new Error(j.erro || `HTTP ${res.statusCode}`)); else resolve(j); } catch (e) { reject(new Error(`resposta inválida do app: ${e.message}`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('o app não respondeu em 60 s')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'o Navegador da pessoa não está ligado para o agente (abra a aba Navegador no app e ligue "agente pode usar")' : e.message)));
    if (route !== 'abas') req.write(data);
    req.end();
  });
}

function textOfRead(r) {
  const head = `# ${r.title || '(sem título)'}\n${r.url}\n\n`;
  const els = r.elements && r.elements.length ? `## Elementos (use o número em clicar/digitar)\n${r.elements.join('\n')}\n\n` : '## Elementos\n(nenhum interativo visível)\n\n';
  return `${head}${els}## Texto\n${r.text || '(vazio)'}${r.truncated ? '\n…(texto cortado)' : ''}`;
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'meu-bot-navegador', version: '1.0.0' } } });
  if (method === 'notifications/initialized' || (typeof method === 'string' && method.startsWith('notifications/'))) return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const name = params?.name; const args = params?.arguments || {};
    try {
      if (!TOOLS.some((t) => t.name === name)) throw new Error(`ferramenta desconhecida: ${name}`);
      const r = await call(name, args);
      if (name === 'print') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'image', data: r.png_base64, mimeType: 'image/png' }] } });
      const text = name === 'ler' ? textOfRead(r) : JSON.stringify(r, null, 1);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `método não suportado: ${method}` } });
});
rl.on('close', () => process.exit(0));
