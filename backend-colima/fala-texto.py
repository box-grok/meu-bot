#!/usr/bin/env python3
"""
Texto da resposta → texto para a voz (pt-BR). Lê da entrada, escreve na saída. Python puro, sem dependências.
Usado pelo meu-bot-falar (OpenClaw) e pelo hermes-voz.sh (Hermes) antes do Piper/Kokoro, que leem tudo ao pé da
letra: markdown, links e números crus viram "asterisco asterisco", "agá tê tê pê" e "um ponto dois três quatro".
- Números por extenso do jeito falado: 1234 "mil duzentos e trinta e quatro", 2500 "dois mil e quinhentos".
- R$, %, horas (14h30, 14:30), datas (12/03/2026), decimais (3,5) e ordinais (1º, 2ª).
- Telefones e documentos (10 dígitos ou mais, ou começando com +) são lidos dígito a dígito, nunca apagados.
- Links e blocos de código não são lidos: viram um aviso de que estão na mensagem escrita.
- Tira markdown e emojis.
Qualquer falha devolve o texto original (quem chama nunca fica sem fala).
"""
import re
import sys

UNI = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
       "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos",
       "novecentos"]
FEM = {"um": "uma", "dois": "duas", "duzentos": "duzentas", "trezentos": "trezentas", "quatrocentos": "quatrocentas",
       "quinhentos": "quinhentas", "seiscentos": "seiscentas", "setecentos": "setecentas", "oitocentos": "oitocentas",
       "novecentos": "novecentas"}
MESES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]
ORD_M = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"]
ORD_F = ["", "primeira", "segunda", "terceira", "quarta", "quinta", "sexta", "sétima", "oitava", "nona", "décima"]
ESCALAS = [(10 ** 12, "trilhão", "trilhões"), (10 ** 9, "bilhão", "bilhões"), (10 ** 6, "milhão", "milhões"),
           (1000, "mil", "mil")]
LINK = "o link que mandei por escrito"
CODIGO = "o código está na mensagem escrita"


def _ate_mil(n):
    """0 < n < 1000."""
    if n == 100:
        return "cem"
    partes = []
    if n >= 100:
        partes.append(CEM[n // 100])
        n %= 100
    if n >= 20:
        partes.append(DEZ[n // 10])
        n %= 10
    if n > 0:
        partes.append(UNI[n])
    return " e ".join(partes)


def extenso(n, feminino=False):
    """Inteiro ≥ 0 por extenso. "e" antes do último grupo quando ele é < 100 ou centena redonda (mil e cem)."""
    if n == 0:
        return "zero"
    grupos = []  # (valor do grupo, texto)
    for base, sing, plur in ESCALAS:
        q = n // base
        if q:
            if base == 1000:
                grupos.append((q * 1000, "mil" if q == 1 else extenso(q, feminino) + " mil"))
            else:
                grupos.append((q * base, "um " + sing if q == 1 else extenso(q) + " " + plur))
            n %= base
    if n:
        grupos.append((n, _ate_mil(n)))
    if feminino:
        ult = grupos[-1]
        if ult[0] < 1000:
            grupos[-1] = (ult[0], " ".join(FEM.get(p, p) for p in ult[1].split(" ")))
    texto = grupos[0][1]
    for valor, parte in grupos[1:]:
        resto = valor % 1000 if valor >= 1000 else valor
        junta = valor < 1000 and (resto < 100 or resto % 100 == 0)
        texto += (" e " if junta else " ") + parte
    return texto


def _numero_br(s):
    """'1.234,56' / '1234' / '3,5' → (inteiro, centésimos ou dígitos decimais como texto) ou None."""
    s = s.strip()
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?", s):
        inteiro, _, dec = s.replace(".", "").partition(",")
        return int(inteiro), dec
    return None


def _decimal(inteiro, dec, feminino=False):
    if not dec or int(dec) == 0:
        return extenso(inteiro, feminino)
    zeros = len(dec) - len(dec.lstrip("0"))
    return extenso(inteiro, feminino) + " vírgula " + " ".join(["zero"] * zeros) + (" " if zeros else "") + extenso(int(dec))


def _digitos(s):
    grupos = [g for g in re.split(r"\D+", s) if g]
    if len(grupos) == 1 and len(grupos[0]) > 4:
        g = grupos[0]
        grupos = [g[i:i + 3] for i in range(0, len(g), 3)]
    return ", ".join(" ".join(UNI[int(c)] for c in g) for g in grupos)


def _dinheiro(m):
    v = _numero_br(m.group(1))
    if v is None:
        return m.group(0)
    inteiro, dec = v
    escala = (m.group(2) or "").lower()
    if escala:
        nome = {"mil": "mil", "mi": "milhões", "milhão": "milhão", "milhao": "milhão", "milhões": "milhões",
                "milhoes": "milhões", "bi": "bilhões", "bilhão": "bilhão", "bilhao": "bilhão", "bilhões": "bilhões",
                "bilhoes": "bilhões"}[escala]
        if nome in ("milhões", "bilhões") and inteiro == 1 and not dec.strip("0"):
            nome = nome[:-5] + "ão"
        return _decimal(inteiro, dec) + " " + nome + (" reais" if nome == "mil" else " de reais")
    reais = extenso(inteiro) + (" real" if inteiro == 1 else " reais") if inteiro or not dec else ""
    if inteiro >= 10 ** 6 and inteiro % 10 ** 6 == 0:
        reais = extenso(inteiro) + " de reais"
    cent = int((dec + "00")[:2]) if dec else 0
    if cent:
        c = extenso(cent) + (" centavo" if cent == 1 else " centavos")
        return reais + " e " + c if reais else c
    return reais


def _hora(m):
    h, mi = int(m.group(1)), int(m.group(2) or m.group(3) or 0)
    if h > 23 or mi > 59:
        return m.group(0)
    hs = extenso(h, feminino=True)
    if mi == 0:
        return hs + (" hora" if h == 1 else " horas")
    return hs + " e " + extenso(mi)


def _data(m):
    d, mes, ano = int(m.group(1)), int(m.group(2)), m.group(3)
    if not (1 <= d <= 31 and 1 <= mes <= 12):
        return m.group(0)
    texto = ("primeiro" if d == 1 else extenso(d)) + " de " + MESES[mes]
    if ano:
        a = int(ano)
        texto += " de " + extenso(a + 2000 if len(ano) == 2 else a)
    return texto


def _numero(m):
    sinal, s = m.group(1), m.group(2)
    v = _numero_br(s)
    if v is None:
        return m.group(0)
    return ("menos " if sinal else "") + _decimal(*v)


def _ordinal(m):
    n = int(m.group(1))
    if not 1 <= n <= 10:
        return extenso(n)
    return (ORD_F if m.group(2) == "ª" else ORD_M)[n]


EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF‍️⃣]+")
SEM_LETRA_ANTES = r"(?<![\w.,/])"
SEM_LETRA_DEPOIS = r"(?![\w%º°ª/]|[.,]\d)"


def limpar(t):
    t = re.sub(r"```.*?(```|$)", " " + CODIGO + ". ", t, flags=re.S)
    t = re.sub(r"`([^`\n]*)`", r"\1", t)
    t = re.sub(r"!?\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)", r"\1", t)  # [texto](url) → texto
    t = re.sub(r"(?:https?://|www\.)\S*[^\s.,;:!?)\]]", LINK, t, flags=re.I)
    t = re.sub(r"%s(?:\s*(?:,|;|\be\b)\s*%s)+" % (re.escape(LINK), re.escape(LINK)), "os links que mandei por escrito", t)
    t = re.sub(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b",
               lambda m: m.group(0).replace("@", " arroba ").replace(".", " ponto "), t)
    t = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "", t, flags=re.I)
    # Markdown: títulos, citações, marcadores de lista, tabela, ênfase e linhas de separação.
    t = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", t)
    t = re.sub(r"(?m)^\s*>\s?", "", t)
    t = re.sub(r"(?m)^\s*[-*+•]\s+", "", t)
    t = re.sub(r"(?m)^\s*[-=_*|: ]{3,}\s*$", "", t)
    t = t.replace("|", ", ")
    t = re.sub(r"(\*\*|__|~~)(.+?)\1", r"\2", t)
    t = re.sub(r"(?<![\w*])[*_](?!\s)([^*_\n]+?)(?<!\s)[*_](?![\w*])", r"\1", t)
    t = EMOJI.sub("", t)
    # Dinheiro, porcentagem, data e hora antes dos números soltos (que comeriam as partes).
    t = re.sub(r"R\$\s*(\d[\d.]*(?:,\d+)?)(?:\s*(mil|mi|milh[õo]es|milh[ãa]o|bi|bilh[õo]es|bilh[ãa]o)\b)?", _dinheiro, t,
               flags=re.I)
    t = re.sub(r"(\d[\d.]*(?:,\d+)?)\s?%", lambda m: (lambda v: _decimal(*v) + " por cento" if v else m.group(0))(
        _numero_br(m.group(1))), t)
    t = re.sub(SEM_LETRA_ANTES + r"(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\d/])", _data, t)
    t = re.sub(SEM_LETRA_ANTES + r"([01]?\d|2[0-3])(?:h(?:([0-5]\d)(?:min)?)?|:([0-5]\d))(?![\w:])",
               _hora, t)
    # Telefone/documento: começa com + ou ( ou tem 10+ dígitos com separadores de telefone (não milhar).
    def fone(m):
        s = m.group(0)
        dig = re.sub(r"\D", "", s)
        if s.startswith(("+", "(")):
            return _digitos(s)
        # Sem + ou parênteses, só com hífen (11 98765-4321, CEP, CPF) ou num bloco só: números soltos separados por
        # espaço ("1234 2500") e milhares (1.000.000) seguem para o extenso.
        milhar = re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s) is not None
        if " " in s and "-" not in s:
            return s
        if not milhar and (len(dig) >= 10 or ("-" in s and len(dig) >= 8)):
            return _digitos(s)
        return s
    t = re.sub(r"(?<![\w,])(?:\+|\()?\d[\d\s().-]{7,}\d(?!\w|,\d)", fone, t)
    # Antes de palavra feminina, o número concorda: "vinte e uma horas", "duas pessoas".
    t = re.sub(r"(?<![\w.,])(\d{1,3}(?:\.\d{3})*|\d+)(?= (?:horas?|pessoas?|semanas?|vezes|vez)\b)",
               lambda m: extenso(int(m.group(1).replace(".", "")), feminino=True), t)
    t = re.sub(r"\b(\d{1,2})([ºª°])(?=\s|$|[,.;!?])", _ordinal, t)
    t = re.sub(r"(?<![\w.,])((?<![^\s(])-)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)" + SEM_LETRA_DEPOIS, _numero, t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    t = re.sub(r"\s+([,.;!?])", r"\1", t)
    return t.strip()


def main():
    bruto = sys.stdin.read()
    try:
        saida = limpar(bruto)
    except Exception:  # noqa: BLE001 — falar o original é melhor que ficar mudo
        saida = bruto
    sys.stdout.write((saida or bruto) + "\n")


if __name__ == "__main__":
    main()
