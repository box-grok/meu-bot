#!/usr/bin/env bash
# listar.sh — grupos onde o agente OpenClaw está HABILITADO hoje (fonte: openclaw.json),
# com nome resolvido pelo cache data/grupos-live.json. Read-only, não para o gateway.
#
#   bash listar.sh            # habilitados (config) + nome + modo de ativação
#   bash listar.sh --todos    # todos os grupos da conta (cache da última wa-admin.sh listar)
#
# Pra atualizar o cache (nome/membros ao vivo): bash wa-admin.sh listar   (para o gateway ~30s)
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$S/../data/grupos-live.json"

python3 - "$CACHE" "${1:-}" <<'EOF'
import json, subprocess, sys, os
cache_path, modo = sys.argv[1], sys.argv[2]
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else None
nomes = {g["jid"]: g for g in (cache or {}).get("grupos", [])}

r = subprocess.run("openclaw config get channels.whatsapp", shell=True, capture_output=True, text=True, timeout=40)
wa = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip().startswith("{") else \
     json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))["channels"]["whatsapp"]

if modo == "--todos":
    if not cache:
        sys.exit("❌ sem cache. Rode: bash wa-admin.sh listar")
    print(f"═══ Todos os grupos da conta {cache.get('conta','?')} — cache de {cache['atualizadoEm'][:16]} ═══")
    hab = wa.get("groups") or {}
    for g in cache["grupos"]:
        flag = " ✅ habilitado" if g["jid"] in hab else ""
        print(f"• {g['nome']} — {g['membros']} membros — criado {g['criado']} — {g['jid']}{flag}")
    sys.exit(0)

gp = wa.get("groupPolicy", "(ausente→allowlist)")
groups = wa.get("groups") or {}
print(f"(fonte: ~/.openclaw/openclaw.json → channels.whatsapp; groupPolicy={gp})")
if gp == "disabled":
    print("(grupos DESABILITADOS no canal — groupPolicy=disabled)")
if not groups:
    print("(nenhum grupo em channels.whatsapp.groups)" + ("" if gp == "disabled" else "  ⚠️ com groupPolicy≠disabled isso admite TODOS os grupos"))
else:
    print("═══ Grupos habilitados pro agente ═══")
    for jid, g in groups.items():
        if jid == "*":
            print("  *  ⚠️  wildcard: TODOS os grupos admitidos"); continue
        nm = nomes.get(jid, {}).get("nome", "(nome não resolvido — rode wa-admin.sh listar)")
        rm = g.get("requireMention", True)
        modo_txt = "menção" if rm else "sempre-ativo"
        sp = " · prompt próprio" if g.get("systemPrompt") else ""
        print(f"  {jid:<32} {nm}  [{modo_txt}{sp}]")
print()
gaf = wa.get("groupAllowFrom") or []
af = wa.get("allowFrom") or []
if gp == "open":
    print("👥 quem dispara em grupo: qualquer membro (groupPolicy=open)")
elif gaf:
    print("👥 quem dispara em grupo (groupAllowFrom): " + ", ".join(gaf))
else:
    print("👥 quem dispara em grupo: groupAllowFrom ausente → allowFrom das DMs: " + ", ".join(af))
EOF
