# Roteiro: conferir a atualização antes de promover

Um atualizador só quebra na transição. Instalar do zero sempre funciona; o que falha é a versão nova
chegando **por cima** de uma que já está lá, com as preferências, as abas e a cópia de reserva daquela
pessoa no meio do caminho. Nenhum teste automatizado encena isso, porque nenhum deles tem uma pessoa de
verdade clicando no meio da troca.

Este roteiro existe para a release não ser a primeira vez que o código encontra o mundo.

Ele roda **depois** do `npm run release:staging` e **antes** do `npm run release`. Dez minutos cobrem a
transição inteira. Três cenários extras, no fim, precisam de montagem e ficam para quando a mudança mexeu
na troca dos bundles.

## Antes de começar

Você precisa de:

- o **`meu-bot-staging` já instalado** na versão anterior (`~/Applications/meu-bot-staging.app`). Se ele
  não estiver lá, instale o `.dmg` da release anterior: este roteiro é sobre a transição, e sem a versão
  de antes não há transição para conferir;
- a release nova publicada como pre-release (`npm run release:staging` terminou);
- um terminal com o log aberto, que é onde tudo aparece:

```sh
tail -f ~/Library/Application\ Support/meu-bot-staging/meu-bot.log | grep atualização
```

Atalhos usados abaixo:

```sh
APP=~/Applications/meu-bot-staging.app
DADOS=~/Library/Application\ Support/meu-bot-staging
```

## Os dez minutos

### 1 · Deixe uma marca para reconhecer depois (1 min)

Com o app aberto **na versão antiga**, antes de qualquer atualização:

- renomeie uma aba de conversa para `MARCA`, com dois cliques no nome dela;
- em Configurações, **desligue** "atualizar sozinho quando o Mac estiver ocioso";
- anote a versão que aparece no título da janela.

Isso é o que o passo 5 vai procurar. Feito agora, não depois: o ponto é que a marca atravesse a troca.

### 2 · A versão preparada é a que o botão promete (2 min)

Espere a verificação, ou force em Configurações › "Verificar atualizações". Quando a tela disser que há
versão pronta:

```sh
cat "$DADOS/update/preparada.json"
ls "$DADOS/update/"
```

Confira os três, que têm de contar a mesma história:

- `para` é a versão que a tela está oferecendo — e é a da release que você acabou de publicar;
- existe um `meu-bot-staging-<versão>-<arch>.zip` na pasta, com o `sha256` do registro;
- o `.app` extraído está lá.

**Por que importa:** o botão mostra uma versão e o que está no disco é outra é exatamente como uma
atualização instala a coisa errada sem ninguém perceber.

### 3 · O que não confere é recusado (1 min)

Teste negativo, e é o mais barato do roteiro. Com a versão preparada e o app **fechado**:

```sh
printf 'lixo' >> "$DADOS"/update/meu-bot-staging-*.zip
```

Abra o app e olhe o log. Deve aparecer:

```
[atualização] a <versão> preparada não passou na conferência
(o arquivo baixado não bate com o que foi conferido na hora do download): descartada
```

E a pasta `update/` deve sumir. O app volta a oferecer a atualização e baixa de novo.

**Se em vez disso ele oferecer instalar, pare o roteiro.** Significa que o conteúdo preparado entra sem
ser reconferido, e a assinatura só valeu no momento do download.

### 4 · A troca (2 min)

Deixe preparar de novo e clique em **"Reiniciar e atualizar"**. Enquanto ele reinicia:

```sh
ls -d ~/Applications/*.antigo
```

A cópia de reserva tem de estar lá durante a troca. Depois que o app subir na versão nova, espere
**trinta segundos** e rode de novo: agora ela não deve mais existir, e o log diz que a versão foi
confirmada.

Confira também que `update-pendente.json` sumiu de `$DADOS`.

**Se o `.antigo` continuar lá** depois de um minuto, a confirmação não rodou — a próxima abertura vai
tratar isso como troca não confirmada e, na terceira, voltar sozinha para a versão anterior.

### 5 · A marca sobreviveu (2 min)

Na versão nova:

- a aba `MARCA` continua com esse nome, e na mesma posição;
- em Configurações, "atualizar sozinho quando o Mac estiver ocioso" continua **desligada**;
- as conversas estão todas lá.

**Por que importa:** a troca mexe no `.app`, não nos dados — mas uma pasta de dados calculada a partir do
nome do app, ou uma migração que roda na primeira abertura, quebra isso sem erro nenhum. A pessoa só
descobre quando as abas dela voltam ao padrão.

### 6 · A volta atrás, matando no meio (2 min)

O cenário que mais dá problema de verdade: o processo morre **entre as duas renomeações**, com o
`<app>.antigo` já criado e o `<app>` ainda não.

Prepare outra atualização, clique em reiniciar e, no instante em que a janela fechar:

```sh
pkill -9 -f meu-bot-staging
```

Abra o app três vezes seguidas, fechando antes de completar trinta segundos de pé a cada vez. Na
terceira, o log deve dizer que está voltando para a versão anterior, e o app deve abrir **na versão
antiga**, inteira e funcionando.

Confira que nenhum `.app` ficou faltando em `~/Applications`.

**Se o app não abrir, ou abrir sem uma das cópias**, o reparo não cobriu o ponto em que você matou — é
precisamente o defeito que o reparo na abertura deveria cobrir.

## Os três que precisam de montagem

Fora dos dez minutos, porque exigem preparar o ambiente. Rode quando a mudança tiver mexido na troca dos
bundles, no download ou na trava entre sessões.

### Disco cheio (~15 min)

Crie uma imagem pequena e aponte o `userData` para ela:

```sh
hdiutil create -size 40m -fs APFS -volname cheio /tmp/cheio.dmg && hdiutil attach /tmp/cheio.dmg
```

Rode o app com os dados lá dentro e deixe baixar. O que conferir: a frase diz **quanto espaço resta**, o
app **para de insistir**, e a pasta de preparação **não fica para trás** ocupando o disco que já faltava.

### Duas contas do Mac ao mesmo tempo (~15 min)

Com troca rápida de usuário, duas sessões mexem no mesmo `/Applications`. Deixe o app aberto nas duas,
atualize numa delas e confira que o `.antigo` da outra **sobrevive**: no log da segunda deve aparecer que
outra sessão está mexendo nos `.app` e que ela deixou a limpeza para depois.

### Ciclo completo em staging (~10 min, já é este roteiro)

Os passos 2 a 6 acima, rodados sobre uma release de staging publicada de verdade, **são** o ciclo
completo. Não há um sétimo passo: se eles passaram, a promoção para o estável está conferida.

## Se algo falhar

Não promova. O `npm run release` exige a tag de staging no mesmo commit justamente para isso: a versão
reprovada fica como pre-release, você corrige, publica `-staging.N+1` e roda o roteiro de novo. Uma
estável publicada não volta atrás — os apps instalados já vão tê-la baixado.
