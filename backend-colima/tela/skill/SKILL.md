---
name: computador-do-bot
description: Ver e usar a tela do computador desta máquina (a mesma que a pessoa assiste ao vivo no painel Computador do meu-bot). Use quando precisar de um programa com janela, conferir algo visualmente, ou quando a pessoa pedir "faz no computador", "abre na tela", "mostra na tela".
---

# Computador do bot

Esta máquina tem uma tela virtual (1280x800). A pessoa assiste ao vivo no painel **Computador** do meu-bot, então
tudo o que você fizer nela aparece para ela.

Use o comando `tela` (em `~/.local/bin/tela`):

- `tela print` tira um print e devolve o caminho do PNG; leia o arquivo para ver a tela antes e depois de agir.
- `tela clicar X Y`, `tela duplo X Y`, `tela digitar "texto"`, `tela tecla Return`, `tela tecla ctrl+l`, `tela rolar baixo 3`.
- `tela abrir <programa>` abre um programa gráfico nesta tela; `tela janelas` lista o que está aberto.

Jeito de trabalhar:
1. Tire um print antes de clicar: as coordenadas vêm dele (0,0 é o canto de cima à esquerda).
2. Uma ação por vez e um print depois, para conferir o efeito.
3. Se `tela` disser que está desligada, peça para a pessoa tocar em "Acordar o computador" no painel Computador.
4. Não digite senhas nem dados de pagamento na tela; peça para a pessoa fazer essa parte.
