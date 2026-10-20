#!/usr/bin/env python3
"""
auditoria.py — registro de auditoria da máquina (quem fez o quê), dono único do formato e da corrente.

  auditoria.py gravar <json-base64url>   grava uma linha e imprime a linha final (JSON)
  auditoria.py ler [--n N] [--apos HASH] imprime as linhas (as N últimas, ou todas depois de HASH)

Arquivo: ~/.local/share/meu-bot/auditoria.jsonl, uma linha JSON por ação:
  { v, em, maquina, quem:{tipo,nome}, app, acao, alvo, detalhe, prev, hash }
`hash = sha256(prev + linha canônica sem "hash")` (chaves em ordem, sem espaços, UTF-8): apagar ou mudar uma linha
quebra a corrente dali em diante (src/main/auditoria-core.ts verifica). `maquina` = o mesmo id do suporte
(sha256 de "<chave do servidor>\\n<usuário>@<porta>", 12 hex). Na primeira gravação o suporte.log antigo entra
como linhas "legado" e vira suporte.log.importado. Quem chama: o app (por SSH, com este arquivo pela entrada
padrão), o backend (server.js) e os plugins do OpenClaw (cópia em ~/.local/share/meu-bot/auditoria.py).
"""
import base64, fcntl, hashlib, json, os, re, sys, time

DIR = os.path.expanduser("~/.local/share/meu-bot")
ARQ = os.path.join(DIR, "auditoria.jsonl")
LEGADO = os.path.join(DIR, "suporte.log")
TIPOS = ("dono", "admin", "agente", "sistema", "legado")
APPS = ("meu-bot", "meu-bot-crm", "meu-bot-admin", "backend", "plugin", "legado")
ACAO_RE = re.compile(r"^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$")


def limpo(v, n):
    """Texto de uma linha só, sem controles, até n caracteres."""
    return re.sub(r"[\x00-\x1f\x7f  ]", " ", str(v if v is not None else "")).strip()[:n]


def canonica(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def selar(obj, prev):
    obj = dict(obj)
    obj.pop("hash", None)
    obj["prev"] = prev
    obj["hash"] = hashlib.sha256((prev + canonica(obj)).encode("utf-8")).hexdigest()
    return obj


def id_maquina():
    chave = ""
    for f in ("/etc/ssh/ssh_host_ed25519_key.pub", "/etc/ssh/ssh_host_ecdsa_key.pub"):
        try:
            chave = " ".join(open(f).read().split()[:2])
            break
        except OSError:
            pass
    usuario = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    if not usuario:
        import pwd
        usuario = pwd.getpwuid(os.getuid()).pw_name
    partes = (os.environ.get("SSH_CONNECTION") or "").split()
    porta = partes[3] if len(partes) == 4 and partes[3].isdigit() else "22"
    return hashlib.sha256(f"{chave}\n{usuario}@{porta}".encode()).hexdigest()[:12]


def ultimo_hash():
    try:
        with open(ARQ, "rb") as f:
            f.seek(0, 2)
            tam = f.tell()
            f.seek(max(0, tam - 65536))
            linhas = [l for l in f.read().decode("utf-8", "replace").split("\n") if l.strip()]
        return json.loads(linhas[-1]).get("hash", "") if linhas else ""
    except (OSError, ValueError, IndexError):
        return ""


def importar_legado(maquina, out):
    """suporte.log ("data|quem|o quê") → linhas "legado", na ordem; devolve o último hash."""
    prev = ""
    try:
        linhas = open(LEGADO, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return prev
    for l in linhas:
        p = l.split("|", 2)
        if len(p) != 3:
            continue
        obj = selar({"v": 1, "em": limpo(p[0], 25), "maquina": maquina, "quem": {"tipo": "legado", "nome": limpo(p[1], 60)}, "app": "legado", "acao": "legado", "alvo": "", "detalhe": limpo(p[2], 300)}, prev)
        out.write(canonica(obj) + "\n")
        prev = obj["hash"]
    os.replace(LEGADO, LEGADO + ".importado")
    return prev


def gravar(b64):
    e = json.loads(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-8"))
    quem = e.get("quem") if isinstance(e.get("quem"), dict) else {}
    tipo = quem.get("tipo") if quem.get("tipo") in TIPOS[:4] else None
    acao = str(e.get("acao") or "")
    if tipo is None or not ACAO_RE.match(acao) or len(acao) > 60:
        raise SystemExit("recusado: entrada inválida")
    app = e.get("app") if e.get("app") in APPS[:5] else "meu-bot"
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    with open(os.path.join(DIR, ".auditoria.lock"), "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        maquina = id_maquina()
        novo = not os.path.exists(ARQ)
        fd = os.open(ARQ, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as out:
            prev = importar_legado(maquina, out) if novo else ultimo_hash()
            out.flush()
            obj = selar({"v": 1, "em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "maquina": maquina, "quem": {"tipo": tipo, "nome": limpo(quem.get("nome"), 60)}, "app": app, "acao": acao, "alvo": limpo(e.get("alvo"), 120), "detalhe": limpo(e.get("detalhe"), 300)}, prev)
            out.write(canonica(obj) + "\n")
    print(canonica(obj))


def ler(n, apos):
    try:
        linhas = [l for l in open(ARQ, encoding="utf-8", errors="replace").read().split("\n") if l.strip()]
    except OSError:
        linhas = []
    if apos:
        i = next((k for k, l in enumerate(linhas) if f'"hash":"{apos}"' in l), None)
        linhas = linhas[i + 1:] if i is not None else linhas
    for l in linhas[-n:] if n > 0 else linhas:
        print(l)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["gravar"] and len(a) == 2:
        gravar(a[1])
    elif a[:1] == ["ler"]:
        n = int(a[a.index("--n") + 1]) if "--n" in a else 0
        apos = a[a.index("--apos") + 1] if "--apos" in a else ""
        ler(n, apos if re.fullmatch(r"[0-9a-f]{64}", apos or "") else "")
    else:
        raise SystemExit(__doc__)
