#!/bin/bash
# meu-bot-backup.sh — backup completo do que é do usuário nesta máquina e a restauração numa outra (meu-bot-admin).
# Vai pela entrada padrão do SSH (bash -s -- <op> …), como o auditoria.py: a máquina não precisa tê-lo instalado.
#
#   criar <maquina>              .tar.gz no stdout: manifesto.json, crontab.txt e dados.tar (o que está em INCLUIR,
#                                menos EXCLUIR). Para o gateway do OpenClaw e o backend durante a cópia (SQLite e
#                                sessão do WhatsApp consistentes) e religa no fim, mesmo com erro.
#   conferir                     pré-voo do destino: CHAVE=valor (Node, OpenClaw, WhatsApp pareado, espaço, unidades)
#   restaurar [--substituir]     lê o .tar.gz do stdin, confere os sha256 do manifesto, guarda o que existia em
#                                ~/.meu-bot-antes-da-restauracao-<ts>/ (nada é apagado), extrai, troca o $HOME antigo
#                                pelo novo nos arquivos de texto conhecidos e deixa o gateway PARADO e DESATIVADO
#                                (WHATSAPP=aguardando). Recusa se já há WhatsApp pareado aqui, sem --substituir.
#   ativar-whatsapp              liga e ativa o gateway (o WhatsApp passa a responder nesta máquina)
#   desativar-whatsapp <id>      na máquina ANTIGA: para e desativa o gateway e marca migrada-para. NUNCA faz
#                                `channels logout`: isso desregistra o aparelho e mata a sessão também na nova.
#
# Os modelos (transcrição, voz), caches e as units do systemd ficam fora: os instaladores do app refazem.
set -euo pipefail
umask 077
OP="${1:-}"; [ $# -gt 0 ] && shift
H="$HOME"
D="$H/.local/share/meu-bot"
export PATH="$H/.openclaw/bin:$H/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
FORMATO=1
INCLUIR=(.openclaw .local/share/meu-bot .hermes .claude .local/bin)
EXCLUIR=(
  .openclaw/cache .openclaw/tmp .openclaw/logs
  .local/share/meu-bot/transcricao .local/share/meu-bot/voz .local/share/meu-bot/stage
  .claude/cache .claude/downloads .claude/paste-cache .claude/shell-snapshots .claude/session-env
)
SERVICOS=(openclaw-gateway meu-bot-backend)
# Arquivos de texto onde o $HOME aparece por extenso (relativos ao $HOME).
COM_CAMINHO=(.openclaw/openclaw.json .hermes/agente-rene/backend-sdk-claude/.env .local/share/meu-bot/crm.json .claude/settings.json)

ativo() { systemctl --user is-active "$1" >/dev/null 2>&1; }
# timeout quando existe (Linux sim; o macOS dos testes não tem).
t20() { if command -v timeout >/dev/null 2>&1; then timeout 20 "$@"; else "$@"; fi; }
parar() { for s in "${SERVICOS[@]}"; do systemctl --user stop "$s" >/dev/null 2>&1 || true; done; }

case "$OP" in
criar)
  MAQ="${1:-}"; printf '%s' "$MAQ" | grep -Eq '^[0-9a-f]{12}$' || { echo "uso: criar <maquina>" >&2; exit 64; }
  T=$(mktemp -d "${TMPDIR:-/tmp}/meu-bot-backup.XXXXXX")
  VOLTAR=()
  for s in "${SERVICOS[@]}"; do ativo "$s" && VOLTAR+=("$s"); done
  # Religa o que estava ligado e apaga o temporário, aconteça o que acontecer.
  trap 'for s in ${VOLTAR[@]+"${VOLTAR[@]}"}; do systemctl --user start "$s" >/dev/null 2>&1 || true; done; rm -rf "$T"' EXIT
  parar
  EX=(); for e in "${EXCLUIR[@]}"; do EX+=("--exclude=./$e"); done
  PRESENTES=(); for i in "${INCLUIR[@]}"; do [ -e "$H/$i" ] && PRESENTES+=("./$i"); done
  [ ${#PRESENTES[@]} -gt 0 ] || { echo "nada para guardar nesta máquina" >&2; exit 1; }
  tar -C "$H" "${EX[@]}" --exclude='*.lock' --exclude='Singleton*' -cf "$T/dados.tar" "${PRESENTES[@]}"
  for s in ${VOLTAR[@]+"${VOLTAR[@]}"}; do systemctl --user start "$s" >/dev/null 2>&1 || true; done
  VOLTAR=()
  crontab -l > "$T/crontab.txt" 2>/dev/null || : > "$T/crontab.txt"
  OPENCLAW=$(t20 openclaw --version 2>/dev/null | head -n1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)
  NODEV=$(node --version 2>/dev/null || true)
  python3 - "$T" "$MAQ" "$H" "$(id -un)" "$FORMATO" "$OPENCLAW" "$NODEV" "$D" <<'PY'
import hashlib, json, os, sys, tarfile, time
t, maq, home, usuario, formato, openclaw, nodev, d = sys.argv[1:9]
entradas = []
with tarfile.open(os.path.join(t, "dados.tar")) as tf:
    for m in tf:
        if not m.isfile():
            continue
        h = hashlib.sha256()
        f = tf.extractfile(m)
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
        entradas.append({"caminho": m.name, "tamanho": m.size, "sha256": h.hexdigest()})
def versao(p):
    try: return json.load(open(p)).get("version", "")
    except Exception: return ""
ultimo = ""
try:
    linhas = [l for l in open(os.path.join(d, "auditoria.jsonl"), encoding="utf-8") if l.strip()]
    ultimo = json.loads(linhas[-1]).get("hash", "") if linhas else ""
except Exception:
    pass
man = {
    "formato": int(formato), "criadoEm": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "maquina": maq,
    "usuario": usuario, "home": home, "ultimoHashAuditoria": ultimo,
    "versoes": {"openclaw": openclaw, "node": nodev, "guarda": versao(os.path.join(d, "guarda", "package.json")),
                "crm": os.path.exists(os.path.join(d, "crm", "crm.mjs")), "transcricao": os.path.isdir(os.path.join(d, "transcricao")),
                "voz": os.path.isdir(os.path.join(d, "voz")), "vozid": (open(os.path.join(d, "voz", "voz-atual")).read().strip() if os.path.exists(os.path.join(d, "voz", "voz-atual")) else ("faber" if os.path.exists(os.path.join(d, "voz", "faber.onnx")) else "")), "statusline": os.path.exists(os.path.join(home, ".claude", "statusline.sh"))},
    "whatsapp": os.path.exists(os.path.join(home, ".openclaw", "credentials", "whatsapp", "default", "creds.json")),
    "arquivos": len(entradas), "bytes": sum(e["tamanho"] for e in entradas), "entradas": entradas,
}
json.dump(man, open(os.path.join(t, "manifesto.json"), "w"), ensure_ascii=False)
# Resumo (sem a lista de arquivos) pelo stderr: o app guarda no índice sem precisar abrir o pacote cifrado.
resumo = {k: v for k, v in man.items() if k != "entradas"}
sys.stderr.write("MANIFESTO=" + json.dumps(resumo, ensure_ascii=False) + "\n")
PY
  tar -C "$T" -czf - manifesto.json crontab.txt dados.tar
  ;;

conferir)
  echo "NODE=$(node --version 2>/dev/null || true)"
  echo "OPENCLAW=$(t20 openclaw --version 2>/dev/null | head -n1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  [ -s "$H/.openclaw/credentials/whatsapp/default/creds.json" ] && echo "WHATSAPP_PAREADO=1" || echo "WHATSAPP_PAREADO=0"
  echo "LIVRE_MB=$(df -Pm "$H" | awk 'NR==2{print $4}')"
  echo "GATEWAY=$(systemctl --user is-active openclaw-gateway 2>/dev/null || true)"
  systemctl --user cat openclaw-gateway >/dev/null 2>&1 && echo "GATEWAY_UNIT=1" || echo "GATEWAY_UNIT=0"
  echo "USUARIO=$(id -un)"
  echo "HOME=$H"
  ;;

restaurar)
  SUBST=0; [ "${1:-}" = "--substituir" ] && SUBST=1
  if [ -s "$H/.openclaw/credentials/whatsapp/default/creds.json" ] && [ "$SUBST" -ne 1 ]; then
    echo "recusado: já há um WhatsApp pareado nesta máquina (restaure com --substituir para trocar)" >&2; exit 65
  fi
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  T="$H/.meu-bot-restauracao/$TS"; mkdir -p "$T"
  trap 'rm -rf "$T"' EXIT
  tar -xzf - -C "$T"
  python3 - "$T" <<'PY'
import hashlib, json, os, sys, tarfile
t = sys.argv[1]
man = json.load(open(os.path.join(t, "manifesto.json")))
if man.get("formato") != 1:
    sys.exit(f"recusado: formato de backup {man.get('formato')} desconhecido")
esperado = {e["caminho"]: e["sha256"] for e in man["entradas"]}
vistos = 0
links = set()
with tarfile.open(os.path.join(t, "dados.tar")) as tf:
    for m in tf:
        # Link com destino absoluto é normal (plugins do OpenClaw); perigoso é um caminho fora do $HOME ou um arquivo
        # do pacote que passa por um link (gravaria onde o link aponta).
        partes = m.name.split("/")
        if os.path.isabs(m.name) or ".." in partes or any("/".join(partes[:k]) in links for k in range(1, len(partes))):
            sys.exit(f"recusado: caminho perigoso no backup: {m.name}")
        if m.issym() or m.islnk():
            links.add(m.name.rstrip("/"))
        if not m.isfile():
            continue
        h = hashlib.sha256(); f = tf.extractfile(m)
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
        if esperado.get(m.name) != h.hexdigest():
            sys.exit(f"recusado: {m.name} não confere com o manifesto")
        vistos += 1
if vistos != len(esperado):
    sys.exit(f"recusado: o backup tem {vistos} arquivos e o manifesto {len(esperado)}")
print(f"CONFERIDO={vistos}")
PY
  OLD=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["home"])' "$T/manifesto.json")
  parar
  ANTES="$H/.meu-bot-antes-da-restauracao-$TS"
  mkdir -p "$ANTES"
  for i in "${INCLUIR[@]}"; do
    if [ -e "$H/$i" ]; then mkdir -p "$ANTES/$(dirname "$i")"; mv "$H/$i" "$ANTES/$i"; fi
  done
  crontab -l > "$ANTES/crontab.txt" 2>/dev/null || true
  tar -xf "$T/dados.tar" -C "$H"
  # Usuário (ou $HOME) diferente: o caminho antigo vira o novo onde ele aparece por extenso.
  if [ "$OLD" != "$H" ]; then
    python3 - "$OLD" "$H" "$T/crontab.txt" "${COM_CAMINHO[@]/#/$H/}" <<'PY'
import re, sys
old, new, *arqs = sys.argv[1:]
padrao = re.compile(re.escape(old) + r"(?=[/\"'\s:]|$)", re.M)
for a in arqs:
    try:
        s = open(a, encoding="utf-8").read()
    except OSError:
        continue
    n = padrao.sub(new, s)
    if n != s:
        open(a, "w", encoding="utf-8").write(n)
        print(f"CAMINHO={a}")
PY
    # Links que apontavam para dentro do $HOME antigo passam a apontar para o mesmo lugar no novo.
    while IFS= read -r -d '' L; do
      ALVO=$(readlink "$L")
      case "$ALVO" in "$OLD"/*) ln -sfn "$H${ALVO#"$OLD"}" "$L" ;; esac
    done < <(find "${INCLUIR[@]/#/$H/}" -type l -print0 2>/dev/null)
  fi
  [ -s "$T/crontab.txt" ] && crontab "$T/crontab.txt"
  # O WhatsApp só liga aqui depois que a máquina antiga for desligada (ativar-whatsapp).
  systemctl --user disable --now openclaw-gateway >/dev/null 2>&1 || true
  systemctl --user start meu-bot-backend >/dev/null 2>&1 || true
  echo "ANTES=$ANTES"
  echo "ORIGEM=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["maquina"], m.get("ultimoHashAuditoria",""))' "$T/manifesto.json")"
  echo "WHATSAPP=aguardando"
  echo "RESTAURADO=ok"
  ;;

ativar-whatsapp)
  systemctl --user enable --now openclaw-gateway >/dev/null 2>&1 || { echo "recusado: não consegui ligar o gateway do OpenClaw (a unit existe?)" >&2; exit 1; }
  rm -f "$D/migrada-para"
  echo "WHATSAPP=ativo"
  ;;

desativar-whatsapp)
  NOVA="${1:-}"; printf '%s' "$NOVA" | grep -Eq '^[0-9a-f]{12}$' || { echo "uso: desativar-whatsapp <maquina nova>" >&2; exit 64; }
  systemctl --user disable --now openclaw-gateway >/dev/null 2>&1 || true
  mkdir -p "$D"; printf '%s %s\n' "$NOVA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$D/migrada-para"
  ativo openclaw-gateway && { echo "recusado: o gateway continua ligado" >&2; exit 1; }
  echo "WHATSAPP=desativado"
  ;;

*)
  sed -n '2,20p' "$0" 2>/dev/null || true
  echo "operação desconhecida: $OP" >&2; exit 64
  ;;
esac
