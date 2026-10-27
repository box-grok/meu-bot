# App: variantes, canais, atualização, produtos, onboarding e tutoriais

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Onboarding guiado (15 out 2026)

- Quando a janela abre sem nenhuma conversa na máquina e `settings.onboarding === "pending"`, em vez
  de criar a conversa automática aparece um cartão flutuante no alto da área de conversa
  (`#onboard`). Cinco passos, cada um é uma ação da pessoa que o renderer detecta: abrir a lista (☰/Cmd+B),
  abrir e fechar a paleta (⌘K, Esc), abrir e fechar as Configurações, criar a conversa (Novo/Cmd+T) e
  enviar a mensagem de exemplo, que já nasce na caixa de texto (`EXAMPLE_MESSAGE`).
- "Pular" em qualquer passo marca `skipped` e cria a conversa normal. Enviar a mensagem marca `done`.
  A flag vive em `settings.json` (`settings-normalize.ts`, `settings:set` só aceita done/skipped), nunca
  em `conversations.json`, porque não é dado de conversa.
- Feedback de cada passo é sorteado em `lib/onboarding.ts` (`pickFeedback`): 40 % frase curta, 30 % ícone,
  30 % nada; nunca repete o anterior e dois "nada" seguidos viram ícone. Máquina de estados pura
  (`advanceOnboard`), testada em `onboarding.test.mjs`.
- Para ver de novo: `"onboarding": "pending"` no `settings.json` e abrir uma máquina sem conversas.
- Abertura (`#intro`, `playIntro`): só na primeira vez (`localStorage.introSeen`; respeita
  prefers-reduced-motion). "meu-bot" discreto no centro → pill da máquina se materializa abaixo →
  backend e túnel lado a lado, mais rápido → o túnel acende verde com um pulso curto e segura. Espera o
  túnel real ficar pronto por no máximo 500 ms; se não, mostra o estado real (amarelo) e some. ~1,5 s,
  2 s no pior caso. Roda antes do onboarding, cobrindo a janela enquanto as abas voltam.
- Onboarding reduzido a 4 passos: criar a conversa pelo botão Novo já envia a primeira mensagem sozinho
  (`sendText(tab, EXAMPLE_MESSAGE)`) e o cartão vira a transição final (`FINAL_MESSAGE`, 3,2 s).
  Cmd+K agora fecha a paleta também (o `stopPropagation` do input engolia o atalho global); Cmd+, abre e
  fecha as Configurações (`openSettings`, `dialog.open`).
- Paleta: "Rever onboarding e abertura" limpa `introSeen`, grava `onboarding: pending` (o `settings:set`
  passou a aceitar "pending") e inicia o onboarding na janela atual, mesmo com conversas. A abertura
  toca na próxima janela que abrir.
- Cmd+, saiu do keydown do renderer (não funcionou para o usuário) e virou item de menu nativo
  "meu-bot › Configurações…" (`menu.ts`, acelerador tratado pelo Electron) → `ui:toggle-settings` na
  janela de máquina focada → abre ou fecha o `<dialog>`. Seletor e alívio ignoram.
- Onboarding, passo "Primeira conversa": o botão Novo recebe `.attention` (pulso na cor de destaque)
  até ser clicado; sem movimento, vira um anel fixo.
- Atalho de conversa nova: Cmd+T virou Cmd+N (Cmd+Shift+N continua sendo a janela nova, pelo menu).
- Abertura animada virou opção: caixinha "abrir direto" no rodapé do seletor (`settings.openDirect`,
  padrão true = sem abertura). Desmarcada, a abertura toca toda vez que uma janela abre. O `introSeen`
  do localStorage saiu; a ação da paleta virou só "Rever onboarding".
- Caixinha "onboarding feito" no rodapé do seletor (`settings.onboarding`): marcada = done, respeita;
  desmarcada = pending, força o onboarding na próxima janela de máquina, mesmo com conversas (as abas
  voltam por baixo do cartão). O renderer começa o onboarding sempre que a flag está pendente.
- "onboarding sempre" foi removido no mesmo dia (o usuário não gostou). Rodapé do seletor ficou com
  três controles curtos: ⇅ sincronizar ssh e dois interruptores (15 out, mesmo `.switch` da lista):
  "Intro" (ligado = abertura animada; grava `openDirect` invertido) e "Onboarding" (ligado = guia na
  próxima janela; grava `onboarding` pending/done invertido). Ligado = tem. O `label.switch` precisa de
  `-webkit-app-region: no-drag`: o seletor inteiro é região de arrasto e o clique no rótulo virava arrasto.
- Onboarding: "pular" virou texto pequeno em cinza (não se clica por reflexo); pular mostra o cartão
  "Onboarding pulado" por 4,5 s com o caminho para refazer (`SKIPPED_MESSAGE`). A lista de conversas
  entra deslizando com um brilho azul (`.sidebar.reveal`), para quem aperta Cmd+B olhando o teclado.

## Mapa de variantes: meu-bot e meu-bot-admin (16 out 2026)

Um código, dois apps. O que muda por variante mora em lugares conhecidos; o resto é comum. Pergunta que o
mapa responde ao abrir um arquivo: isto é admin, cliente ou dos dois?

| Onde | Variante | O quê |
|---|---|---|
| `src/main/variant-core.ts` | comum (puro) | `resolveVariant` (variant.json / `MEU_BOT_VARIANT`) e `capsFor` → `Capabilities` (`chat`, `pair`, `login`, `manageWa`, `tunnel`, `install`, `supportClient`, `supportAdmin`). Testado. |
| `src/main/variant.ts` | comum | `appVariant()`, `caps()`, `isAdmin()`, `appTitle()`: só a leitura do arquivo e o cache. `isAdmin()` não aparece em mais nenhum lugar do main. |
| `src/main/ipc-policy.ts` | comum (puro) | `SHARED_CHANNELS`, `CLIENT_CHANNELS`, `ADMIN_CHANNELS`: todo canal IPC está em exatamente uma lista. Testado contra os quatro preloads. |
| `src/main/ipc/registry.ts` | comum | `handleShared` / `handleClient` / `handleAdmin` / `onShared`, tipados pelas listas: canal sem lista não compila. No admin, canal de cliente vira stub que recusa; no cliente, canal de admin recusa. Registro duplicado acusa na subida. |
| `src/main/ipc/{context,shared,client,index}.ts` | comum e cliente | helpers de origem (`hostFromEvent`, `ownedConversation`); handlers comuns (leituras, configurações, memória, menu do WhatsApp, terminal); handlers só do cliente (chat, parear, logins, instalar, suporte lado da pessoa). `registerIpc(deps)` registra os três grupos. |
| `src/main/admin/` | admin | `ipc.ts` (`admin:*`), `picker-source.ts` (seletor de pessoas), `support-admin.ts`, `user-data.ts` (userData próprio: `~/Library/Application Support/meu-bot-admin`; o Electron nomearia a pasta pelo productName, "meu-bot" nos dois apps, e aí os dois dividiriam configurações, conversas e a trava de instância única: abrir um fechava o outro calado. Corrigido em 16 out, com migração do `pessoas.json`). Só `main.ts`, `ipc/index.ts` e `picker.ts` importam daqui. |
| `src/main/client/support.ts` | cliente | suporte do lado da pessoa. |
| `src/main/picker.ts` | comum | `initPicker(source: PickerSource)`; `clientPickerSource` mora aqui; os canais comuns do seletor também. |
| `src/main/wa-menu.ts` | comum (puro) | itens do menu "…" do WhatsApp por capacidade. Testado. |
| `src/main/updater-core.ts`, `src/main/update-download.ts`, `src/main/proc.ts`, `src/main/updater.ts` | comum | atualização automática do próprio app pelo GitHub Releases (ver as seções abaixo; a de 24 out é a vigente). Núcleo puro, download com retomada e processo filho testados. |
| `src/renderer/renderer.ts` | comum | `caps` (de `window:info`) no lugar de "é admin?": `caps.chat`, `caps.login`, `caps.install`, `caps.supportClient`; o arranque do admin chama `mountSuportePage`. |
| `src/renderer/admin/` | admin | `suporte-page.ts` (fábrica com dependências explícitas, como `snake.ts`), `picker-chrome.ts` (seletor de pessoas). |
| `src/renderer/lib/admin-view.ts` | admin (puro) | textos e linhas da página Suporte e do seletor. Testado. |
| `src/renderer/admin.css` | admin | `body.admin-mode`, `body.admin`, `.admin-*`; linkado em `index.html` e `picker.html`, copiado no `build:renderer`. |
| `src/shared/ipc.ts` | tipos | `MeuBotApi = MeuBotSharedApi & MeuBotClientApi & MeuBotAdminApi` (idem `PickerApi`); os preloads expõem `sharedApi`, `clientApi` e `adminApi` num só objeto. |

Regras:

- Arquivo exclusivo de uma variante começa o cabeçalho com `Variante: admin` ou `Variante: cliente`.
- Canal IPC novo: entra numa lista de `ipc-policy.ts`, no grupo certo do preload (`sharedApi`/`clientApi`/
  `adminApi`) e na interface `*Api` correspondente. O teste `scripts/tests/ipc-policy.test.mjs` confere que
  todo canal dos preloads tem política, que cada grupo do preload só usa canais da própria lista e que o que
  escreve na máquina da pessoa é só do cliente.
- `src/shared/` fica só com tipos: o `build:renderer` sobrescreve `dist/shared/ipc.js` com ESM, e o main
  (CJS) quebraria se houvesse valor lá. Lógica pura comum vive em `src/main/*-core.ts` ou
  `src/renderer/lib/`.
- `admin/` pode importar do resto; o resto não importa de `admin/` (só os pontos de composição acima).
- No renderer, decidir por capacidade (`caps.x`), nunca por variante: uma terceira variante um dia não exige
  novos `if`.
- Dev: `npm run dev` (cliente) e `MEU_BOT_VARIANT=admin npm run dev` (admin). Com o app instalado aberto, a
  trava de instância única (pelo userData) faz um dev sair calado; para testar ao lado dele:
  `./node_modules/.bin/electron . --user-data-dir=<pasta> --remote-debugging-port=9333` e `curl
  127.0.0.1:9333/json` lista as janelas.

## Atualização automática do app (16 out 2026)

Como no Grok Bot (que usa a infra do Cursor com app assinado pela Anysphere), mas sem assinatura da Apple: o
meu-bot é assinado ad-hoc, então o `autoUpdater` do Electron (Squirrel) não serve e o app se atualiza sozinho.

- Publicar: `npm run release` (`scripts/release.mjs`): exige árvore limpa e `gh auth login`; empacota as duas
  variantes (`fuses.mjs --no-install`, sem tocar nos apps deste Mac), zipa cada `.app` com `ditto -c -k
  --keepParent` em `out/<app>-<versão>-<arch>.zip`, cria a tag `v<versão>` e a release no GitHub
  (`diegofornalha/meu-bot`, público) com os dois .zip. O .dmg continua sendo o instalador da primeira vez.
- No app (`src/main/updater.ts`, só empacotado; `MEU_BOT_NO_UPDATE=1` desliga): 20 s depois de abrir e a cada
  6 h consulta `/releases/latest` (sem token; 404 = ainda sem release), escolhe o asset desta variante e
  arquitetura (`pickUpdate`, puro, testado), baixa para `userData/update`, extrai, confere a versão e o bundle
  id do Info.plist e tira a quarentena (assinatura e identidade: ver a revisão de 22 out abaixo). Pronta, avisa as janelas (`update:ready`): faixa
  "meu-bot X pronto para instalar · Reiniciar e atualizar" (`update:apply` troca o .app que está rodando e as
  cópias em `~/Applications` e na mesa com o mesmo bundle id, e reabre). Sem clique, a troca acontece calada ao
  sair do app (`will-quit`): a próxima abertura já é a nova. Canais comuns (`update:state`, `update:apply`).
- A versão do meu-bot de cada pessoa aparece para o admin na saúde da máquina (abaixo).

### Revisão no molde do Brave/Sparkle (22 out 2026)

REA do Brave 155→156 (Sparkle: `SUPublicEDKey`, delta baixado em `~/Library/Caches/…/PersistentDownloads`) e do
Cursor 3.26.16 (Squirrel + trilhas `dogfood/candidate/stable`, `update.mode` com `silentlyApplyOnQuit`). O que
mudou no meu-bot (o texto acima segue valendo onde não é contradito):

- **Assinatura Ed25519 das releases:** `npm run chave-release` (uma vez) cria a privada em
  `~/.config/meu-bot/release-ed25519.pem` (fora do repo; guarde um backup) e mostra a pública, embutida em
  `UPDATE_PUBLIC_KEY` (`updater-core.ts`). O `release.mjs` publica `<zip>.sig` ao lado de cada zip; `pickUpdate`
  ignora release sem `.sig` e o `stage()` só extrai se `verificaAssinatura` conferir.
- **Nada é reassinado:** o zip do `ditto` preserva a assinatura "meu-bot local" (conferido); o `stage()` exige
  `codesign --verify --deep --strict` e o mesmo designated requirement do app em execução. Assim o chaveiro
  ("Safe Storage", cookies do Navegador) não pede senha a cada atualização.
- **Volta sozinho:** a troca guarda cada anterior como `<app>.antigo` e grava `userData/update-pendente.json`.
  A versão nova que fica 30 s de pé é confirmada (os `.antigo` saem); na 3ª abertura sem confirmar
  (`decideRollback`), os `.antigo` voltam ao lugar e o app reabre na anterior.
- **Staging calado:** os apps do canal staging não mostram a faixa "pronto para instalar"; a versão entra ao
  fechar o app (Configurações › Sobre e atualização continua mostrando e oferecendo o botão). O estável mantém a
  faixa e nunca reinicia sozinho.
- **Backend da máquina se atualiza sozinho:** `backend-colima/VERSION` vai no app; o `install.sh` grava
  `$DEST/VERSION` só depois de o backend responder. A sondagem lê `backendver` e `backendbusy` (`/health` agora
  traz `ativos`, os chats em andamento) e `ensureBackendAtual` (`picker.ts`) reinstala para cima, só ocioso, antes
  dos plugins (o do financeiro chama a API). Decisão pura em `precisaAtualizarBackend`.
- **O release barra versão esquecida:** `componentesSemVersao` (`release-core.mjs`) compara com a última tag `v*`
  cada componente de `COMPONENTES` (`src/main/backend-bundle-core.ts`, a mesma lista que o `hostProbe.ts` instala):
  backend → `VERSION`; financeiro, CRM e guarda → o `package.json` do plugin. Mudou sem subir, sai com 64.

**Fluxo de trabalho:** desenvolver e testar com `dist:staging`/`dist:finance-staging` (build local, versão do
`package.json` sem sufixo, que vence o staging publicado) → `npm run release:staging` (os staging instalados se
atualizam) → testar → `npm run release` no mesmo commit (os meu-bot dos usuários baixam, verificam e aplicam; na
abertura seguinte o seletor atualiza backend e plugins das máquinas) → subir a versão base no `package.json`.

## Tutoriais: "ainda não consultei" não é "não feito" (19 out 2026)

- **Sintoma:** ao abrir a janela, a lista de Tutoriais e o selo da lateral nasciam com tudo "pendente" e mudavam
  conforme as consultas à máquina chegavam (o selo "3" aparecia tarde; cartões concluídos iam para arquivados
  depois). Causa: cada `done()` de passo devolve `false` para fonte `null`, e a lista tratava isso como pendente.
- **Modelo:** cada tutorial declara `needs` (fontes do contexto: whatsapp, claude, statusline, xai, fallback,
  support, objective, guarda, navegador, crm) e o contexto traz `known` por fonte (consulta respondeu, ou não se
  aplica aqui: este Mac, sem o pacote, máquina sem OpenClaw; consulta que falhou continua desconhecida).
  `tutorialState` é tri-valente: `done` / `todo` pelo estado real quando as fontes chegaram; antes, a lembrança
  por máquina (`tutLembrado:<host>`, gravada sempre que as fontes estão completas); sem lembrança, `unknown`.
- **UI:** `unknown` vira cartão "verificando a máquina…" (sem Começar, fora do selo e do "próximo"); o resumo
  diz "verificando N na máquina…". Com lembrança, a lista nasce como ficou da última vez e só muda se a máquina
  mudou. As consultas que a lista precisa (guarda, licença, Navegador, CRM) agora rodam na abertura, em
  paralelo, e não só ao abrir cada guia. Puro e testado: `tutorialKnown`, `tutorialState`, `parseTutMemory`.

## Produtos: meu-bot, meu-bot-admin e meu-bot-crm (19 out 2026)

Um código, três apps, e a porta aberta para mais (meu-bot-vendas, meu-bot-imobiliaria…). O "Mapa de variantes"
acima continua valendo para admin × cliente; o que mudou é que a variante deixou de ser um `if` e virou uma
linha numa tabela:

| Onde | O quê |
|---|---|
| `src/main/variant-core.ts` | `PRODUTOS`: por produto, `variant`, `nome` (bundle, título, userData, asset da atualização), `bundleId`, `icone`, `userData` (null = pasta padrão), `extensoes` (pastas de build das extensões embutidas), `licenca`, `herdaDe`, `fundeDe`, `portaLocal`, `caps`. O que depende da licença (CRM próprio) não está nas caps: é por máquina (22 out). |
| `scripts/produtos.mjs` | a mesma tabela lida de `dist/main/variant-core.js` para `package.mjs`, `fuses.mjs`, `dmg.mjs`, `release.mjs` e `icons.mjs` (`--variant <id>`; `--admin` segue como alias). `release.mjs` publica um zip por produto. |
| `src/main/user-data.ts` | `useVariantUserData(nome, migrate?)`: userData próprio de qualquer produto que não o meu-bot (o admin só traz o `pessoas.json`). |
| `src/main/acesso.ts` | `assertAcesso(host)`: um só gate no main. Produto free → módulo Pro exige pro/personalizado (`PRO_REQUIRED`); produto por assinatura → plano exigido em vigor (`ASSINATURA_REQUIRED`). |
| `src/main/licenca.ts`, `backend-colima/licenca.js` | três planos: `free | pro | personalizado`. `proOk` (pro ou personalizado), `crmOk` (Pro ou superior em vigor, ou o produto meu-bot-crm contratado), `isActive`, `mergeApps` (apps por device). |
| `src/renderer/lib/pro.ts` | `browserAccess(view, host, exige)`: no produto por assinatura devolve `ok` ou `assinatura` (uma tela só, sem etiqueta Pro); `planoLiberaPro`, `acessoProduto`. |
| `src/main/extensao-gmail/` | `extensao.ts` (copia `Resources/<pasta>` para `userData/Navegador/<host>/<pasta>/` por extensão, refeito pelo carimbo `.origem`; grava `config.json` 0600 com porta+token, aplica o polyfill e carrega descompactada), `extensao-api.ts` (proxy 127.0.0.1:<porta aleatória> → túnel `-L` → `/v1/crm/*` do backend com a chave do backend; CORS só para a extensão e o Gmail; `Host` conferido), `extensao-api-core.ts` (puro, testado). Ligado em `browser.ts`: o Autenticador na cadeia `ready` da sessão; a extensão do CRM em `browserOpen`/`license:get` por `sincronizarExtensaoCrm`, pela licença da máquina (22 out). |
| `extensao-crm/` | a extensão do Gmail (InboxSDK `@inboxsdk/core` 2.2.31 fixo, esbuild, DOM vanilla, pt-BR). `npm run build:extensao` → `build/extensao-crm/` (o app em dev carrega daí); o `package.mjs` copia para `Resources/extensao-crm/`. Id estável pelo `key` do manifesto (`scripts/id-da-extensao.mjs`). Dev: `npm run build:extensao && MEU_BOT_VARIANT=crm npm run dev` (ou `MEU_BOT_EXTENSAO_CRM_DIR=<pasta>` para outra cópia). |
| `backend-colima/crm-modelo.js`, `crm-store.js`, `crm-api.js` | o CRM próprio no host: domínio puro, store em `~/.local/share/meu-bot/crm/db/` (JSON por pipeline, escritor único, feed `mudancas.jsonl`, lixeira, backup diário), rotas `/v1/crm/*` montadas no `server.js` (exige `personalizado`). |
| `backend-colima/crm/crm.mjs`, `backend.mjs`, `importar-streak.mjs` | CLI do agente (mesmos subcomandos do `streak.mjs`, falando HTTP com o backend), helper do `.env`, importador do Streak (preserva as chaves; idempotente). `crm-job.mjs` escolhe a CLI pela licença: personalizado → `crm.mjs`; pro → `streak.mjs`. |
| `src/renderer/lib/tutoriais.ts` | `GuideContext.produto`; tutorial 10 em duas versões excludentes: `crm-gmail` (`needsExtensaoGmail`) e `crm-whatsapp` (`needsCrmStreak`). |
| `src/main/backend.ts`, `backend-colima/server.js` | o `hello` leva `produto`; o backend guarda `apps[produto] = {version, lastSeen}` por device (um Mac pode ter o meu-bot e o meu-bot-crm: mesmo `deviceId`, não gasta `deviceLimit`); o admin vê em `appsText`. |

Regras novas:

- Produto novo = um membro em `AppVariant`, uma linha em `PRODUTOS`, um `assets/icon-<x>.svg` (`npm run icons`)
  e, se tiver extensão do Gmail, a pasta de build. Nada mais; nenhum `if (variant === …)`.
- Planos: `pro` e `personalizado` liberam os módulos Pro (Navegador, CRM pelo WhatsApp) e, desde 22 out, o CRM
  próprio no Gmail (`crmProprioOk`); o produto `meu-bot-crm` contratado por cima do plano gratuito também libera o
  CRM. O admin muda o plano em Suporte › Conta e licença.
- Empacotar o meu-bot: `npm run dist`
  (encadeia `build:extensao`). `./instalar.sh`.
- O `localBackend.ts` passou a copiar todos os módulos que o `server.js` exige (antes só `server.js` e
  `session-map.js`: o backend local quebrava no require).

### meu-bot-crm: o CRM próprio no host

- Escritor único: só o `server.js` toca em `crm/db/`. Extensão (pelo proxy do app), agente (`crm.mjs`), job do
  WhatsApp e importador falam HTTP. A fila em memória serializa; cada mutação grava só os arquivos tocados
  (tmp+rename, 0600), avança `meta.seq` e acrescenta uma linha em `mudancas.jsonl`; `GET /v1/crm/changes?since=`
  (com `wait=` para long-poll) é o que a extensão consulta (5 s com visão CRM aberta, 30 s de resto).
- Formas: pipeline `{key, name, stages[{key,name}], fields[{key,name,type,options[{key,name}]}]}`; box
  `{key, pipelineKey, name, stageKey, notes, fields{fieldKey: valor}, contatos[key], threads[{gid,…}],
  comentarios[{key,at,autor,texto}]}`; contato `{key, nome, emails[], telefones[]}`. Tipos: TEXT, NUMBER, DATE
  (ms UTC), DROPDOWN (chave da opção), TAG (lista de chaves), CHECKBOX. Chaves opacas; as do Streak são
  preservadas na importação (idempotência e `crm/estado.json` continuam válidos).
- Extensão: só o service worker conhece o token (config.json fora dos web-acessíveis); o content script manda
  `{tipo:"crm:fetch"}` por `chrome.runtime.sendMessage`; se o fetch do worker falhar (CORS/rede local), o content
  script cai no fetch direto por 60 s com a config pedida ao worker. Painel por conversa
  (`threadView.addSidebarContentPanel`), rotas `meu-bot-crm/home`, `meu-bot-crm/pipeline/:key` e `meu-bot-crm/caixa/:key` (os antigos `crm/…` redirecionam), rótulos nas linhas
  (`threads/lookup` em lote), botões "Adicionar ao pipeline" e "CRM" na toolbar (sobrevivem aos recortes que
  escondem o menu esquerdo), item no menu, atalho ctrl+shift+c. Tema pelo `Global.gmailTheme` do SDK.
- Pendente de verificação real no Navegador (spike da Fase 0 do plano): `host_permissions` do service worker
  para 127.0.0.1 no Electron, `sendMessage` content ⇄ worker com resposta assíncrona, `key` honrado no
  `loadExtension`. O desenho tem os dois transportes e o CORS no proxy para cobrir os "se não".

### Produtos no meu-bot-admin (MVPs de bots verticais)

Pedido de 19 out: o admin é o lugar de registrar e dar o pontapé inicial em novos bots personalizados
(meu-bot-fit para academias e estúdios, por exemplo). Vista "Produtos" (`src/renderer/admin/produtos-page.ts`,
botão "Novo MVP / Produtos" do seletor; a lateral da janela da pessoa tinha `#produtos-line` até 26 out, quando o
lugar passou a ser do `#suporte-line`, que reabre a aba Suporte): lista os três produtos fixos e os MVPs do admin, com
formulário (nome `meu-bot-<slug>`, vertical, pitch, público, módulos, pipeline modelo, status ideia/mvp/beta/
lançado, notas, próximos passos). "Pontapé inicial (exportar)" mostra a definição (`produto.json`) e o checklist do
que falta para virar variante (linha em `PRODUTOS`, ícone, templates, licença das pessoas, `--variant`). Dados em
`userData/produtos.json` do admin (0600, atômico); o admin não altera o repositório. Main: `src/main/admin/
produtos-core.ts` (puro, testado) e `produtos.ts`; canais `picker:produtos-list|save|remove|export` no seletor e
só `admin:produtos-list` na janela (`adminProdutos`: os nomes para os botões "＋ produto" da licença).
Pendente: anotar em `pessoas.json` qual produto cada pessoa contratou no plano personalizado.

## Assinatura dos apps e o chaveiro do macOS

Os cookies do Navegador (login do Gmail) são cifrados com a chave "<app> Safe Storage" do chaveiro, que o macOS
libera só para a assinatura que a criou. Assinatura ad-hoc muda a cada build, então cada reinstalação pedia a senha
do Mac e, se negada, o Gmail caía deslogado. `npm run assinatura` cria uma vez o certificado autoassinado
"meu-bot local" no chaveiro de login; `fuses.mjs` e `dmg.mjs` passam a assinar com ele (sem ele, continuam ad-hoc).
Na primeira abertura depois da troca o macOS pergunta mais uma vez: clique em **Permitir Sempre**. Daí em diante
os builds seguintes (feitos neste Mac) não perguntam mais.

## Canal staging (20 out), como VS Code e VS Code Insiders

O meu-bot e o meu-bot-crm têm uma cópia **staging** ao lado do estável: `meu-bot-staging` e `meu-bot-crm-staging`.
O meu-bot-admin é só estável.

**Como a cópia staging é definida** (`staging()` em `src/main/variant-core.ts`): ela sai da linha estável. Recebe:
- nome `<app>-staging` e bundle `local.<app>.staging`;
- ícone com a faixa laranja (`assets/icon*-staging.svg`);
- userData próprio, herdado do estável uma vez só;
- porta local própria: meu-bot 8790, meu-bot-staging 8791, crm-staging 8792. O meu-bot-crm ainda divide a 8790 com o
  meu-bot (pendência).

**Licença e título**
- `caps.produto` é a **licença**, a mesma do estável. É por ela que a licença meu-bot-crm libera o crm-staging.
- `caps.nome` é o app. `caps.titulo` mostra a versão no staging ("meu-bot-staging 0.2.0-staging.3").

**Isolamento**
- Pasta de controle por app (`/tmp/<app>-<uid>`): mestre do SSH e socket do Navegador do agente. Os dois apps abertos
  juntos não fecham os túneis um do outro nem trocam o Navegador do agente.
- A cópia inicial não leva o que o chaveiro cifra com o nome do app (`google-contatos.bin`, `tailscale-oauth.bin`).
  O staging pede de novo o login do Google Contatos; o Gmail do Navegador provavelmente também.

**Versões**
- O `package.json` guarda a próxima estável (0.2.0). Os builds staging são `0.2.0-staging.N`.
- `compareVersions` segue o semver: `0.2.0-staging.3 < 0.2.0-staging.10 < 0.2.0`.
- O staging se atualiza pela maior pre-release `v*-staging.*` que tenha o `.zip` dele. O estável continua com
  `/releases/latest`.

**Publicar**
- `npm run release:staging` publica a pre-release `v<versão>-staging.N` com os dois apps staging.
- `npm run release` é a promoção: só roda num commit com a tag `v<versão>-staging.N`; sem ela, sai com 64. A regra
  fica em `scripts/release-core.mjs`.
- Instalar localmente: `./instalar.sh --staging` e `./instalar.sh --crm --staging`.

**Máquina compartilhada**
- O estável e o staging falam com a mesma máquina, e a guarda só sobe de versão (`deveAtualizar`): um app não rebaixa
  a do outro.
- O backend da máquina (server.js, crm-api, auditoria.py, plugins) é um só para os dois canais. O que se instala
  testando no staging vale também para o estável.
- O navegador-mcp da máquina atende um app por vez.

**Auditoria:** o campo `app` grava o nome real, então o registro mostra quando a ação veio de um app staging.

## Um app só: o CRM próprio vira capacidade por licença (22 out)

O meu-bot-crm era o meu-bot com três chaves ligadas na tabela de produtos (`extensaoGmail`, `crmStreak: false`,
`planoExigido: "personalizado"`), mas isso virava binário, ícone, pasta de dados, porta dividida e 5 builds. Agora:

- **Uma regra, por máquina:** `crmProprioOk(view, host)` (`src/main/licenca.ts`, `src/renderer/lib/pro.ts`;
  `crmOk` em `backend-colima/licenca.js`) = Pro ou superior em vigor, **ou** o produto `meu-bot-crm` contratado;
  nunca neste Mac nem sem licença lida (fail closed). `Capabilities` perdeu `extensaoGmail`/`crmStreak`; o renderer
  usa `crmProprio()` (do `license` da janela) onde olhava `caps.extensaoGmail` (limpar histórico guarda no CRM,
  `navHome`, `refreshCrm`, textos); o main usa `assertCrmProprio(host)` (`acesso.ts`, erro `CRM_REQUIRED`) no
  `whatsapp:archive-crm`.
- **Motor explícito na máquina:** `crm.json.motor: "proprio" | "streak"`; sem ele, quem tem a chave do Streak fica no
  Streak (nada muda em silêncio para quem já o usava com Pro), senão a licença decide (`motorCrm` em `crm-job.mjs`,
  `motorEfetivo` em `crm-core.ts`, `CrmInfo.motor`/`streakKey`). O tutorial 10 é `crm-gmail` quando
  `crmProprio && motor === "proprio"`, senão `crm-whatsapp` (Streak); `ctx.produto = { planoExigido, crmProprio, crmStreak }`.
- **Extensões:** o meu-bot traz as duas (`CLIENT.extensoes`). O Autenticador carrega na cadeia `ready` da sessão; a do
  CRM entra por `sincronizarExtensaoCrm` (idempotente: carrega/`removeExtension`) em `browserOpen` (que recebe a
  licença de quem abre) e sempre que `license:get` relê a licença (`browserSincronizarCrm`). No servidor, as rotas
  `/v1/crm/autenticador/*` passam sem `licenseOk` (`crm-api.js handle`): o Autenticador não é CRM.
- **Fusão de dados** (`Produto.fundeDe`; `fundirDe` em `user-data.ts`, regras puras em `user-data-core.ts`,
  testadas): o meu-bot adota `appData/meu-bot-crm` (o staging, `meu-bot-crm-staging`) uma vez (carimbo
  `.fundido-de-<origem>`), sem tocar na origem: conversas unem por id (empate → `updatedAt` maior, transcrições
  junto); `settings.json` mescla (origem prevalece; mapas por máquina e listas unem; favoritos por url; `onboarding`
  done se qualquer); `memory.json` fica a mais recente; `google-whatsapp.json` une `criados`; o resto só se faltar
  (`COPIAR_SE_FALTAR`, `POR_MAQUINA`). Nunca os `.bin` do chaveiro nem o leveldb da sessão. Aviso único na abertura
  (`relatorioFusao`).
- **App removido (22 out):** o produto `crm` saiu da tabela, com o `encerrado.ts` e o campo `encerrado` (nenhuma
  release chegou a ser publicada, então ninguém o recebeu pelo updater). `crm-staging` também saiu. O meu-bot segue
  com `fundeDe: "meu-bot-crm"`: a pasta antiga ainda é fundida na primeira abertura.
  `mergeApps` apaga `meu-bot-crm` quando o `meu-bot` se apresenta (sem fantasma no admin).
- **Build:** `dist` e `dist:staging` encadeiam `build:extensao`; `package.mjs` copia `google-oauth.json` quando o
  produto traz `extensao-crm`. Somem `dist:crm`, `dist:crm-staging`, `dmg:crm`, `instalar.sh --crm`.
- Fica como está: o projeto `extensao-crm/` gera as duas extensões (um build); separar o Autenticador num projeto
  próprio é só organização de pasta, sem efeito na licença.

## Atualização no molde do Grok Bot (24 out)

REA do updater do Grok Bot 0.71.2→0.75.5 (Cursor/Anysphere; `sand-update-service`: feed próprio, download com
retomada, zip retido em `sand-update-kept/`, marcador `sand-update-apply-marker.json`, reinício ocioso e gate de
versão mínima do Statsig que vira a tela "Atualização pronta · Reiniciar para atualizar"). O que mudou no meu-bot (o
texto das seções de 16 e 22 out segue valendo onde não é contradito; a assinatura Ed25519, o mesmo designated
requirement e o rollback pelos `.antigo` ficam, que o Grok Bot não tem):

- **Módulos:** `updater-core.ts` (puro: feed, versões, assinatura, os registros em disco, cadência, reinício ocioso,
  versão mínima), `update-download.ts` (download em fluxo com retomada; testado com servidor `node:http` falso),
  `proc.ts` (`run`/`runText`: processo filho assíncrono com limite de tempo; o updater não usa mais `execFileSync`
  durante a preparação, que congelava a janela no `ditto` e no `codesign`), `updater.ts` (o orquestrador).
- **Verificação:** 10 s depois de abrir, depois a cada hora com até 5 min de jitter (`proximaVerificacaoMs`); também
  ao voltar a internet, ao acordar/desbloquear o Mac se a última ficou velha (`checkIfStale`), em "Verificar agora" e
  quando o backend exige versão mínima. Cada verificação loga o gatilho (`UpdateTrigger`).
- **Download:** `baixarComRetomada` grava em `<zip>.partial` com `<zip>.resume` (URL + ETag/Last-Modified), retoma com
  `Range`/`If-Range`, insiste até 15 vezes com espera dobrando (1 s → 60 s), vigia de 30 s sem bytes, progresso em
  passos de 1 % (`UpdateState.progress`, fase `downloading`), confere o tamanho declarado na release e calcula o sha256.
  Cancelado ao sair, o `.partial` fica e a próxima abertura retoma. O `.sig` é baixado antes do zip (falha barata).
- **Preparada em disco:** `userData/update/app/<app>.app` + `preparada.json` (`parsePreparada`: versão, bundle,
  sha256 do zip, quando). Na abertura seguinte `reaproveitarPreparada` reconfere (`codesign --verify`, mesmo
  requisito) e já fica "pronta", sem baixar. A release deixou de oferecer a versão (ou oferece outra) → descarta.
- **Troca só da versão mostrada:** `update:apply` leva `expectedVersion`; o main recusa se a pronta mudou. Se a última
  verificação tem mais de 60 s (`CONFIRMA_FEED_MS`), reconsulta só a release (`feedAindaOferece`): retirada do ar, nada
  muda; sem internet, a preparada já conferida vale. Com uma resposta em andamento (`anyConversationBusy`), espera até
  20 s (fase `applying`, `aguardando`). Pré-voo de escrita no .app e na pasta: `EROFS`/`EACCES`/`EPERM` vira a fase
  `needs-move` ("arraste para Aplicativos"). Reabre na mesma máquina (`--host=` no `app.relaunch`).
- **Registro da troca** (`update-pendente.json`, `parsePendente` lê o formato antigo): ganha `gatilho` (clique, ocioso,
  saída), `pedidoEm` e `fase` ("pedida" antes de mexer nos .app, "trocada" depois). Na abertura, `decideRollback`:
  `aguardar` (30 s de pé confirma), `voltar` (3.ª abertura sem confirmar), **`nao-pegou`** (reabriu na versão de antes:
  `repararTroca` repõe um .app que tenha ficado faltando entre os dois renames, registra e a próxima verificação
  prepara de novo) ou `descartar` (outra versão).
- **Reinício ocioso** (preferência `atualizarOcioso`, ligada por padrão; chave em Configurações › Sobre e
  atualização): a cada minuto e ao bloquear a tela, com versão pronta, `powerMonitor.getSystemIdleState(600)` em
  `idle`/`locked`, nenhuma resposta em andamento e nenhum terminal aberto (`decideReinicioOcioso`) → troca e reabre.
- **Versão mínima:** o backend responde `appMinima` no hello (`APP_MINIMA` em `server.js`, acompanha o backend; o
  admin força uma maior gravando `~/.local/share/meu-bot/app-minima.json` `{"versao":"x.y.z"}`; também vai no
  `/health`). `backend.ts` entrega a `noteVersaoMinima` (vale a maior entre as máquinas abertas); abaixo dela
  (`abaixoDaMinima`) o `UpdateState` marca e a janela mostra o bloqueador `#update-blocker` ("Atualização necessária",
  progresso, "Reiniciar e atualizar" quando pronta, "Baixar a versão mais recente" se o download não vier), até
  reiniciar na versão nova. Backend antigo não manda o campo = sem exigência. `backend-colima/VERSION` 1.0.3.
- **Tela:** `UpdateState` ganhou `phase` novas (`downloading`, `verifying`, `applying`, `needs-move`), `progress`,
  `errorKind`, `aguardando`, `minima`/`abaixoDaMinima`, `atualizarOcioso`; `update:ready` saiu (o `update:state`
  cobre). O ponto da barra mostra `short` ("baixando 42%"). Corrigidos: a linha "Sobre" usava um `name` inexistente
  (vinha vazio) e o primeiro estado era pintado antes de `window:info` (um staging podia mostrar a faixa).
- Fica igual: faixa só no estável; staging troca calado ao fechar (e agora também ocioso); troca ao sair (`will-quit`)
  é o único caminho ainda síncrono, de propósito (não dá para esperar Promise ali).
- **Trava do Hermes (24 out, ao religar a `grokbot-1`):** `precisaAtualizarBackend` devolve "nao" quando a sondagem
  diz `gateway: "hermes"`: lá o backend é o original do Hermes (`hermes-mythos-lucas`, sem `VERSION`, na mesma pasta
  que o backend-colima usaria), e a atualização automática o reinstalaria por cima na primeira sondagem.



## Espera que não parece erro (26 out)
As telas mostravam "Consultando…" cinza e parado enquanto a máquina respondia por SSH/túnel; com 10–20 s de demora
parecia travado e a pessoa clicava de novo. Agora toda espera de dado da máquina usa `lib/carregando.ts`: ponto
pulsando, o tempo a partir de 3 s ("Lendo os grupos… 7 s") e, a partir de 10 s, "A máquina está respondendo devagar;
continuo buscando. Não precisa clicar de novo." O relógio é por rótulo e não zera quando a tela se redesenha. Vale para
Conta Google, Finanças e Curva ABC, grupos e conversas do WhatsApp, passos do guia, CRM, Navegador e as páginas do
meu-bot-admin. Tela nova que espera a máquina: use `carregando("…")` no lugar de um `<p class="hint">`.
