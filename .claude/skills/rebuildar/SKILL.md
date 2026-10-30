---
name: rebuildar
description: Rebuilda e reinstala o meu-bot-admin (e as outras variantes afetadas) depois de qualquer modificação no código do meu-bot. Use SEMPRE ao terminar uma mudança em src/, scripts/, build/, config/, assets/ ou extensao-crm/, sem esperar o usuário pedir, e também quando ele disser "rebuilda", "refilda", "reempacota" ou "gera o app de novo".
---

# Rebuildar o meu-bot depois de mudar o código

> **Automático desde 30 out 2026:** o hook `Stop` em `.claude/settings.json` roda `scripts/hooks/rebuild-auto.sh` ao fim
> de cada resposta. Se algo em `src/`, `scripts/tests`, `config/`, `assets/` ou `extensao-crm/` mudou desde o último
> empacotamento (carimbo `.claude/.rebuild-stamp`), ele faz em segundo plano: testes → fecha os apps abertos →
> empacota (abertos primeiro, depois admin, depois os demais instalados) → reabre, e o Mac avisa. Só rode os passos
> abaixo à mão se o hook estiver desligado ou se quiser uma variante específica agora. `--check` mostra o plano.

O app instalado é empacotado: mudança no código só vale depois de rebuildar. Ao terminar uma modificação, faça isto sem perguntar.

1. **Testes primeiro**: `npm test` (já roda o build). Se falhar, pare, corrija ou mostre a falha ao usuário. Não empacote com teste quebrado.
2. **Feche o app velho** (o novo substitui o .app instalado):
   `pgrep -f "meu-bot-admin.app/Contents/MacOS"`. Se estiver aberto, avise o usuário e só feche com `osascript -e 'quit app "meu-bot-admin"'` se ele concordar.
3. **Empacote a variante certa** pelo que mudou (`git status --short` / `git diff --name-only`):
   - Sempre: `npm run dist:admin` (instala em ~/Applications/meu-bot-admin.app e atualiza o atalho na Área de Trabalho).
   - Mudou algo fora de `src/*/admin/` que o app comum usa (inclui `extensao-crm/` e o CRM): também `npm run dist`.
   - Mudou algo que os staging usam: também `npm run dist:staging` e `npm run dist:finance-staging`.
   Use timeout de 10 min. Confira na saída "Assinado com" e "Instalado em".
4. **Avise em pt-BR**, em poucas linhas: o que foi rebuildado, onde ficou instalado e que é só abrir o app de novo.

Não faça commit nem push por conta disso.
