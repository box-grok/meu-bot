/**
 * wa-cloud-core.js — o puro (testado) do gateway da API oficial do WhatsApp (Cloud API da Meta). O serviço
 * (wa-cloud.js) recebe o webhook, confere a assinatura, decide se o agente responde e manda a resposta pela Graph API;
 * aqui fica só o que não toca rede nem disco: verificação do webhook, HMAC do corpo bruto, leitura das mensagens,
 * duplicatas, política "quem o agente responde" e montagem do envio.
 *
 * Por que um gateway oficial: OpenClaw, Hermes e PicoClaw usam o protocolo do WhatsApp Web (cliente não oficial), que
 * pode levar o número a ser bloqueado. Na Cloud API cada pessoa usa o app e o número do Meta Business dela.
 */
'use strict';
const crypto = require('node:crypto');

/** Versão da Graph API usada no envio e na conferência do número. */
const GRAPH_VERSAO = 'v21.0';
/** Limite de texto de uma mensagem na Cloud API; acima disso a resposta vai em partes. */
const TEXTO_MAX = 4096;

/** GET de verificação do webhook: devolve o `hub.challenge` só se o modo e o token baterem; senão null (403). */
function verificarDesafio(query, verifyToken) {
  if (!verifyToken || !query) return null;
  const modo = query['hub.mode']; const token = query['hub.verify_token']; const desafio = query['hub.challenge'];
  if (modo !== 'subscribe' || typeof token !== 'string' || typeof desafio !== 'string') return null;
  return iguais(token, verifyToken) ? desafio : null;
}

/** Comparação em tempo constante (tamanhos diferentes = falso, sem vazar onde difere). */
function iguais(a, b) {
  const x = Buffer.from(String(a), 'utf8'); const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 do CORPO BRUTO com o App Secret. Tem de ser o Buffer recebido:
 * reserializar o JSON muda bytes (espaços, escapes) e a assinatura não bate.
 */
function assinaturaOk(corpoBruto, cabecalho, appSecret) {
  if (!appSecret || typeof cabecalho !== 'string' || !Buffer.isBuffer(corpoBruto)) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim());
  if (m === null) return false;
  const esperado = crypto.createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  return iguais(m[1].toLowerCase(), esperado);
}

/** Só dígitos, com o "+" na frente: "+5511999990000". Vazio se não parece número. */
function numero(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? `+${d}` : '';
}

/**
 * As mensagens recebidas no corpo do webhook (`entry[].changes[].value.messages[]`), já normalizadas. Ignora status de
 * entrega (`statuses`) e o que não é deste número (`metadata.phone_number_id` diferente). Texto, botão e resposta
 * interativa viram `texto`; mídia (áudio, imagem, documento…) vem com `midiaId` e o `texto` da legenda, se houver.
 */
function lerMensagens(corpo, phoneNumberId) {
  const out = [];
  for (const e of Array.isArray(corpo?.entry) ? corpo.entry : []) {
    for (const ch of Array.isArray(e?.changes) ? e.changes : []) {
      const v = ch?.value;
      if (ch?.field !== 'messages' || !v || (phoneNumberId && v.metadata?.phone_number_id !== phoneNumberId)) continue;
      const nomes = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((c) => [numero(c?.wa_id), String(c?.profile?.name ?? '')]));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const de = numero(m?.from);
        if (!de || typeof m?.id !== 'string') continue;
        const tipo = String(m.type ?? '');
        const ts = Number(m.timestamp);
        const base = { id: m.id, de, nome: nomes.get(de) ?? '', tipo, em: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString() };
        if (tipo === 'text') out.push({ ...base, texto: String(m.text?.body ?? '') });
        else if (tipo === 'button') out.push({ ...base, texto: String(m.button?.text ?? '') });
        else if (tipo === 'interactive') out.push({ ...base, texto: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') });
        else if (['audio', 'image', 'video', 'document', 'sticker'].includes(tipo)) out.push({ ...base, texto: String(m[tipo]?.caption ?? ''), midiaId: String(m[tipo]?.id ?? ''), mime: String(m[tipo]?.mime_type ?? '') });
        else out.push({ ...base, texto: '' }); // localização, contato, reação…: registra, mas o agente não recebe
      }
    }
  }
  return out;
}

/** Ids já vistos (a Meta reenvia o mesmo webhook quando não recebe 200 a tempo): guarda os últimos `max`. */
function criarDuplicatas(max = 2000) {
  const vistos = new Set();
  return {
    /** true se é a primeira vez (e passa a lembrar); false se já veio. */
    novo(id) {
      if (vistos.has(id)) return false;
      vistos.add(id);
      if (vistos.size > max) vistos.delete(vistos.values().next().value);
      return true;
    },
  };
}

/** Políticas "quem o agente responde": só o dono, todo mundo, ou uma lista. */
const POLITICAS = ['self', 'open', 'list'];

/** O estado do wa-cloud.json, validado; o que estiver errado cai no mais fechado ("só o dono"). */
function lerEstado(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const lista = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(numero).filter(Boolean))];
  return {
    politica: POLITICAS.includes(v.politica) ? v.politica : 'self',
    dono: numero(v.dono),
    lista: lista(v.lista),
    pausados: lista(v.pausados),
  };
}

/**
 * Decide o que fazer com quem escreveu: `responder` (com o papel: o dono ou um cliente, que roda com ferramentas
 * travadas) ou `ignorar` (com o motivo, para o registro). Pausado vence tudo; sem dono definido, "só o dono" ignora todos.
 */
function decidir(de, estado) {
  const n = numero(de);
  if (!n) return { acao: 'ignorar', motivo: 'número inválido' };
  if (estado.pausados.includes(n)) return { acao: 'ignorar', motivo: 'pausado' };
  const papel = estado.dono !== '' && n === estado.dono ? 'dono' : 'cliente';
  if (papel === 'dono') return { acao: 'responder', papel };
  if (estado.politica === 'open') return { acao: 'responder', papel };
  if (estado.politica === 'list' && estado.lista.includes(n)) return { acao: 'responder', papel };
  return { acao: 'ignorar', motivo: estado.politica === 'self' ? 'responde só o dono' : 'fora da lista' };
}

/** Quebra a resposta em partes de até `max` caracteres, preferindo parágrafo, depois linha, depois espaço. */
function partes(texto, max = TEXTO_MAX) {
  const t = String(texto ?? '').trim();
  if (t === '') return [];
  const out = []; let resto = t;
  while (resto.length > max) {
    const janela = resto.slice(0, max);
    let corte = Math.max(janela.lastIndexOf('\n\n'), -1);
    if (corte < max * 0.5) corte = janela.lastIndexOf('\n');
    if (corte < max * 0.5) corte = janela.lastIndexOf(' ');
    if (corte < max * 0.5) corte = max;
    out.push(resto.slice(0, corte).trim()); resto = resto.slice(corte).trim();
  }
  if (resto !== '') out.push(resto);
  return out;
}

/** O pedido de envio de texto pela Graph API (um por parte). `para` sem o "+", como a Meta espera. */
function envioTexto(phoneNumberId, para, texto, versao = GRAPH_VERSAO) {
  return {
    url: `https://graph.facebook.com/${versao}/${encodeURIComponent(phoneNumberId)}/messages`,
    corpo: { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero(para).slice(1), type: 'text', text: { preview_url: false, body: texto } },
  };
}

/** Marca a mensagem como lida (os dois tiques azuis), opcional. */
function envioLido(phoneNumberId, mensagemId, versao = GRAPH_VERSAO) {
  return { url: `https://graph.facebook.com/${versao}/${encodeURIComponent(phoneNumberId)}/messages`, corpo: { messaging_product: 'whatsapp', status: 'read', message_id: mensagemId } };
}

/** O que o agente recebe de uma mensagem que não é texto (para ele responder algo útil em vez de nada). */
function textoParaAgente(m) {
  if (m.texto !== '') return m.texto;
  if (m.tipo === 'audio') return '[a pessoa mandou um áudio; ainda não consigo ouvir áudios por aqui]';
  if (m.midiaId) return `[a pessoa mandou um(a) ${m.tipo} sem legenda]`;
  return '';
}

module.exports = { GRAPH_VERSAO, TEXTO_MAX, verificarDesafio, assinaturaOk, numero, lerMensagens, criarDuplicatas, POLITICAS, lerEstado, decidir, partes, envioTexto, envioLido, textoParaAgente };
