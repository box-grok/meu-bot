> Roteiro passo a passo para uma máquina nova: [PLAYBOOK-nova-maquina.md](PLAYBOOK-nova-maquina.md). Este guia é o diário técnico.

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

### Onda B — conversas
- Modelo: `archived`, `openAsTab`, `branchedFrom`. **Fechar aba só fecha a aba**; a conversa fica na
  lista. Excluir é explícito e pede confirmação.
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
  `/tmp/meu-bot-<uid>/cm-%C` (userData passa do limite de 104 bytes). Chave, forward e checagens são
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

## Backend local no Colima (`backend-colima/`)

Quando a `grokbot-1` fica inacessível, o meu-bot usa a VM do Colima (host `colima` do
`~/.ssh/config`, incluído pelo Lima) com um backend próprio, sem dependências npm:

- `backend-colima/server.js`: `node:http` puro. Mesmo contrato do backend da grokbot-1
  (`/v1/models`, `/v1/chat/completions`, Bearer, SSE legado, `X-Stream-Mode: live`,
  `X-Conversation-Id`/`X-Conversation-Seen` → `X-Session-Resumed`). Modelos: `claudecode` (chat,
  8 turnos, `--permission-mode default`) e `agente` (30 turnos, `--dangerously-skip-permissions`,
  cwd `~/agent-workspace`: edita arquivos e roda comandos na VM do Colima sem perguntar).
  Spawna `~/.local/bin/claude -p --output-format stream-json --include-partial-messages` em
  `~/chat-workspace`; `res.on('close')` aborta a CLI.
- `backend-colima/session-map.js`: cópia do mapa de sessões da VM remota.
- `backend-colima/meu-bot-backend.service`: unidade systemd de usuário (linger já ativo na VM).
- `backend-colima/install.sh`: baixa Node 20 (`.tar.gz`; a VM não tem `xz`) em `~/.local/node`,
  copia os arquivos para `~/.hermes/agente-rene/backend-sdk-claude` (mesmo caminho que o app
  procura o `.env`), gera `OPENAI_COMPAT_KEY` se não existir e sobe o serviço.

Atualizar: `scp backend-colima/* colima:~/backend-colima/ && ssh colima bash ~/backend-colima/install.sh`.
Logs: `ssh colima journalctl --user -u meu-bot-backend -f`. A VM do Colima tem 4 GB; cada CLI do
Claude usa ~250 MB. Se faltar memória: `colima stop && colima start --cpu 4 --memory 8`.
O Claude Code dentro da VM precisa estar logado (`claude /login` lá) — o backend devolve 401
`claude_auth` quando a CLI responde "Not logged in".

## Máquinas (hosts) por conversa

- Cada conversa guarda `host` (alias do `~/.ssh/config`) desde a criação; o seletor de modelo troca
  só o modelo. "Máquina padrão" nas Configurações vale apenas para conversas novas. Para usar outra
  máquina, mude o padrão e abra uma aba nova; as antigas continuam na máquina em que nasceram.
- `src/main/tunnel.ts` mantém um túnel por host (`Map<host, HostTunnel>`: master, forward, estado,
  suspeita pós-sleep). `backend:status` leva `host`; o renderer guarda o último estado por host e
  mostra o da aba ativa. Com abas em máquinas diferentes, o badge da aba vira "máquina · modelo".
- Trocar a porta fecha todos os túneis (recusado com resposta em andamento). Trocar o host padrão
  não mexe em túnel nenhum.
- Host sem backend: `fetchBackendKey` lança `TunnelFatalError` (sem retry) com a instrução de
  instalar pelas Configurações.
- `src/main/hostProbe.ts`: `probeHost` roda um script por ssh avulso (ControlMaster=no) e devolve
  usuário, SO, arquitetura, backend instalado/ouvindo, caminho do `claude`, login (procura
  `oauthAccount` em `~/.claude.json`), Node e systemd. `installBackend` copia `backend-colima/`
  (em `Contents/Resources/backend-colima` no .app, via `extraResource`) para `~/.meu-bot-install`
  no host e roda `install.sh`, com progresso por `backend:install-progress`.
- `install.sh` é idempotente: usa Node existente (>= 18) ou baixa o 20 em `~/.local/node`; unidade
  systemd de usuário (com linger) ou, como root, unidade do sistema em `/etc/systemd/system`;
  grava `CLAUDE_BIN` no `.env`; termina com um GET em `/v1/models`.
- Estado das Configurações por host: "✓ backend instalado e ouvindo", "⚠ Claude logado, sem backend"
  (botão Instalar), "✗ Claude não logado" (instruções `ssh -t host claude` + `/login`), "✗ inacessível".

## Máquina "local" (este Mac, sem SSH)

- Host especial `local`, primeiro do seletor ("este Mac (sem SSH)"). `src/main/localBackend.ts` copia
  `server.js` e `session-map.js` do bundle para `userData/backend-local`, gera `.env` (chave própria,
  porta fixa 8790 porque o Lima do Colima costuma encaminhar a 8080 para o Mac) e sobe o Node como
  processo filho; log em `userData/backend-local.log`. Workspaces em `~/meu-bot-workspace/{chat,agente}`.
- Apps de GUI no macOS têm PATH mínimo: `findNode`/`findClaude` procuram em Homebrew, /usr/local,
  `~/.local/bin`, `~/.local/node`, nvm e, por fim, num `zsh -lc`. Login = `oauthAccount` em `~/.claude.json`.
- O managed settings deste Mac já põe `bypassPermissions` como padrão, então até o `claudecode` roda
  sem pedir permissão aqui; o `agente` é explícito com `--dangerously-skip-permissions`.
- O processo morre com o app (`will-quit` → `closeTunnel()` → `stopLocalBackend`); se morrer sozinho,
  o host fica `degraded` e a próxima mensagem sobe de novo.

## Modelo `agente` na grokbot-1

- `backend-vm/services/openai-compat.js` ganhou o modelo `agente` (bypassPermissions, 30 turnos, cwd
  `~/agent-workspace`, sem bridge-rene nem MCP dedicado). `backend-vm/deploy-agente.sh` faz backup,
  copia, roda os testes, `pm2 restart hermes-mythos-lucas` e um smoke que cria um arquivo.

## Mapa das máquinas (14 out 2026)

| Alias ssh | Endereço | Usuário | O que é | Backend do meu-bot | Modelos |
|---|---|---|---|---|---|
| `local` | este Mac, sem SSH | box | macOS, Node 26 (Homebrew), Claude Code 2.1.300 logado (m6), bypass global por managed settings | processo filho do app, porta 8790 | claudecode, agente |
| `colima` | 127.0.0.1:53314 (VM Lima) | box (home `/home/box.guest`) | Ubuntu 24.04 arm64, 3 CPU / 4 GB, Node 20 em `~/.local/node`, Claude Code 2.1.299 logado (m5) | systemd user `meu-bot-backend`, 8080 | claudecode, agente |
| `agente-box` | 187.127.41.175 (público, sem NAT) · Tailscale 100.65.117.27 · IPv6 2a02:4780:6e:8383::1 | box (uid 1002, sudo sem senha) | Debian 13 x86_64, 2 CPU / 8 GB, hostname `agente`, Node 24 em `/opt/node`, Claude Code 2.1.300 nativo em `~/.local/bin`, logado | systemd user `meu-bot-backend` com linger, 8080 | claudecode, agente |
| `agente-root` | mesma máquina acima | root | Claude Code global 2.1.296 (`/usr/local/bin/claude` → `/opt/node`), não logado; root não roda bypass | nenhum | — |
| `grokbot-1` | Tailscale 100.69.163.93 (hostname grok-bot-vm-153046289) | box | Linux x86_64, 8 vCPU / 16 GB, sem systemd; Tailscale SSH servido por `tailscaled` sob PM2; daemon do Grok Bot, Hermes do WhatsApp, backend original (`hermes-mythos-lucas`) | pm2 `hermes-mythos-lucas`, 8080 | claudecode, rene, rene-dm, rene-buffer (+ agente após o deploy) |

Outros nós do Tailscale: `agente-br` (= agente-box/root), `grokbot-2` (este Mac), `grokbot` (antigo, offline).
O sshd da `agente-br` aceita senha (`PasswordAuthentication yes` em `/etc/ssh/sshd_config.d/50-cloud-init.conf`); vale desligar.

## v3: uma janela por máquina

- Abertura: `showPicker()` (`src/main/picker.ts`) sempre; Enter abre a última máquina (`lastHost` nas
  settings). Segunda instância (`requestSingleInstanceLock` + `second-instance`), clique no Dock sem
  janelas, Cmd+Shift+N (`src/main/menu.ts`), e a ação da paleta abrem o mesmo seletor.
- `src/main/windows.ts`: registro `host → BrowserWindow` (uma por host), última focada, `sendToHost` /
  `broadcast` / `sendWhenLoaded`, bounds por máquina, pré-aquecimento do túnel ao abrir e carência de
  5 min antes de derrubar o túnel de uma máquina sem janela (adiada se houver turno/resumo).
- O renderer descobre a máquina por `window:info`; todo handler resolve o host pela janela remetente
  (`hostFromEvent`) e a propriedade da conversa é `conv.host === host`. `windowId` sumiu.
- `Sender` do backend é por host e resolve a janela a cada evento: fechar a janela no meio da resposta
  não perde a resposta. `memory:changed` e `settings:changed` são broadcast.
- Entrada rápida vai para a última janela focada (ou abre a do último host); o ack é validado pelo
  id do webContents que recebeu o pedido.
- Settings v3: `sshHost` → `lastHost` (migração em `settings-normalize.ts`), `defaultModelByHost`,
  `windowBounds`. "Modelo padrão nesta máquina" grava por host.
- Seletor: lista imediata, sondagens em paralelo com cache de 60 s (`picker.ts`), `describeProbe`
  (`src/renderer/lib/probe-text.ts`) decide texto/botão, `hostAccent` (`lib/host-color.ts`) dá a cor
  da faixa e da bolinha. Instalação do backend acontece ali, com progresso.
- Menu próprio: inclui `editMenu` (senão Cmd+C/V somem) e `windowMenu` (lista as janelas por título).
- Testes novos: `order`, `host-color`, `probe-text`, `settings-normalize`.

## Atalhos na área de trabalho (`src/main/shortcuts.ts`)

- "meu-bot <host>.app" é um applet AppleScript (`osacompile`) que roda o binário do app com
  `--host=<host>`. Com o app aberto, isso vira
  `second-instance` na instância principal, que abre a janela da máquina direto (`openFromArgs`).
  `open -a` não serviria: num app em execução o macOS descarta os `--args`.
- Ícone: janela offscreen do Electron renderiza um quadrado arredondado com cor e emoji sorteados
  (`randomLook`), `capturePage` → PNG 1024² → `iconutil` monta o `.icns`. O applet traz um
  `Assets.car` com o ícone padrão, que o Finder prefere: é removido junto com `CFBundleIconName`.
- Marcador `Contents/Resources/meu-bot-host.txt` (linha 1 `meu-bot-shortcut-v1 <host>`, linha 2 o
  emoji): só o que tem marcador é removido pelo botão; o emoji aparece no botão do seletor.
- `LSUIElement` no applet evita o ícone piscar no Dock. Se o Finder mostrar o ícone antigo, `touch`
  no bundle resolve (o Finder cacheia por data).

## Botão "aliviar grokbot-1" (`scripts/alivio/`)

- `alivio-pod.sh` vive no pod em `~/bin/` (cópia versionada aqui): encerra CLIs do Claude do backend
  presas há mais de 30 min (`LIMITE_S`), Chrome headless, e com `--tailscale` agenda `pm2 restart
  tailscaled` em 2 s via nohup (a sessão ssh cai e volta). Log em `~/alivio.log` no pod.
- `aliviar-grokbot1.sh` roda no Mac num Terminal: ssh com ConnectTimeout 90 s, mostra antes/depois e
  oferece abrir `~/Desktop/grokbot-1.app` (atalho do meu-bot) 8 s depois. Se o ssh não entrar, diz que
  o pod está congelado pelo host e que o caminho é reiniciar pelo app do Grok Bot.
- `~/Desktop/aliviar grokbot-1.app`: applet osacompile que faz `open -a Terminal aliviar-grokbot1.command`
  (cópia executável do .sh). Não usar `tell application "Terminal"`: isso pede permissão de Automação na
  primeira vez e, sem resposta, o clique não faz nada. Ícone 🧯 sobre vermelho pelo mesmo método dos
  atalhos (Assets.car removido, LSUIElement).
- A `grokbot-1` é um contêiner (pod) da infraestrutura do Grok Bot: PID 1 `tini`/`pod-daemon`, overlay em
  `/var/lib/isod`, IP 172.30.0.2 atrás de NAT, sem systemd nem sudo, `virtio_balloon` do host pausa a
  máquina. O alívio só alcança processos nossos e o PM2.

## Sincronizar SSH e alívio pelo seletor (14 out 2026)

- `config/ssh-hosts.conf` é o modelo versionado das máquinas (formato do `~/.ssh/config`, sem segredo).
  Botão ⇅ "sincronizar ssh" no rodapé do seletor → `picker:sync-ssh` → `sshSync.ts`: lê o modelo
  (`Resources/config/` no .app), planeja com `ssh-sync.ts` (puro, testado: Include normalizado com `~`,
  Host existente nunca alterado, "só neste Mac" relatado), faz backup `config.bak-<data>` e **acrescenta**
  no fim. Pergunta de origem: "num Mac novo, como sincronizar com o Cursor?" Resposta: não há sync; os
  dois leem o mesmo arquivo, o botão só preenche o arquivo.
- Sondagem ganhou `grokPod` (PID 1 `pod-daemon` ou cgroup `pod-`), lembrado em `settings.podHosts`
  (só uma sondagem que entrou atualiza; inacessível não apaga). Linha do pod: botão 🧯 "aliviar agora"
  (`picker:relieve` → `showRelief`, fecha o seletor). Caixa de baixo: "🧯 Botão de alívio na mesa"
  (`picker:relief-shortcut` → `createReliefShortcut`, applet `aliviar <host>.app`, `RELIEF_LOOK` fixo).
- `shortcuts.ts` virou genérico: `createApplet(nome, arg, look)` + marcador `meu-bot-shortcut-v1 <nome>`.
  O `aliviar grokbot-1.app` feito à mão ganhou o marcador para o app reconhecer e poder substituir.
- `relief.ts` não depende mais de `~/bin/alivio-pod.sh` existir: manda o script pelo stdin do ssh
  (`cat > ~/bin/alivio-pod.sh && bash …`). Empacotado em `Resources/alivio/` (extraResource).
- Testes: 33 (novo `ssh-sync.test.mjs`).
- "seletor na mesa" (`seletor.app`, `--picker`) foi removido: o próprio `meu-bot.app` e o Dock já abrem o
  seletor. `--picker` em argv ainda cai no padrão (`showPicker`) por não ser `--host`/`--alivio`.
- Ajustes de interface (14 out, noite): botão "Nova conversa" virou "Novo" (dica com Cmd+T); lista de
  conversas oculta por padrão (`localStorage.sidebarShown`, ☰/Cmd+B); rolagem do chat só acompanha o fim
  da resposta se a pessoa já estava perto do fim (`followBottom`, 48 px; evento scroll decide). Antes,
  cada tick de render puxava para baixo e quem rolava para cima para ler era arrastado de volta.
- Paleta ⌘K: mover o mouse sobre a lista rolada fazia a lista "pular para cima". Causa: `mousemove`
  chamava `paintPalette()`, que reconstrói a lista com `replaceChildren` (zera a rolagem) e dava
  `scrollIntoView`. Agora `selectPalette(i, scroll)` só troca `aria-selected`; a lista é reconstruída só
  ao abrir e ao digitar, e o `scrollIntoView` fica para o teclado.
- Configurações em quatro seções recolhíveis (`<details class="group">`): Conexão, Aparência e avisos,
  Memória e contexto, Entrada rápida. Acordeão: abrir uma recolhe as outras; nada é lembrado:
  toda vez que as Configurações abrem, as quatro começam recolhidas.

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
  três controles curtos: ⇅ sincronizar ssh, "abrir" (= abrir direto, sem a abertura animada) e
  "feito" (= onboarding feito). Os títulos (tooltip) explicam.
- Onboarding: "pular" virou texto pequeno em cinza (não se clica por reflexo); pular mostra o cartão
  "Onboarding pulado" por 4,5 s com o caminho para refazer (`SKIPPED_MESSAGE`). A lista de conversas
  entra deslizando com um brilho azul (`.sidebar.reveal`), para quem aperta Cmd+B olhando o teclado.

## Provedores com fallback e o modelo grok-4 (15 out 2026)

- `providers.json` ao lado do backend: lista ordenada `{ name, type: claude|openai, priority, … }`.
  Padrão: `agente` (claude, 0) → `grok-4` (openai, 1). Entrada openai tem `base_url`, `model`,
  `key_env`/`key`; sem chave só fica disponível com endpoint local (127.0.0.1), que é o caso do
  `hermes proxy start --provider xai` da grokbot-1 (porta 8645, aceita qualquer bearer e usa o OAuth da
  xAI). Em outras máquinas, `XAI_API_KEY` no `.env` liga o grok-4 direto na api.x.ai.
- Módulo `providers.js` (cópia idêntica em `backend-colima/` e `backend-vm/services/`): `load`,
  `chain(requested)` = pedido primeiro + outros disponíveis por prioridade, `openaiCompletion` (SSE),
  `fallbackChunk`. Testes em `scripts/tests/providers.test.mjs` (mock HTTP incluso).
- Regra do fallback: só se o provedor pedido falhar ANTES de produzir texto; já saiu delta, o erro é
  definitivo. O cliente recebe um chunk com `x_meu_bot.fallback {from,to,reason}` (delta vazio) e o
  cabeçalho `X-Provider`. Modelo fora do providers.json (rene, rene-dm, claudecode) roda como sempre.
- Backend genérico (`server.js`): `attempts = chain(model)`, laço de tentativas, `used` vira o model dos
  chunks. Backend do Hermes (`openai-compat.js`): `_serveOpenai` atende grok-4 direto; `_streamLive` com
  `ctx.canFallback` devolve o erro ao chamador em vez de responder 503, e aí `_nextOpenai(reqModel)`
  decide. `/v1/models` dos dois listam os openai disponíveis.
- App: `BackendModel` ganhou `grok-4` (seletor "grok-4 · xAI", paleta, Configurações; 120 s de timeout).
  `backend.ts` lê `x_meu_bot.fallback` e manda `chat:notice` (aviso amarelo na conversa) +
  `backend:status degraded`. É o "aviso de fallback" que tinha sido apagado, de volta.
- Deploy na grokbot-1: `backend-vm/deploy-agente.sh` leva `openai-compat.js` + `providers.js` e cria
  `providers.json` (proxy local) só se faltar. Verificado: `/v1/models` com os seis modelos, grok-4
  respondeu em 2,4 s.

### Incidente: o instalador genérico sobrescreveu o server.js do Hermes
- `install.sh` copia para `~/.hermes/agente-rene/backend-sdk-claude`, que na grokbot-1 é o backend
  ORIGINAL do Hermes (git em `~/.hermes/agente-rene`). Em 14 out 17:00 o `server.js` do Hermes foi
  substituído pelo genérico. O processo vivo continuou com o código antigo em memória; só o restart do
  deploy de 15 out 01:18 subiu o genérico, e por 3 minutos a porta 8080 não conhecia `rene-dm` (WhatsApp).
  Restaurado com `git checkout -- server.js` + `rm session-map.js` (cópia do genérico em `/tmp`).
- Trava nova no `install.sh`: se `$DEST/app.js` ou `$DEST/services/` existir, recusa (exit 3) e aponta
  para o `deploy-agente.sh`. Não existe backup automático do `server.js` do Hermes fora do git: não
  rodar o instalador genérico na grokbot-1.
- Outra regra da grokbot-1: `hermes gateway restart` na mão deixa um gateway solto fora do PM2 e o PM2
  entra em loop (17 mil reinícios em 2,5 h). Sempre `pm2 restart hermes-gateway`.
- Pill do túnel mostra quem respondeu de fato (`X-Provider` do backend): "túnel ativo · agente ·
  respondeu grok-4", em amarelo quando difere do pedido. Lição do diálogo na grokbot-1 (15 out): a prova
  do modelo é o log/cabeçalho, nunca o nome que o modelo dá a si mesmo.
- Troca de modelo no meio da conversa: `setConversationModel` guarda `pendingSwitch {from,to}`
  (transitório) e o próximo turno manda a mensagem do usuário com `note` (campo de `BackendMessage`,
  persistido mas nunca exibido; `toWire` concatena antes do conteúdo). A nota diz ao modelo novo que as
  respostas anteriores foram de outro modelo. Motivo: no teste do usuário o grok-4 disse "na mensagem
  anterior eu respondi errado" sobre uma resposta que era do Claude.

## Status line e seção Fallback (15 out 2026)

- Rodapé da conversa (`#ctx-line`) virou a status line no modelo do `statusline.sh` da box:
  `agente | Ctx: 13% · 3.2k/24.0k | 6.3 s · 258 tok · 41 t/s | m6@… (Premium) | Sessão: 37% · 1h35m |
  Semanal: 37% · 5d0h | há 12 min`. Cores: modelo amarelo, Ctx/Sessão ciano, conta verde, Semanal
  magenta. Conta e limites só aparecem em modelos do Claude (não no grok-4). Puro em
  `lib/status-line.ts` (`buildSegments`, `timeUntil`, `fmtK`, `thresholdToWarn`), testado.
- Dados: `GET /v1/meu-bot/status` nos dois backends (`account-status.js`, cópia idêntica) lê
  `~/.cache/claude-statusline/{profile,ratelimits}.json`, que o statusline.sh do Claude Code interativo
  mantém na máquina; `updated` vira "há N min". O app busca no boot (`backend:account`) e depois de
  cada turno (`chat:account`). Tokens de contexto: `chat:context.tokens/budget` (estimativa do que foi
  enviado); turno: `chat:done.ms/usage` (usage vem do chunk final do SSE).
- Aviso de sessão: ao cruzar 80, 90 e 95% da sessão de 5 h, um aviso amarelo na conversa ativa
  ("Sessão do Claude em 92% … renova em 1h35m"), uma vez por limiar; zera quando a sessão renova.
  Mesma regra do alerta do Hermes no WhatsApp da box, adaptada ao painel.
- Configurações › Fallback: seletor "Primário nesta máquina" (Claude = agente, xAI = grok-4) que é só
  uma cara amigável do "Modelo padrão nesta máquina" (os dois ficam sincronizados), mais a linha da
  reserva calculada da corrente do backend (`providers` do status). O primário gasta o orçamento da
  conta dele; a reserva não consome nada até ser acionada.
- Na grokbot-1 o endpoint foi implantado e devolve a conta Premium e 37%/37% (cache de 01:14). No Mac
  (`local`) só há `profile.json`: o statusline do Mac é o da biblioteca gerenciada e não grava limites.

## Grok Bot: Atualizar vs Redefinir, deep link e verificação do Tailscale SSH (15 out 2026)

- `grokbot://app/v1/settings?id=<id>` (esquemas `grokbot` e `sand` no Info.plist do app) abre as
  Configurações do Grok Bot no card pedido; `reset-computer` e `update-computer` estão na seção
  "computer". É navegação: o card "Redefinir" tem o botão vermelho, e só o clique lá redefine.
  Lido do `app.asar` (lista de ids, rota `/v1/settings`, estado `resetComputer`/`recoverComputer`).
- "Atualizar o computador do Bot" = troca a base, "arquivos e logins ficam, aplicativos e pacotes
  instalados são removidos". Não é socorro. Testado em 15 out 02:20: tudo nosso sobreviveu (home
  inteira: Node em ~/.local, PM2 com 16 processos, backend 8080, proxy xAI, gateway, alivio-pod.sh).
  "Redefinir" = "comece do zero se travar", reconstrói do último snapshot; é o socorro para pod congelado.
- App: janela de alívio, quando o ssh não entra, faz contagem de 6 s e abre o Grok Bot no card Reset
  (`src/main/grokbot.ts`, `shell.openExternal`); "Abrir agora" antecipa, Fechar cancela. Seletor: pod
  inacessível ganha o botão "Abrir o reset no app do Grok Bot".
- Pegadinha nova: depois da atualização o Tailscale SSH passou a exigir "check" (aprovação de um link
  `https://login.tailscale.com/a/…` no navegador). Sintoma: `Connection … port 22 timed out` com
  `# Tailscale SSH requires an additional check` no stderr. O link só vale para a sessão ssh que o
  pediu. O app agora detecta (`tailscaleCheckUrl`), e: no seletor mostra "Aprovar verificação do
  Tailscale" (ssh paciente de 4 min + link no navegador + re-sonda); na janela de alívio abre o link e
  espera até 5 min, sem contagem para o reset. O usuário notou: "não era reset, só faltava logar".
