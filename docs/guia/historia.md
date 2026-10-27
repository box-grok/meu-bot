
# Guia passo a passo: do REA ao meu-bot

Registro de como saímos de "o que é o REA?" para um app de mesa próprio que conversa com o
cérebro do Hermes na VM, sem chave de API. Feito em 13 e 14 de outubro de 2026 no Mac do Lucas.

## Visão geral

Ordem do que foi feito:

1. Preparar o REA no Mac e registrar nos agentes.
2. Analisar o Grok Bot com o REA. No caminho, corrigimos um bug do próprio REA.
3. Ler o resultado: identidade, arquitetura, rede e segurança do Grok Bot.
4. Criar o botão **REA Grok Bot** na área de trabalho, que roda a análise e abre um relatório.
5. Mapear o backend do Hermes na VM `grokbot-1` (porta 8080, Claude Code por baixo).
6. Construir o **meu-bot** em `~/Desktop/meu-bot`: Electron + túnel SSH + cliente do backend.
7. Empacotar o `.app` com os fuses do Electron travados.

Arquitetura final:

```
┌──────────────── Mac ────────────────┐        ┌──────────── VM grokbot-1 (Tailscale) ────────────┐
│  meu-bot.app (Electron)             │        │                                                    │
│  ├─ renderer (chat, sandbox, CSP)   │        │  claude-chat-backend  :8080  /v1/chat/completions  │
│  ├─ preload (contextBridge)         │  ssh   │  └─ @anthropic-ai/claude-code  query()             │
│  └─ main                            │ ─────▶ │       └─ Claude Code com login Team (sem API key)  │
│      ├─ tunnel.ts  ssh -N -L :8080  │        │           cwd bridge-rene + MCPs (rene-dm)         │
│      └─ backend.ts POST pelo túnel  │        │                                                    │
└─────────────────────────────────────┘        │  Hermes Agent (WhatsApp) usa o MESMO backend       │
                                               └────────────────────────────────────────────────────┘
```

---

## Passo 1: preparar o REA no Mac

O REA (Reverse Engineer Anything) é uma ferramenta local de engenharia reversa que funciona
como CLI e como servidor MCP. O código-fonte está em `~/Desktop/rea`.

1. Instalar dependências e compilar:

   ```bash
   cd ~/Desktop/rea
   npm ci
   npm run build:cached
   node scripts/rea.mjs --version   # 6.4.0
   ```

2. Ver o plano do setup antes de aplicar (ele mostra cada arquivo que vai tocar e faz backup):

   ```bash
   node scripts/rea.mjs setup --all-detected --install-hopper --dry-run
   ```

3. Aplicar:

   ```bash
   node scripts/rea.mjs setup --all-detected --install-hopper --yes
   ```

   O que isso fez:
   - Registrou o REA como MCP em Claude Code, Cursor, Gemini CLI, Antigravity, VS Code e Hermes.
   - Instalou a skill `reverse-engineer-anything` nos diretórios de skills dos agentes.
   - Baixou o Hopper Disassembler oficial, verificou a assinatura e instalou em `~/Applications`.
   - Backups: `~/.claude.json.rea.backup`, `~/.cursor/mcp.json.rea.backup`, `~/.hermes/config.yaml.rea.backup`.

4. Abrir o Hopper uma vez e escolher o modo demo (gratuito, sem cadastro). Depois `node scripts/rea.mjs doctor`.

Notas:
- Ghidra, IDA e JADX não são instalados pelo REA. Se quiser, instale e aponte `GHIDRA_INSTALL_DIR`,
  `REA_IDA_MCP_CONFIG` ou `REA_JADX_MCP_JAR`.
- Análise de JavaScript, Electron e sites não precisa de nenhum motor nativo.

---

## Passo 2: engenharia reversa do Grok Bot com o REA

O alvo: `/Applications/Grok Bot.app`, um app Electron. O código fica em `Contents/Resources/app.asar`.

1. Localizar o app e confirmar que é Electron:

   ```bash
   pgrep -fl "Grok Bot"            # mostra --app-path=.../app.asar e a versão do Electron
   ```

2. Rodar a análise estática. Na primeira tentativa o REA parou porque seis binários nativos
   desempacotados tinham hash diferente do declarado no ASAR. Isso é normal em apps assinados
   depois do empacotamento. A opção abaixo registra a divergência e segue:

   ```bash
   node scripts/rea.mjs analyze-javascript-application \
     "/Applications/Grok Bot.app/Contents/Resources/app.asar" \
     --integrity-policy record-and-continue --format json > grokbot.json
   ```

3. Ler os fuses do Electron (segurança do binário):

   ```bash
   node scripts/rea.mjs inspect-electron-fuses "/Applications/Grok Bot.app" --format json
   ```

### Bug corrigido no REA

A segunda tentativa quebrou com `Unrecognized key: "interpretation"` em `endpoints`. Causa: o
domínio emite `interpretation: "candidate"` em endpoints desde o commit `b58adafa4`, mas o schema
estrito de transferência do worker nunca foi atualizado. Qualquer app com um endpoint "candidato"
derrubava a análise inteira.

Correção em `src/javascript/analysis/JavaScriptAnalysisWorkerSchemas.ts`:
- `interpretation: z.literal("candidate").optional()` no schema de `endpoints`.
- Um helper `withEndpointInterpretation` que remove a chave quando `undefined`, no mesmo padrão
  já usado para `module_runtime` (necessário por causa de `exactOptionalPropertyTypes`).
- Teste de regressão em `JavaScriptAnalysisWorkerSchemas.test.ts` usando `client.open(verb, "users")`,
  que gera um endpoint candidato.

Validação: `npm run test:local -- <arquivo>` e `npm run check:fast` passaram. A mudança ficou
no working tree de `~/Desktop/rea`, sem commit.

### Como ler o resultado

O JSON tem 250 MB. Não dá pra abrir inteiro; use um script Node com heap grande:

```bash
node --max-old-space-size=6144 -e '
const r = JSON.parse(require("fs").readFileSync("grokbot.json","utf8"));
const n = r.normalized_result;
console.log(n.summary, n.statistics);
const kinds = {}; for (const x of n.graph.nodes) kinds[x.kind] = (kinds[x.kind]||0)+1;
console.log(kinds);'
```

Nós úteis do grafo: `browser-window`, `context-bridge-api`, `ipc-channel`, `native-addon`,
`endpoint`, `package`. As `limitations` dizem o que a análise não provou.

---

## Passo 3: o que descobrimos sobre o Grok Bot

| Tema | Observação |
|---|---|
| Identidade | Bundle `com.anysphere.sand`, assinado por Anysphere Incorporated (a empresa do Cursor). `package.json`: nome `sand`, productName "Grok Bot", autor "SpaceXAI", homepage cursor.com. Quase todas as deps são `@anysphere/*`. |
| Runtime | Electron 42.1.0, app 0.70.2. Fuses: RunAsNode off, inspect off, integridade do ASAR on, só-ASAR on. |
| Processos | `main-core.cjs` e `main-app.cjs` (principal), `local-exec-daemon/main.cjs` (o "computador do usuário" visto pela nuvem), `node-agent-coordinator/main.cjs`, renderer em React 19. |
| Protocolo | O daemon faz long-poll e watch contra `aiserver.v1.GrokBotService`: `WatchGrokBotUserComputerRequests`, `PollGrokBotUserComputerRequests`, `SubmitGrokBotUserComputerResponses`. |
| Rede | `api2.cursor.sh` (API e updates), `api.origin.cursor.com`, `prod.authentication.cursor.sh`, `api3.cursor.sh/tev1` (Statsig), Sentry, `wss://api.x.ai` (voz), `grok.com/connectors-oauth-exchange-code`. |
| Nativos | `sand-op-launcher` (lança o CLI do 1Password num sandbox, só o binário assinado pela AgileBits) e `sand-webauthn-signer` (CTAP2/WebAuthn em Rust). Addons: `cursor-proclist`, `sand-notification-settings`, tree-sitter. |
| Estado local | `~/.grokbot` com arquivos selados em AES-256-GCM (`sandSealedFile`); `~/Library/Application Support/Grok Bot`. |

Conclusão prática: o app no Mac é só a casca. O cérebro e a execução ficam nos servidores da
Anysphere e na VM do bot. Não dá pra "clonar" o Grok Bot a partir disso; dá pra copiar a arquitetura.

---

## Passo 4: botão "REA Grok Bot" na área de trabalho

Um applet AppleScript que abre o Terminal e roda um script. Arquivos dentro de
`~/Desktop/REA Grok Bot.app/Contents/Resources/`:

- `run.sh`: roda `inspect-electron-fuses` e `analyze-javascript-application`, gera o relatório e abre.
  Tem uma trava em `~/rea-grok-bot/.lock` pra impedir execuções paralelas (cliques repetidos
  derrubavam as análises anteriores).
- `report.mjs`: lê o JSON com heap de 6 GB e gera `report.html` com identidade, fuses, superfície
  Electron, IPC, janelas, addons, hosts referenciados (regex sobre o ASAR bruto), rotas literais,
  divergências de integridade e limitações.

Como foi criado:

```bash
osacompile -o ~/Desktop/"REA Grok Bot.app" main.applescript
# main.applescript:
#   set appPath to POSIX path of (path to me)
#   tell application "Terminal" to do script "bash " & quoted form of (appPath & "Contents/Resources/run.sh")
```

Saída: `~/rea-grok-bot/<timestamp>/` com `analysis.json`, `fuses.json`, `report.html`;
`~/rea-grok-bot/latest` aponta pra última. A análise leva cerca de 1 minuto.

---

## Passo 5: o backend do Hermes na VM

A VM `grokbot-1` (100.69.163.93 pelo Tailscale, alias no `~/.ssh/config`) é o "computador do bot"
do Grok Bot e também onde roda o Hermes Agent do WhatsApp.

O que existe lá:

| Processo | Papel |
|---|---|
| `hermes gateway run` | Gateway do Hermes (WhatsApp via `whatsapp-bridge/bridge.js`). |
| `hermes proxy start --provider xai` (:8645) | Proxy da xAI, hoje só pra gerar imagens. |
| `node server.js` em `~/.hermes/agente-rene/backend-sdk-claude` (:8080) | **O cérebro**: `claude-chat-backend`, Express com endpoint OpenAI-compatível. |
| `thais_espelho.py`, sites, watchdog | Pontes e utilidades do Hermes. |

Sobre o nome "mythos": o processo se chama `hermes-mythos-lucas`, mas não usa o modelo Claude
Mythos. O banner "mythos/claude-sonnet-5" que aparece no WhatsApp vem da instância OpenClaw do
Salvador, em outro host (nota em `~/.claude/projects/-home-box--hermes-agente-rene/memory/`).

### Como o backend funciona (`services/openai-compat.js`)

- Rotas: `GET /v1/models` e `POST /v1/chat/completions`. Auth: `Authorization: Bearer <OPENAI_COMPAT_KEY>`,
  chave no `.env` do backend. Sem ela: `401 invalid api key`.
- Modelos: `claudecode` (chat puro, cwd neutro, diretiva de chat, maxTurns 8), `rene` (agente,
  cwd `bridge-rene` com CLAUDE.md e skills, MCP completo, maxTurns 30), `rene-dm` (igual ao rene com
  MCP restrito), `rene-buffer` (perfil com MCP do Buffer).
- Cada request abre uma sessão **nova** do Claude Code via `query()` do `@anthropic-ai/claude-code`,
  com `permissionMode: 'bypassPermissions'`. O histórico inteiro é achatado em texto
  (`User: ...` / `Assistant: ...`) num único prompt; mensagens `system` viram `appendSystemPrompt`.
- `stream: true` é só de fachada: o texto chega num bloco só no final. Por isso o meu-bot usa `stream: false`.
- Autenticação do Claude Code na VM: login de assinatura **Team** (`~/.claude/.credentials.json`,
  escopo `user:inference`). Não há chave de API.
- Erros: 401 (chave ou auth do Claude), 503 (`authDown` ou erro), 400 (sem mensagens).

Teste manual na VM:

```bash
K=$(grep ^OPENAI_COMPAT_KEY= ~/.hermes/agente-rene/backend-sdk-claude/.env | cut -d= -f2-)
curl -s http://127.0.0.1:8080/v1/chat/completions -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" \
  -d '{"model":"claudecode","messages":[{"role":"user","content":"Responda só: pong"}]}'
```

Latências medidas pelo túnel: `claudecode` 4 s, `rene-dm` 5 s numa pergunta simples.

Atenção: o backend escuta em `*:8080` (todas as interfaces), não só em `127.0.0.1`. Pelo Tailscale
está ok; se a VM tiver IP público aberto, restrinja no `app.js`.

Sobre termos de uso: credenciais de assinatura são para o Claude Code e o claude.ai. Usar esse login
pra alimentar outro produto é uso que a Anthropic não permite em assinatura. Para uso pessoal é
zona cinzenta; para qualquer coisa que terceiros usem, o caminho correto é chave de API.

---

## Passo 6: construir o meu-bot

Projeto em `~/Desktop/meu-bot`. Decisões: Electron 44.7.2, TypeScript 7 (só `tsc`, sem bundler),
renderer em HTML/CSS/TS puro, sem React, sem chave de API.

### Estrutura

```
meu-bot/
├── package.json              # main: dist/main/main.js; scripts build/dev/dist
├── tsconfig.base.json        # strict, ES2022, exactOptionalPropertyTypes
├── tsconfig.main.json        # module nodenext → dist/ (CommonJS)
├── tsconfig.renderer.json    # lib DOM, só `import type`, carregado como <script type="module">
├── src/shared/ipc.ts         # canais e tipos do contrato IPC
├── src/main/main.ts          # BrowserWindow travada + handlers IPC
├── src/main/settings.ts      # settings.json em userData (host, modelo, porta)
├── src/main/tunnel.ts        # chave via ssh + ssh -N -L com retentativas
├── src/main/backend.ts       # POST /v1/chat/completions pelo túnel
├── src/main/conversation.ts  # histórico por janela + transcript
├── src/preload/preload.ts    # contextBridge.exposeInMainWorld("meuBot")
├── src/renderer/{index.html,style.css,renderer.ts,global.d.ts}
├── scripts/package.mjs       # @electron/packager
├── scripts/fuses.mjs         # @electron/fuses + codesign ad-hoc
└── docs/GUIA.md              # este arquivo
```

### Passos de construção

1. Scaffold e dependências:

   ```bash
   mkdir -p ~/Desktop/meu-bot && cd ~/Desktop/meu-bot
   npm install -D electron@44.7.2 typescript @electron/packager@20.3.0 @electron/fuses@2.1.3 @types/node@24
   ```

2. Segurança da janela (`main.ts`): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
   `setWindowOpenHandler → deny`, `will-navigate → preventDefault`. CSP no `index.html`:
   `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'`.

3. Preload: como roda em sandbox, não pode importar módulos do app. A lista de canais permitidos
   fica duplicada ali como literais. Expõe `send`, `newConversation`, `getSettings`, `setSettings`, `on`.

4. Túnel (`tunnel.ts`):
   - Busca a chave: `ssh grokbot-1 "grep '^OPENAI_COMPAT_KEY=' ~/.hermes/.../.env | cut -d= -f2-"`.
     A limpeza de aspas é feita no Node, não na VM (ver problemas abaixo).
   - Escolhe uma porta local livre e roda `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local>:127.0.0.1:8080 grokbot-1`.
   - Espera a porta local aceitar conexão (até 15 s). Três tentativas com espera crescente,
     porque a VM oscila no Tailscale.
   - `ConnectTimeout=15`, `BatchMode=yes`, `StrictHostKeyChecking=accept-new`. Host validado por regex
     e sem `-` inicial, pra impedir injeção de opção via settings.

5. Cliente do backend (`backend.ts`): envia as últimas 12 mensagens, `stream: false`, timeout de
   2 min (`claudecode`) ou 10 min (`rene`/`rene-dm`). Em erro, remove a mensagem do usuário sem resposta
   pra não repetir no próximo turno. Eventos pro renderer: `backend:status`, `chat:assistant-start`,
   `chat:delta`, `chat:done`, `chat:error`.

6. Interface: chat com balões, selo "backend VM · modelo", selo de status do túnel, diálogo de
   Configurações (host SSH com lista lida do `~/.ssh/config` por `sshConfig.ts`, modelo, porta). Texto do modelo sempre via `textContent`, nunca `innerHTML`.

   **Abas.** "Nova conversa" (ou Cmd+T) abre uma aba nova sem perder a anterior. Cada aba é uma
   conversa própria no processo principal (`createConversation` em `conversation.ts`, mapa por id),
   com histórico, estado de "pensando" e transcript separados. Abas podem receber resposta em
   segundo plano (ponto azul na aba) e podem ser fechadas pelo × ou Cmd+W. O título da aba vira o
   começo da primeira mensagem. Todos os eventos `chat:*` carregam `conversationId`.

   **Histórico persistente.** As conversas são gravadas em
   `~/Library/Application Support/meu-bot/conversations.json` a cada mensagem (escrita atômica) e
   recarregadas na abertura: as abas voltam na mesma ordem, a mais recente fica ativa. Fechar o app
   não apaga nada; fechar uma aba pelo × apaga aquela conversa (o transcript em `transcripts/` fica
   como arquivo morto). Abas vazias não são restauradas.

   **Renomear aba.** Dois cliques no título abrem um campo; Enter confirma, Esc cancela, vazio volta
   ao título automático. O nome vai em `title` no `conversations.json` e tem prioridade sobre o
   título automático ao restaurar.

   **Reordenar arrastando.** As abas aceitam arrastar e soltar (HTML5 drag and drop). Durante o
   arrasto a aba se move ao vivo; ao soltar, a ordem do DOM é enviada em `chat:reorder` e gravada
   no campo `order` de cada conversa, que define a posição ao reabrir.

7. Build e execução:

   ```bash
   npm run build    # tsc main + tsc renderer + cp html/css
   npm run dev      # build + electron .
   ```

### Testes feitos

- Túnel + chave: 3,3 s. Reuso do túnel entre mensagens confirmado.
- `claudecode` e `rene-dm` responderam pelo túnel (4 s e 5 s).
- Teste headless sem Electron: `ELECTRON_RUN_AS_NODE=1 npx electron -e '...'` carrega `dist/main/tunnel.js`.

---

## Passo 6b: v2, funcionalidades inspiradas no Hermes

Três levantamentos do código do `hermes-agent` (app de mesa, gestão de contexto, transporte com
provedor OpenAI-compatível) viraram um plano de 12 funcionalidades, implementadas em ondas.

### Onda A — fundações, Markdown, modelo por conversa, fonte e tema
- `src/shared/ipc.ts` virou **só tipos**; `BACKEND_MODELS` mora em `settings.ts`. Isso acabou com a
  dupla emissão de `dist/shared/ipc.js` (CJS pelo main, ESM pelo renderer).
- `scripts/vendor.mjs` copia `marked`, `DOMPurify` e `highlight.js` (pacote `@highlightjs/cdn-assets`,
  que é ESM autônomo; o `highlight.js` do npm não roda no browser sem bundler) para `dist/renderer/vendor/`.
  Tipos locais em `src/renderer/vendor/*.d.ts`. CSP inalterada: temas do hljs como `<link>`.
- `src/renderer/lib/markdown.ts`: `marked` com `renderer.code` → `DOMPurify.sanitize(RETURN_DOM_FRAGMENT,
  FORBID_TAGS img/svg/form…)` → links só `https?://` abrindo via `shell:open-external`.
- Modelo por conversa (`conv.model`, IPC `chat:set-model`); fonte e tema (`nativeTheme.themeSource`,
  `--chat-font`); `backgroundColor` da janela segue o tema pra não piscar.
- `npm test` roda `node --test scripts/tests/` sobre o `dist/` (renderer como ESM via
  `dist/renderer/package.json {"type":"module"}`; main como CJS com stub do `electron`).

### Qual agente a máquina tem (Hermes, OpenClaw ou PicoClaw)
- PicoClaw (sipeed; FlowBox-F1 no Termux, 23 out): detectado por `picoclaw` no PATH **com** `~/.picoclaw/config.json`
  (só o binário é uma cópia solta), depois de OpenClaw e Hermes. O estado vem do config (`channel_list.whatsapp`:
  `enabled`, `type: "whatsapp_native"`, `settings.use_native`/`self_chat_only`, `allow_from`), da sessão
  (`store.db` na `session_store_path` ou `<workspace>/whatsapp`; o número é o `jid` de `whatsmeow_device`) e do
  `/health` do gateway na `gateway.port` (18790 por padrão). "Conectado" = sessão pareada + gateway no ar; não há
  `channels status`. `dmPolicy` é `allowlist` com `self_chat_only` ou `allow_from`, senão `open`. O QR de
  pareamento sai no registro do gateway (runit: `$PREFIX/var/log/sv/picoclaw/current`), não há pareamento pelo app.
  "Reiniciar o gateway" usa `sv -w 30 force-restart picoclaw` no Termux (fechar o WhatsApp pode travar o TERM)
  ou `systemctl --user restart picoclaw-gateway` fora dele; os registros sem journal saem desse log (sem as linhas
  do QR) e do `backend.log` do nohup. Transcrição, guarda e grupos continuam só do OpenClaw. Parse puro em
  `picoclawStatus` (`scripts/tests/whatsapp-picoclaw.test.mjs`).
- `whatsappStatus` (`src/main/whatsapp.ts`) devolve `agent` ("OpenClaw 2026.9.9 em /usr/local/bin (global,
  todos os usuários; /opt/node/lib/node_modules/openclaw)"), `ready` e `missing`. Hermes = `~/.hermes/whatsapp`
  existe; OpenClaw = `openclaw` no PATH. Escopo: binário sob `/home`, `/Users` ou `/root` é "só deste
  usuário"; o resto é global. Para o OpenClaw, `ready` exige `~/.openclaw/openclaw.json` e o plugin do
  WhatsApp em `openclaw plugins list` (não vem de fábrica; `openclaw plugins install clawhub:@openclaw/whatsapp`).
  Sem config o script nem chama `channels status` (poupa 25 s). A linha do WhatsApp mostra "instalado, mas
  sem configurar · clique para ver o que falta" e esconde o botão de parear; o `PAIR_SCRIPT` também recusa
  cedo com a mensagem certa, em vez do "código 255" que o wizard cancelado devolvia (agente-box, 15 out).
- Pareamento do OpenClaw: "conectado" só vem do vigia do `PAIR_SCRIPT`, quando o
  `~/.openclaw/credentials/whatsapp/default/creds.json` ganha `me.id` (emite um JSON `connected`). Antes se
  casava texto ("linked", "successfully"…) e o próprio convite do CLI ("go to Linked Devices") disparava:
  o QR fechava em 4 s, antes de escanear (agente-box, 15 out). O CLI só imprime com pseudo-terminal.
- Fim do pareamento do OpenClaw: o CLI sai sozinho logo após vincular, então o script confere o creds.json
  mais uma vez depois do `wait`. Os cronômetros de 5 min rodam com a saída em /dev/null e são mortos com
  `pkill -P`: um `sleep 300` órfão segurava o ssh e deixava o modal preso em "Cancelar" (15 out). No app,
  `waShowSuccess` é chamado pelo vigia e também pela consulta de estado (a cada 8 s durante o pareamento):
  ✓ verde animado no lugar do QR, o único botão vira "Concluído" e o modal fecha em 2,6 s.
- Quem o agente responde (OpenClaw): o padrão do OpenClaw é `dmPolicy: pairing`, que manda um código de
  pareamento a qualquer desconhecido que escreva (aconteceu com um contato real na agente-box, 15 out). Duas
  escolhas no app (`REPLY_OPTIONS` em `lib/tutoriais.ts`, cartões de rádio iguais no modal e no guia):
  "só você" = `dmPolicy allowlist` + `allowFrom [+número]` + `selfChatMode true` (as mensagens que você manda
  para o próprio número entram; mais ninguém recebe resposta nem código; `SELF_POLICY_SH`) e "todo mundo" =
  `open` + `allowFrom ["*"]`. Grupos sempre desativados. O `PAIR_SCRIPT` grava "só você" antes do login quando
  não há valor autorado (allowFrom vazio, com aviso do OpenClaw) e, ao vincular, põe o número no allowFrom. O
  status lê `dmPolicy` (vazio = pairing) e o bloco `channels.whatsapp` em JSON (`channelConfig`).
  `whatsapp:dm-policy` → `setDmPolicy`; vale sem reiniciar o gateway. As duas políticas também gravam
  `responsePrefix ""`: sem isso o safeguard do `selfChatMode` prefixa as respostas com a identidade do agente
  ("[main]") (agente-box, 15 out). Ajustes finos (lista de números,
  grupos, limite de mídia) são por conversa: "Ajustar pelo chat" (`waChannelPrompt`) abre uma conversa e
  dá ao agente o estado atual + como editar com `openclaw config set --strict-json`; nada de editor de JSON
  na interface. Conectado, a gerência (quem responde, ajustar pelo chat, atualizar, desconectar) fica na
  aba do guia, não em modal; a linha lateral do WhatsApp sempre abre essa aba (OpenClaw).
- Plug and play pelo próprio agente: no modal, "Pedir ao agente para preparar" (`waAgentPrompt` em
  `renderer.ts`) abre uma conversa nova e manda ao Claude Code em bypass da máquina o pedido pronto
  (onboard não interativo com `--auth-choice anthropic-cli`, plugin do ClawHub, conferência do gateway e
  do linger), sem parear: o QR continua sendo do app. O app não roda nada disso por SSH; quem executa é o
  agente, com o mesmo acesso que já tem. A linha do WhatsApp se atualiza sozinha a cada 10 s e passa a
  mostrar "Gerar QR" quando ficar pronto.

### Tour (onboarding) com convite
- Primeira abertura (ou interruptor "Onboarding" ligado no seletor): em vez de o guia começar direto, aparece o
  convite "Vamos fazer um tour" (`#tour-welcome`, textos em `TOUR_INVITE`): "Iniciar tour" começa o
  onboarding; "Pular por enquanto" ou × marca pulado (`SKIPPED_MESSAGE` aponta para Tutoriais).
- Em Tutoriais o primeiro cartão é o "Tour do meu-bot" (`TOUR_CARD`): "Começar", ou "Rever" com selo
  "Concluído" depois de feito; fecha Tutoriais e chama `restartTour()` (marca pendente e começa). A paleta usa o
  mesmo caminho. O tutorial do WhatsApp passou a ter o selo "Próximo".
- Fim do tour: em vez de mandar uma pergunta de verdade ao agente (que falhava sem login), aparece uma
  boas-vindas local (`welcomeMessage` + `showWelcome`), não enviada e não salva. Com o Claude Code da máquina
  deslogado, ela explica e traz o botão "Entrar no Claude Code"; logado, sugere por onde começar.
  Depois do cartão "Isso é tudo" (só ao concluir; pular não leva), a aba Tutoriais abre com o primeiro
  tutorial pendente em destaque (`tutNext`: borda, selo "Seu próximo passo", Começar pulsando). Para quem
  começa do zero é o WhatsApp. O destaque some quando a pessoa começa algum tutorial.
- Tutoriais concluídos (o tour feito, um guia terminado) saem da lista e vão para "arquivados", como as
  conversas: interruptor `#tut-archived` no topo da aba (`localStorage tutArchived`), seção "Arquivados" com
  "Rever". A contagem da lateral mostra só os ativos ("tudo feito" quando não sobra nenhum).
- **Pular** (22 out): todo tutorial pendente tem "Pular" ao lado de Começar/Continuar. O pulado vai para
  "Arquivados" com "Tutorial N · Pulado" e o botão "Retomar" (que tira o pulo e abre o guia); sai da contagem da
  lateral e do "próximo", e o resumo diz "N pulados". Nada é desfeito na máquina; concluir de fato vence o pulo.
  Por máquina: `localStorage tutPulado:<host>` (`parseTutPulados`, testado).

### Páginas em aba própria: Acervo e Tutoriais
- `definePage/openPage/activatePage/closePage` em `renderer.ts`: abas que não são conversa, uma de cada vez
  na frente (`pageActive`); `activate()` de qualquer conversa manda a página para trás; fechar volta a
  `pagePrev`; Cmd+W fecha. Tutoriais: `src/renderer/lib/tutoriais.ts` (`Tutorial`: id, título, resumo,
  passos), linha abaixo do Acervo, painel `#tutoriais-panel` com `<details>` por tutorial, ação na paleta.
  Cada tutorial é um guia ao vivo (estilo onboarding) numa aba própria ("WhatsApp 2/4", uma por tutorial,
  `openGuide`/`guidePages`): o passo atual tem o botão que leva ao lugar (`GUIDE_ACTION_LABEL`; "Gerar QR"
  já dispara o pareamento), só os botões do modal pulsam (nada na lateral, que não abre sozinha), os
  títulos das abas acompanham o progresso e os passos se marcam concluídos pelo
  `WhatsappStatus` real (`guideView`): preparado = `ready`, QR = `connected`, escolha = clique num botão de
  política ou `dmPolicy open` (o silencioso automático não conta), teste = botão "Testei, funcionou"
  (flags em `localStorage` `guia:<id>:<host>`). `paintWhatsapp` chama `paintGuide`.

### Instalador .dmg para mandar a outra pessoa
- `npm run dmg` (= `npm run dist` + `node scripts/dmg.mjs`) gera `out/meu-bot-<versão>-<arch>.dmg`, fora do git.
  Janela no estilo do Rambox: arte `assets/dmg-fundo.svg` (660×400), app à esquerda, "arraste", Aplicativos à
  direita, ícones de 128.
- Layout gravado direto no `.DS_Store` pelo `dmgbuild` 1.6.7 (MIT, o motor do electron-builder) num venv em
  `build/.venv-dmg`, criado sozinho na primeira vez. Nada de AppleScript no Finder: pedia permissão e não
  resolvia o fundo.
- Pegadinha do fundo deslocado (15 out): o `qlmanage` renderiza SVG só em quadrado e o `sips -c` recorta só
  pelo centro, ignorando `--cropOffset`. Recortar o topo deixava a arte 130 pt acima dos ícones, com branco
  embaixo. A arte vai centralizada num quadro 660×660 (viewBox `0 -130 660 660`) e o recorte central pega o
  desenho certo. Diagnóstico: o fundo do Rambox funcionou na nossa configuração, então era o arquivo.
- Para terceiros, o `config/ssh-hosts.conf` do app (suas máquinas e IPs, inclusive o root da agente-box) vira
  um modelo vazio e o app é reassinado ad-hoc. `node scripts/dmg.mjs --com-minhas-maquinas` mantém o arquivo.
  Nenhum segredo vai no pacote: a chave do backend é gerada na instalação.
- Limites: só Apple Silicon (arm64); assinado ad-hoc, então o macOS bloqueia a primeira abertura. Quem recebe
  abre em Ajustes do Sistema › Privacidade e Segurança › "Abrir Mesmo Assim". Abrir direto exige Developer
  ID da Apple e notarização.

### Conversas do WhatsApp (espelho, só leitura)
- Seletor `[ meu-bot | WhatsApp ]` acima da busca (`#list-mode`, só com OpenClaw pronto; escolha em
  `localStorage listMode:<host>`). No modo WhatsApp a lista mostra os contatos e cada conversa abre numa
  página em aba (`wa-<número>`, compositor desligado). Lista a cada 20 s; conversa aberta a cada 8 s.
- Dados: `openclaw gateway call sessions.list` e `chat.history` pela CLI da máquina (`message read` não
  suporta WhatsApp; `gateway call` não pede emparelhar dispositivo). Parse puro em
  `src/main/whatsapp-chats.ts` (testado): junta por número a sessão principal (`agent:main:main`) e a por
  contato (`…:whatsapp:default:direct:+N`); na principal só as mensagens com `senderId` do contato e as
  respostas logo depois; descarta avisos `System:` (sem `senderId`), `NO_REPLY`, `tool_use` vazio; o
  próprio número fica de fora da principal. IO em `whatsappChats`/`whatsappThread` (`whatsapp.ts`; chaves
  de sessão validadas antes de entrar no script).
- Isolamento: `session.dmScope = per-channel-peer` nas duas políticas (cada contato com memória própria;
  sem reinício do gateway). Antes disso, todos os contatos dividiam o contexto do agente.
- Conversa aberta sem piscar (`renderWaChat`): enquanto carrega, bolhas "esqueleto" com brilho correndo;
  na primeira carga as últimas 10 bolhas entram em cascata (deslize do lado delas, 35 ms entre uma e outra);
  nas atualizações (8 s) o cabeçalho muda no lugar e só as mensagens novas entram, com rolagem suave se a
  pessoa estava no fim (`WaChatPage.shown` guarda as chaves já na tela). Histórico limpo ou mudado no meio
  redesenha. `prefers-reduced-motion` desliga as animações.
- "Digitando…" (simulação, `waAgentTyping`): balão do agente com três pontinhos quando a última mensagem é
  do contato, tem menos de 3 min, o WhatsApp está conectado, a conversa não está pausada e a política
  responde essa pessoa ("todo mundo", ou "só eu" na conversa consigo mesmo). Fica sempre por último, sai
  quando a resposta entra; enquanto aparece, a conversa é consultada a cada 3 s em vez de 8 s.
- Levar ao meu-bot: só pelo menu "…" do contato ("Conversar com o meu-bot sobre isto"; o ícone de ramo nas
  bolhas e o botão no cabeçalho foram tirados a pedido, as bolhas ficam só com Copiar). `whatsapp:branch`
  relê o histórico no main (a fonte é o gateway) e cria uma conversa nova
  ("WhatsApp: <nome>", `fromWhatsapp`) com o trecho em `pendingNote`. O trecho
  (`whatsappContextNote`, testado; últimas mensagens até 24 mil caracteres, as antigas viram contagem) vai
  como `note` da primeira mensagem da pessoa, igual à nota de troca de modelo: o agente sabe que é contexto
  trazido e não fala do usuário. `pendingNote` só some quando essa mensagem fica no histórico (erro ou
  Parar sem resposta devolvem o pendente). Nada vai ao WhatsApp. Ao abrir, a lista volta para "meu-bot"
  e o cursor vai para o campo (antes a aba abria, mas a lista seguia no WhatsApp e parecia que nada mudou).
  A aba mostra no topo a conversa trazida com as mesmas bolhas do espelho (`renderWaQuote`; as mensagens
  ficam gravadas em `fromWhatsapp.messages`) e, abaixo, a conversa com o meu-bot segue normal.
- Menu "…" de cada contato (`ui:wa-menu`): Conversar com o meu-bot, Exportar (.md legível por dia, ou
  .json com contato, máquina e mensagens; `threadToMarkdown`), Copiar referência, Renomear (apelido guardado na
  máquina, ver 17 out), Arquivar, Pausar, Limpar histórico e Excluir conversa.
  "Arquivar" (mesmo termo das conversas do meu-bot; antes "Remover da lista") fica marcado na máquina
  (`whatsapp-lista.json`, ver "sincronizados pela máquina" em 17 out; antes era `localStorage waHidden:<host>`,
  migrado sozinho) e vale até "Desarquivar" (não volta sozinha com atividade nova: a sessão principal muda a hora
  de todos os participantes e o contato reaparecia sem mensagem nova); o interruptor "arquivadas" do rodapé
  aparece no modo WhatsApp quando há alguma arquivada. "Limpar histórico…" roda `gateway call sessions.reset` (o "/reset" do OpenClaw: sessão nova,
  transcript antigo arquivado) e `memory forget` nas sessões do contato (`whatsappClearPlan`). O OpenClaw
  recusa apagar `agent:main:main` ("Cannot delete the main session"), mas zera; como a principal não se
  separa por contato, a confirmação avisa que ela inteira vai junto, com os outros contatos e as
  conversas diretas com o agente. A confirmação abre na própria lista, logo abaixo do contato
  (`waClearBox`, Cancelar + Limpar em vermelho; nada de caixa nativa por cima). `whatsapp:clear-plan`
  conta as sessões; `whatsapp:clear` refaz o plano e só zera a principal com `includeShared`.
- "Desconectar" (guia e janela do WhatsApp) só desconecta: `whatsapp:logout` → `openclaw channels logout
  --channel whatsapp` (Hermes: sessão vira session.loggedout-… com o gateway parado) e confere que o
  creds.json sumiu; depois o status volta a "desconectado". Antes chamava o pareamento com reset, que já
  gerava outro QR: desconectava, mas a tela ficava em "escaneie" e acabava em "QR expirou".
  O pareamento e o desconectar encerram antes um `openclaw channels login` que tenha ficado órfão na
  máquina (app fechado/reinstalado no meio do QR; sem terminal o ssh caído não manda HUP): com ele vivo, o
  "Gerar QR" novo falhava na hora. Quando o "Gerar QR" do guia termina sem conectar, o motivo fica no
  próprio passo (`waGuidePairNote`), em vez de sumir junto com a linha de progresso devolvida ao modal.
- Contagem do QR: o baileys (biblioteca do WhatsApp no OpenClaw, `lib/Socket/socket.js`) dá 60 s ao 1º QR
  e 20 s aos seguintes. A contagem usa isso (`WA_QR_FIRST`), mede o ciclo só do 2º em diante e, passado o
  tempo, mostra "renovando…" em vez de travar em "0 s" (o QR chega pelo texto do CLI, com atraso).
- Áudio no WhatsApp (OpenClaw). Sem transcritor, áudio chega ao agente como "Audio attachment not analyzed:
  no audio-understanding model is configured" e ele responde que não ouviu (caso da Bianca, 16 out).
  - Ouvir: `backend-colima/install-transcricao.sh`. faster-whisper 1.1.1 (+ `requests`, que o
    huggingface_hub novo não puxa) num venv em `~/.local/share/meu-bot/transcricao`, modelo `small` int8
    em CPU (12 s de áudio em ~9 s na agente-box; o `base` é 2x mais rápido mas erra muito em pt-BR). O
    ffmpeg decodifica (o PyAV 15+ quebra o faster-whisper 1.1.1 e o PyAV antigo não tem roda para Python
    3.13). OpenClaw: `tools.media.models` = entrada `cli` com `{{MediaPath}}` (vale da 2026.7 à 2026.9;
    `{{AttachmentPath}}` só nas novas) + `tools.media.audio.enabled`, sem reiniciar o gateway. Teste:
    `openclaw capability audio transcribe` (tom puro dá "No transcript returned", que também prova).
  - Falar: `backend-colima/install-voz.sh off|inbound|always`. Piper 2023.11.14-2 + voz pt_BR faber medium
    (piper-voices v1.0.0) em `~/.local/share/meu-bot/voz`, chamado pela extensão `tts-local-cli` que já vem
    no OpenClaw 2026.9 (texto na entrada, WAV em `{{OutputPath}}`; o OpenClaw converte em nota de voz):
    sem o shim HTTP, o Bun e o serviço systemd do guia antigo. Na 2026.9 a chave é `tts` (o
    `messages.tts` das versões antigas foi migrado). `tts.auto` = quando: off | inbound | always.
  - Os dois respeitam configuração alheia (outro transcritor/voz: avisam e saem com 3). App: status lê o
    openclaw.json (JSON puro) numa linha de Python (`audioIn`, `audioOut`); seletor mostra "sem transcrição
    de áudio" + "Ativar transcrição de áudio" (depois da status line); passo 4 do tutorial do WhatsApp
    ("Fazer o agente entender áudios", `body: "audio"`) e seção "Áudio no WhatsApp" no painel conectado,
    com "Ativar transcrição" e os cartões Nunca / Quando receber áudio / Sempre (`installAudio`).
- Trava do dono (`tools.toolsBySender`): o número pareado (`e164:+N`) sem restrição; `"*"` sem write, edit,
  apply_patch, exec, process, cron e gateway. Sem ela, uma contato nomeou o agente (reescreveu o
  IDENTITY.md). O claude-cli aplica por argv (`nativeToolMode: selectable`, `execution-args`). Gravada nas
  duas políticas quando o número é conhecido, só se o campo estiver vazio ou já for a do meu-bot.
- Pausar o agente para uma pessoa (menu "…"): `gateway call sessions.patch` com `sendPolicy: "deny"` na
  sessão só do contato (`null` retoma). O OpenClaw ainda recebe e grava a mensagem (e pode rodar o turno),
  mas não entrega a resposta nem mostra "digitando". A principal nunca é pausada (calaria todo mundo).
  Lista com "pausado" e ponto vazado; cabeçalho da conversa avisa.
  Desde 20 out a pausa também vai para a lista durável `session.sendPolicy.rules` do openclaw.json (`deny` com
  `keyPrefix: "whatsapp:direct:+N"`; muda sem reiniciar o gateway): a marca da sessão some quando a conversa é
  limpa, a regra não. Retomar tira as duas; lista vazia tira a chave. Pausar vale também sem sessão
  própria. Limpar/excluir um pausado que só tinha a marca da sessão (pausas antigas, guarda de loop) põe a regra
  antes do reset (`whatsappKeepPaused`). A lista do app lê as duas (`pausedNumbersOfPolicy`).
- O agente sabe que foi pausado e que voltou (17 out, `src/main/whatsapp-pause.ts`, puro e testado). Confirmado no
  gateway 2026.9.9: com `deny` o agente roda igual e a entrega é descartada (`suppress / send-policy`); nada o
  avisa, e o `sessions.patch` não tem system prompt por sessão. Então o meu-bot (quem pausa) dá o contexto em duas
  peças, iguais em todas as máquinas: (1) `pauseNoteSh` → `openclaw agent --session-key … --message-file …` em
  segundo plano na máquina (nohup; a pausa volta na hora e a nota entra uns segundos depois; sem `--deliver`, nada
  vai ao WhatsApp): um turno de verdade, porque com o runtime claude-cli o contexto do modelo é a sessão do
  Claude Code e só um turno chega lá. Primeiro tentei `chat.inject`: grava uma linha "visível ao operador" no
  transcript do gateway, mas o agente disse ao vivo que nenhum aviso chegou; com o turno, uma pergunta de controle
  na sessão de teste devolveu a nota certa (~4 s por turno). A nota pede "registre com uma palavra", então a resposta
  do agente a ela é um "Registrado." que ninguém recebe. Ao pausar ("o agente foi pausado para este contato em <hora local do Mac, com fuso> pelo
  dono do número/pelo suporte… nada do que você responder será entregue") e ao retomar ("pausa encerrada em …
  Nada do que você respondeu desde a nota 'pausado' acima chegou… responda ao pendente de forma resumida"); a
  de retomada aponta para a de pausa, então não há estado a guardar; (2) `pauseRuleSh` grava no `AGENTS.md` do
  workspace (`openclaw config get agents.defaults.workspace`, reserva `~/.openclaw/workspace`) um bloco versionado
  entre `<!-- meu-bot:pausa v1 inicio/fim -->` dizendo como agir (python3: acrescenta, troca versão antiga, não
  duplica; `REGRA=1/0/erro`). Roda no pareamento (`ensurePauseRule`, junto da transcrição) e em toda pausa/retomada
  dos dois apps (máquinas antigas e pausas do admin). O `whatsappPause(host, number, paused, by)` manda patch +
  nota (`NOTA=agendada`) + regra num só SSH; só a falha do patch é erro, nota/regra só vão ao log. Decisões: o agente continua rodando pausado (o dono quer que raciocine)
  e não há mensagem proativa ao retomar. Testado na agente-box: sessão de teste com as duas notas no
  `chat.history`, regra gravada e depois `REGRA=0`.
- Chave por contato no OpenClaw 2026.9.9: `agent:main:whatsapp:direct:+N` (sem a conta); o parse aceita os
  dois formatos. Respostas no espelho: só as entregues. Com o backend claude-cli, a entregue é a do
  `runId`; as importadas do CLI sem `runId` (ferramentas, textos de meio de turno, `stopReason: tool_use`)
  são rascunho e não aparecem. Partes sem texto só viram "[mídia]" se forem mídia (imagem, áudio…);
  chamada de ferramenta não é mídia.
- Depois: responder pelo app (`openclaw message send`), tempo real pelo WebSocket do gateway, mídia.

### Acervo (biblioteca de skills)
- Linha "Acervo" acima da busca da lista lateral (`#acervo-line`), aba própria pelo mecanismo de páginas
  acima, painel `#acervo-panel` e ação na paleta.
  `src/renderer/lib/acervo.ts` define `Skill` (id, nome, resumo, passos de instalação, conferência) e
  `installPrompt(skill, máquina)`, o pedido pronto ao agente. A lista `ACERVO_SKILLS` está vazia de
  propósito: é o começo do conceito. Para entrar uma skill, basta um item na lista; o botão "Pedir ao agente
  para instalar" abre uma conversa e manda o pedido, como o WhatsApp faz. O teste garante ids únicos e
  campos obrigatórios.

### Onda B — conversas
- Modelo: `archived`, `openAsTab`, `branchedFrom`. **Fechar aba só fecha a aba**; a conversa fica na
  lista. Excluir é explícito e pede confirmação. Fechar a última aba deixa a tela vazia (campo e
  Enviar desligados), sem criar outra conversa sozinha: Novo, Cmd+N ou a lista abrem a próxima.
  Só na abertura da janela, sem aba salva, a primeira conversa é criada automaticamente. Sem aba de
  conversa, a fila mostra uma aba só com "+" ao lado do ☰ (`#tab-plus`, visibilidade em `syncRest`), que é
  o Novo; some assim que a primeira aba nasce.
- Tela vazia = cobrinha (`src/renderer/lib/snake.ts` regras puras + testes; `src/renderer/snake.ts`
  canvas e teclado; seção `#rest` em `index.html`). Já sai andando ao fechar a última aba, atravessa
  as bordas, nunca morre (passa pelo próprio rabo) e para de crescer em 24 segmentos. O tabuleiro é o
  painel inteiro (células de ~30 px; `resizeBoard` dobra posições quando a janela muda) e cada bolha
  acelera 7% (170 ms → mínimo 55 ms por passo). A comida é a
  bolha-mascote do Novo, uma cor por vez na ordem de `MASCOT_HUES`. Setas ou WASD viram e, seguradas por mais de 160 ms, viram turbo (passo pela metade); o listener de
  teclado só existe enquanto o painel está visível (`syncRest()` liga/desliga em `activate`/`afterTabGone`).
- `src/renderer/lib/sidebar.ts`: busca normalizada (NFD, sem acento) e `groupByDate` com cabeça
  "Recentes" cortada no primeiro intervalo ≥ 30 min (nunca atravessando 8 h), depois Hoje / Ontem /
  Esta semana / Mais antigas.
- `src/main/export.ts`: Markdown legível ou JSON via `dialog.showSaveDialog`. Ramificar copia o
  histórico até a mensagem escolhida (`branchConversation`).
- Menu de contexto nativo (`Menu.popup` com callback adiado pra o clique vencer). Notificações:
  o renderer decide (janela sem foco ou aba inativa) e o clique ativa a conversa.
- `src/renderer/lib/palette-rank.ts`: escada exato > prefixo > prefixo de palavra > substring >
  termos espalhados > subsequência > só keywords.

### Onda C — contexto e memória
- `src/main/context.ts`: `planContext(messages, summary, budget)` → `full` (cabe no orçamento),
  `summary` (cabeça + resumo + turnos novos + cauda) ou `truncated` (cabeça + cauda). Cauda por tokens
  (chars/4) com ≥ 2 turnos do usuário, sempre começando em `user`. Resumo entra como mensagem `user`
  com prefixo "[RESUMO DE CONTEXTO — só referência]".
- Resumo gerado em **fila serial de background** com `claudecode`, prompt fixo em pt-BR com 8 seções,
  atualização incremental ("RESUMO ANTERIOR + NOVOS TURNOS"), validado por ≥ 4 seções; falha mantém o
  anterior. Indicador "contexto: resumo + N de M msgs · resumindo…" acima da caixa de texto.
- `src/main/memory.ts`: `memory.json` com `perfil` (≤ 1375) e `notas` (≤ 2200), injetado como `system`
  inicial; editor em Configurações > Memória; extração a cada N turnos via JSON `{ops:[…]}` com parse
  tolerante e `applyOps` respeitando limites.

### Onda D — túnel e streaming no cliente
- `src/main/tunnel.ts`: `ssh -M -N -f` com `ControlMaster=yes`, `ControlPersist=600`, socket em
  `/tmp/<app>-<uid>/cm-%C` (por app desde o canal staging: `src/main/control-dir.ts`) (userData passa do limite de 104 bytes). Chave, forward e checagens são
  clientes `ControlMaster=no` do mesmo master. Estados `idle | connecting | ready | degraded | error`.
  Liveness = `-O check` **mais** um `ssh … true` real. `powerMonitor`: suspend marca suspeito,
  resume/unlock revalidam. Forward morto reinicia (orçamento 5) antes de refazer o master.
- Pegadinhas descobertas: pelo mux, o `ssh -N` é uma sessão do master e **sai quando o stdin fecha**
  (o filho mantém um pipe de stdin aberto); quem anuncia o listener é o master, então "pronto" = porta
  local aceitando conexão; o forward persiste no master depois que o cliente sai, por isso `-O cancel`
  no teardown.
- `backend.ts`: `httpPostStream` pede `Accept: text/event-stream` + `X-Stream-Mode: live`; se vier JSON
  (backend antigo, 401, 503) usa o caminho normal; se vier SSE, emite `chat:delta` por chunk. Timeout
  total 2/10 min **e** ocioso 60 s. Botão **Parar** (`chat:cancel` → `AbortController` → `req.destroy`);
  resposta parcial é mantida com marca "[interrompido]".

### Onda E — backend na VM (opt-in, Hermes intacto)
Código versionado em `backend-vm/` neste repo e instalado em
`grokbot-1:~/.hermes/agente-rene/backend-sdk-claude/` (backup `services/openai-compat.js.bak-<TS>`).
- `services/openai-compat.js`: o loop de coleta (retry 3x, entrega após `error_max_turns`) virou
  `_collectResponse()`; os caminhos sem cabeçalho são idênticos ao histórico (testado byte a byte no
  jest: não-stream e stream legado de um chunk só).
- **Streaming ao vivo**: `stream: true` + `X-Stream-Mode: live` (ou `OPENAI_COMPAT_LIVE_STREAM_DEFAULT=1`)
  → `includePartialMessages`, cabeçalhos SSE só no primeiro texto (erro antes vira 401/503 JSON),
  deltas `content_block_delta`, `"\n\n"` entre blocos separados por ferramentas, `: ping` a cada 15 s,
  `finish_reason: "stop"`, chunk de `usage`, `[DONE]`. Cliente que desconecta aborta a CLI
  (`res.on('close')`; em `req`, no Node 16+, `close` dispara ao fim do corpo do pedido e abortaria tudo).
- **Retomada de sessão**: `X-Conversation-Id` (+ `X-Conversation-Seen: N` = quantas mensagens
  não-system do body o servidor já conhece). `services/session-map.js` guarda
  `data/openai-compat-sessions.json` (chave `modelo:conversa` → `sessionId`, `cwd`, `mcpConfigPath`,
  `sysHash`, TTL 6 h) e confere o `.jsonl` em `~/.claude/projects/<cwd com / e . → ->/`. Com tudo
  válido, `prompt` = só as mensagens novas e `--resume`; senão achata como sempre. Resposta leva
  `X-Session-Resumed: true|false`. Lock em memória por conversa.
- Teste: `tests/openai-compat-live.test.js` (CLI mockado); suíte completa na VM: 14 suítes, 161 testes.
  Deploy: `cp` dos 3 arquivos, `node --check`, `bash scripts/run-tests.sh`, `pm2 restart hermes-mythos-lucas`.
  Smoke: não-stream igual; stream legado 4 linhas `data:`; live com deltas reais (primeiro em 1,4 s);
  duas chamadas com `X-Conversation-Id` → a segunda lembrou o conteúdo com `X-Session-Resumed: true`.
- Cliente: `context.ts` marca `absIndex` em cada mensagem enviada e `alreadySeenPrefix()` calcula o
  `X-Conversation-Seen`; `conv.serverSeen` persiste; com `resumed=true` o cliente não gera resumo.

### Onda F — entrada rápida global
- `src/main/quickEntry.ts`: janela `frame:false`, `alwaysOnTop(floating)`, `type:"panel"`,
  `hiddenInMissionControl`, visível em todos os espaços, posicionada a 22% do topo do display do
  cursor, esconde no `blur`. `globalShortcut` com `parseAccelerator` (`src/main/accelerator.ts`:
  exige modificador, proíbe Escape). Status `registered | taken | invalid | disabled` nas Configurações,
  com gravador de atalho (pressione a combinação; Backspace limpa).
- Relay: `quick:submit` → main → `ui:quick-submit {correlationId, text}` na janela principal (fila até
  as abas restaurarem; aba ativa ou nova se ocupada) → `quick:ack`; timeout 8 s; a janela rápida some
  e a principal vem à frente.

## Passo 7: empacotar e travar os fuses

```bash
npm run dist
# = build + scripts/package.mjs + scripts/fuses.mjs
```

- `package.mjs`: `@electron/packager` com `asar: true`, `appBundleId: local.meu-bot`,
  ignora `src/`, `scripts/`, `tsconfig*`. Saída: `out/meu-bot-darwin-arm64/meu-bot.app`.
- `fuses.mjs`: `flipFuses` com `resetAdHocDarwinSignature: true` e:
  RunAsNode **off**, EnableCookieEncryption **on**, EnableNodeOptionsEnvironmentVariable **off**,
  EnableNodeCliInspectArguments **off**, EnableEmbeddedAsarIntegrityValidation **on**, OnlyLoadAppFromAsar **on**.
  Depois `codesign --force --deep --sign - <app>`.
- Verificação independente com o REA:

  ```bash
  node ~/Desktop/rea/scripts/rea.mjs inspect-electron-fuses ~/Desktop/meu-bot/out/meu-bot-darwin-arm64/meu-bot.app
  ```

Esses fuses são a mesma postura do Grok Bot. Mudar fuses num app assinado por terceiros quebra a
assinatura; no nosso app, decidimos na hora de empacotar.

---

## Problemas encontrados e correções

| Sintoma | Causa | Correção |
|---|---|---|
| REA: `artifact_integrity_mismatch` em `cursor_proclist.node` | Binários nativos assinados depois do empacotamento | `--integrity-policy record-and-continue` |
| REA: `Unrecognized key: "interpretation"` | Schema estrito do worker desatualizado | Campo opcional + helper no schema, teste de regressão |
| Build do meu-bot: `moduleResolution=node10 removed` | TypeScript 7 removeu a resolução antiga | `module`/`moduleResolution: nodenext` |
| `renderer.js` terminava com `export {}` | `import type` mantém o arquivo como módulo | `<script type="module">` no `index.html` |
| Botão "Enviar" cortado | textarea sem `min-width: 0` no flex | `min-width: 0` + `white-space: nowrap` no botão |
| Cliques repetidos no REA Grok Bot derrubavam análises | Execuções paralelas | Trava em `~/rea-grok-bot/.lock` com PID |
| "Nova conversa" apagava o histórico | Uma conversa por janela | Uma conversa por aba, mapa por id no processo principal |
| Backend: `401 invalid api key` pelo túnel | `tr -d '"\x27 '` no Linux apagava os caracteres `x`, `2`, `7` da chave | Limpeza de aspas movida pro Node |
| `ECONNRESET` ao salvar Configurações durante uma resposta | `settings:set` fechava o túnel SSH sempre, cortando o pedido em andamento | Trocar modelo não mexe no túnel; host/porta novos são recusados enquanto houver resposta pendente |
| Forward SSH pelo mux saía em 400 ms com código 0 | Pelo ControlMaster, `ssh -N` é sessão do master e termina quando o stdin fecha | Filho do forward mantém um pipe de stdin aberto; "pronto" = porta local aceitar conexão |
| Teste jest do backend travava e abortava todo stream ao vivo | `req.on('close')` no Node 16+ dispara ao fim do corpo do pedido | Ouvir `res.on('close')` |
| `ssh: connect ... Operation timed out` intermitente | VM oscilando no Tailscale (endpoint público mudou, "offline, last seen 1m") | Retentativas com backoff + `ConnectTimeout=15`; mensagem clara |

---

## Operação do dia a dia

| Tarefa | Comando ou caminho |
|---|---|
| Abrir o meu-bot | `open ~/Desktop/meu-bot/out/meu-bot-darwin-arm64/meu-bot.app` |
| Rodar em dev | `cd ~/Desktop/meu-bot && npm run dev` |
| Regerar o `.app` | `npm run dist` |
| Configurações do meu-bot | `~/Library/Application Support/meu-bot/settings.json` |
| Transcripts | `~/Library/Application Support/meu-bot/transcripts/` |
| Analisar o Grok Bot de novo | duplo clique em `REA Grok Bot.app` ou `bash "~/Desktop/REA Grok Bot.app/Contents/Resources/run.sh"` |
| Último relatório do REA | `~/rea-grok-bot/latest/report.html` |
| Checar a VM | `ssh grokbot-1 uptime` e `tailscale status \| grep grokbot-1` |
| Testar o backend direto na VM | ver o `curl` no passo 5 |
| Logs do Hermes/backend | `~/.hermes/agente-rene/backend-sdk-claude/logs/` na VM |

Depuração rápida do meu-bot:
- "VM inacessível pelo SSH após 3 tentativas": a VM está fora no Tailscale. Confirme com `ssh grokbot-1 true`.
- "Backend recusou a chave": o `.env` do backend mudou ou a chave está com aspas estranhas.
- "Backend indisponível (503)": o Claude Code na VM está com `authDown`. Veja `/api/auth-status` no backend.
- Resposta demorada no `rene-dm`: é normal, ele roda ferramentas. Pra chat rápido use `claudecode`.

---

## Pendências, riscos e próximos passos

- O backend escuta em todas as interfaces na porta 8080. Restringir a `127.0.0.1` se a VM tiver IP público.
- O backend abre uma sessão nova por turno e achata o histórico. Um `resume` de sessão do Claude Code
  no backend tornaria o meu-bot mais rápido e barato; hoje limitamos a 12 mensagens.
- Uso de assinatura Team pra alimentar outro app: risco de termos. Pra terceiros, usar chave de API.
- A correção do REA está sem commit em `~/Desktop/rea`. Vale abrir um PR no `morluto/rea`.
- `~/Desktop/meu-bot` ainda não é um repositório git. `.gitignore` já exclui `node_modules`, `dist` e `out`.
- A versão com aprovação por comando (ferramentas `run_on_vm` via API da Anthropic) foi removida.
  Se quiser de volta, está no histórico desta sessão e no plano em `~/.claude/plans/lovely-painting-badger.md`.
