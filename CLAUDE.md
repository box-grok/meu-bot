# meu-bot

- Depois de qualquer modificação no código, rode a skill `rebuildar` (testes + `npm run dist:admin` e as outras variantes afetadas) sem esperar o usuário pedir: o app instalado é empacotado e não pega mudanças sozinho.
- Mudança que vai virar PR nasce num worktree próprio (`git worktree add -b <branch> ../meu-bot-<nome> origin/main`), nunca trocando de branch neste checkout: outras sessões (Claude, Cursor) usam este diretório ao mesmo tempo. A skill `contribuir` diz como preparar o worktree para empacotar.
- Antes de conferir uma mudança na tela, confirme que o app instalado é o seu build: `grep -a -c <símbolo novo> ~/Applications/<app>.app/Contents/Resources/app.asar`. O hook de rebuild de outra sessão pode ter reinstalado a partir de outro branch.
- Trabalho commitado num branch sem PR: o hook `Stop` `scripts/hooks/pr-lembrete.sh` avisa ao fim da resposta; se o branch é seu, abra a PR pela skill `contribuir` sem esperar o usuário pedir.
