#!/usr/bin/env python3
"""
habilitar.py — habilita/desabilita o agente OpenClaw em um grupo WhatsApp.

  python3 habilitar.py "<nome ou JID>"                 # DIAGNÓSTICO (não muda nada). Sempre primeiro.
  python3 habilitar.py "<nome ou JID>" --aplicar       # habilita + verifica hot reload
  python3 habilitar.py "<nome ou JID>" --desabilitar   # remove o grupo (e fecha groupPolicy se ficar vazio)

Opções do --aplicar:
  --mencao        (default) responde só quando mencionado / reply / padrão de menção  → requireMention: true
  --sempre        recebe tudo e decide quando responder (NO_REPLY quando não agrega)  → requireMention: false
  --prompt "..."  systemPrompt específico do grupo (contexto do assunto do grupo)
  --remetentes +55...,+55...   acrescenta em channels.whatsapp.groupAllowFrom (quem pode DISPARAR o agente
                  em grupos — vale pra TODOS os grupos habilitados; sem isso cai no allowFrom das DMs)
  --politica allowlist|open    sender policy do canal (default mantém; se estiver "disabled" vira "allowlist").
                  "open" = qualquer membro de grupo habilitado dispara o agente.

Onde tudo mora: ~/.openclaw/openclaw.json → channels.whatsapp.{groupPolicy, groupAllowFrom, groups}.
Escrita SEMPRE via `openclaw config patch --stdin` (validação de schema + hot reload do canal, sem restart).
Nome↔JID vem do cache data/grupos-live.json (gerado por wa-admin.sh listar).
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "grupos-live.json")
CFG = os.path.expanduser("~/.openclaw/openclaw.json")
SVC = "openclaw-gateway.service"

OK, BAD, WARN, INFO = "✅", "❌", "⚠️ ", "ℹ️ "


def sh(cmd, timeout=30, check=False):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}{r.stderr}")
    return r


def load_cfg():
    r = sh("openclaw config get channels.whatsapp", timeout=40)
    if r.returncode == 0 and r.stdout.strip().startswith("{"):
        wa = json.loads(r.stdout)
    else:
        wa = json.load(open(CFG)).get("channels", {}).get("whatsapp", {})
    full = {}
    try:
        full = json.load(open(CFG))
    except Exception:
        pass
    return wa, full


def load_cache():
    if not os.path.exists(CACHE):
        return None
    try:
        return json.load(open(CACHE))
    except Exception:
        return None


def resolve(alvo, cache):
    """Devolve (jid, entry|None)."""
    if re.fullmatch(r"\d{10,25}(-\d+)?@g\.us", alvo):
        e = None
        if cache:
            e = next((g for g in cache["grupos"] if g["jid"] == alvo), None)
        return alvo, e
    if "@" in alvo:
        sys.exit(f"{BAD} '{alvo}' não é JID de grupo (precisa terminar em @g.us; @s.whatsapp.net é DM).")
    if not cache:
        sys.exit(f"{BAD} sem cache de grupos pra resolver o nome '{alvo}'. Rode: bash {HERE}/wa-admin.sh listar")
    hits = [g for g in cache["grupos"] if alvo.lower() in g["nome"].lower()]
    if not hits:
        sys.exit(f"{BAD} nenhum grupo no cache casa com '{alvo}'. Cache de {cache['atualizadoEm']}. Rode wa-admin.sh listar pra atualizar.")
    if len(hits) > 1:
        print(f"{BAD} '{alvo}' é ambíguo:")
        for g in hits:
            print(f"   • {g['nome']} — {g['jid']}")
        sys.exit(1)
    return hits[0]["jid"], hits[0]


def mention_sources(full):
    srcs = []
    for a in full.get("agents", {}).get("list", []) or []:
        ident = (a.get("identity") or {})
        if ident.get("name"):
            srcs.append(f"identity.name={ident['name']!r} (agente {a.get('id')})")
        pats = (a.get("groupChat") or {}).get("mentionPatterns")
        if pats:
            srcs.append(f"agents.list[{a.get('id')}].groupChat.mentionPatterns={pats}")
    pats = (full.get("messages", {}).get("groupChat") or {}).get("mentionPatterns")
    if pats:
        srcs.append(f"messages.groupChat.mentionPatterns={pats}")
    return srcs


def journal(since="3 min ago"):
    r = sh(f"journalctl --user -u {SVC} --since '{since}' --no-pager -o cat", timeout=30)
    return r.stdout


def listening_line(text):
    lines = [l for l in text.splitlines() if "Listening for WhatsApp inbound" in l]
    return lines[-1] if lines else None


def diagnostico(jid, entry, wa, full):
    print(f"═══ Diagnóstico — {entry['nome'] if entry else '(nome não resolvido)'} — {jid} ═══")
    if entry:
        print(f"{INFO} {entry['membros']} membros, criado {entry['criado']} (cache de {load_cache()['atualizadoEm'][:16]})")
        for p in entry["participantes"]:
            adm = f" [{p['admin']}]" if p.get("admin") else ""
            print(f"     - {p.get('phone') or p['jid']}{adm}")
        print(f"{WARN} Confira: são todos de casa? Tem outro agente IA no grupo? (regra: nunca grupo de cliente)")
    else:
        print(f"{WARN} grupo não está no cache — rode wa-admin.sh listar pra ver nome e membros antes de habilitar.")

    gp = wa.get("groupPolicy", "(ausente → allowlist)")
    groups = wa.get("groups") or {}
    gaf = wa.get("groupAllowFrom") or []
    af = wa.get("allowFrom") or []
    print()
    print(f"[1] groupPolicy: {gp}", OK if gp in ("allowlist", "open") else BAD + " (grupos bloqueados no canal)")
    if jid in groups:
        g = groups[jid]
        rm = g.get("requireMention", True)
        print(f"[2] channels.whatsapp.groups[{jid}]: {OK} presente — requireMention={rm} "
              f"({'só quando mencionado' if rm else 'sempre-ativo/NO_REPLY'})"
              + (f", systemPrompt={g['systemPrompt'][:60]!r}…" if g.get("systemPrompt") else ""))
    else:
        print(f"[2] channels.whatsapp.groups[{jid}]: {BAD} ausente")
    if "*" in groups:
        print(f"    {WARN} groups['*'] existe → TODOS os grupos da conta estão admitidos. Quase certo que não é o que você quer.")
    if groups == {} and gp in ("allowlist", "open"):
        print(f"    {BAD} groups é {{}} (vazio) com groupPolicy={gp} → OpenClaw trata como 'todos os grupos'. Perigoso.")
    outros = [k for k in groups if k not in (jid, "*")]
    if outros:
        cache = load_cache()
        print(f"    outros grupos habilitados ({len(outros)}):")
        for k in outros:
            nm = next((x["nome"] for x in (cache or {}).get("grupos", []) if x["jid"] == k), "?")
            print(f"     • {k} — {nm}")
    if gp == "open":
        print(f"[3] quem dispara: {WARN} groupPolicy=open → QUALQUER membro dos grupos habilitados")
    elif gaf:
        print(f"[3] quem dispara (groupAllowFrom): {OK} {', '.join(gaf)}")
    elif af:
        print(f"[3] quem dispara: {INFO} groupAllowFrom ausente → cai no allowFrom das DMs: {', '.join(af)}")
    else:
        print(f"[3] quem dispara: {BAD} nem groupAllowFrom nem allowFrom → ninguém dispara")
    srcs = mention_sources(full)
    self_r = sh("openclaw directory self --channel whatsapp --json", timeout=40).stdout
    self_num = (re.search(r'"id":\s*"(\+\d+)"', self_r) or [None, None])[1]
    if srcs:
        print(f"[4] menção: {OK} " + "; ".join(srcs))
    else:
        print(f"[4] menção: {WARN} agente SEM nome de identidade e SEM mentionPatterns → em modo --mencao só dispara por "
              f"@menção real do contato {self_num or ''} ou reply a uma msg dele.")
        if self_num and self_num in af:
            print(f"    {WARN} o número do agente ({self_num}) também está no allowFrom (self-chat): o dono não consegue "
                  f"@mencionar o próprio número. Ou use --sempre, ou dê nome ao agente: "
                  f"openclaw agents set-identity --agent main --name \"<Nome>\" --emoji \"<emoji>\"")
    j = journal("30 days ago")
    ll = listening_line(j)
    det = [l for l in j.splitlines() if "config change detected" in l and "channels.whatsapp" in l]
    print(f"[5] processo vivo — última 'Listening' (config no START do canal): {ll.strip() if ll else '(não achei — gateway em pé?)'}")
    if det:
        print(f"    última mudança de channels.whatsapp vista pelo gateway (lida dinamicamente): {det[-1].strip()}")
    st = sh("systemctl --user is-active " + SVC).stdout.strip()
    print(f"    {SVC}: {st}")
    return jid in groups and gp in ("allowlist", "open")


def patch(obj):
    p = subprocess.run(["openclaw", "config", "patch", "--stdin"], input=json.dumps(obj), capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        sys.exit(f"{BAD} openclaw config patch falhou:\n{p.stdout}{p.stderr}")
    return p.stdout


def esperar_reload(esperado_groups_count):
    """Confirma que o gateway VIU a mudança. Para channels.whatsapp.groups/groupPolicy/groupAllowFrom o
    plugin lê a config dinamicamente: o journal mostra só
    '[reload] config change detected; evaluating reload (…channels.whatsapp.groups…)' — sem linha
    'applied' nem 'restarting whatsapp channel' nem nova linha 'Listening' (validado 2026-09-18: a
    mensagem seguinte no grupo já entrou). Falha = 'config reload skipped (invalid config)'."""
    t0 = time.time()
    while time.time() - t0 < 25:
        j = journal("1 min ago")
        if "config reload skipped" in j or "Invalid config" in j:
            return None, "config reload skipped — rode: openclaw config validate"
        det = [l for l in j.splitlines() if "config change detected" in l and "channels.whatsapp" in l]
        if det:
            return det[-1].strip(), None
        time.sleep(2)
    return None, "sem 'config change detected' em 25s (gateway.reload.mode=off? gateway em pé?)"


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    alvo = argv[0]
    aplicar = "--aplicar" in argv
    desab = "--desabilitar" in argv
    sempre = "--sempre" in argv
    prompt = None
    remetentes = []
    politica = None
    for i, a in enumerate(argv):
        if a == "--prompt" and i + 1 < len(argv):
            prompt = argv[i + 1]
        if a == "--remetentes" and i + 1 < len(argv):
            remetentes = [x.strip() for x in argv[i + 1].split(",") if x.strip()]
        if a == "--politica" and i + 1 < len(argv):
            politica = argv[i + 1]
    if politica and politica not in ("allowlist", "open"):
        sys.exit(f"{BAD} --politica precisa ser allowlist|open")
    for r in remetentes:
        if not re.fullmatch(r"\+\d{10,15}", r):
            sys.exit(f"{BAD} remetente '{r}' precisa estar em E.164: +5511999998888")

    cache = load_cache()
    jid, entry = resolve(alvo, cache)
    wa, full = load_cfg()
    ja = diagnostico(jid, entry, wa, full)

    if not (aplicar or desab):
        print("\n(diagnóstico apenas — nada alterado. Use --aplicar ou --desabilitar.)")
        return

    groups = dict(wa.get("groups") or {})
    gp = wa.get("groupPolicy")

    if desab:
        if jid not in groups:
            print(f"\n{INFO} {jid} já não está em groups. Nada a fazer.")
            return
        restantes = [k for k in groups if k != jid]
        obj = {"channels": {"whatsapp": {"groups": {jid: None}}}}
        if not restantes:
            # groups vazio = "todos os grupos" → fecha o canal de grupos de vez
            obj["channels"]["whatsapp"]["groups"] = None
            obj["channels"]["whatsapp"]["groupPolicy"] = "disabled"
            print(f"\n{INFO} era o último grupo → groups removido e groupPolicy=disabled (groups {{}} vazio admitiria TODOS).")
        print(f"\n→ patch: {json.dumps(obj, ensure_ascii=False)}")
        patch(obj)
        ll, err = esperar_reload(len(restantes))
        print(f"{OK if ll else WARN} gateway: {ll or err}")
        return

    # --aplicar
    if ja and not prompt and not remetentes and not politica and ("requireMention" in groups.get(jid, {})) and (groups[jid]["requireMention"] == (not sempre)):
        print(f"\n{INFO} já habilitado com essas mesmas opções. Nada a fazer.")
        return
    novo = dict(groups.get(jid, {}))
    novo["requireMention"] = not sempre
    if prompt is not None:
        novo["systemPrompt"] = prompt
    obj = {"channels": {"whatsapp": {"groups": {jid: novo}}}}
    if politica:
        obj["channels"]["whatsapp"]["groupPolicy"] = politica
    elif gp not in ("allowlist", "open"):
        obj["channels"]["whatsapp"]["groupPolicy"] = "allowlist"
    if remetentes:
        atual = list(wa.get("groupAllowFrom") or [])
        for r in remetentes:
            if r not in atual:
                atual.append(r)
        obj["channels"]["whatsapp"]["groupAllowFrom"] = atual
    if "*" in groups:
        print(f"{WARN} groups['*'] continua presente — remova manualmente se quiser restringir.")
    print(f"\n→ patch: {json.dumps(obj, ensure_ascii=False)}")
    patch(obj)
    ll, err = esperar_reload(len(set(groups) | {jid}))
    print(f"{OK if ll else WARN} gateway: {ll or err}")
    st = sh("openclaw channels status", timeout=40).stdout
    wl = next((l for l in st.splitlines() if "WhatsApp" in l), "")
    print(f"{INFO} {wl.strip()}")
    print(f"""
Próximo passo — teste real no grupo:
  • modo {'--sempre: mande qualquer frase' if sempre else '--mencao: mencione o agente (@nome/padrão) ou responda uma msg dele'}
    a partir de um número autorizado ({', '.join(wa.get('groupAllowFrom') or wa.get('allowFrom') or ['?'])}).
  • acompanhe: journalctl --user -u {SVC} -f | grep -i -E 'inbound|group|{jid.split('@')[0]}'
  • zere o contexto do grupo se ele já tinha histórico: mande "/new" sozinho no grupo (só o dono).
  • sessão do grupo: ~/.openclaw/agents/main/sessions/sessions.json → chave agent:main:whatsapp:group:{jid}
""")


if __name__ == "__main__":
    main()
