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
