#!/usr/bin/env bash
# Pareia de novo o WhatsApp do Hermes (ponte Baileys do hermes-gateway) e devolve o QR ao vivo.
# O meu-bot manda este arquivo pelo stdin do ssh (fica em ~/bin) e lê a saída, uma linha por evento:
#   passo: <etapa> <texto>       etapa = checar | parar | sessao | qr | religar
#   qr: <svg em base64>          QR novo (o WhatsApp troca a cada ~20 s)
#   conectado: <json do usuário> o celular leu o QR e a ponte salvou as credenciais
#   pronto: <texto> | erro: <texto> | ja-conectado: <texto>
# Uso: parear-hermes.sh [--forcar]   (--forcar pareia mesmo com a ponte conectada)
# Qualquer saída sem par (cancelado, tempo esgotado) devolve a sessão antiga e religa o gateway.
set -u
export PATH="$HOME/.local/bin:$PATH"
FORCAR=0; [ "${1:-}" = "--forcar" ] && FORCAR=1
WA="$HOME/.hermes/whatsapp"; SESS="$WA/session"
BRIDGE="$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent/scripts/whatsapp-bridge/bridge.js"
QRLIB="$HOME/.hermes/agente-rene/backend-sdk-claude/node_modules/qrcode"
TIMEOUT_S=240

saude() { curl -s -m 3 http://127.0.0.1:3000/health | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p'; }

echo "passo: checar procurando o Hermes nesta máquina"
for f in "$BRIDGE" "$QRLIB"; do [ -e "$f" ] || { echo "erro: o Hermes (ou a biblioteca de QR) não está nesta máquina: falta $f"; exit 2; }; done
command -v pm2 >/dev/null && command -v node >/dev/null || { echo "erro: pm2 ou node não estão no PATH desta máquina"; exit 2; }
pm2 jlist 2>/dev/null | grep -q '"name":"hermes-gateway"' || { echo "erro: não há hermes-gateway no PM2 desta máquina"; exit 2; }
# Um pareamento por vez: dois na mesma pasta de sessão se atropelam. A trava vai junto para o node e
# a ponte (herdam o fd 9), então só solta quando tudo morreu.
exec 9>"$WA/.pareando.lock"
flock -n 9 || { echo "erro: já tem um pareamento rodando nesta máquina; espere ~1 min e tente de novo"; exit 2; }
if [ "$(saude)" = "connected" ] && [ $FORCAR -eq 0 ]; then echo "ja-conectado: o WhatsApp do Hermes já está conectado; nada a fazer"; exit 0; fi

parado=0; guardada=""; pareado=0; NODE_PID=""
devolver() {
  # A ponte de pareamento morre antes de a sessão voltar ao lugar (ela escreve na pasta).
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  pkill -f "whatsapp-bridge/bridge.js --pair-only" 2>/dev/null && sleep 1
  # Sem par novo: a sessão antiga volta como estava (se a pessoa só cancelou, nada se perde).
  if [ $pareado -eq 0 ] && [ -n "$guardada" ] && [ -d "$guardada" ]; then rm -rf "$SESS"; mv "$guardada" "$SESS"; fi
  [ $parado -eq 1 ] && pm2 start hermes-gateway >/dev/null 2>&1
}
trap devolver EXIT
trap 'exit 1' HUP INT TERM PIPE

echo "passo: parar parando o hermes-gateway (a ponte não pode rodar duas vezes na mesma sessão)"
pm2 stop hermes-gateway >/dev/null 2>&1; parado=1
pkill -f "whatsapp-bridge/bridge.js" 2>/dev/null; sleep 1

if [ -d "$SESS" ]; then
  guardada="$SESS.loggedout-$(date +%s)"
  mv "$SESS" "$guardada"
  echo "passo: sessao sessão antiga guardada em $(basename "$guardada")"
else
  echo "passo: sessao não havia sessão antiga"
fi

echo "passo: qr abra o WhatsApp do número do agente › Dispositivos conectados › Conectar dispositivo"
BRIDGE="$BRIDGE" QRLIB="$QRLIB" TIMEOUT_S="$TIMEOUT_S" node -e '
const { spawn } = require("node:child_process");
const fs = require("node:fs"); const path = require("node:path"); const readline = require("node:readline");
const QR = require(process.env.QRLIB);
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(process.env.HOME, ".hermes", ".env"), "utf8").split("\n")) {
    const i = line.indexOf("="); if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim(); if (!(k in env)) env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
} catch { /* sem .env: a ponte usa os padrões */ }
const out = (s) => { try { process.stdout.write(s + "\n"); } catch { child.kill("SIGKILL"); process.exit(1); } };
process.stdout.on("error", () => { child.kill("SIGKILL"); process.exit(1); });
process.on("SIGTERM", () => { child.kill("SIGKILL"); process.exit(1); });
const child = spawn("node", [process.env.BRIDGE, "--pair-only", "--pair-json"], { cwd: path.dirname(process.env.BRIDGE), env, stdio: ["ignore", "pipe", "pipe"] });
let ok = false;
const timer = setTimeout(() => { out("erro: ninguém leu o QR em " + process.env.TIMEOUT_S + " s"); child.kill("SIGKILL"); }, Number(process.env.TIMEOUT_S) * 1000);
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let ev; try { ev = JSON.parse(line); } catch { return; }
  if (ev.event === "qr") QR.toString(ev.qr, { type: "svg", margin: 2 }).then((svg) => out("qr: " + Buffer.from(svg).toString("base64")));
  else if (ev.event === "connected") { ok = true; out("conectado: " + JSON.stringify(ev.user ?? {})); }
  else if (ev.event === "error") out("erro: a ponte respondeu " + String(ev.error).slice(0, 200));
});
child.on("close", () => { clearTimeout(timer); process.exit(ok ? 0 : 1); });
' &
NODE_PID=$!
# wait (e não o node em primeiro plano): o bash só atende HUP/TERM entre comandos, e o wait cede na hora.
wait "$NODE_PID" || exit 1
NODE_PID=""; pareado=1

echo "passo: religar religando o hermes-gateway com a sessão nova"
pm2 start hermes-gateway >/dev/null 2>&1; parado=0
for _ in $(seq 1 45); do
  if [ "$(saude)" = "connected" ]; then echo "pronto: WhatsApp do Hermes conectado e o gateway no ar"; exit 0; fi
  sleep 2
done
echo "erro: o par foi salvo, mas o gateway não confirmou a conexão em 90 s (veja ~/.hermes/logs/gateway.log)"
exit 1
