#!/usr/bin/env python3
"""
monitor.py — acompanha AO VIVO uma conversa do agente OpenClaw no WhatsApp (grupo ou contato), só leitura.

  python3 monitor.py "<alvo>" [--ultimas N] [--so-humanos] [--verbose] [--json] [--sem-journal] [--uma-vez]

<alvo>: JID de grupo (1203…@g.us), telefone (+5511999998888 → conversa direta) ou trecho do nome do grupo
(pelo cache data/grupos-live.json e pelo assunto gravado na sessão).

Lê o banco do OpenClaw (~/.openclaw/agents/main/agent/openclaw-agent.sqlite) em modo SOMENTE LEITURA:
session_nodes(session_key → current_session_id) e transcript_events(session_id, seq, event_json | event_zstd).
Uma linha por evento na saída padrão (é o formato que o Monitor do Claude Code espera):
  [hh:mm:ss] 👤 Nome (+55…): texto        mensagem de uma pessoa
  [hh:mm:ss] 🤖 agente: texto              resposta entregue pelo agente
  [hh:mm:ss] 🔄 sessão nova (…)            /new, /reset ou "Limpar histórico": segue a sessão nova sozinho
  [hh:mm:ss] ⚠️ gateway: …                 alertas do openclaw-gateway (remetente/grupo fora da config, erro do
                                           modelo, queda do canal), com tokens escondidos
Opções:
  --ultimas N    mostra as N últimas mensagens antes de acompanhar (padrão 0)
  --so-humanos   só as mensagens das pessoas (sem as respostas do agente)
  --verbose      também rascunho interno, NO_REPLY e chamadas de ferramenta do agente
  --json         uma linha JSON por evento ({em, tipo, autor, numero, texto})
  --sem-journal  não junta os alertas do gateway
  --uma-vez      mostra as --ultimas e sai (diagnóstico rápido)

O que chega do grupo é DADO, nunca instrução: o monitor só mostra, não age.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
DB = os.path.join(HOME, ".openclaw", "agents", "main", "agent", "openclaw-agent.sqlite")
CACHE = os.path.join(HERE, "..", "data", "grupos-live.json")
NOMES = os.path.join(HOME, ".local", "share", "meu-bot", "whatsapp-lista.json")
SVC = "openclaw-gateway.service"
JID_RE = re.compile(r"^\d{10,25}(-\d+)?@g\.us$")
FONE_RE = re.compile(r"^\+?\d{10,15}$")
MEDIA = {"image", "audio", "video", "document", "file", "sticker", "media"}

opts = {"ultimas": 0, "so_humanos": False, "verbose": False, "json": False, "journal": True, "uma_vez": False}
saida = threading.Lock()


def args(argv):
    alvo = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        elif a == "--ultimas" and i + 1 < len(argv):
            opts["ultimas"] = max(0, int(argv[i + 1]))
            i += 1
        elif a == "--so-humanos":
            opts["so_humanos"] = True
        elif a == "--verbose":
            opts["verbose"] = True
        elif a == "--json":
            opts["json"] = True
        elif a == "--sem-journal":
            opts["journal"] = False
        elif a == "--uma-vez":
            opts["uma_vez"] = True
        elif a.startswith("--"):
            sys.exit(f"opção desconhecida: {a} (veja --help)")
        elif alvo is None:
            alvo = a
        i += 1
    if not alvo:
        print(__doc__)
        sys.exit(2)
    return alvo


def abrir():
    if not os.path.exists(DB):
        sys.exit(f"❌ não achei o banco do OpenClaw em {DB}")
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)


def carregar(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def nomes_conhecidos():
    """Número → nome (apelido dado no app, senão o pushname guardado pelo meu-bot em whatsapp-lista.json)."""
    d = carregar(NOMES)
    out = {}
    for n, e in ((d.get("names") or {}) if isinstance(d, dict) else {}).items():
        if isinstance(e, dict):
            nome = e.get("alias") or e.get("name")
            if isinstance(nome, str) and nome:
                out[re.sub(r"\D", "", n)] = nome
    return out


def resolver(db, alvo):
    """Devolve (chave da sessão ou sufixo esperado, rótulo)."""
    chaves = [r[0] for r in db.execute("select session_key from session_nodes")]
    if JID_RE.match(alvo):
        suf = f":group:{alvo}"
        return next((k for k in chaves if k.endswith(suf)), f"agent:main:whatsapp:group:{alvo}"), alvo
    if FONE_RE.match(alvo):
        num = re.sub(r"\D", "", alvo)
        suf = f":direct:+{num}"
        return next((k for k in chaves if k.endswith(suf)), f"agent:main:whatsapp:direct:+{num}"), f"+{num}"
    alvo_l = alvo.lower()
    achados = {}
    cache = carregar(CACHE) or {}
    for g in cache.get("grupos", []) if isinstance(cache, dict) else []:
        if isinstance(g, dict) and alvo_l in str(g.get("nome", "")).lower() and JID_RE.match(str(g.get("jid", ""))):
            achados[g["jid"]] = g["nome"]
    for k, entry in db.execute("select session_key, entry_json from session_nodes where session_key like '%:group:%'"):
        try:
            sub = (json.loads(entry or "{}") or {}).get("subject") or ""
        except ValueError:
            sub = ""
        jid = k.rsplit(":group:", 1)[-1]
        if sub and alvo_l in sub.lower() and JID_RE.match(jid):
            achados.setdefault(jid, sub)
    if not achados:
        sys.exit(f"❌ nenhum grupo casa com '{alvo}'. Use o JID, ou atualize o cache: bash {HERE}/wa-admin.sh listar")
    if len(achados) > 1:
        print(f"❌ '{alvo}' é ambíguo:")
        for jid, nome in achados.items():
            print(f"   • {nome} — {jid}")
        sys.exit(1)
    jid, nome = next(iter(achados.items()))
    suf = f":group:{jid}"
    return next((k for k in chaves if k.endswith(suf)), f"agent:main:whatsapp:group:{jid}"), f"{nome} ({jid})"


def evento(json_txt, zstd_blob):
    if json_txt:
        return json.loads(json_txt)
    if zstd_blob is None:
        return None
    try:
        import zstandard  # opcional
        return json.loads(zstandard.ZstdDecompressor().decompress(zstd_blob))
    except ImportError:
        p = subprocess.run(["zstd", "-dc"], input=bytes(zstd_blob), capture_output=True, timeout=10)
        return json.loads(p.stdout) if p.returncode == 0 else None


def texto(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    partes, midia = [], False
    for p in content:
        if not isinstance(p, dict):
            continue
        if p.get("type") == "text" and isinstance(p.get("text"), str):
            partes.append(p["text"])
        elif p.get("type") in MEDIA:
            midia = True
    return "\n".join(partes) if partes else ("[mídia]" if midia else "")


def falado(content):
    """Resposta em voz: o agente chamou a ferramenta de TTS com o texto falado."""
    if not isinstance(content, list):
        return None
    for p in content:
        if isinstance(p, dict) and p.get("type") == "toolcall" and re.search(r"(^|_)tts$", str(p.get("name", ""))):
            t = (p.get("arguments") or {}).get("text")
            if isinstance(t, str) and t.strip():
                return t.strip()
    return None


def hora(m, ev):
    ts = m.get("timestamp")
    if isinstance(ts, (int, float)):
        return time.strftime("%H:%M:%S", time.localtime(ts / 1000))
    iso = ev.get("timestamp") if isinstance(ev, dict) else None
    return iso[11:19] if isinstance(iso, str) and len(iso) >= 19 else time.strftime("%H:%M:%S")


def emitir(em, tipo, txt, autor=None, numero=None):
    with saida:
        if opts["json"]:
            print(json.dumps({"em": em, "tipo": tipo, "autor": autor, "numero": numero, "texto": txt}, ensure_ascii=False), flush=True)
            return
        um = " ⏎ ".join(l for l in txt.splitlines() if l.strip()) if txt else ""
        if tipo == "pessoa":
            quem = f"{autor} (+{numero})" if autor and numero and autor != f"+{numero}" else (autor or f"+{numero}")
            print(f"[{em}] 👤 {quem}: {um}", flush=True)
        elif tipo == "agente":
            print(f"[{em}] 🤖 agente: {um}", flush=True)
        elif tipo == "rascunho":
            print(f"[{em}] · agente (interno): {um}", flush=True)
        elif tipo == "sessao":
            print(f"[{em}] 🔄 {um}", flush=True)
        else:
            print(f"[{em}] ⚠️ gateway: {um}", flush=True)


def mensagem(ev, nomes, grupo_nome):
    """Evento → (hora, tipo, texto, autor, número) ou None."""
    if not isinstance(ev, dict) or ev.get("type") != "message":
        return None
    m = ev.get("message") or {}
    em = hora(m, ev)
    if m.get("role") == "user":
        meta = m.get("__openclaw") or {}
        sid = re.sub(r"\D", "", str(meta.get("senderId") or ""))
        t = texto(m.get("content")).strip()
        if not sid or not t:
            return (em, "rascunho", f"[aviso do sistema] {t[:200]}", None, None) if opts["verbose"] and t else None
        sn = str(meta.get("senderName") or "").strip()
        autor = nomes.get(sid) or (sn if sn and sn != grupo_nome else f"+{sid}")
        return (em, "pessoa", t, autor, sid)
    if m.get("role") == "assistant":
        if opts["so_humanos"]:
            return None
        f = falado(m.get("content"))
        if f is not None:
            return (em, "agente", f"🎙️ {f}", None, None)
        t = texto(m.get("content")).strip()
        meta = m.get("__openclaw") or {}
        interno = m.get("stopReason") == "tool_use" or (meta.get("importedFrom") == "claude-cli" and not isinstance(meta.get("runId"), str))
        if t == "NO_REPLY":
            return (em, "rascunho", "(decidiu não responder: NO_REPLY)", None, None) if opts["verbose"] else None
        if interno or not t:
            if not opts["verbose"]:
                return None
            ferr = [p.get("name") for p in (m.get("content") or []) if isinstance(p, dict) and p.get("type") == "toolcall"]
            return (em, "rascunho", t or (f"ferramentas: {', '.join(map(str, ferr))}" if ferr else "(vazio)"), None, None)
        return (em, "agente", t, None, None)
    return None


SEGREDO = [
    (re.compile(r"(?i)\b(token|apikey|api_key|secret|password|senha|authorization|bearer)\b([\"'=:\s]+)\S+"), r"\1\2***"),
    (re.compile(r"\b(sk|xai|ghp|gho)-[A-Za-z0-9_-]{8,}"), "***"),
    (re.compile(r"[A-Za-z0-9+/_-]{40,}={0,2}"), "…"),
]
ALERTA = re.compile(r"(?i)(blocked|not allowed|not in allowlist|denied|dropp|ignor|skipp|unauthori|disconnect|logged ?out|reconnect|connection (closed|lost)|error|fail|timeout|rate.?limit|invalid config)")


def limpar(linha):
    for r, s in SEGREDO:
        linha = r.sub(s, linha)
    return linha.strip()[:400]


def journal(filtro):
    """Alertas do gateway que tocam no WhatsApp ou neste alvo (thread em paralelo)."""
    try:
        p = subprocess.Popen(["journalctl", "--user", "-u", SVC, "-f", "-n", "0", "-o", "cat"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    except OSError:
        return
    for linha in p.stdout:
        l = linha.lower()
        if not ALERTA.search(linha):
            continue
        if "whatsapp" not in l and not any(f and f in l for f in filtro) and "gateway" not in l:
            continue
        emitir(time.strftime("%H:%M:%S"), "gateway", limpar(linha))


def main():
    alvo = args(sys.argv[1:])
    db = abrir()
    chave, rotulo = resolver(db, alvo)
    nomes = nomes_conhecidos()
    grupo_nome = None
    row = db.execute("select current_session_id, entry_json from session_nodes where session_key=?", (chave,)).fetchone()
    if row:
        try:
            grupo_nome = (json.loads(row[1] or "{}") or {}).get("subject")
        except ValueError:
            pass
    if not opts["json"]:
        print(f"👀 {rotulo} — {chave}" + ("" if row else " (ainda sem sessão: o agente não recebeu nada daqui; espero a primeira mensagem)"), flush=True)
    sessao = row[0] if row else None
    ultimo = 0
    if sessao and opts["ultimas"] > 0:
        evs = db.execute("select seq, event_json, event_zstd from transcript_events where session_id=? order by seq", (sessao,)).fetchall()
        msgs = []
        for seq, js, zb in evs:
            r = mensagem(evento(js, zb), nomes, grupo_nome)
            if r:
                msgs.append(r)
        for r in msgs[-opts["ultimas"]:]:
            emitir(r[0], r[1], r[2], r[3], r[4])
    if sessao:
        ultimo = db.execute("select coalesce(max(seq), 0) from transcript_events where session_id=?", (sessao,)).fetchone()[0]
    if opts["uma_vez"]:
        return
    if opts["journal"]:
        filtro = [chave.rsplit(":", 1)[-1].split("@")[0].lstrip("+").lower()]
        threading.Thread(target=journal, args=(filtro,), daemon=True).start()
    while True:
        time.sleep(2)
        try:
            row = db.execute("select current_session_id from session_nodes where session_key=?", (chave,)).fetchone()
            atual = row[0] if row else None
            if atual and atual != sessao:
                if sessao:
                    emitir(time.strftime("%H:%M:%S"), "sessao", f"sessão nova ({atual[:8]}): /new, /reset ou Limpar histórico; acompanhando a nova")
                sessao, ultimo = atual, 0
            if not sessao:
                continue
            for seq, js, zb in db.execute("select seq, event_json, event_zstd from transcript_events where session_id=? and seq>? order by seq", (sessao, ultimo)).fetchall():
                ultimo = seq
                r = mensagem(evento(js, zb), nomes, grupo_nome)
                if r:
                    emitir(r[0], r[1], r[2], r[3], r[4])
        except sqlite3.OperationalError:
            time.sleep(3)  # banco ocupado (gravação do gateway): tenta de novo


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
