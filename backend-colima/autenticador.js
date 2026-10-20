/**
 * autenticador.js — códigos de dois fatores (TOTP, RFC 6238) do meu-bot-crm, guardados na máquina. O segredo entra
 * uma vez (otpauth:// lido do QR, ou colado) e nunca sai: nenhuma rota o devolve; só os códigos do momento.
 *
 *   <dir>/autenticador.json          { contas: { [key]: Conta } }  segredo cifrado (AES-256-GCM)
 *   <dir>/autenticador-uso.jsonl     auditoria: quem pediu código de qual conta e quando (rotação em 5 000 → 2 000)
 *   <chaveFile>                      32 bytes aleatórios, 0600, FORA do db/ (o backup diário do CRM não leva a chave)
 *
 * Quem pede (`por`, do X-Crm-Por): a extensão vê todas as contas; o agente (qualquer outro) só as marcadas
 * "agente pode usar". O cabeçalho não é autenticação (quem tem a chave do backend pode mandá-lo): é a regra de
 * uso que o agente segue, registrada na auditoria.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ErroCrm } = require('./crm-modelo');

const ALGORITMOS = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' };
const USO_MAX = 5000;
const USO_KEEP = 2000;
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Base32 (RFC 4648, sem padding obrigatório, espaços e hífens ignorados) → bytes; null se inválido. */
function base32(texto) {
  const s = String(texto ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (s === '' || !/^[A-Z2-7]+$/.test(s)) return null;
  let bits = 0; let valor = 0; const out = [];
  for (const ch of s) { valor = (valor << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch); bits += 5; if (bits >= 8) { out.push((valor >>> (bits - 8)) & 0xff); bits -= 8; } }
  return out.length >= 10 ? Buffer.from(out) : null; // < 80 bits não é segredo de TOTP de verdade
}

/** Código TOTP de `segredo` (bytes) no instante `agora` (ms). */
function totp(segredo, { digitos = 6, periodo = 30, algoritmo = 'SHA1' } = {}, agora = Date.now()) {
  const passo = Math.floor(agora / 1000 / periodo);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac(ALGORITMOS[algoritmo] ?? 'sha1', segredo).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

/**
 * Entrada de conta nova: `{uri: "otpauth://totp/Emissor:conta?secret=…&issuer=…"}` ou `{segredo, emissor?, conta?}`.
 * Devolve os parâmetros validados e o segredo em bytes. HOTP (por contador) não é aceito.
 */
function parseEntrada(input) {
  let segredo = null; let emissor = ''; let conta = ''; let digitos = 6; let periodo = 30; let algoritmo = 'SHA1';
  if (typeof input?.uri === 'string' && input.uri.trim() !== '') {
    let u; try { u = new URL(input.uri.trim()); } catch { throw new ErroCrm('invalido', 'o QR não tem um endereço otpauth:// válido'); }
    if (u.protocol !== 'otpauth:') throw new ErroCrm('invalido', 'o QR não é de autenticador (otpauth://)');
    if (u.hostname.toLowerCase() !== 'totp') throw new ErroCrm('invalido', 'só códigos por tempo (TOTP); este QR é por contador (HOTP)');
    const rotulo = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const i = rotulo.indexOf(':');
    emissor = str(u.searchParams.get('issuer') ?? (i >= 0 ? rotulo.slice(0, i) : ''), 80);
    conta = str(i >= 0 ? rotulo.slice(i + 1) : rotulo, 120);
    segredo = base32(u.searchParams.get('secret'));
    if (u.searchParams.has('digits')) digitos = Number(u.searchParams.get('digits'));
    if (u.searchParams.has('period')) periodo = Number(u.searchParams.get('period'));
    if (u.searchParams.has('algorithm')) algoritmo = String(u.searchParams.get('algorithm')).toUpperCase();
  } else {
    segredo = base32(input?.segredo);
  }
  if (typeof input?.emissor === 'string' && input.emissor.trim() !== '') emissor = str(input.emissor, 80);
  if (typeof input?.conta === 'string' && input.conta.trim() !== '') conta = str(input.conta, 120);
  if (segredo === null) throw new ErroCrm('invalido', 'segredo inválido: precisa ser base32 (letras A–Z e 2–7) com pelo menos 16 caracteres');
  if (![6, 7, 8].includes(digitos)) throw new ErroCrm('invalido', 'o código precisa ter 6, 7 ou 8 dígitos');
  if (!Number.isInteger(periodo) || periodo < 10 || periodo > 300) throw new ErroCrm('invalido', 'período inválido (10 a 300 segundos)');
  if (!(algoritmo in ALGORITMOS)) throw new ErroCrm('invalido', `algoritmo ${algoritmo} não suportado`);
  if (emissor === '' && conta === '') throw new ErroCrm('invalido', 'dê um nome à conta (emissor ou conta)');
  return { segredo, emissor, conta, digitos, periodo, algoritmo };
}

/** `deps`: `dir` (pasta do db do CRM), `chaveFile`, `now()`, `rnd(n)`, `log`. */
function createAutenticador(deps) {
  const now = deps.now ?? (() => Date.now());
  const rnd = deps.rnd ?? ((n) => crypto.randomBytes(n));
  const log = deps.log ?? (() => {});
  const arquivo = path.join(deps.dir, 'autenticador.json');
  const usoArquivo = path.join(deps.dir, 'autenticador-uso.jsonl');

  let chave = null;
  function chaveMestra() {
    if (chave !== null) return chave;
    try { chave = fs.readFileSync(deps.chaveFile); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // Sem chave e com contas gravadas = os segredos ficaram ilegíveis; não cria outra por cima.
      if (Object.keys(ler().contas).length > 0) throw new Error(`a chave do autenticador sumiu (${deps.chaveFile}); as contas gravadas não podem ser lidas`);
      fs.mkdirSync(path.dirname(deps.chaveFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(deps.chaveFile, Buffer.from(rnd(32)), { mode: 0o600, flag: 'wx' });
      chave = fs.readFileSync(deps.chaveFile);
    }
    if (chave.length !== 32) throw new Error(`chave do autenticador inválida em ${deps.chaveFile}`);
    return chave;
  }
  const cifrar = (segredo, key) => { const iv = Buffer.from(rnd(12)); const c = crypto.createCipheriv('aes-256-gcm', chaveMestra(), iv); c.setAAD(Buffer.from(key)); const dados = Buffer.concat([c.update(segredo), c.final()]); return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64') }; };
  const decifrar = (s, key) => { const d = crypto.createDecipheriv('aes-256-gcm', chaveMestra(), Buffer.from(s.iv, 'base64')); d.setAAD(Buffer.from(key)); d.setAuthTag(Buffer.from(s.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(s.dados, 'base64')), d.final()]); };

  function ler() {
    try { const v = JSON.parse(fs.readFileSync(arquivo, 'utf8')); return v && typeof v.contas === 'object' && v.contas !== null ? v : { contas: {} }; }
    catch (e) { if (e.code === 'ENOENT') return { contas: {} }; throw new Error(`autenticador.json corrompido: ${e.message}`); }
  }
  function gravar(v) { fs.mkdirSync(deps.dir, { recursive: true, mode: 0o700 }); const tmp = `${arquivo}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, arquivo); }
  function auditar(por, acao, c) {
    try {
      fs.appendFileSync(usoArquivo, `${JSON.stringify({ em: new Date(now()).toISOString(), por, acao, conta: c.key, nome: rotulo(c) })}\n`, { mode: 0o600 });
      const linhas = fs.readFileSync(usoArquivo, 'utf8').split('\n').filter(Boolean);
      if (linhas.length > USO_MAX) fs.writeFileSync(usoArquivo, `${linhas.slice(-USO_KEEP).join('\n')}\n`, { mode: 0o600 });
    } catch (e) { log(`autenticador: auditoria falhou: ${e.message}`); }
  }
  const rotulo = (c) => (c.emissor && c.conta ? `${c.emissor} (${c.conta})` : c.emissor || c.conta);
  const view = (c) => ({ key: c.key, emissor: c.emissor, conta: c.conta, digitos: c.digitos, periodo: c.periodo, agente: c.agente, criadoEm: new Date(c.criadoEm).toISOString().slice(0, 10) });
  const ehExtensao = (por) => por === 'extensao';
  const visiveis = (por) => Object.values(ler().contas).filter((c) => ehExtensao(por) || c.agente).sort((x, y) => rotulo(x).localeCompare(rotulo(y), 'pt-BR'));
  const contaOr404 = (key, por) => { const c = ler().contas[key]; if (!c || (!ehExtensao(por) && !c.agente)) throw new ErroCrm('nao_encontrado', 'conta do autenticador não existe (ou o agente não pode usá-la)'); return c; };
  const codigoDe = (c, t) => ({ ...view(c), codigo: totp(decifrar(c.segredo, c.key), c, t), restante: c.periodo - (Math.floor(t / 1000) % c.periodo) });

  return {
    listar: (por) => ({ contas: visiveis(por).map(view) }),
    /** Códigos do momento (todas as contas visíveis): o popup chama a cada virada de período. */
    codigos(por) { const t = now(); const cs = visiveis(por); if (!ehExtensao(por)) for (const c of cs) auditar(por, 'codigo', c); return { agora: new Date(t).toISOString(), contas: cs.map((c) => codigoDe(c, t)) }; },
    codigo(key, por) { const c = contaOr404(key, por); auditar(por, 'codigo', c); return codigoDe(c, now()); },
    criar(input, por) {
      const e = parseEntrada(input);
      const v = ler();
      const dup = Object.values(v.contas).find((c) => c.emissor === e.emissor && c.conta === e.conta);
      if (dup) throw new ErroCrm('conflito', `já existe uma conta "${rotulo(dup)}"; apague a antiga antes de ler o QR novo`);
      const key = `a_${Buffer.from(rnd(9)).toString('base64url')}`;
      const c = { key, emissor: e.emissor, conta: e.conta, digitos: e.digitos, periodo: e.periodo, algoritmo: e.algoritmo, agente: input?.agente === true, segredo: cifrar(e.segredo, key), criadoEm: now(), atualizadoEm: now() };
      v.contas[key] = c; gravar(v); auditar(por, 'criar', c);
      return { ok: true, conta: view(c) };
    },
    editar(key, patch, por) {
      const v = ler(); const c = v.contas[key]; if (!c) throw new ErroCrm('nao_encontrado', 'conta do autenticador não existe');
      if (!ehExtensao(por)) throw new ErroCrm('invalido', 'só a extensão muda as contas do autenticador');
      if ('emissor' in patch) c.emissor = str(patch.emissor, 80);
      if ('conta' in patch) c.conta = str(patch.conta, 120);
      if ('agente' in patch) { if (typeof patch.agente !== 'boolean') throw new ErroCrm('invalido', 'agente deve ser true/false'); c.agente = patch.agente; }
      if (c.emissor === '' && c.conta === '') throw new ErroCrm('invalido', 'dê um nome à conta (emissor ou conta)');
      c.atualizadoEm = now(); gravar(v); auditar(por, 'editar', c);
      return { ok: true, conta: view(c) };
    },
    apagar(key, por) {
      const v = ler(); const c = v.contas[key]; if (!c) throw new ErroCrm('nao_encontrado', 'conta do autenticador não existe');
      if (!ehExtensao(por)) throw new ErroCrm('invalido', 'só a extensão apaga contas do autenticador');
      delete v.contas[key]; gravar(v); auditar(por, 'apagar', c);
      return { ok: true };
    },
  };
}

module.exports = { createAutenticador, totp, base32, parseEntrada };
