# meu-bot-diego: módulos de produto num submódulo

> Parte do diário técnico do meu-bot. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## O que é e onde mora cada coisa (28 out)

O **meu-bot-diego** é o meu-bot da pessoa com os módulos do Diego. São as ideias do antigo agente-rene
(`hermes-mythos-lucas`), ligadas uma a uma. O código fica dividido em dois repositórios:

| Repositório | Visibilidade | O que tem |
|---|---|---|
| `diegofornalha/meu-bot` | **público** | O app inteiro e o **contrato** genérico de módulos: a variante `diego`/`diego-staging` (`src/main/app/variant-core.ts`), `src/main/modulos/`, a página Módulos (`src/renderer/modulos/`) e o lado da máquina (`backend-colima/modulos.js`, rota `/v1/meu-bot/avisar`). |
| `diegofornalha/meu-bot-diego` | **privado** | O **conteúdo**: `modulos.json` e uma pasta por módulo (`whatsapp-rene`, `grok-mcp`, `buffer-mcp`…). Entra no meu-bot como submódulo em `produtos/meu-bot-diego`. |

O repositório público só guarda o endereço do submódulo (`.gitmodules`) e o commit que o meu-bot usa. Sem acesso ao
privado, o clone do meu-bot fica com a pasta `produtos/meu-bot-diego` vazia. Os outros apps (meu-bot, staging, admin)
continuam iguais: só o meu-bot-diego leva os módulos em `Resources/meu-bot-diego/` (`scripts/package.mjs`).

## Primeira vez: clonar com os módulos

```bash
git clone https://github.com/diegofornalha/meu-bot.git
cd meu-bot
git submodule update --init --recursive   # precisa de acesso ao repositório privado meu-bot-diego
npm ci
npm run dist:diego-staging                # ou dist:diego; instala em ~/Applications
```

Sem o submódulo baixado, o `dist:diego*` para com a mensagem
`falta produtos/meu-bot-diego/modulos.json … Rode git submodule update --init produtos/meu-bot-diego`. Os outros
`dist` não precisam dele.

## Puxar as atualizações do meu-bot

O app do Diego é o meu-bot com módulos por cima. Toda correção do meu-bot chega a ele assim:

```bash
git pull                                  # o meu-bot
git submodule update --init --recursive   # os módulos no commit que o meu-bot aponta
npm ci                                    # só se o package-lock mudou
npm test                                  # a suíte do meu-bot, inclusive o contrato (scripts/tests/modulos.test.mjs)
npm run dist:diego-staging
```

O `git submodule update` põe o submódulo no commit que o meu-bot registrou. Ele não pega o último commit do
`meu-bot-diego`; para isso, veja a seção abaixo.

## Trazer uma versão nova dos módulos para o meu-bot

Depois de um commit novo no `meu-bot-diego` (no próprio repositório, ou em `produtos/meu-bot-diego`):

```bash
cd produtos/meu-bot-diego
git pull origin main
node --test tests/                        # testes do repositório de módulos
cd ../..
git add produtos/meu-bot-diego
git commit -m "chore: módulos do Diego em <commit>"
npm run dist:diego-staging                # o empacotamento valida o modulos.json antes
```

Ao mudar algo dentro de `produtos/meu-bot-diego`, faça o commit e o push **no repositório do submódulo primeiro**. Só
depois registre o commit novo no meu-bot. Senão o meu-bot aponta para um commit que só existe no seu Mac.

## Versões: o que precisa subir

- **Mudou um módulo** (qualquer arquivo da pasta dele): suba a `versao` dele no `modulos.json`. Quando o app abre, o
  seletor compara a versão e reinstala sozinho o módulo nas máquinas onde ele está ligado
  (`atualizarModulos`, `src/main/modulos/modulos.ts`). Sem subir a versão, as máquinas ficam com a anterior.
- **Mudou o contrato no backend** (`backend-colima/modulos.js`, `server.js`): suba o `backend-colima/VERSION`. O
  `release.mjs` recusa a mudança sem versão nova.
- **Mudou o contrato no app** (`src/main/modulos/`, página Módulos): vale a versão do app, como em qualquer mudança.
- **Módulo novo:** uma entrada nova no `modulos.json` e uma pasta com `instalar.sh` e `desinstalar.sh`. O contrato está
  no README do `meu-bot-diego`.

## Atualização do app para o Diego (ainda não publicada)

O `npm run release` e o `release:staging` publicam os apps do canal nas releases do repositório **público** do meu-bot.
Publicar o meu-bot-diego por ali deixaria o app, com os módulos dentro, aberto para download. Por isso, até agora o
`meu-bot-diego-staging` só foi empacotado e instalado no Mac de quem desenvolve (`~/Applications`).

**Ainda falta decidir** como o Diego recebe o app e as atualizações dele. O caminho previsto é tirar a variante `diego`
do release público e publicá-la nas releases do repositório privado `meu-bot-diego`, com o atualizador do app
apontando para lá. Enquanto isso não existe, o Diego atualiza assim:
- **O app:** instalando o `.app` novo que alguém gera com `npm run dist:diego`.
- **Os módulos nas máquinas:** sozinhos, pela versão, na próxima abertura do app novo.

## Liberar para uma pessoa

1. No meu-bot-admin › Suporte da máquina, inclua o add-on **"Módulos do Diego"** (`meu-bot-diego`) na licença.
2. No app meu-bot-diego, abra **Módulos**.
3. Cole as chaves de cada módulo (elas ficam em `~/.config/meu-bot/modulos/<id>.env`, 0600, e não voltam ao app).
4. Ligue o módulo.

Sem o add-on, a página explica o que pedir ao admin. O backend também recusa os módulos no turno.
