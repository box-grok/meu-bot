/**
 * Lista os grupos do WhatsApp numa máquina com Hermes, pelo próprio WhatsApp (groupFetchAllParticipating), como a
 * skill whatsapp-grupos faz no OpenClaw. Sem isto, no Hermes só apareciam grupos que já tinham mandado mensagem ao
 * agente, o que nem acontece com o grupo ainda fora da lista admitida: "Atualizar lista" não listava nada.
 *
 * Usa o MESMO Baileys e a MESMA sessão do bridge do Hermes (…/scripts/whatsapp-bridge/node_modules e
 * ~/.hermes/whatsapp/session), então o gateway precisa estar PARADO: duas conexões com a mesma credencial derrubam
 * uma à outra (440 "connection replaced"). O WhatsApp do agente fica fora uns 30 s; a tela pede confirmação antes.
 * Grava o mesmo cache que `gruposHermes` já lê (WA_GRUPOS_DIR/data/grupos-live.json, formato de parseCacheGrupos).
 * Saída: `GRUPOS=<n>` e `RC=0` quando deu certo; `ERRO=<motivo>` quando não.
 */
import { HERMES_PATH_SH, HERMES_RESTART_SH } from "./whatsapp-hermes-core";

/** O node que conecta e grava o cache; argv: pasta da sessão, arquivo do cache. Sem template strings (vive num template do TS). */
const LISTAR_JS = `'use strict';
const fs = require('fs'), path = require('path');
const AUTH = process.argv[2], CACHE = process.argv[3];
const b = require('@whiskeysockets/baileys');
const makeWASocket = b.makeWASocket || b.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = b;
let pino = null; try { pino = require('pino'); } catch (e) { pino = null; }
const silent = { level: 'silent', child: function () { return silent; } };
for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) silent[m] = function () {};
const logger = pino ? pino({ level: 'silent' }) : silent;
(async () => {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  let version; try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { version = undefined; }
  const sock = makeWASocket(Object.assign(version ? { version: version } : {}, {
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger: logger, printQRInTerminal: false, browser: ['Hermes Agent', 'Chrome', '120.0'], syncFullHistory: false, markOnlineOnConnect: false,
  }));
  sock.ev.on('creds.update', saveCreds);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo esgotado (45 s) esperando a conexão com o WhatsApp')), 45000);
    sock.ev.on('connection.update', (u) => {
      if (u.qr) { clearTimeout(t); reject(new Error('o WhatsApp pediu QR: a sessão do Hermes não está pareada (tutorial 3)')); }
      if (u.connection === 'open') { clearTimeout(t); resolve(); }
      if (u.connection === 'close') {
        clearTimeout(t);
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : undefined;
        reject(new Error(code === DisconnectReason.connectionReplaced ? 'conexão substituída (440): o gateway do Hermes ainda estava ligado' : 'conexão fechada (' + code + ')'));
      }
    });
  });
  const groups = await sock.groupFetchAllParticipating();
  const list = Object.values(groups).map((m) => ({
    jid: m.id, nome: m.subject || '', membros: (m.participants || []).length,
    criado: m.creation ? new Date(Number(m.creation) * 1000).toISOString().slice(0, 10) : '?',
    owner: m.owner || m.subjectOwner || null, descricao: m.desc || null,
    participantes: (m.participants || []).map((p) => ({ jid: p.id, phone: p.phoneNumber || (p.id && p.id.endsWith('@s.whatsapp.net') ? p.id : null), admin: p.admin || null })),
  })).sort((a, c) => (c.criado > a.criado ? 1 : -1));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ atualizadoEm: new Date().toISOString(), conta: (sock.user && sock.user.id) || null, grupos: list }, null, 2));
  console.log('GRUPOS=' + list.length);
  try { sock.end(undefined); } catch (e) { /* já vai sair */ }
  process.exit(0);
})().catch((e) => { console.log('ERRO=' + (e && e.message ? e.message : String(e))); process.exit(1); });
`;

/**
 * O script por SSH: acha o bridge do Hermes (com o Baileys), confere a sessão, para o gateway, lista, grava o cache
 * e religa o gateway sempre (mesmo com erro). A mesma trava da skill do OpenClaw (wa-admin.lock) evita duas listagens
 * ao mesmo tempo. Nunca sai com código != 0 por conta do SSH: o resultado vai nas linhas GRUPOS=/ERRO=/RC=.
 */
export const HERMES_GRUPOS_LISTAR_SH = `${HERMES_PATH_SH}
R=$(hermes_version | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent
B="$R/scripts/whatsapp-bridge"
[ -d "$B/node_modules/@whiskeysockets/baileys" ] || { echo "ERRO=não achei o bridge do WhatsApp do Hermes (com o Baileys) em $B"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "ERRO=esta máquina não tem o node no PATH para o Hermes"; exit 0; }
S=$HOME/.hermes/whatsapp/session
[ -f "$S/creds.json" ] || { echo "ERRO=o WhatsApp do Hermes não está pareado nesta máquina (tutorial 3)"; exit 0; }
C=$HOME/.claude/skills/whatsapp-grupos/data/grupos-live.json
LOCK=$HOME/.cache/meu-bot/wa-admin.lock; mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK.flock"
flock -n 9 || { echo "ERRO=já há uma listagem de grupos em andamento nesta máquina; espere ela terminar"; exit 0; }
echo $$ > "$LOCK"
J=$(mktemp /tmp/meu-bot-grupos-XXXXXX.js)
cat > "$J" <<'JS'
${LISTAR_JS}
JS
if pm2 describe hermes-gateway >/dev/null 2>&1; then GW=pm2; elif systemctl --user cat hermes-gateway >/dev/null 2>&1; then GW=systemd; else GW=hermes; fi
case "$GW" in pm2) pm2 stop hermes-gateway ;; systemd) systemctl --user stop hermes-gateway ;; *) hermes gateway stop ;; esac >/dev/null 2>&1
echo "parou=$GW"
for i in $(seq 1 20); do P=$(cat "$S/bridge.pid" 2>/dev/null | tr -dc 0-9); if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then sleep 1; else break; fi; done
NODE_PATH="$B/node_modules" timeout 90 node "$J" "$S" "$C"; RC=$?
rm -f "$J" "$LOCK"
${HERMES_RESTART_SH}
echo "RC=$RC"`;

/** Lê a saída do script: o número de grupos, ou o motivo de não ter dado. */
export function lerListagemHermes(out: string): { ok: true; grupos: number } | { ok: false; erro: string } {
  const erro = /^ERRO=(.*)$/m.exec(out)?.[1]?.trim();
  if (erro !== undefined && erro !== "") return { ok: false, erro };
  const n = /^GRUPOS=(\d+)$/m.exec(out)?.[1];
  if (n !== undefined && /^RC=0$/m.test(out)) return { ok: true, grupos: Number(n) };
  const restart = /^restart=(.*)$/m.exec(out)?.[1]?.trim();
  return { ok: false, erro: `a listagem não terminou${restart !== undefined && restart.startsWith("falhou") ? ` e o gateway não religou (${restart})` : ""}` };
}
