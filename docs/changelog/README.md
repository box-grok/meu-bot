# Itens ainda não lançados, um arquivo por PR

Cada PR que muda algo que a pessoa vê escreve o seu item **aqui**, num arquivo próprio, e não no topo do
`docs/CHANGELOG.md`. Quando toda PR editava as mesmas linhas de "Ainda não lançado", cada merge deixava as outras
PRs abertas em conflito.

- **Nome:** o do branch, `docs/changelog/<branch>.md` (por exemplo `docs/changelog/proxy-grok-orfao.md`).
- **Conteúdo:** o mesmo formato das seções do CHANGELOG, em linguagem de quem usa, uma frase por item:

  ```markdown
  ### Grok neste Mac: o proxy volta depois de fechar e reabrir o app
  #### Corrigido
  - Depois de fechar o app, o Grok do "Este Mac" podia ficar preso num proxy da abertura anterior. Agora o app o encerra.
  ```

- **Mudou de ideia no mesmo PR?** Edite o arquivo; ninguém mais mexe nele.

O que acontece com eles:

- **Staging e estável:** as notas da release são estes arquivos (em ordem de nome) mais o que ainda estiver escrito
  em "Ainda não lançado" do CHANGELOG (`notasDaRelease`, em `scripts/release-core.mjs`).
- **Depois da estável:** o PR automático "Versão: base sobe" (`scripts/release-auto.mjs`) passa os itens para a seção
  datada da versão no CHANGELOG e apaga os arquivos daqui.
- **No PR:** o CI (`scripts/release-checar.mjs`) avisa quando o PR muda o app sem criar o seu arquivo, ou quando
  escreve direto no topo do CHANGELOG.
