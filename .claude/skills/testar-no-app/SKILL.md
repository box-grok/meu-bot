---
name: testar-no-app
description: Ciclo fecha → rebuilda → abre → testa de um app do meu-bot (meu-bot-admin, meu-bot, staging) neste Mac, conferindo na tela que a mudança funcionou. Use quando o usuário disser "rebuilda e testa", "abre e vê se deu certo", "testa no app", "simula se deu certo", "kill, rebuilda e abre", ou depois de uma mudança visual que precisa ser vista no app instalado.
---

# Testar no app: fecha, rebuilda, abre e confere

> **Os passos 1 a 4 já rodam sozinhos**: o hook `Stop` do projeto (`scripts/hooks/rebuild-auto.sh`, ver skill
> `rebuildar`) faz testes → fecha → empacota → reabre → confere o log, em segundo plano, sempre que algo do app mudou.
> Esta skill continua valendo para o passo 5 (ver na tela) e para quando a pessoa pedir o ciclo agora, numa variante
> específica. Atenção: `System Events` (clicar, digitar) só funciona se o Terminal tiver Acessibilidade; sem ela,
> confira o conteúdo do build com `grep -a` no `app.asar` instalado e a tela só pelo que já está visível.

O app instalado é empacotado e só mostra a mudança depois de rebuildar. Pedir esta skill já autoriza fechar e
reabrir o app sem perguntar de novo.

| Variante | Processo / app | Empacotar |
|---|---|---|
| admin | `meu-bot-admin` | `npm run dist:admin` |
| meu-bot | `meu-bot` | `npm run dist` |
| staging | `meu-bot-staging` | `npm run dist:staging` |

Log de cada app: `~/Library/Application Support/<app>/meu-bot.log`. Capturas: sempre no scratchpad da sessão.

## 1. Testes

`npm test` (já roda o build). Com teste quebrado, pare e mostre a falha: não empacote.

## 2. Fechar (kill se não fechar)

```bash
osascript -e 'quit app "<app>"'
for i in 1 2 3 4 5; do pgrep -f "<app>.app/Contents/MacOS" >/dev/null || break; sleep 1; done
pgrep -f "<app>.app/Contents/MacOS" >/dev/null && pkill -f "<app>.app/Contents/MacOS"
```

## 3. Rebuildar

`npm run dist…` da tabela, com timeout de 10 min. Confira na saída "Assinatura ad-hoc aplicada" e "Instalado em".

## 4. Abrir e ver se ficou de pé

```bash
L=~/Library/Application\ Support/<app>/meu-bot.log; N=$(wc -l < "$L")
open ~/Applications/<app>.app; sleep 8
pgrep -f "<app>.app/Contents/MacOS" >/dev/null && echo "de pé"
tail -n +$((N+1)) "$L" | grep -iE "erro|error|falh|exception|uncaught"
```

O app caiu ou há erro novo no log: pare e mostre o trecho do log.

## 5. Testar na tela

1. **Ver**: `osascript -e 'tell application "<app>" to activate'`, `screencapture -x <scratchpad>/tela.png`,
   `sips -Z 1600` para reduzir e Read na imagem. A captura funciona sem permissão extra.
2. **Navegar até a mudança** (clicar, digitar, Enter) com `osascript` e `System Events` (`keystroke`, `key code`,
   `click at {x, y}`). Isso exige que o Terminal tenha **Acessibilidade** (Ajustes do Sistema › Privacidade e
   Segurança › Acessibilidade). Sem ela, o `keystroke` não falha, mas o texto não chega ao app. Confira com uma
   captura depois de cada passo. Antes de digitar, sempre `activate` no app e confira na captura que ele está na
   frente: o usuário pode estar digitando no Terminal, e as teclas iriam para lá.
3. **Conferir o resultado esperado** na captura (o botão novo, a tabela no lugar, a mensagem de sucesso) e no log.
4. Não conseguiu navegar até lá: diga ao usuário onde clicar e o que ele deve ver, e confira pela captura depois que
   ele clicar.

Ações de verdade (apagar, criar usuário, instalar) só com o pedido do usuário: o teste é ver, não mexer em máquina.

## 6. Avisar

Em pt-BR, em poucas linhas: o que foi rebuildado, se abriu sem erro, o que a tela mostrou (com o resultado esperado
ao lado) e o que não deu para conferir.
