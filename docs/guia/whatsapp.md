# WhatsApp do agente

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## WhatsApp do Hermes: estado e pareamento por QR no app (15 out 2026)

- Motivo: o WhatsApp do gateway do Hermes na grokbot-1 estava deslogado ("❌ Logged out" no
  `~/.hermes/whatsapp/bridge.log`; o gateway tenta reconectar a cada 60/120/240 s e falha). Antes,
  parear era `hermes whatsapp` no terminal da máquina. Referência: `~/Desktop/qr-hermes-padrao`
  (painel Next.js que roda o bridge em `--pair-only --pair-json`).
- `src/main/whatsapp.ts`: tudo por ssh com `bash -s` (script no stdin, sem quoting). Estado:
  `~/.hermes/whatsapp` existe? + `GET 127.0.0.1:3000/health` do bridge (`status: "connected"` = conectado; não é o "open" do Baileys) +
  `me.id` do `session/creds.json` + "Logged out" nas últimas linhas do bridge.log. Pareamento:
  `pm2 stop hermes-gateway` (senão o bridge do gateway disputa a sessão), opcional `mv session
  session.loggedout-<ts>` (igual ao Hermes), `node bridge.js --pair-only --pair-json --session
  ~/.hermes/whatsapp/session --mode bot` (eventos JSON por linha: started/qr/connected/error), e
  `pm2 start hermes-gateway` no fim, inclusive em cancelamento (trap HUP/TERM/INT) e timeout de 5 min.
  O QR vira PNG no main com o pacote `qrcode` e vai como data URL.
- Renderer: linha `#wa-line` no topo da lista de conversas (só aparece onde há Hermes com WhatsApp),
  verde "conectado · +55 (16) 99229-4486" ou vermelha "desconectado · clique para parear"; modal
  `#wa-dialog` com QR, instrução, log curto, "Gerar QR" / "Reparear (apaga a sessão)" / Cancelar.
  Paleta: "WhatsApp do Hermes: estado e pareamento por QR". Depois do pareamento, re-consulta em 6 s.
- Pegadinhas: sessão deslogada precisa ser movida antes do QR (senão o bridge só repete "Logged
  out"); nunca rodar dois bridges na mesma sessão (conflito 440 derruba a sessão nova); o script
  remoto sempre sobe o gateway de volta.

## WhatsApp: "Só alguns contatos" (18 out 2026)

- Terceiro cartão em "Quem o agente responde": você + os números listados. É `dmPolicy allowlist` com `allowFrom`
  explícito (o dono entra sempre, `selfChatMode true`, grupos desativados, trava de ferramentas só para o dono).
  Os dois primeiros cartões continuam iguais. "Ajustar pelo chat" segue para o resto.
- `replyChoiceOf(dmPolicy, allowFrom, self)`: allowlist com alguém além do dono marca "list"; só o dono (ou vazio,
  ou "*") marca "self". `listedNumbers` e `parseWaNumbers` (puros, testados): um número por linha/vírgula; sem
  "+" e com 10/11 dígitos ganha o 55. O estado traz `allowFrom` lido do `channels.whatsapp` da máquina.
- Clicar no cartão abre o campo logo abaixo (fora do botão); grava só em "Salvar lista"
  (`whatsapp:dm-policy` com `numbers`); o main valida 8 a 15 dígitos.

## Voz das respostas em áudio e o modelo do agente (20 out)

**Voz das respostas.** `install-voz.sh <modo> [voz]` oferece três vozes, todas locais e grátis:
- `faber`: masculina, Piper (~70 MB);
- `dora`: feminina, Kokoro (`kokoro-onnx` 0.4.9 num venv, mais ~350 MB);
- `alex`: masculina natural, Kokoro.

Como funciona:
- O provedor no OpenClaw é sempre o `tts-local-cli`; só o `meu-bot-falar` muda de motor. A voz atual fica em
  `voz/voz-atual`.
- Se o teste do OpenClaw falhar, a voz volta para a anterior.
- A Microsoft "grátis" foi descartada: o serviço devolve 403 e 429.
- **Pela tela:** no tutorial de áudio, uma seção "Voz" com três cartões.
- **Pelo chat** (e pelo dono no WhatsApp): o instalador deixa uma cópia de si em `voz/install-voz.sh` e a skill
  `~/.claude/skills/voz-das-respostas`. No `~/.claude/settings.json` libera só esses comandos.
- O backup guarda a voz (`versoes.vozid`), e a restauração reinstala a mesma.

**Modelo do agente.** Um OpenClaw recém-instalado fica sem `agents.defaults.model` e cai num padrão sem chave
(`openai/gpt-6-astra`): o WhatsApp conecta, mas o agente não responde. O status do WhatsApp e o "Gerar QR"
(`oc_model_ensure`) configuram, com o Claude Code logado, o Claude pelo runtime `claude-cli`: Opus 5.5 como principal,
mais Sonnet e Haiku. Um modelo já escolhido nunca é trocado.

**"Todo mundo" no WhatsApp.** O app grava `allowFrom: ["*"]` antes do `dmPolicy: open`, porque `open` sem `*`
descarta tudo. Depois relê o que ficou gravado (`politicaNaoBate`).

## Skill whatsapp-grupos (21 out)

Grupos do WhatsApp do agente: listar (`wa-admin.sh listar` para o gateway por ~30 s, com backup das credenciais),
habilitar e desabilitar (`habilitar.py`: diagnóstico primeiro, depois `--aplicar --remetentes +55…`) e criar grupo.
Ela foi adaptada da skill da máquina agente-openclaw e fica em `backend-colima/skills/whatsapp-grupos`, com o
`SKILL.md` genérico (descobre conta e modelo na hora).

O `install-guarda.sh` a instala em `~/.claude/skills/whatsapp-grupos` junto da guarda. A guarda subiu para a 1.2.0,
então as máquinas que já a têm recebem a skill na próxima abertura do app. O cache `data/` da conta nunca é tocado.

Com `allowFrom: ["*"]`, habilitar um grupo sem `--remetentes` deixaria qualquer membro acionar o agente: a skill
manda sempre usar `--remetentes`.

## Pausar contato no Hermes (25 out)

O Hermes não tem pausa por contato (o OpenClaw tem `sendPolicy` por sessão). Pausar lá é **tirar o número da lista de
quem o agente responde** (WHATSAPP_ALLOWED_USERS, relida ao vivo) enquanto a pausa durar, e retomar é devolvê-lo.
Diferença dita na tela: o agente nem vê as mensagens da pessoa nesse período.

- Marca `paused: { número: ISO }` em `whatsapp-lista.json` (dona: `whatsapp-marks.ts`); só o main grava. A lista do
  app e o status leem a marca; o cartão "Quem o agente responde" continua mostrando o número (união com os pausados)
  e, ao gravar, deixa os pausados fora (`setDmPolicyHermes`).
- `hermesPausaPlano` (puro, testado): lista efetiva = lista de hoje ± o número, sempre com o próprio, sem os outros
  pausados; fixa `WHATSAPP_MODE=bot` e `WHATSAPP_DM_POLICY=allowlist` (em pairing um número fora da lista receberia
  pedido de pareamento); reinicia só se modo/política mudaram. Recusa "só você", desligado e "todo mundo".
- `pauseHermes` (whatsapp.ts): grava o .env com backup, reinicia se preciso, relê e confere a lista e só então grava
  a marca. Capacidade `pausar` do Hermes ligada.

## Grupos no Hermes: ligar/desligar e "quando chamado" (25 out)

Na máquina com Hermes a política de grupos mora em `~/.hermes/config.yaml` (`platforms.whatsapp`): `group_policy`
(`allowlist` + `group_allow_from` com os jids; `open` = todos, exige WHATSAPP_ALLOW_ALL_USERS; `disabled`/`pairing` =
nenhum), `require_mention` (global) e `free_response_chats` (jids que respondem sempre). Quem fala dentro de um grupo
admitido passa pela MESMA lista das conversas diretas (WHATSAPP_ALLOWED_USERS): não há "quem aciona" por grupo. O yaml
tem precedência sobre o .env e os dois são lidos na subida do gateway (`pm2 restart hermes-gateway --update-env`).

- **Tradução** (`whatsapp-hermes-core.ts`, puro, testado): `desligado` = fora da lista; `sempre` = admitido e (sem
  menção obrigatória ou nas exceções); `mencao` = admitido com menção obrigatória. `hermesGroupCfgPara` faz a config
  nova: ligar entra na lista (`allowlist`), desligar sai (o último volta a `disabled`); o primeiro "quando chamado" numa
  máquina que respondia a tudo liga `require_mention` e põe os outros ligados em `free_response_chats`, para ninguém
  mudar sem querer. "Quem pode conversar" é recusado com a explicação (mude em "Quem o agente responde"); com `open`/"*"
  não dá para desligar um grupo só (explica, em vez de chutar).
- **Leitura** (`HERMES_GROUP_CFG_SH`, python da venv do Hermes com PyYAML): yaml, chaves soltas ou em `extra`, senão
  o .env. `gruposHermes` junta a lista admitida com as sessões de grupo do state.db (uma por remetente; a mais
  recente dá hora, chave e id) e `quemAciona` = lista das conversas diretas, nunca "herdado".
- **Escrita** (`hermesGroupCfgSetSh`): ruamel round-trip (comentários e prompts por grupo ficam; indentação do
  arquivo), backup `config.yaml.bak-meu-bot-<ts>`, tmp + rename, as mesmas chaves saem de `extra:`; depois
  `HERMES_RESTART_SH` e releitura conferida (`setGroupHermes` em whatsapp.ts). Capacidade `grupos` do Hermes ligada.
- Caso que motivou: "liberar para todo mundo" num grupo da `grokbot-1` dava "não consegui ler a configuração do
  WhatsApp (~/.openclaw/openclaw.json)".

## Excluir grupo da lista (25 out)

"Excluir da lista" no menu "…" de um grupo é só tirar da vista, como na conversa: a marca mora na máquina
(`whatsapp-lista.json`, chave `groupsDeleted: { "<jid>@g.us": ISO }`, dona do formato `whatsapp-marks.ts`), os dois apps veem a
mesma lista e o `openclaw.json` não muda. Volta sozinho quando o agente recebe mensagem nova do grupo (`updatedAt` da
sessão > hora da exclusão; sem sessão, continua excluído até a primeira). Aparece sempre, nos dois gateways e com o
agente ligado ou não (decisão do dono em 25/10: "deve ter no grupo e na conversa normal"); um grupo ligado excluído some da
lista, mas o agente continua respondendo nele, porque a marca não mexe na configuração. Excluído vira "Restaurar na lista" no menu;
o admin, com o interruptor de arquivadas, vê os excluídos para restaurar. Auditoria: `whatsapp.grupo.excluir`/`restaurar`.
Caso que motivou: grupo "zohomail" na `grokbot-1`, sem sessão, que não tinha como sair da lista.

## Grupos no app, tutorial 12 e monitor (21 out)

**Área "Grupos" na lista do WhatsApp.** Fica no fim da lista e pode ser recolhida. Junta três fontes:
- as sessões de grupo do `sessions.list`;
- o `channels.whatsapp` do openclaw.json;
- o cache da skill (`data/grupos-live.json`).

Cada grupo leva um selo: "quando chamado", "sempre" ou "desligado". A página do grupo mostra a conversa só para
leitura, com o autor de cada mensagem, e o resumo de quem aciona o agente. O menu "…" oferece:
- Ligar/Desligar;
- Quem pode conversar…;
- Copiar ID;
- Atualizar lista (pede confirmação, porque para o gateway ~30 s).

O dono das regras é `src/main/whatsapp-grupos-core.ts`, com as mesmas regras do `habilitar.py`:
- ligar usa `allowlist` mais `groups[jid]`;
- desligar o último grupo volta para `groupPolicy: disabled` e apaga `groups`, porque vazio admitiria todos;
- `groupAllowFrom` nunca fica vazio com o agente ligado, porque herdaria o `allowFrom ["*"]` das diretas;
- "todos do grupo" é `groupPolicy: open`, nunca um `*` na lista, e na tela fica atrás de um aviso vermelho com
  confirmação dupla.

A gravação usa `openclaw config patch --stdin`; depois o app relê o openclaw.json e confere. Os canais IPC são
`whatsapp:groups`, `whatsapp:group-thread`, `whatsapp:group-set`, `whatsapp:groups-refresh` e `ui:wa-group-menu`,
compartilhados pela pessoa e pelo admin. Na auditoria entram `whatsapp.grupo-ligar`, `grupo-desligar` e
`grupo-quem`.

**Tutorial 12 · O agente nos grupos do WhatsApp** (after 2). Os passos são:
1. escolher o grupo, com o aviso fixo "nunca grupo com clientes";
2. quem pode conversar: só você por padrão, mais os membros ou números digitados;
3. como responde: só quando chamado (padrão) ou sempre;
4. testar: o passo se conclui quando aparece uma resposta do agente no grupo.

O passo "quem" do tutorial 2 aponta para este tutorial quando a máquina tem grupos.

**Monitor.** `skills/whatsapp-grupos/scripts/monitor.py` lê o SQLite do OpenClaw (`session_nodes` →
`transcript_events`, `event_zstd` quando houver) em modo só leitura e segue o `/new` sozinho. Também junta os alertas
do journal e esconde tokens. Vai com a guarda 1.3.0.

## Vigia do gateway e wa-admin.sh fora do gateway (21 out)

**O que aconteceu na box-lv.** O agente chamou o `wa-admin.sh listar` de dentro da conversa do WhatsApp. O
`systemctl stop` ficou esperando a própria execução que o chamou (`draining … rootRequests=1`), e depois de ~5 min o
systemd matou tudo junto, inclusive o "religar". O WhatsApp só voltou porque o processo pendurado ainda religou no
fim. O número continuou vinculado: parar o gateway nunca pede QR de novo; só um logout pede.

**Consertos (guarda 1.4.0):**
- O `wa-admin.sh` detecta que está no cgroup do `openclaw-gateway.service` e se relança fora, com `systemd-run --user`,
  devolvendo na hora (o log fica em `data/wa-admin-ultimo.log`). Ele também recusa argumentos de exemplo
  (`<trecho do nome>`) e grava a trava `~/.cache/meu-bot/wa-admin.lock`.
- `guarda/vigia-gateway.sh` roda pelo timer de usuário `meu-bot-vigia-gateway.timer`, a cada minuto, instalado pelo
  `install-guarda.sh` e removido pelo uninstall. Ele religa o gateway habilitado que está `inactive` ou `failed`,
  desde que a trava esteja livre (ou tenha mais de 15 min). A cada 5 min reinicia o gateway se o WhatsApp está
  "linked but disconnected" há 3 checagens seguidas. Nunca desloga e nunca mexe em credenciais. O
  `disable --now` da migração de máquina é respeitado: serviço desabilitado não é tocado. Cada ação vai para
  `~/.cache/meu-bot/vigia-gateway.log` e para a auditoria (`servico.religar-gateway`, quem: sistema).
- O "Atualizar lista" do app dá até 7 min para o `wa-admin.sh`, porque o gateway pode demorar para drenar.

## Espelho do WhatsApp em máquina com Hermes (24 out)

Até aqui a lista de conversas do WhatsApp (modo "WhatsApp" da lista lateral) só existia com o OpenClaw: `whatsappChats`
chamava `openclaw gateway call sessions.list` e `whatsappThread` o `chat.history`. Na `grokbot-1` (Hermes Agent
v0.21.1) a linha de cima mostrava "conectado", o pareamento por QR funcionava, mas nenhuma conversa aparecia.

- **Onde o Hermes guarda:** `~/.hermes/state.db` (SQLite, WAL). `sessions`: uma por contato, `source = "whatsapp"`,
  `chat_type = "dm"`, `session_key = "agent:<perfil>:whatsapp:dm:<número>"`, `display_name` = o nome do contato,
  `started_at`/`last_activity_at` em segundos, `hidden`/`archived`; grupos são `…:whatsapp:group:<jid>:<quem falou>`
  (uma sessão por grupo e por remetente). `messages`: `role` user/assistant/tool/session_meta, `content`, `timestamp`
  em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp; `assistant` vazio = turno
  só de ferramenta. O próprio número vem de `~/.hermes/whatsapp/session/creds.json` (`me.id`).
- **`whatsapp-hermes-core.ts` (puro, testado):** `HERMES_LIST_PY` e `HERMES_THREAD_PY` (Python com `sqlite3`, banco
  aberto com `mode=ro`, JSON numa linha; o pod não tem o `sqlite3` de linha de comando), `chatsFromHermes` (uma conversa
  por contato, nome do `display_name` quando não é só dígitos nem `…@lid`, escondidas fora, `ownSession` sempre,
  `paused` nunca) e `threadFromHermes` (user = contato, assistant = agente; fora ferramentas, metadados, vazias,
  `NO_REPLY` e hidden/internal_notification).
- **`whatsapp.ts`:** o script de `whatsappChats` escolhe na máquina: com `~/.hermes/whatsapp` lê o state.db e devolve
  `gateway=hermes`; senão o OpenClaw como antes. `whatsappThread` vai pelo `hermesThread` quando as chaves são do Hermes
  (`isHermesKey`). `whatsappLearnNames` não faz nada no Hermes (o nome já vem na lista). `whatsappGatewayOf(host)`
  guarda o gateway da última consulta para o menu.
- **Menu "…" (`wa-menu.ts`):** `waMenuTemplate(state, caps, gateway)`; no Hermes saem "Pausar" e "Limpar histórico" (são
  `sessions.patch`/`sessions.reset` do OpenClaw). Ficam Conversar, Exportar, Copiar ID, Renomear, Arquivar e Excluir
  (as marcas moram em `~/.local/share/meu-bot/whatsapp-lista.json`, iguais nos dois gateways).
- **Tela:** `waMirrorAvailable` aceita `hermes`; a política de DM, os grupos e a guarda continuam só do OpenClaw
  (já eram condicionados a `gateway === "openclaw"`). Fica de fora por ora: grupos do Hermes (as sessões existem no
  banco, por remetente) e o PicoClaw.

## Hermes com vários usuários na mesma máquina e RAM (28 out)

- **Porta do bridge por usuário:** o Hermes usa a 3000 quando ninguém diz outra; com dois usuários com WhatsApp na mesma
  máquina, o segundo gateway não subia. O root fica na 3000 e os outros ganham **3100 + (uid − 1000)**, gravada como
  `platforms.whatsapp.bridge_port` no config.yaml por `HERMES_WA_ENSURE_SH`. O app lê a porta de cada um por
  `HERMES_BRIDGE_PORT_SH` (config, depois o registro do Hermes, depois a regra) em vez de olhar a 3000 fixa.
- **Whisper ocioso:** o ajuste de transcrição grava `stt.local.unload_after_idle_seconds: 300`. O modelo carrega no
  primeiro áudio e sai da memória 5 min depois do último: na meu-root o gateway caiu de 526 MB para 208 MB parado.
- **Lista de grupos pelo WhatsApp:** `hermes-grupos-listar.ts` para o gateway, lista com o Baileys do bridge do Hermes
  (`groupFetchAllParticipating`) e grava o cache que `gruposHermes` lê; "Atualizar lista" no tutorial 12.
- **Objetivo (tutorial 7):** a skill `objetivo-whatsapp` vai para a pasta do agente escolhido (Hermes:
  `~/.hermes/skills/`; OpenClaw: o workspace) e uma cópia antiga no lugar errado é movida na leitura.
- **Nível de liberdade no Hermes:** quem executa é o Claude Code do backend, então a trava fica lá (ver agente.md,
  "Nível de liberdade no backend").
