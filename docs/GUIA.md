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
  três controles curtos: ⇅ sincronizar ssh e dois interruptores (15 out, mesmo `.switch` da lista):
  "Intro" (ligado = abertura animada; grava `openDirect` invertido) e "Onboarding" (ligado = guia na
  próxima janela; grava `onboarding` pending/done invertido). Ligado = tem. O `label.switch` precisa de
  `-webkit-app-region: no-drag`: o seletor inteiro é região de arrasto e o clique no rótulo virava arrasto.
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

## Instalar status line pelo seletor (15 out 2026)

- A status line do app só tem Sessão/Semanal se a máquina grava `~/.cache/claude-statusline/ratelimits.json`.
  O `statusline.sh` do `claude-statusline` (Diego) lê esses limites do stdin que o Claude Code manda
  (`rate_limits.five_hour/seven_day`), mas só persistia `profile.json`; o semanal nem era lido. Sem o arquivo,
  `account-status.js` devolve null e o rodapé fica só com modelo, Ctx e conta.
- `backend-colima/statusline.sh` é aquele script com um bloco a mais que grava `ratelimits.json`
  (`session_pct`, `session_resets`, `weekly_pct`, `weekly_resets`, `updated`), só quando há dado. O semanal vai
  para o cache mesmo sem aparecer na barra do terminal; quem o mostra é o painel. Testado em
  `scripts/tests/statusline-cache.test.mjs` (HOME descartável, `security`/`curl` neutralizados no PATH).
- `backend-colima/install-statusline.sh` copia para `~/.claude/statusline.sh`, injeta `statusLine` no
  `~/.claude/settings.json` preservando o resto (backup `.antes-do-meu-bot`, uma vez) e prova que o script roda.
  Idempotente. Se a máquina tem settings gerenciadas com `statusLine`, sai com 3 e explica: elas ganham do
  settings.json, e instalar ali não teria efeito — é o caso deste Mac (`/Library/Application Support/ClaudeCode`),
  que se atualiza pela skill `global-statusline`, não pelo app.
- Sondagem: `statusline=1` quando `~/.claude/statusline.sh` contém `ratelimits.json` (no `local`, se há
  gerenciada, é o script dela que conta). `probe-text.ts` mantém a máquina em ✓ e abrível, só acrescenta
  "sem status line do Claude" e troca o botão para "Instalar status line" (`install: "statusline"`); o mesmo
  `install()` do seletor atende os dois, pelo canal `picker:install-statusline`, com o log de progresso de sempre.

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

## Tailscale SSH: de check para accept pela API, dentro do app (15 out 2026)

- Problema: o "check" do Tailscale SSH pede aprovação de um link no navegador a cada 12 h e depois
  de troca de chave do nó (ex.: "Atualizar o computador" do Grok Bot). O app já abria o link; agora
  resolve de vez editando a política do tailnet: `"ssh"[].action: "check" → "accept"`.
- Módulos (main): `tailscale-policy.ts` (puro: tokenizer + parser mínimo de HuJSON com spans;
  `applySshAction(text, "accept"|"check")` edita por índice, preserva comentários e formatação,
  remove `checkPeriod` ao ir para accept, insere a regra padrão se não há bloco ssh; `stripHujson`
  para os testes), `tailscale-api.ts` (node:https, `baseUrl` injetável: `oauthToken`, `getPolicy`
  com `Accept: application/hujson` + ETag, `validatePolicy`, `setPolicy` com `If-Match`; erros
  tipados auth/conflict/invalid/network/timeout em pt-BR), `secrets.ts` (OAuth client cifrado pelo
  `safeStorage` em `userData/tailscale-oauth.bin`, 0600; renderer só vê `{configured,
  encryptionAvailable}`), `tailscale.ts` (`disableSshCheck`: credencial → token → GET → backup em
  `userData/tailscale-policy-backups/` (10 últimos) → edição → validate → POST If-Match;
  `restoreLastPolicy` desfaz).
- Seletor: com verificação detectada, botão "Desligar a verificação de vez". Sem credencial, abre o
  formulário inline (Client ID + secret, link para Settings › Keys); com credencial, roda e re-sonda
  após 8 s (o tailscaled recarrega e a porta 22 recusa por segundos). Option+clique no botão mostra
  "Esquecer credencial". Enter/setas não vazam do formulário para a lista. Paleta: "Tailscale:
  desligar verificação do SSH" e "…restaurar política do último backup" (guarda `hostFromEvent`).
- Escopo mínimo do OAuth client: Policy File leitura+escrita (`policy_file`). Docs verificados em
  15 out: token `POST /api/v2/oauth/token` (form), `-` = tailnet da credencial, 412 em `If-Match`
  errado, validate não salva, `checkPeriod` 1 min a 168 h, padrão 12 h.
- Testes: `tailscale-policy.test.mjs` (política real do usuário como fixture, iscas em comentários e
  grants, várias regras, inserção) e `tailscale-api.test.mjs` (servidor falso: token, ETag, 412, 400).

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

## Entrar no Claude Code pelo app (15 out 2026)

- `claude auth login` (CLI 2.1.300) sem terminal imprime o link `https://claude.com/cai/oauth/authorize?…`
  e espera o código no stdin ("Paste code here if prompted >"). `src/main/claudeLogin.ts` roda isso por
  ssh (ou local), abre o link no navegador do Mac, recebe o código pelo modal (`#cl-dialog`) e
  escreve no stdin; no fim confere com `claude auth status` (JSON `loggedIn`). Timeout 10 min.
- Entradas: botão "Entrar no Claude Code" na notice de erro/fallback que mencione login/deslogado
  (`offerClaudeLogin`), ação na paleta, e no seletor (abre a janela da máquina já no modal, via
  `ui:claude-login`). Sondagem: backend no ar + Claude deslogado agora é amarelo com o botão
  (antes ficava verde). `probe-text` ganhou o campo `login`.
- Backend do Hermes: pedido direto a `grok-4` passa antes do corte do authDown, e em authDown um
  modelo com reserva (agente → grok-4) cai para ela com aviso em vez de 503. `rene-dm` segue 503
  (fora da corrente), que é o que o Hermes do WhatsApp espera.
- Pegadinha mantida: o login reescreve `settings.json`/`.bashrc` na máquina; o backend não depende
  disso (bypass vai por flag).
- Lista de conversas ganhou três linhas de conta no topo: WhatsApp do Hermes, Claude Code
  (`claudeAuthInfo`: `claude auth status` + e-mail do `~/.claude.json`; "sair" = `claude auth logout`
  e já abre o login) e xAI (Grok) (`src/main/xaiLogin.ts`: `hermes auth status/list/add/logout
  xai-oauth`; o login abre o link de código de dispositivo e espera a aprovação; ao concluir remove
  as credenciais antigas do provedor, porque uma vencida na frente derruba o proxy com invalid_grant).
  Modais: um botão só (Cancelar enquanto roda, Fechar depois), "Começar" some ao concluir e vira
  "Tentar de novo" se falhar; fecham sozinhos no sucesso.
- Pegadinha: `hermes auth add xai-oauth --type oauth --no-browser` sem pseudo-terminal não imprime
  nada e fica parado (o CLI exige tty); o app usa `ssh -tt` com stdin aberto e limpa ANSI/CR da saída.
  Já `claude auth login`, `hermes auth status/list/logout` funcionam sem tty.
- Interface "clean" (15 out, madrugada): ☰ na ponta esquerda da barra; "arquivadas" virou interruptor
  no rodapé da lista; barra superior recolhível (Cmd+Shift+B, botão ⌃/⌄, paleta) com faixa fina
  mostrando máquina · modelo · estado do túnel. Lista e barra começam recolhidas por padrão
  (`localStorage.sidebarShown` / `topbarShown`).

## Grok (xAI) em máquinas sem Hermes (16 out 2026)

- O login por conta da xAI (OAuth) é do Hermes: `hermes auth add xai-oauth --type oauth --no-browser` (link
  de código de dispositivo) e `hermes proxy start --provider xai` (127.0.0.1:8645, aceita qualquer bearer e
  usa o OAuth). Era assim no grokbot. Em colima/agente-box não havia Hermes, então a linha "xAI (Grok)" não
  aparecia e o grok-4 não existia no modo nem no fallback.
- `backend-colima/install-grok-oauth.sh` (idempotente) reproduz o arranjo em qualquer máquina com o backend
  do meu-bot: instala `hermes-agent@0.22.2` (npm, `--prefix ~/.local`, com o node do backend), grava
  `providers.json` com o grok-4 em `http://127.0.0.1:8645/v1` (endpoint local dispensa chave; um
  providers.json alheio vai para `.antes-do-grok-oauth`), cria `hermes-xai-proxy.service` (systemd --user,
  `RestartSec=15`: antes do login o proxy sai com "Not logged in" e volta sozinho depois), liga linger e
  reinicia o backend. Exige `providers.js` no backend: um backend antigo (caso da colima, 16 out) não tem
  fallback nem grok-4, e "Reinstalar backend" no seletor resolve.
- App: a linha "xAI (Grok)" aparece também sem Hermes quando há backend (`xaiKeyStatus`); "entrar" roda o
  instalador pela janela (`xai-login:prepare`, progresso no diálogo) e emenda no login OAuth de sempre
  (`xaiLogin.ts`). A opção de chave de API foi retirada a pedido do usuário (só OAuth); `src/main/xaiKey.ts`
  ficou só com a checagem "há backend?" que decide se a linha aparece. `install-statusline.sh` instala o
  `jq` sozinho quando há `sudo` sem senha (caso da colima).
- Depois do login, o backend lista o grok-4 e ele entra no modo e em Configurações › Fallback. Verificado na
  colima (16 out): login OAuth concluído pelo app; o proxy aceita o id `grok-4` (responde com `grok-4.3`; lista
  também 4.5/4.6/4.7 e os de imagem) e o backend respondeu `X-Provider: grok-4`. O `hermes` precisa do node no
  PATH do ssh sem login (`~/.local/node/bin` do backend, `/opt/node/bin`): `REMOTE_PATH` do `xaiLogin.ts`.
- Tutorial 5 · Fallback: Claude e Grok (17 out; antes "Em breve"): três passos. (1) "As duas contas nesta máquina":
  conclui com `claude.loggedIn && xai.loggedIn` no `GuideContext`. (2) "Escolher primário e reserva" (corpo
  `fallback-order`, `renderFallbackOrder`): o estado das duas contas, o mesmo seletor de Configurações › Fallback
  (Claude = agente, xAI = grok-4), salvo na hora com `setSettings({ backendModelForHost })`, a linha da corrente
  (`fallbackOrderText`, pura em `lib/tutoriais.ts`, agora usada também pelas Configurações) e "Manter assim" quando o
  primário já está na corrente; conclui com a flag `fallbackChosen` (também gravada ao escolher nas Configurações) e
  o primário em `FALLBACK_PRIMARIES`. (3) "Ver a reserva assumir": a flag `fallbackSeen` é gravada sozinha quando um
  `chat:done` traz `fallback` (a reserva respondeu de verdade) ou pelo botão "Entendi como funciona". `needsXai`
  (some onde o Grok não é possível) e `after: "xai-login"`; "Refazer do zero" só esquece as duas flags.

## Suporte: meu-bot-admin (16 out 2026)

Para dar suporte a 2–3 pessoas sem servidor. Um projeto, dois apps: o **meu-bot** (de cada pessoa) e o
**meu-bot-admin** (só no Mac do admin; ícone âmbar com escudo). Cada pessoa tem a própria máquina do agente.

- Variante: `scripts/package.mjs --admin` (nome, bundle id `local.meu-bot-admin`, ícone, `variant.json` em
  Resources) e `scripts/fuses.mjs --admin` (instala
  `~/Applications/meu-bot-admin.app` + atalho na mesa). `src/main/variant-core.ts` decide (puro, testado:
  `resolveVariant`, `capsFor`) e `src/main/variant.ts` só lê o arquivo (`appVariant`, `caps`, `isAdmin`,
  `appTitle`; dev: `MEU_BOT_VARIANT=admin`). Ver "Mapa de variantes" abaixo. Ícones: `npm run icons`
  (`scripts/icon.mjs`: qlmanage → sips → iconutil).
- Preparo, uma vez: `node scripts/suporte-setup.mjs [--caixa agente-box] [--nome Lucas]`. Cria
  `~/.ssh/meu-bot-admin` (a chave do suporte), `build/suporte/entrega` (chave SÓ de entrega, gitignored),
  instala a caixa de entrada na máquina do admin (`backend-colima/meu-bot-suporte-inbox` em
  `~/.local/bin`) com `restrict,command="…inbox" <entrega> meu-bot-entrega` no authorized_keys de lá, e
  grava `build/suporte/suporte.json` + `known_hosts`. Testado: com a chave de entrega, pedir comando é
  ignorado (roda a caixa), túnel dá "administratively prohibited", terminal é recusado.
- Pacotes: `npm run dmg -- --suporte` (pessoas: pública do admin, chave de entrega e a chave do servidor da
  caixa; nenhuma máquina do admin) e `npm run dmg:admin` (admin; leva só o `suporte.json` público).
- Código de suporte (`src/main/support-code.ts`, testado): `MBS1.<base64url(JSON)>` com nome, endereço
  (`ssh -G` do Mac da pessoa), usuário, porta, chave pública do servidor dela, estado on/off, data e (desde
  16 out) `machine`, o apelido que ela usa para a máquina no `~/.ssh/config` dela ("colima"; opcional, código
  antigo vale). Sem segredo. Alias no admin: `suporte-<nome>-<4 hex do hash da chave do servidor>`; a página
  Suporte e o seletor de pessoas mostram o `machine` em vez do alias.
- Pessoa (`src/main/client/support.ts`; só no tutorial "Ligar o suporte", vale na hora): ligar = nome + chave do admin no
  authorized_keys (`no-agent-forwarding,no-X11-forwarding … meu-bot-admin`) + entregador na máquina dela
  (`~/.local/share/meu-bot/suporte/`, timer systemd --user de 30 min ou cron) que manda o código para a
  caixa por SSH (máquina com máquina; se a máquina não sai, o Mac entrega). Desligar = tira a chave, entrega
  "off", remove timer e arquivos. "Copiar código de suporte" é o plano B. Tudo vai para
  `~/.local/share/meu-bot/suporte.log`, mostrado como "O que o suporte fez nesta máquina".
- Admin (`src/main/admin/support-admin.ts`): o seletor lê a caixa (`~/suporte-inbox/<id>.code`; o id tem de bater
  com a chave do servidor do código) e lista as pessoas com "visto há"; "Adicionar pessoa" cola o código.
  As pessoas viram `~/.ssh/meu-bot-suporte.conf` (gerado; `Include` no topo do `~/.ssh/config`, backup em
  `config.antes-do-meu-bot-admin`) com `IdentityFile ~/.ssh/meu-bot-admin` e known_hosts próprio
  (`StrictHostKeyChecking yes`). Janela da pessoa: página "Suporte" (saúde = sondagem + WhatsApp; ações com
  confirmação de 2 cliques: reiniciar gateway, reiniciar backend, ativar transcrição; registros do
  journalctl) e o espelho do WhatsApp na lateral (menu "…" só Exportar/Arquivar). Sem compositor, sem túnel;
  o build admin nem registra os canais de cliente (`src/main/ipc/client.ts`: chat, pareamento, política,
  logins, instalar, suporte lado da pessoa), só stubs que recusam ("o meu-bot-admin só lê; use as ações de
  suporte"); ver `src/main/ipc-policy.ts` e o teste `ipc-policy`.
- Máquina de endereço local (VM do Colima: `127.0.0.1:<porta>`) pode ligar o suporte: só um admin no mesmo
  Mac a alcança, e o admin mostra "só alcançável deste Mac" (`SupportPerson.local`). Serve para testar o
  admin sem outra máquina. Limite geral: o aviso periódico reenvia o código gerado ao ligar; se o endereço
  da máquina mudar (porta do Colima após reiniciar, IP novo), é preciso desligar e ligar de novo.
- Progresso nos tutoriais: com o suporte ligado, o meu-bot da pessoa grava `~/.local/share/meu-bot/
  progresso.json` (tour feito/pulado, cada tutorial com passos feitos, total e onde parou; validado por
  `parseSupportProgress`) 3 s depois de cada mudança do guia, só quando algo mudou. O admin mostra o quadro
  "Progresso nos tutoriais" (✓ concluído, "3 de 5 · parou em …"). Desligar o suporte apaga o arquivo.
- Código de suporte na tela da pessoa: "Mostrar código de suporte" revela o código numa caixa selecionável
  com Copiar (plano B da entrega automática). Registros no admin: recolhidos por padrão; só leem o journal
  quando abertos.
- Tutorial "Ligar o suporte" (3 passos, depois do WhatsApp; `requires: "support"`, só aparece com o pacote
  de suporte, em máquina por SSH e fora do admin): dizer o nome → permitir → "O que o admin recebe". Os
  passos leem o estado real pelo `GuideContext` (`guideView(t, status, flags, ctx)`, `visibleTutorials`). No
  app da pessoa nunca aparece o nome de quem dá o suporte: os textos dizem "o admin" (pedido do usuário), e o
  registro da máquina anota as ações como "admin". Conclui sozinho: o `entregar.sh` grava
  `~/.local/share/meu-bot/suporte/ultima-entrega` quando a entrega na caixa dá certo (a entrega pelo Mac
  também grava) e `supportInfo` devolve `deliveredAt`. Enquanto o aviso não chega, a tela confere a cada
  10 s e oferece "Tentar de novo" (`support:deliver`); o código visível fica recolhido em "Não chegou?
  Mostrar código de suporte". As peças (nome, interruptor, escolha, aviso/código, registro) estão em
  `renderSupportParts`; o modal de Configurações não tem mais seção Suporte (16 out: o tutorial é o único
  lugar). O progresso dele vai para o admin como os outros.
- Tutorial do suporte, ajustes de 16 out (pedidos do usuário): o nome fica sempre editável (ligado, "Salvar
  nome" regrava o aviso com o nome novo); o interruptor "Permitir o acesso do admin" já vem marcado
  (`supportWantOn`) e "Salvar nome" liga o suporte no mesmo clique (ainda é a pessoa quem confirma; desmarcar
  antes salva só o nome); o passo "O que o admin recebe" tem a escolha do que o app do admin pode ver
  (`SupportShare`: progresso nos tutoriais, WhatsApp, registros; `support:share` grava
  `~/.local/share/meu-bot/compartilha.json` na máquina dela, fora da pasta do suporte para sobreviver a
  desligar/ligar; tirar o progresso apaga o `progresso.json`) e mostra o registro "O que o suporte fez nesta
  máquina". O app do admin respeita a escolha (`adminHealth` devolve `share` e nem consulta o WhatsApp/
  progresso não compartilhados; `adminLogs` recusa; a lateral do admin só mostra o WhatsApp se a saúde o
  trouxer). Limite dito na tela: enquanto o suporte está ligado, o admin ainda entra por SSH; desligar o
  interruptor corta tudo.
- CRUD do admin sobre o que está na máquina dela (16 out): no espelho do WhatsApp o menu "…" do admin ganha
  "Pausar o agente para esta pessoa"/"Retomar" (`whatsapp:pause` comum, registrado no admin; a nota na conversa
  diz "pelo suporte") e
  "Limpar histórico…" (mesma confirmação inline do cliente; `whatsapp:clear-plan`/`whatsapp:clear` viram
  canais comuns e, no admin, a limpeza entra no registro que ela vê: "admin limpou o histórico do WhatsApp de
  <número>"). No espelho das conversas com o meu-bot, "Apagar esta conversa" (dois cliques; `admin:bot-delete`
  apaga o .jsonl da sessão na máquina e registra "apagou uma conversa dela com o meu-bot"; o backend abre
  outra sessão no próximo turno). Para a pessoa, o meu-bot já tinha "Limpar histórico" e "Excluir conversa".
- Excluir conversa apaga também na máquina (16 out): `chat:delete` chama `DELETE /v1/meu-bot/session?conv=<id>`
  no backend da máquina (`deleteBackendSession`, pelo túnel), que apaga o .jsonl da sessão do Claude Code nos
  dois perfis e esquece o mapa; o admin deixa de ver a conversa. Backend antigo (sem a rota) é ignorado:
  atualizar com `scp backend-colima/* <host>:~/backend-colima/ && ssh <host> bash ~/backend-colima/install.sh`
  (ou "Instalar backend" no seletor).
- Renomear pessoa no admin (16 out): "Renomear" no seletor, com pessoa selecionada, guarda um apelido do admin
  (`nickname` em pessoas.json, `picker:support-rename`) que vence o nome do código na lista, no título da
  janela e na página Suporte; vazio volta ao nome dela. O alias SSH não muda (ele vem do nome do código).
- Identidade por conta na máquina (16 out): `machineId` passou a ser hash de chave do servidor + usuário + porta
  (antes só a chave: duas contas na mesma VM, root e box, se sobrescreviam na caixa, no pessoas.json e no
  alias). O admin aceita avisos com o id antigo (`legacyMachineId`) e guarda sob o novo; o `pessoas.json`
  antigo é re-chaveado ao carregar; o meu-bot da pessoa vê pelo `SupportInfo.staleId` que o código gravado na
  máquina é antigo e regrava sozinho (liga de novo). Aliases mudam de sufixo uma vez.
- Escolha do que o admin vê, oculta por ora (16 out, pedido do usuário: poluía): `SHOW_SUPPORT_SHARE = false` no
  renderer; o código e o `support:share` ficam, tudo compartilhado por padrão.
- Suporte ligado por padrão e seção nas Configurações (16 out): numa janela de máquina por SSH com o pacote, o
  app liga o suporte sozinho na primeira consulta (`refreshSupportState`, uma vez por janela, com o nome
  guardado ou o sugerido), a não ser que o admin tenha desligado: "Desligar o suporte desta pessoa" deixa
  `~/.local/share/meu-bot/suporte-desligado-pelo-admin` na máquina (`SupportInfo.blockedByAdmin`), e aí a
  pessoa vê "Desligado pelo admin" e só religa clicando em "Ligar o suporte" (ligar apaga a marca). A seção
  "Suporte" voltou às Configurações com: nome (Salvar nome / Ligar o suporte), "Avisar o admin agora" (entrega
  forçada, `support:deliver`, sempre visível), "Mostrar código de suporte" (copiar e mandar à mão), o que o
  admin vê e o registro. O tutorial "Ligar o suporte" continua, concluindo sozinho.
- Só o admin desliga (16 out, pedido do usuário): o interruptor "Permitir o acesso do admin" saiu do tutorial da
  pessoa; "Salvar nome" liga o suporte (o passo "Dizer seu nome" conclui com o nome gravado e o suporte ligado) e
  não há como ela desligar pelo app (nem "Refazer do zero" nesse tutorial). Quem desliga é o admin, pela ação
  "Desligar o suporte desta pessoa" (`AdminAction "support-off"`, `turnSupportOff`): roda na máquina dela o
  mesmo script do antigo desligar (tira a chave, entrega "off" na caixa, apaga timer e pasta;
  `removeDeliverySh` agora é puro em support-code.ts), marca a pessoa "off" e a tira do conf. Caso de uso:
  deixou de pagar. Ela volta se salvar o nome de novo; aí o admin arquiva ou desliga outra vez.
- Login da xAI como passo a passo (16 out): `src/renderer/lib/login-steps.ts` (puro, testado com a sequência
  real) transforma os eventos url/log/done em quatro passos com estado (conectar, pedir, aprovar no navegador,
  guardar a credencial), código do dispositivo em destaque com Copiar, e o que sobrar em "detalhes técnicos"
  recolhido; o main já não repassa "Connection to … closed". O mesmo componente está pronto para o login do
  Claude (passos conectar, link, código, conferir), a ligar quando o bloco de login do tutorial estabilizar.
- xAI na saúde do admin (16 out): `AdminHealth.xai` (via `xaiAuthInfo`): "xAI (Grok) logada (e-mail)",
  "deslogada: o grok-4 não responde" ou "sem Hermes nesta máquina".
- Versão e atividade dela no admin (16 out): o progresso que o meu-bot dela grava leva `app: { version,
  openedAt }` (versão do app e quando a sessão abriu; `WindowInfo.version`). A saúde mostra "meu-bot X no Mac
  dela · aberto há N" e acusa em vermelho quando está atrás da versão do admin (`compareVersions`): ela ainda
  não abriu o app com internet, então não atualizou. Depende de ela compartilhar o progresso. Saiu em 26 out: o
  progresso só é gravado com o suporte ligado do lado dela e envelhecia (agente-box-lv mostrava 0.1.0 de 21/10 com
  0.3.0 aberto); versão e "visto há" de cada app ficam só nos devices da licença, que cada app atualiza ao abrir.
  `parseSupportProgress` ignora o `app` de arquivo antigo.
- Transcrição de áudio por padrão (16 out): o app não instala o OpenClaw (a pessoa instala; o app só pareia),
  então o gancho é o pareamento: concluído numa máquina com OpenClaw sem transcritor, `ensureTranscription`
  (`ipc/client.ts`) roda `install-transcricao.sh` em seguida, contando os passos no mesmo fluxo do QR
  (baixa ~500 MB uma vez). `install-transcricao.sh off` desliga (`AudioSetup { kind: "in", off: true }`). No
  admin a ação é Ativar ou Desativar conforme `audioIn`, e some com uma nota quando a máquina não tem OpenClaw
  (`transcriptionNote`): era o caso de "esta máquina não tem OpenClaw: a transcrição é para o agente do
  WhatsApp dele", que aparecia porque a máquina ainda não tinha o OpenClaw.
- Conversas dela com o meu-bot no admin (16 out): além do WhatsApp, a lateral do admin tem o modo "meu-bot" com as
  conversas da pessoa, só leitura, para ver onde ela trava. Não vêm do Mac dela: o backend roda cada turno pelo
  Claude Code com `--resume`, e a transcrição fica em `~/.claude/projects/<cwd>/<sessão>.jsonl` na máquina
  (pastas `*chat-workspace` e `*agent-workspace`). `admin:bot-chats` lista as sessões (uma linha por arquivo:
  id, mtime, pasta, nº de respostas, 1ª linha `user`) e `admin:bot-thread` lê uma (só as linhas
  `user`/`assistant`, 30 KB cada; o arquivo tem muito ruído: pedidos à API, anexos, filas). Parser puro em
  `src/main/bot-chats.ts` (o "User: " que o backend põe sai; `tool_use` vira uma linha "ferramenta"), testado
  com o formato real do colima. UI em `src/renderer/admin/bot-mirror.ts` (lista por data e página com as
  bolhas do WhatsApp, atualiza a cada 8 s aberta e a lista a cada 30 s). Entra em `SupportShare.chat`
  ("Minhas conversas com o meu-bot"), ligado por padrão. Limite: sessões sem `--resume` (fallback do backend)
  aparecem como conversas novas com a história repetida no primeiro turno.
- Arquivar pessoa no seletor do admin (16 out): "Arquivar" na pessoa selecionada tira da lista sem mexer no
  suporte dela (`archived` em pessoas.json, `picker:support-archive`); o interruptor "mostrar arquivadas"
  aparece quando há alguém arquivado. Mesmo modelo das conversas.
- "Excluir conversa" no menu "…" do WhatsApp (17 out, os dois apps; sem confirmação, a pedido): limpa o histórico na
  máquina (o mesmo `whatsapp:clear`, sem o aviso da sessão principal: zera ela junto) e marca a conversa como
  excluída na máquina. Como o `sessions.list` continua listando a sessão depois do reset, a conversa só volta se
  `updatedAt` ficar maior que a hora da exclusão, ou seja, se o contato mandar outra mensagem. Sem histórico na
  máquina, excluir só marca. No admin a limpeza e a exclusão ficam no registro da pessoa.
  Desde 20 out (pedido de Lucas), excluir **não** limpa mais: só marca como excluída. O agente continua de onde
  parou; zerar o contexto é só o "Limpar histórico".
  Exclusão lógica: no meu-bot-admin o interruptor "arquivadas e excluídas" mostra também as excluídas (chip
  "excluída"), com menu Exportar / Copiar ID / Restaurar (`restore` → marca `deleted: false`; vai para o registro
  da pessoa como "restaurou a conversa…"). A pessoa nunca vê as excluídas.
- Nome do contato em cache na máquina + "Renomear" (17 out): o pushname só vinha ao abrir a conversa (`threadFor` →
  `chatNames` em memória do main) e sumia ao fechar o app; agora `whatsapp-lista.json` guarda `names` por número
  (`name` = pushname em cache, `alias` = apelido do "Renomear", `at`). `whatsappChats` semeia `namesOf(host)` com o
  arquivo (a memória, mais fresca, vence) e `applyWaMarks` preenche `WhatsappChat.alias`; `whatsappThread` regrava o
  cache quando o pushname muda. Contatos sem nome: `whatsapp:names` (compartilhado, ≤ 20) → `whatsappLearnNames` lê
  o `chat.history` (limite 40) da sessão própria de cada um (sem ela, a principal) numa chamada só, tira o nome com
  `threadFor` e grava; a tela chama em segundo plano depois de cada lista, uma vez por contato por abertura
  (`waNamesTried`). "Renomear" no "…" (os dois apps): caixa inline abaixo do contato, `markWhatsapp([{number,
  alias}])` (vazio tira); o apelido vence na lateral e no título (`waChatTitle`), e o cabeçalho da conversa mostra o
  nome original ao lado do número; no admin entra no registro da pessoa ("renomeou a conversa … para «X»"); cache de
  nome não registra.
- Sensação de instantâneo (17 out): regra única "pinta o último estado conhecido, lê a máquina por baixo, troca sem
  piscar" (stale-while-revalidate), com `src/renderer/lib/cache.ts` (puro, testado: envelope `{at, v}` em
  `localStorage`, chave `cache:<host>:<nome>`, try/catch em tudo, `clearCache(host)`). Entram: lista do WhatsApp
  (`waChats`, antes da primeira leitura), cada conversa (`waThread:<número>`, últimas 200, dica "atualizando…" até a
  leitura real), estado do WhatsApp (`waStatus`: o modo WhatsApp aparece antes do SSH responder), e no admin a lista
  e as conversas dela com o meu-bot (`botChats`, `botThread:<sessão>`) e a saúde (`health`, rótulo "como estava há X
  min" quando passou de 90 s ou está consultando). Limpar/excluir/apagar conversa tira o cache dela. Nada que dispara
  ação é cacheado. Desde 26 out o envelope é `{at, b, v}`: `b` é o `WindowInfo.build` (versão + data do renderer.js)
  e só o mesmo build lê; o valor sai sem validação como o tipo do build que gravou, e a saúde gravada antes de
  `capacidades` derrubava a janela do admin antes de abrir a aba Suporte (e deixava o botão Suporte sem ação).
- Arquivado/excluído do WhatsApp sincronizados pela máquina (17 out): as marcações moram em
  `~/.local/share/meu-bot/whatsapp-lista.json` na VM (`{archived: {número: ISO}, deleted: {número: ISO da
  exclusão}}`), então o meu-bot da pessoa e o meu-bot-admin veem a mesma lista, como já acontece com a pausa (que
  mora no OpenClaw). Leitura: `whatsappChats` lê o arquivo na mesma chamada SSH do `sessions.list` e
  `applyWaMarks` (`src/main/whatsapp-marks.ts`, puro, testado) preenche `WhatsappChat.archived/deleted`
  (excluída = há marca e `updatedAt <= deletedAt`). Escrita: canal compartilhado `whatsapp:mark`
  (`{marks: [{number, archived?, deleted?, at?}]}`, até 200) → `whatsappSetMarks` roda `waMarkSh`: um python3 na
  máquina lê o arquivo atual (corrompido = `{}`), aplica só os ajustes e grava tmp+mv com 0600, então o admin e a
  pessoa não se sobrescrevem. A tela aplica otimista e, em erro, relê a lista e avisa. O outro app vê em até 20 s
  (ciclo de `refreshWaChats`). Migração: na primeira lista que carrega, o que o app guardava no localStorage
  (`waHidden:<host>` arquivadas, `waDeleted:<host>` excluídas) vai para a máquina com a hora de então (`at`) e as
  chaves locais somem; se falhar, ficam e tenta na próxima. No admin, um ajuste da tela fica no registro da pessoa
  ("arquivou/desarquivou/excluiu a conversa do WhatsApp de +55…"); a migração não registra. Sem python3 na VM, a
  marcação falha com aviso claro (o app já depende dele para ler o número próprio). Testado na agente-box: arquivo
  corrompido + ajuste, merge de dois ajustes, `at` respeitado.
- REA do Rambox: o que veio e o que ficou de fora (17 out). Analisado o Rambox 3.1.1 (`/Applications/Rambox.app`:
  fuses, main.js, canais IPC e strings pt-BR). Veio: (A) verificação de atualização visível, como lá: `UpdateState`
  ganhou `phase` (idle/checking/up-to-date/available/ready/error) e `checkedAt`, o `updater.ts` emite `update:state`
  em cada fase (primeira consulta aos 3 s; sem release no GitHub a fase é up-to-date), `update:check` é o "Verificar
  agora"; na tela, o ponto "verificando atualizações…" na barra de cima enquanto `checking` e o grupo "Sobre e
  atualização" nas Configurações (versão, frase da fase por `lib/update-text.ts`, Verificar agora, Notas de lançamento,
  Reiniciar e atualizar). (B) Notificação de teste ("Enviar uma notificação de teste" → "Você viu? Sim / Não, abrir
  Ajustes do Sistema", `ui:notify-test`), e a primeira notificação desta instalação disparada no momento certo
  (quando a pessoa marca "Testei, funcionou" no tutorial do WhatsApp, `maybeAskNotificationsOnce`): o macOS pede a
  permissão junto. Sem `node-mac-permissions`: para notificações não há API de estado, e o Rambox também usa o teste.
  (C) "Abrir ao entrar no Mac" (grupo Inicialização): `app.setLoginItemSettings` no `settings:set`, estado lido do
  sistema em `settings:get` (`openAtLogin`/`openAtLoginAvailable`, só empacotado). (D) Disco e memória da máquina na
  saúde do admin (`df -Pk $HOME`, `free -k` na sondagem → `HostProbe.disk*/mem*Mb`; `healthLines` avisa abaixo de
  2 GB de disco e 512 MB de memória). (E) Aviso de "Mac novo usou o meu-bot desta máquina", como o e-mail de login
  numa máquina nova do Rambox: o app se apresenta ao backend a cada abertura (`POST /v1/meu-bot/hello`, id =
  sha256(hostname+usuário)[:12], `announceMachine` em `backend.ts`, uma vez por máquina por abertura); o backend guarda
  `~/.local/share/meu-bot/maquinas.json`, e um Mac desconhecido (o primeiro de todos é a instalação, sem aviso) gera
  linha no `suporte.log` ("sistema|um Mac novo usou o meu-bot: nome (usuário, sistema)"), mensagem no WhatsApp da
  própria pessoa (`openclaw message send --channel whatsapp --target +<número dela>`) e e-mail opcional pela API do
  Resend (`RESEND_API_KEY` e `ALERT_EMAIL_FROM` no .env do backend). Preferências em `alertas.json`
  (`GET/PUT /v1/meu-bot/alerts`), editadas no grupo "Segurança" das Configurações (só no meu-bot, máquina por SSH).
  Ficou de fora: bandeja, hibernação, workspaces, telemetria/Firebase, licença e permissões de câmera/microfone/tela/
  localização/Bluetooth (sem uso; pedir assusta). Os fuses do Rambox (RunAsNode off, NodeOptions off, Inspect off,
  cookie encryption, ASAR integrity, OnlyLoadAppFromAsar) são idênticos aos nossos (`scripts/fuses.mjs`).
- Quem respondeu, sempre visível e rastreável (17 out): (A) `BackendMessage`/`ChatMessage` ganham `provider`
  (X-Provider do backend) e `fallback` (o aviso "agente falhou (…); respondendo com grok-4", antes só um aviso que
  sumia); `runBackendTurn` grava os dois na resposta, `chat:done` os leva à tela, e a bolha do assistente mostra o
  rótulo `.msg-provider` (`lib/provider-label.ts`, puro: "grok-4", ou "respondeu grok-4 (fallback de agente) ⚠" em
  cor de aviso, com o motivo no title); vale ao reabrir (restauração do disco) e no export .md ("Assistente
  (grok-4)"). (B) Conversas fora do Claude Code (Grok, Hermes) não tinham arquivo na máquina: o backend passa a
  gravar um diário `~/.local/share/meu-bot/conversas/<id da conversa>.jsonl` (uma linha JSON por mensagem
  `{at, role, model, provider, text}`, 0600) só quando o provedor usado não é um perfil Claude (o `.jsonl` do
  Claude Code segue sendo a transcrição deles, sem duplicar). `GET /v1/meu-bot/session` devolve `{profile: "app",
  file}` quando o diário existe (então "Copiar ID" traz caminho real) e `DELETE` o apaga junto. O admin lista as
  duas fontes no mesmo script (`adminBotChats`: linhas `F` do Claude e `A` do diário; `BotChat.source`
  `"claude"|"app"` e `provider`), lê (`parseAppTranscript`, puro, testado) e apaga por fonte; no espelho a conversa
  Grok leva a etiqueta do provedor na lista e na bolha ("grok-4 · 00:42"); `botReferenceText` aponta para o diário.
  (C) O modelo sabe quem é: `providers.openaiCompletion` antepõe ao system "Você responde dentro do meu-bot como o
  modelo grok-4, da xAI…", e os perfis Claude recebem o mesmo pelo `--append-system-prompt` ("pelo Claude Code,
  perfil agente"), inclusive no refazer sem resume. Backend reinstalado no colima e na agente-box (17 out); provado:
  turno grok-4 → diário com 2 linhas, GET traz o arquivo, DELETE apaga, resposta "Sou o modelo grok-4, da xAI."
- "Copiar ID" nos três pontinhos (17 out, os dois apps): uma linha para colar numa IA dizendo onde a
  conversa mora. Três formas (`src/renderer/lib/reference.ts`, puro, testado): espelho do meu-bot no admin →
  `meu-bot · <máquina> · ~/.claude/projects/<pasta>/<uuid>.jsonl` (botão "…" na linha via `ui:bot-menu`, canal
  admin, e botão no cabeçalho da conversa); aba do meu-bot → o mesmo caminho, vindo do backend
  (`GET /v1/meu-bot/session?conv=` em `backend-colima/server.js`, lista `{profile, sessionId, cwd, file}` do
  session-map), guardado em `StoredConversation.claude` ao fim de cada turno (`rememberClaudeSession` em
  `ipc/client.ts`) para valer depois do TTL de 6 h do mapa; sem sessão ainda (conversa nova, backend antigo ou
  sem túnel) o plano B é `meu-bot · <máquina> · conversa <id do app> (ainda sem transcrição…)`; WhatsApp →
  `whatsapp · <máquina> · +55… · <chave da sessão> · sessão <uuid>`, uma linha por sessão (a principal inclusive),
  porque a chave é estável e o UUID (`WhatsappChat.sessionIds`, do `sessions.list`) troca a cada "Limpar". A cópia
  é só do que a lista já tem (sem SSH); aviso "✓ ID copiado" por 1,5 s na lateral (`sidebar-notice`).
  Canais novos: `chat:reference` (cliente), `ui:bot-menu` (admin). Backend atualizado no colima em 17 out.
- Tutorial 7 · O que você quer resolver pelo WhatsApp? (17 out): deixou de ser "Em breve". Tudo mora na máquina, como a
  pausa: `~/.local/share/meu-bot/objetivo.json` (`{objective: {id, label, text}, level, savedAt}`) e uma skill de
  verdade em `<workspace do OpenClaw>/skills/objetivo-whatsapp/SKILL.md` (o OpenClaw a lista como
  `openclaw-workspace`, confirmado na agente-box). Passo 1 *Escolher o objetivo* (corpo `objective-choice`: cartões
  Atender clientes / Vender / Marcar horários / Dar suporte / Outro + frase; "Outro" exige a frase; "Salvar objetivo"
  → `objective:set`). Passo 2 *Dizer quanta liberdade* (`objective-level`: Só conversa / Consulta e organiza / Age
  por mim, grava no clique). Passo 3 *Salvar como skill no Acervo* (`objective-skill` → `objective:save`: escreve o
  SKILL.md com o objetivo e as regras do nível em português e aplica `tools.toolsBySender`: o dono conforme o nível
  (conversa = sem write/edit/exec/…, consulta = sem exec/process/cron/gateway, age = tudo) e `*` sempre sem as
  ferramentas que mudam a máquina; sem número pareado a trava fica para depois). Conclui quando `savedAt` existe e o
  SKILL.md está na máquina. "Refazer do zero" (`objective:reset`) apaga a skill e o objetivo.json e devolve a
  liberdade total ao dono. O Acervo passa a listar as skills do workspace da máquina (a do objetivo primeiro, com
  "Ajustar no tutorial 7") além da biblioteca estática; o contador da lateral soma as duas. Puro e testado em
  `src/main/objetivo-core.ts`; SSH em `src/main/objetivo.ts`; opções da tela em `lib/tutoriais.ts`
  (`OBJECTIVE_OPTIONS`, `LEVEL_OPTIONS`); `GuideContext.objective`.
- Excluir máquina no seletor do admin (17 out): "Excluir máquina" (um clique, sem confirmação; é máquina, não pessoa: cada
  linha é uma VM) na pessoa selecionada faz tudo de uma
  vez: na máquina dela limpa todo o histórico do WhatsApp (todas as `sessionKeys` de `whatsappChats`, via
  `whatsappClearSessions`, o mesmo "Limpar histórico" de cada conversa) e desliga o suporte (mesmo script do
  `support-off`: tira a chave do admin, entrega "off", apaga timer/pasta, marca o bloqueio), e aqui ela sai de
  pessoas.json, do ~/.ssh/meu-bot-suporte.conf e do arquivo dela na caixa de entrada (senão a próxima leitura a
  traria de volta). A janela dela, se aberta, fecha. Máquina fora do ar: nada é limpo, ela fica na lista e o botão
  vira "Excluir máquina mesmo assim (só tira da lista)" por 10 s (`force`). `removePerson` em `admin/support-admin.ts`,
  `picker:support-remove`. Ela volta ao suporte só se salvar o nome de novo no tutorial (o bloqueio do admin
  impede o religar automático).
- "Renomear" (seletor, máquina selecionada; não "este Mac" nem no admin): apelido guardado em
  `settings.hostNames` (host → nome, 1–40 caracteres, `normalizeHostNames`). A chave SSH não muda; o apelido
  entra em `hostLabel` (`lib/probe-text.ts`, com `setHostNicknames`), então seletor, título da janela e
  textos mostram o apelido. Janelas abertas retitulam pelo `settings:changed`. Vazio tira o apelido.
- "Remover do seletor" (botão na máquina selecionada, dois cliques; nunca "este Mac" nem no admin): tira o
  Host do ~/.ssh/config com `removeSshHost` (`src/main/ssh-sync.ts`, testado: bloco só dele sai inteiro; em
  `Host a b` sai só o nome; o resto do arquivo fica igual) e backup em `config.antes-de-remover-<host>`.
  Host que vem de um Include (Colima, suporte) não é mexido e o erro diz isso. Recusa com a janela da
  máquina aberta; os atalhos da mesa dela saem junto. Ela volta se estiver no modelo do projeto e alguém
  usar "sincronizar ssh".
- Status line, personalizar (16 out): preferência por máquina em `~/.claude/statusline-segments.json`
  (`{model, ctx, account, session, weekly}`; ausente = todos; o app exige pelo menos um ligado), lida pelo
  `statusline.sh` (`seg_on`, com `if has($k) then .[$k] else true end`: o `// true` do jq trocaria false por
  true) e pelo backend (`account-status.js` → `segments` no `/v1/meu-bot/status`), então barra do terminal e
  rodapé do app (`buildSegments` filtra model/ctx/account/session/weekly; `turn` e `age` ficam) combinam.
  Gravação pela janela: `src/main/statusLine.ts` (`statusline:segments` / `statusline:set-segments`, ssh ou
  fs local, atômico 0600). Correções no script: `stat -c %Y` antes de `stat -f %m` (no Linux o `-f` devolvia
  lixo e o cache de perfil nunca valia: uma chamada à API da Anthropic por atualização; agente-box e colima
  estavam assim), segmento **Semanal** (magenta) na barra, e sem o segmento Conta o script nem vai à API.
  Teste real do script em `scripts/tests/statusline-sh.test.mjs` (bash + jq, HOME temporário, `curl` falso
  que acusa chamada). Tutorial com 4 passos: Instalar → **Escolher o que aparece** (interruptores + prévia
  `previewLine`) → **Conferir no terminal** (digita `SL_TEST_COMMAND` num terminal do app; "Apareceu certo"
  marca `GuideFlags.statusTested`) → **Ver os limites na conversa** (alvo `chat`: botão "Ir para a conversa"
  volta à aba de conversa com uma mensagem pronta no compositor e um aviso de onde olhar; o botão Enviar faz
  uma contagem "Enviando em 3 → 2 → 1" e manda sozinho, para a pessoa ver o fluxo acontecer (`startAutoSend`;
  digitar ou Esc cancela, clicar em Enviar manda na hora, trocar de aba ou esvaziar o compositor cancela;
  `syncComposer` não repinta o botão durante a contagem); o passo se conclui sozinho quando a conta traz os limites). `GuideTarget` ganhou `chat`
  (`goToChatForStatusLine`, `backToChat` compartilhado com "Perguntar ao agente" do terminal); o painel de
  gerência do tutorial concluído repete o botão em "Onde aparece". `backend-vm/services/account-status.js` é cópia.
  O rótulo da barra no terminal passou de "Sessão diaria" (herdado do script original; a janela é de 5 h, não
  diária) para "Sessão:", o mesmo do rodapé do app e da prévia do passo 2.
- Trilha numerada e tutorial 1 · Entrar no Claude Code (16 out): cada tutorial tem `number` fixo (1 Claude,
  2 WhatsApp, 3 Status line, 4 xAI/Grok, 5 Fallback, 6 Suporte, 7 Objetivo): selo "TUTORIAL 3 · 4 PASSOS · 3 MIN",
  aba "3 · Status line 2/4", paleta "Tutorial 3: …", admin "3 · Status line do Claude: 2 de 4" (`tutorialNumber`
  pelo id; o payload do progresso não mudou). `Tutorial.after` (id) esconde o tutorial até o anterior ser
  concluído — `visibleTutorials(ctx, finished)` — e `needsSupport` substitui `requires: "support"`: 3 e 4 só
  depois do 1, 5 só depois do 4 (4 e 5 continuam "Em breve"; o cartão Fallback sumiu de quem não chegou lá).
  Tutorial 1 (3 passos): *Entrar na conta* (corpo `claude-login`: os controles do login vivem dentro do guia,
  `clGuide`, criados uma vez e reanexados a cada repintura para o campo do código sobreviver; o modal
  `#cl-dialog` usa o mesmo `clState`/`paintClaudeLogin` e fica para trocar de conta depois de concluído;
  `enterClaude()` é a porta única: paleta, aviso de deslogado, boas-vindas, botão da lateral e `ui:claude-login`),
  *Conferir quem está logado* (e-mail de `claudeAuth`; "Vi minha conta" = `GuideFlags.claudeSeen` se o e-mail
  não vier), *Primeira resposta do agente* (alvo `chat` com 3-2-1; conclui quando o `index` desta máquina tem
  uma mensagem `assistant` — checado em `chat:done`). `refreshClaudeLine` repinta o guia; `logoutClaude(relogin)`
  serve ao botão "sair", ao painel de gerência ("Sair e entrar com outra conta") e ao "Refazer do zero". O guia
  só espera o WhatsApp (`st === null`) em tutoriais com alvo `wa-*`.
- Guarda do WhatsApp (18 out, `backend-colima/guarda/` + `install-guarda.sh`): plugin local do OpenClaw
  (`meu-bot-guarda`, JS puro, hooks `message_received`/`message_sending`/`session_start`; registrado por
  `openclaw plugins install --link ~/.local/share/meu-bot/guarda --force`, que o gateway aplica na hora, sem
  reiniciar; `plugins reload` depois de editar). Motivo: na conversa com +595981003050 (bot da DLS Technology) o
  OpenClaw entregou ao contato "↪️ Model Fallback: grok/grok-4.7 (selected anthropic/claude-opus-5-5; empty
  response)" e a conversa entrou em loop de despedidas (9 ciclos em 8 min). O OpenClaw 2026.9.9 não tem chave
  para calar a nota em conversas diretas (só poupa grupos/canais) e o `botLoopProtection` nativo não vale para
  WhatsApp (não classifica autor como bot). Regras em `guarda/regras.mjs` (puro; `scripts/tests/guarda-regras.test.mjs`
  roda direto, sem dist): (1) `isOperationalNotice` — texto começando por "↪️ Model Fallback"/"↪️ Retried on" →
  `{ cancel: true }` em `message_sending` (o estado de fallback do OpenClaw segue; só a linha não sai); (2)
  `LoopTracker` — por sessão direta, pares recebida→enviada; loop = 3 ciclos seguidos, mensagens ≤ 200 chars,
  ≤ 3 min entre ciclos, e os 3 textos do contato (ou do agente) são despedidas/cortesias (lista pt/es/en,
  ≤ 12 palavras) ou quase iguais (Jaccard de palavras ≥ 0,6). Ao detectar, na 3ª resposta: cancela o envio,
  `api.runtime.agent.session.patchSessionEntry({ sendPolicy: "deny" })` (a mesma pausa manual: a lista do app
  mostra "pausado"; retomar é o menu "…" › Retomar) e injeta a nota ao agente por `openclaw agent --message-file`
  (molde de whatsapp-pause.ts). Humanos não batem: três "ok" com 5 min de intervalo estouram a janela; conversa
  com conteúdo não passa. Logs em `/tmp/openclaw/openclaw-<data>.log` ("meu-bot-guarda: …"). No app: sonda
  `guarda` (null sem OpenClaw), `guarda:status|install|uninstall`, botão "Ativar guarda do WhatsApp" no seletor
  (depois de status line e transcrição) e **tutorial 8 · Guarda do WhatsApp** (após o 2: ativar + "Entendi").
  Instalada na agente-box em 18 out (geração 5 do gateway); confirmação ao vivo pendente do próximo loop.
- Módulo Pro "Navegador" (18 out), como o quick view do Rambox: aba `navegador` (renderer, `openNavTab`) com
  abas internas que são `<webview>` (`webviewTag: true` na janela; `windows.ts`) na partição
  `persist:navegador-<host>` (cookies/logins por máquina, separados do app). O main (`src/main/browser.ts`)
  prepara a sessão (permissões fechadas, User-Agent sem "Electron" — senão o login do Google recusa — e a
  Chrome Web Store ligada pelo `electron-chrome-web-store`, MIT, como no Rambox: a pessoa abre a loja na aba e
  "Usar no Chrome" instala em `userData/Navegador/<host>/Extensions`, com atualização automática; menu 🧩 lista
  e remove). Popups viram aba interna; Cmd+K/J/N/B/W/T/L/[/] dentro do webview voltam ao app
  (`before-input-event` → `browser:key`). `electron-chrome-extensions` (GPL-3) NÃO entrou: sem a licença
  patron do autor; extensões rodam com as APIs nativas do Electron (content scripts, storage, scripting;
  sem popup de botão nem declarativeNetRequest). **Gate Pro**: `lib/pro.ts` (`browserAccess`: ok/free/
  expired/unknown; testado) com cache `license` no renderer; free vê a aba bloqueada com "Pedir o Pro ao admin"
  (`browser:request-pro` → linha no suporte.log); o main recusa `browser:open` sem Pro (PRO_REQUIRED); o
  backend ignora o navegador sem licença Pro. Só no meu-bot da pessoa (`caps.chat`; escondido no admin).
  **Agente navega** (o desenho simples, em vez de emular o CDP para o puppeteer): `src/main/nav-api.ts` serve
  ações JSON num socket Unix 0700 (`/tmp/<app>-<uid>/nav-<host>.sock`: abas, abrir, ler — texto + elementos
  numerados —, clicar, digitar com `insertText`, tecla, print, voltar/avancar/recarregar, js); o interruptor
  "🤖 agente: pode usar" na barra (`browserAgent`) sobe o socket e pede ao túnel um `-R 127.0.0.1:<porta>:<socket>`
  (`tunnel.ts`: `setReverseWanted`/`reconcileReverse`, porta livre por python3 na máquina, prontidão por curl
  ao `/abas`, reinício com orçamento, `-O cancel -R` ao desligar). Com o agente ligado e o -R de pé,
  `runBackendTurn` manda `X-Meu-Bot-Browser-Port`; o backend (`navegador.js`, puro/testado) confere Pro e o
  arquivo `~/.local/share/meu-bot/navegador-mcp.mjs` (servidor MCP stdio de um arquivo, sem npm, instalado por
  `install-navegador-mcp.sh` junto com a regra de conduta no CLAUDE.md dos workspaces) e roda a CLI com
  `--mcp-config` + `--allowedTools mcp__navegador` (+ `--system-prompt-snapshot off` em CLI ≥ 2.1.257), a
  regra no system (depois do sysHash, como a identity) e uma nota no prompt do turno. `tool-events.js` resume
  como "🌐 abriu …", "🌐 digitou em …" (nunca o texto). Tutoriais 9 "Navegador do agente (Pro)" e 10
  "Extensões no Navegador" (exemplo: Streak CRM for Gmail; o passo "Usar" exige login no Google dentro da
  aba). Verificado: backend novo na agente-box (requer `licenca.js` ao lado: copiar todos os .js), MCP responde
  `tools/list`.
- Service worker das extensões segurado (18 out): o Chromium encerra o service worker MV3 após ~30 s ocioso e
  o Electron **não** o acorda quando o content script chama `runtime.connect`/`sendMessage` (o Chrome acorda).
  Sintoma no Streak: minutos depois de abrir, "failure to send getExtensions message", `BackgroundPageCommunicator`
  undefined e "Faça login para usar o Streak" a cada recarga (a ponte com o background morreu, não a sessão).
  Correção em `browser.ts`: `workerHold` acorda com `startWorkerForScope` e chama `w.startTask()` sem nunca
  encerrar (o worker não entra em ociosidade); `running-status-changed` → `stopped` religa (1 s; 30 s depois de
  3 quedas); `browserOpen` espera os workers subirem (até 4 s) antes de o webview carregar; `extension-unloaded`
  solta a tarefa. Diagnóstico: `/diag` do nav-api lista `service_workers` (o da extensão tem de aparecer).
- Recortes do Navegador (18 out): partes de um site que a pessoa oculta para sobrar tela (`lib/recortes.ts`,
  tabela `RECORTES` por host). No Gmail: painel lateral (`.bkL > .aqn`: pastas do Gmail e painel do Streak, 256 px),
  menu Mail/Streak/Chat/Meet (`.aeN.WR`, 68 px) e barra superior (`header#gb`, 64 px); os três **ocultos por
  padrão** (pedido do usuário), botões ◧ ⋮ ⬒ na barra do Navegador (apagado = oculto). Implementação:
  `insertCSS` no webview por documento (`NavTab.cssKeys`, zerado no `did-navigate`, aplicado em `did-navigate` e
  `dom-ready`), depois `dispatchEvent(new Event("resize"))` porque o Gmail mede a tela por JS (sem isso o
  conteúdo não cresce). Preferência em `localStorage.navRecortes` (por recorte, vale para todas as máquinas).
- Polyfill nos content scripts (18 out): o Electron não dá `chrome.extension` ao mundo isolado dos content
  scripts; o Streak testa `chrome.extension` para criar a ponte com o background e, sem ela, `_bridge` fica
  undefined ("reading 'getLocalStorageItem'", "failure to send getExtensions") e ele pede login a cada carga.
  `patchExtensionFiles` agora prepõe o polyfill (marca v3) a todo `content_scripts[].js` com `world !== "MAIN"`;
  o polyfill detecta o contexto por `chrome.runtime.id` e só cria `chrome.extension`. Depois da recarga da
  extensão o `extension-ready` não repete: `workerHold` é chamado direto após `loadExtension`. Verificado: zero
  erros no console do Gmail, Streak sem pedir login.
- Barra de favoritos do Navegador (18 out): lista **por máquina** em `settings.navFavoritos` (normalizada:
  url http(s), título ≤ 60, url repetida só atualiza título, 50 no máximo); IPC `browser:favorite-add/remove`
  e evento `browser:favorites` para todas as janelas da máquina; o agente usa `/favoritos`, `/favoritar
  {url, titulo?}` (sem título: o da aba nessa url, senão o host) e `/desfavoritar {id|url}` → ferramentas MCP
  `favoritos/favoritar/desfavoritar` (resumo ⭐ em tool-events). UI: linha `.nav-favs` sob a barra (clique abre
  na aba atual, Cmd+clique em aba nova, × tira), ☆/★ na barra guarda/tira a página aberta, **Cmd+Shift+F**
  mostra/esconde a barra (também vindo do webview; preferência `localStorage.navFavsShown`), paleta "barra de
  favoritos". Verificado na agente-box: `favoritar` pelo socket e `favoritos` pelo MCP na VM.
- Skills aprendidas do Navegador (18 out): o agente registra o que descobriu num site para não repetir
  tentativas. Regra v3 do bloco `meu-bot:navegador` (install-navegador-mcp.sh): antes de operar um site, ler
  `~/.claude/skills/<site>-navegador/SKILL.md`; ao terminar uma tarefa que exigiu descobrir o caminho, gravar
  ou atualizar essa skill (frontmatter + o que funcionou e o que não). Sementes `backend-colima/skill-*.md`
  (hoje `skill-streak-crm-navegador.md`, escrita a partir da sessão c8d553bf na agente-box: "+" da barra cria
  box, célula inline não salva, selects aceitam digitar+Enter, checkbox do cabeçalho só por eventos de mouse,
  confirmação "N caixas", hash `#pipeline` volta a `#inbox` em Gmail recém-carregado, popup da extensão não é
  aba, conversa do WhatsApp no sqlite do OpenClaw) são copiadas para `~/.claude/skills/<nome>/SKILL.md` só se
  a máquina ainda não tiver a sua (o agente edita a dele). nav-api: popup da extensão fora de `abas`, erro
  claro quando a aba morre no meio (`alive`), `ler` tenta duas vezes e toda falha vai ao meu-bot.log.
- Guarda com versão e rollout automático (18 out, noite): `guarda/package.json` leva a versão (1.1.0); a sonda
  do seletor imprime `guardaver=`; `ensureGuarda` (picker.ts) instala quando falta **ou quando a versão da máquina
  difere da que vem no app** (`bundledGuardaVersion()`). Assim toda máquina com OpenClaw da conta recebe regras
  novas (encerramento, bloqueio de erros, agent_end) na próxima abertura do seletor, sem clicar em nada. Subir a
  versão no package.json a cada mudança no plugin.
- `agent_end` chega (18 out, noite): ao contrário de `message_received`, o hook `agent_end` é entregue ao plugin
  com `event.messages` (a conversa inteira, role/content/timestamp) e `ctx.sessionKey/channelId`. A guarda usa
  isso para (1) reavaliar o loop com os dois lados (`loopVerdict`: replay dos últimos 8 pares na `LoopTracker`,
  3 ciclos) e (2) **pausar a conversa encerrada** (`closureVerdict`: o agente se despediu e ficou em silêncio,
  NO_REPLY ou sem resposta, em 2 turnos seguidos do contato) com a mesma pausa de verdade (sendPolicy deny +
  nota), que o app mostra como "pausado", como o usuário pediu ("como se estivesse clicando lá"). Silêncio
  depois de resposta com conteúdo (falha transitória) não encerra. Retomar é manual, e a nota diz ao agente para
  responder ao pendente quando voltar.
- Vazamento de erro em inglês (18 out): quando o primário e os fallbacks falham, o OpenClaw entrega ao chat o
  texto do erro ("claude-cli/claude-opus-5-5 request failed", "The model returned an empty response. Please try
  again.", "This turn ended before a reply: …"). A Sofía recebeu um desses e respondeu "parece uma mensagem de
  erro do sistema". `isOperationalNotice` agora cobre prefixos (↪️, ⚠️, "This turn ended…", "LLM request
  failed", "The model returned…", "The provider session expired", "NO_REPLY") e padrões
  (`<provedor>/<modelo> request failed`, "request failed … provider/model/status NNN", "empty response … try
  again"), só em textos de até 400 caracteres; a fala normal do agente, mesmo em inglês, passa (teste). Regra de
  encerramento (`meu-bot:encerramento v1` no AGENTS.md, gravada pelo install-guarda.sh): depois da despedida, o
  próprio agente responde NO_REPLY a cortesias; a conversa da Sofía mostrou NO_REPLY em 16:38 e 16:40.
- Loop só pelas saídas e pausa silenciosa (18 out, mais tarde): **confirmado ao vivo** que o OpenClaw 2026.9.9
  não chama `message_received` de plugins de fora, mesmo com `allowConversationAccess` (log de depuração na
  primeira linha do handler nunca apareceu enquanto o agente processava as entradas); `message_sending` chega.
  A `LoopTracker` passou a aceitar `sending` sem `received`: ciclo "só de saída", e nesse modo exige 4
  respostas de despedida/quase iguais em sequência (3 quando há entrada), para a despedida educada de um
  humano não pausar a conversa dele; simulado com a transcrição da Sofía, pausaria na 10ª resposta. Notas de
  pausa (manual e automática) e o bloco `meu-bot:pausa v2` do AGENTS.md agora mandam o agente responder
  **NO_REPLY** a tudo enquanto pausado e nunca mencionar a pausa ao contato: antes a nota pedia "registre com
  uma palavra" e o agente soltava um "Valeu." que aparecia no espelho como se tivesse respondido.
- Guarda por padrão na conta (18 out): o anti-loop não disparava porque o OpenClaw **não entrega
  `message_received` a plugins de fora do catálogo** sem `plugins.entries.<id>.hooks.allowConversationAccess:
  true`; a guarda via só as saídas (`message_sending`, que bloqueava as notas de fallback) e nunca fechava um
  ciclo. Caso real: Sofía (+595995661756), 40 trocas de despedida em 8 min; as regras já detectariam no 3º ciclo
  (simulado com a transcrição). Correções: `install-guarda.sh` grava a permissão; `FAREWELLS` ganha chau, dale,
  listo, nos vemos, que andes bien, cuidate, hasta la próxima, quedamos así, vos también, abraço; log
  "observando <contato> (entrada recebida)" na 1ª entrada por sessão para confirmar ao vivo; e o seletor
  (`picker.ts: ensureGuarda`) instala a guarda sozinho em toda máquina com OpenClaw que a sonda achar sem ela
  (uma tentativa por máquina por sessão do app). Tutorial 8 vira conferência. Depois de editar o plugin, o
  `--link --force` pode dizer "replacement not applied": rodar `openclaw plugins reload meu-bot-guarda`.
- CRM pelo WhatsApp, tutorial 11 (18 out, módulo Pro): o agente da máquina anota no Streak **pela API**, sem
  navegador, 24 h. Lado da VM em `backend-colima/crm/`: `streak.mjs` (CLI node puro: diag, pipelines,
  pipeline, box-find, box-create, box-update, field-set, comment, contact-upsert, telefone-set; chave em
  `~/.local/share/meu-bot/crm.json` 0600, nunca impressa), `crm-job.mjs` (lê a conversa com `gateway call
  chat.history` desde a marca d'água em `crm/estado.json`, pede um turno ao backend local — `model: agente`,
  `X-Conversation-Id: crm:+N` — com o prompt de `regras.buildPrompt`, espera o bloco ```crm-json``` {aplicado,
  propostas, resumo}, avisa o dono por `openclaw message send`; `--aplicar [n]`/`--descartar` respondem à última
  proposta sem LLM; `--dono --comando` para pedidos sem contato explícito; `transcricao +N` para o agente ler uma
  conversa), plugin OpenClaw `meu-bot-crm` (`message_received`/`message_sending` alimentam `SilenceTracker`
  persistido em `crm/tracker.json`; timer de 30 s dispara o job após `silencioMin` (config do plugin, 10); no chat
  do dono consigo mesmo: "anota no CRM: …"/"crm: …" → job, "ok"/"ok 2"/"não" → aplicar/descartar). Regras puras
  em `crm/regras.mjs` (testes crm-regras). `install-crm.sh`: copia, `plugins install --link`, grava
  `plugins.entries.meu-bot-crm.hooks.allowConversationAccess=true` (docs exigem para plugins de fora), semeia a
  skill `streak-crm-api`. Limites conhecidos: a transcrição do OpenClaw tem só contato + Rene (respostas manuais
  do dono pelo celular não aparecem) e `chat.history` devolve só a janela desde o último reset; por isso o comando
  do dono no chat consigo mesmo é o caminho garantido. Sem box e sem pedido do dono, o job não cria nada (só
  marca `semBox`). App: `crm-core.ts` (puro: `parseCrmPatch`, `setCrmSh` em base64, `crmInfoSh`, `streakSh`
  diag/pipelines) + `crm.ts` (gate Pro via `fetchLicense`), IPC `crm:info|install|set|test|reset` + evento
  `crm:progress`, `hostProbe.installCrm/uninstallCrm`, tutorial 11 `crm-whatsapp` (after `navegador`; o tutorial 10 de extensões foi removido em 19 out 2026,
  bodies crm-pro/crm-install/crm-config/crm-test, flag `crmSeen`), `proBlockText(a, view, "crm")`. Também
  corrigido: `licenca.js` faltava no `install.sh` e em `BUNDLE_FILES` (backend novo quebrava no require).
- Modo dividido (18 out): conversa à esquerda e uma página fixada à direita (Navegador, Terminal, Atividade,
  Tutoriais, Acervo, guia, chat do WhatsApp), como o terminal dividido do Cursor. `.content` vira grid de 3
  colunas (`--split`, mínimos de 320 px; `< 760 px` recolhe a direita com `split-collapsed`); os painéis de
  página já são absolutos, então `splitOn(page)` só **move o elemento** para `#split-panel` e `splitOff` devolve
  ao `#panels`. Regras: com a divisão ligada, páginas sempre vão para a direita (`activatePage` → `splitOn`) e
  conversas para a esquerda; arrastar a aba da página para a metade direita do conteúdo (camada `.split-drop`,
  por cima do webview; soltar à esquerda volta a tela inteira), Cmd+\ (também vindo do webview) e a paleta ("Dividir a tela
  com …"); fechar a página desfaz. `pageShown(page)` substitui `pageActive === page` nas repinturas (guia,
  Tutoriais, Acervo, polling do WhatsApp, pedidos do agente ao Navegador); `activeGuide()` considera a página
  fixada, então o guia pulsa os alvos ao lado da conversa. Divisor com pointer capture e `body.dragging`
  (webview/xterm perdem o mouse no arrasto). Lembrado em `localStorage split:<host>` (`lib/split.ts`, testado:
  `clampSplitRatio`, `splitLayout`, `parseSplitPref`); `restoreSplit()` no boot reabre a página (Navegador só
  com Pro; terminal sempre novo).
- Extensões MV3 no Navegador (18 out): o Streak não desenhava porque o service worker dele morria na primeira
  linha (`chrome.permissions.onAdded`: o Electron não tem `chrome.permissions`, `declarativeNetRequest`,
  `windows`, `alarms`…). `registerPreloadScript({type:"service-worker"})` NÃO alcança o contexto da extensão
  (testado: o marcador nunca apareceu). O que funciona: `patchExtensionFiles` (browser.ts) grava
  `src/preload/ext-polyfill.ts` (como script puro: o tsc emite cabeçalho CommonJS e `exports` não existe no
  worker; `polyfillSource` tira essas linhas) no começo do service worker e, por `<script src="/meu-bot-
  polyfill.js">`, nas páginas (popup/opções), com marcadores de início/fim versionados; depois recarrega a
  extensão uma vez (`removeExtension` + `loadExtension`). Versão sem marcador de fim → `reinstallExtension`
  (baixa de novo da Web Store). Resultado: o service worker do Streak roda, o pipeline aparece no Gmail dentro
  da aba (print em 18 out); sobram erros de `BackgroundPageCommunicator` (local storage/pixel tracker via
  background) sem efeito visível. Popups `window.open` com tamanho (OAuth do Google) viram janela de verdade
  (`action: "allow"`), senão `window.opener`/postMessage quebram; `_blank` comum vira aba interna. Diagnóstico:
  `POST /diag` no socket de ações (extensões, service workers, console da aba) e o log `sw chrome-extension://…`.
  Incidente: sem as ferramentas (interruptor desligado), o agente em modo bypass rodou `sudo npx playwright
  install` na agente-box; a regra v2 (navegador.js + CLAUDE.md) proíbe instalar navegador por conta própria.
  O interruptor "agente pode usar" agora é lembrado por máquina (`navAgentHosts` em settings) e religa ao
  abrir a aba; fechar a janela derruba socket e -R sem esquecer a escolha.
- Resposta em voz no espelho do WhatsApp (18 out): quando o agente responde em áudio, a mensagem do
  assistente no `chat.history` é uma chamada à ferramenta `mcp__openclaw__tts` (`stopReason: "tool_use"`,
  importada do claude-cli sem `runId`) com o `tool_result` "(spoken) …" — o filtro de rascunho descartava e o
  balão de "digitando" ficava preso para sempre. `spokenText` em whatsapp-chats.ts reconhece o par toolcall
  tts + "(spoken)" e mostra a fala como "🎙️ <texto>" (sem o "(spoken)", a chamada falhou e continua rascunho).
- "Instalar Claude Code" no seletor (17 out): uma conta sem Claude Code (outro usuário da mesma VPS, como
  `agente-openclaw` ao lado de `agente-box`: o Claude e o backend são por home) dava "✗ sem backend e sem Claude
  Code. Instale antes" sem botão. Agora `describeProbe` devolve `install: "claude"` e o seletor instala pelo
  instalador oficial (`curl -fsSL https://claude.ai/install.sh | bash`, binário em `~/.local/bin`, sem Node nem
  root; `installClaudeCode` em hostProbe.ts, canal `picker:install-claude`, 5 min de teto, idempotente). A
  sonda seguinte vê o `claude` e oferece "Entrar no Claude Code" e depois "Instalar backend", como sempre.
- Faixa OFFLINE (17 out): como no Rambox, para a pessoa saber que **o problema é na conexão dela, não no
  app**. `src/main/net.ts` sonda a internet (HEAD em `captive.apple.com/hotspot-detect.html` e
  `gstatic.com/generate_204`, 5 s; offline só se as duas falharem com erro de rede; qualquer resposta HTTP
  prova saída), ao abrir, por `net:check` (botão "Verificar agora", eventos `online`/`offline` do renderer),
  ao acordar o Mac e em qualquer erro de conexão do túnel/backend/GitHub/caixa do suporte
  (`noteNetworkError`); offline, resonda a cada 10 s; online, sem timer. `broadcast("net:state")` chega a
  todas as janelas (admin incluído). `src/main/net-core.ts` (puro, testado): `looksLikeOffline` (ENOTFOUND,
  EAI_AGAIN, ENETUNREACH… e o texto do ssh "Could not resolve hostname"/"Network is unreachable"),
  `isConnectionCode`, `isLocalAddr`, `offlineMessage`. Consequências: `readyTunnel` sai na hora com "Você está
  sem internet…" em vez de insistir 75 s culpando a VM; o erro da conversa e o `backend:status` dizem "sem
  internet"; o updater mostra "Sem internet; verifico de novo quando a conexão voltar" e refaz a checagem na
  volta (`onBackOnline`), que também revalida/reabre os túneis das janelas abertas. Renderer: `#offline-bar`
  (mesmo estilo da update-bar, fundo `--warn`, sem animação) com texto de `lib/offline-text.ts` (remoto; colima
  = "a máquina local responde, mas o Claude não", via `host:local-addr` = `ssh -G` + `isLocalAddr`; "há N min";
  "ainda sem internet (verificado agora)" depois do botão); pill "sem internet" e barra mini vermelha enquanto
  offline; aviso "✓ internet de volta" na conversa ativa. O grid do `body` ganhou linhas fixas por elemento
  (`grid-row`): antes, com a barra recolhida e a update-bar visível, o `1fr` caía na update-bar.
- Tutorial 4 · Entrar na xAI (Grok) (16 out): deixou de ser "Em breve". `needsXai` esconde o 4 (e o 5, que
  depende dele: `visibleTutorials` é recursiva no `after`) onde o Grok não é possível — este Mac ou máquina sem o
  backend (`GuideContext.xai.possible`; null = ainda não consultado = mostra). Passos: *Preparar o Grok nesta
  máquina* (corpo `xai-prepare`: botão "Preparar" → `xaiPrepare()`/`install-grok-oauth.sh`, log no passo; conclui
  quando `xaiAuth !== null`, ou seja, Hermes presente), *Entrar na conta da xAI* (corpo `xai-login`: os mesmos
  `LoginControls` do tutorial 1 — `buildLoginControls()` — sem o campo de código, porque o OAuth da xAI é por
  código de dispositivo aprovado no navegador; conclui com `loggedIn`), *Ver o grok-4 responder* (alvo `chat`:
  `goToChatFromGuide(…, "grok-4")` troca o modelo da conversa e dispara o 3-2-1; conclui com
  `GuideFlags.grokReplied`, gravado em `chat:done` quando `done.provider === "grok-4"` — o X-Provider, a mesma
  prova da pill "respondeu grok-4"). `xaiState` + `paintXaiLogin()` pintam guia e modal `#xai-dialog`; `enterXai()`
  é a porta única (lateral "entrar"; concluído → modal para trocar de conta); `logoutXai(relogin)` serve ao
  "sair", ao painel ("Sair e entrar com outra conta") e ao "Refazer do zero". `XaiKeyStatus` ficou só com
  `backend` (o `hasKey` da chave de API saiu).
- Selo da lateral com duas notificações (16 out): o **número** são as pendências (interruptor "avisar na
  lateral" desliga); o **pulso** é novidade — tutorial visível, pendente e nunca visto (`localStorage
  tutVisto:<host>`, só cresce; abrir Tutoriais marca tudo que está à vista). A novidade não obedece ao
  interruptor: desligado, o selo mostra só as novidades, pulsando, até a pessoa abrir Tutoriais (`sidebarBadge`
  em tutoriais.ts, testado). Cartão de novidade ganha "NOVO ·" no selo durante aquela visita. Reaparecer (Refazer
  do 1 esconde 3/4; relogar mostra de novo) não é novidade. Resumo do topo: "Você fez 2 de 6 · próximo: 3 ·
  Status line · 1 novo · 2 em breve".
- Limites sem Claude Code interativo (16 out): o backend roda `claude -p`, e nesse modo a status line não
  executa, então mandar mensagem pelo meu-bot nunca gravava `ratelimits.json` (o passo "Ver os limites na
  conversa" não concluía). `account-status.js` ganhou `refreshRateLimits`: em `GET /v1/meu-bot/status`, se o
  cache tem mais de 60 s, busca `GET https://api.anthropic.com/api/oauth/usage` com o token OAuth do Claude
  Code da máquina (`~/.claude/.credentials.json`; Keychain no macOS; vencido = não chama) e grava o mesmo
  formato do statusline.sh (atômico, 0600; falha mantém o cache). O app consulta o status a cada resposta
  (`chat:account`), então o rodapé e o passo 4 atualizam logo depois da resposta. Motivo de não renovar vai
  ao log do backend quando muda ("limites da conta: no-token"). Testes em `scripts/tests/account-status.test.mjs`.
- Aviso de tutoriais na lateral (16 out): o "N tutoriais" ao lado de "Tutoriais" virou um selo com o número
  do que **falta fazer** (tour pendente + tutoriais não concluídos; arquivados e "Em breve" não contam;
  `tutCounts`). Some com zero. Em Tutoriais há o interruptor "avisar na lateral" (`localStorage tutBadge`,
  ligado por padrão) que desliga o selo, e o resumo "N para fazer · M arquivados · K em breve" no topo.
- "Refazer do zero" (16 out): tutorial concluído ganha, no cartão arquivado, um botão de dois cliques que
  desfaz na máquina o que o tutorial fez e esquece as marcações (`localStorage guia:<id>:<host>`), voltando
  ao passo 1: é o "excluir" do CRUD dos tutoriais. `Tutorial.reset.what` descreve o que é desfeito; a ação
  fica em `resetTutorial` (renderer). Status line → `backend-colima/uninstall-statusline.sh` (tira o nosso
  statusline.sh restaurando o `.antes-do-meu-bot`, volta o settings.json do backup ou tira só a chave
  `statusLine`, apaga `statusline-segments.json`; o cache de limites fica) via `uninstallStatusLine`
  (`statusline:uninstall`); suporte → `resetSupport` (desliga se ligado e esquece o nome, `support:reset`);
  WhatsApp → `whatsappLogout`. O tour já tinha "Rever". Nada disso no admin.
- Tutorial "Status line do Claude" (antes 2 passos, depois do "Ligar o suporte"; em toda janela, nunca no admin):
  instalar (o mesmo `installStatusLine` do seletor, agora também pela janela: IPC `statusline:status` com a
  checagem da sondagem e `statusline:install` com progresso em `statusline:progress`) e ver os limites no
  rodapé (conclui quando a conta da máquina traz `sessionPct`/`weeklyPct`, que só nascem depois que o
  Claude Code roda uma vez lá). `GuideContext.statusLine`. O seletor continua oferecendo instalar.
- Verificado de ponta a ponta (16 out, Electron rodando as funções do app): ligar → timer ativo e código na
  caixa → admin vê a pessoa, saúde, WhatsApp e 200 linhas de registro → desligar → a chave do admin passa a
  ser recusada e o timer/arquivos somem.

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

## Terminal na aba (16 out 2026)

Inspirado em `~/Desktop/terminal/apps` (FastAPI + `pty` do Python + xterm.js), sem o que ele tinha de frágil
(porta HTTP sem autenticação, `select` bloqueante, decode UTF-8 por pedaço, sem aviso de saída).

- **PTY sem módulo nativo:** `src/main/pty-broker.py` (só stdlib, Python 3.6+) roda **onde o shell roda**: na
  máquina da janela via `ssh … python3 -c "<broker em base64>"` pegando carona no ControlMaster do túnel
  (`sshMuxArgs` em `tunnel.ts`; sem master, `ssh` próprio) ou, em "este Mac", via `/usr/bin/python3` (sem
  ele, erro pede `xcode-select --install`). `pty.fork` → `$SHELL -l` em `$HOME` com `TERM=xterm-256color`;
  resize = `TIOCSWINSZ` no master, então o shell recebe SIGWINCH de verdade mesmo remoto.
- **Framing** (`src/main/pty-frames.ts`, testado com o broker real): `tipo(1) + tamanho(4 BE) + payload`.
  App→broker: `i` entrada, `r` "cols rows", `k` encerrar. Broker→app: `o` bytes crus (o xterm decodifica
  UTF-8 incremental), `x` código de saída. `RingBuffer` de 256 KiB por sessão (`term:replay`).
- **Sessões** (`src/main/terminal.ts`): presas à janela (`ownedTerminal`), máx. 8 por janela, encerradas no
  `closed` da janela (`closeTerminalsOfWindow`). IPC: `term:open` (invoke), `term:input`/`term:resize`
  (`ipcRenderer.send`, sem resposta), `term:close`, `term:replay`; eventos `term:data` (Uint8Array) e
  `term:exit`. No admin, abrir um terminal entra no `suporte.log` da pessoa ("admin: abriu um terminal").
- **xterm.js 5.5 no renderer:** só há build UMD, então `scripts/vendor.mjs` copia `xterm.js` + addons (fit,
  webgl, web-links, search, unicode11) e `xterm.css`, e o `index.html` os carrega por `<script src>` (CSP
  `script-src 'self'`). No navegador o UMD põe a **classe** em `window.Terminal` (em Node, `{ Terminal }`):
  `xtermClass()` aceita os dois; addons vêm como `window.FitAddon.FitAddon` etc. (tipos em
  `src/renderer/vendor/xterm-globals.d.ts`). **CSP:** `style-src 'self' 'unsafe-inline'` só por causa do
  `<style>` que o renderer DOM do xterm injeta; `script-src` e `connect-src 'none'` seguem iguais.
- **Abas:** linha "Terminal" na lateral (contagem de abertos), paleta, **Cmd+J** (foca o último vivo ou abre)
  e **Cmd+Shift+J** (mais um). Página `term-<n>` ("Terminal n · <máquina>"), tema das variáveis CSS
  (`xtermTheme`, repintado em `applySettings`), `ResizeObserver` → fit → resize. Com o terminal focado,
  `Ctrl+*` vai ao shell; `Cmd+K/N/B/W/J/F` são do app (`attachCustomKeyEventHandler`), Cmd+F = busca do
  addon. Fechar aba com shell vivo pede 2 cliques; saída do processo mostra "sessão encerrada" + Reconectar.
- **Integrações:** (A) selecionou → barrinha "Copiar / Perguntar ao agente" (pré-preenche o compositor com o
  trecho em bloco de código; nada é enviado sozinho) e "Últimas linhas → conversa"; (B) blocos `bash/sh/zsh/
  shell/console` nas respostas ganham "Rodar no terminal": digita o comando com *bracketed paste* e **sem
  Enter** (`shellBlockToPaste`, testado; em `console` tira o prompt e a saída); (C) **atividade do agente**:
  o backend (`backend-colima/tool-events.js`, testado; `runClaude` ganhou `onTool`) emite `x_meu_bot.tool`
  para cada `tool_use` (Bash → comando; Read/Write/Edit → arquivo; Grep/Glob → padrão…) e `tool_result`
  (20 linhas); `backend.ts` → `chat:tool`; na conversa vira uma linha recolhível "rodou `cmd`" (verde/vermelho
  pelo resultado) e a aba **"Agente · atividade"** (xterm só leitura, nasce atrás na primeira ferramenta;
  também pela paleta) mostra `$ comando` e o resultado ao vivo. Exige backend reinstalado (colima: feito).
- Verificado: broker local no teste; terminal na colima pelo app (prompt, `uname`, `stty size` = tamanho da
  aba, cores). Pendente de ver no app: "este Mac", barra de seleção, Rodar no terminal, Reconectar.

## Porta do backend por máquina (18 out 2026)

- **Problema:** a porta era uma só no app (`backendPort`, 8080). Duas contas na mesma máquina (`agente-box` e
  `agente-openclaw` na mesma VPS) não cabem na mesma porta: a segunda conta instalava e o seletor dizia "sem
  backend" ou abria o túnel para o backend da outra conta (401). A porta é propriedade do backend de cada
  máquina (o `PORT=` do `.env` dele), não do app.
- **Settings:** `backendPortByHost` (vence a padrão; igual à padrão tira a exceção), `getBackendPort(host)`,
  `setBackendPortForHost`. Todo `ensureTunnel`/`probeHost` passa a porta da máquina. Na janela de uma máquina o
  campo "Porta do backend" edita só a dela (`backendPortForHost`); na janela deste Mac edita a padrão das demais.
  Trocar derruba só o túnel afetado (todos, se a padrão mudou), com a mesma recusa de resposta em andamento.
- **Sondagem** (`hostProbe.ts`): lê `PORT=` do `.env` do backend (`backendPort`), checa "ouvindo" e `/v1/models`
  **nessa** porta, diz se a porta do app está tomada (`portBusy`) e a primeira livre acima dela até +30
  (`freePort`). `appPort` é a porta com que a sondagem foi feita, para o texto do seletor.
- **Seletor** (`probe-text.ts`, puro e testado): backend instalado em outra porta → "⚠ … está na porta 8081, mas
  o app usa a 8080" e botão **"Usar porta 8081"** (`picker:use-port`, canal compartilhado: grava só para a
  máquina, derruba o túnel dela, invalida a sondagem). É configuração deste Mac, nada escrito na máquina da
  pessoa, por isso o meu-bot-admin também mostra o botão (os outros botões de instalar continuam só no cliente). Sem backend e porta do app ocupada → "⚠ … a porta 8080 já está ocupada nesta
  máquina (outra conta ou outro programa)" e botão **"Instalar backend na porta 8081"**; `picker:install` usa a
  porta que a sondagem decidiu (a do `.env` ao reinstalar, a livre quando ocupada, senão a do app) e, se não
  for a configurada, grava para a máquina ao terminar. Sem porta livre, manda trocar nas Configurações.
- **install.sh:** com `.env`, o `PORT=` dele manda (um `PORT=` diferente pedido só fazia a checagem do fim
  falhar); instalação nova em porta ocupada sai com código 4 e explica, antes de escrever qualquer coisa.
- Verificado na VPS `agente`: sondagem em `agente-openclaw` → `envport=8081 port=1 busy=1 freeport=8082
  models=claudecode,agente`; reinstalar com `PORT=8080` mantém 8081 e responde OK.

## Gateway do OpenClaw em porta própria (18 out 2026)

- **Sintoma:** ao gerar o QR (ou na consulta de estado) em `agente-openclaw`: `gateway connect failed:
  GatewayClientRequestError: unauthorized: gateway token mismatch`. Causa: a segunda conta da mesma VPS não tem
  `gateway.port` autorado; a CLI cai no padrão 18789, que é o gateway da conta `box` (token diferente), e o
  serviço dela, preso à mesma porta, falha com exit 78 ("Another process is listening on this port").
- **Conserto automático** (`whatsapp.ts`, `GATEWAY_FIX_SH`, nos dois scripts remotos): "token mismatch" no
  `channels status` → `gw_fix`: primeira porta livre a partir da configurada (até +30) vira `gateway.port`,
  `openclaw gateway install --force --port N` regrava a unidade systemd de usuário (backup `.bak` do OpenClaw),
  `reset-failed`, e espera o `channels status --json` responder (até ~36 s). Só gateway `mode=local` sob
  systemd; sob supervisord (computador do Grok Bot) ou remoto, não mexe.
  - Estado do WhatsApp: a consulta já conserta e devolve `repaired` ("✓ Consertado sozinho: …" no painel);
    se não deu, `detail` explica com os dois comandos.
  - Pareamento: antes do `channels login`, conserta e emite o passo "ganhou a porta própria N"; se não deu,
    erro claro em vez do texto cru da CLI.
- Verificado na VPS `agente` (conta `openclaw`): porta livre 18790, serviço ativo, `channels status` ok,
  gerenciador de usuário voltou de "degraded" para "running".
- **Bug antigo corrigido junto:** os dois `echo` do evento `connected` no PAIR_SCRIPT tinham `\"` no template
  literal do TS, que vira `"` antes de chegar ao shell; o shell então imprimia `{event:connected,user:{id:…}}`
  (sem aspas), o `JSON.parse` falhava e o app nunca recebia "connected" pelo evento (só pelo refresh do
  estado depois do `done`, com "terminou sem conectar"). Agora é `\\"` (o shell recebe `\"`), como o evento
  `gateway-port`. Conferido avaliando o template do `dist/` e rodando no bash: JSON válido.

## Backend e proxy do Grok em conta secundária da mesma máquina (18 out 2026)

- **Sintoma:** "Preparar o Grok" em `agente-openclaw`: `Failed to restart meu-bot-backend.service: Unit
  meu-bot-backend.service not found.` Causa dupla, a mesma família das portas: (1) o `install.sh` decidia
  "serviço de usuário" pelo código de saída de `systemctl --user is-system-running`, que é ≠ 0 também em
  `degraded` (o openclaw-gateway dessa conta estava falho), e mandou o backend para `/etc/systemd/system`;
  todo script que faz `systemctl --user restart meu-bot-backend` quebrava. (2) O proxy do Hermes era fixo na
  8645, que já é da conta `box`: o da conta `openclaw` saía com status 2 e o grok-4 apontava para o proxy (e a
  conta xAI) do vizinho.
- **install.sh:** `user_manager()` aceita running/degraded/starting/maintenance. Conta com serviço de sistema
  antigo (`User=` desta conta) é migrada: `sudo -n systemctl disable --now` + remove a unidade + daemon-reload e
  nasce a de usuário; sem sudo, mantém o de sistema e avisa.
- **install-grok-oauth.sh:** `backend_restart()` reinicia o que existe (usuário → sistema via `sudo -n` →
  aviso para "Reinstalar backend"); o node vem da unidade de usuário ou da de sistema. Porta do proxy: a que a
  unidade desta conta já usa, se ninguém de fora a ocupou (`ss -ltnp` só mostra processo dos sockets desta
  conta); senão a primeira livre a partir de 8645. `providers.json` aponta para essa porta.

## WhatsApp: "Só alguns contatos" (18 out 2026)

- Terceiro cartão em "Quem o agente responde": você + os números listados. É `dmPolicy allowlist` com `allowFrom`
  explícito (o dono entra sempre, `selfChatMode true`, grupos desativados, trava de ferramentas só para o dono).
  Os dois primeiros cartões continuam iguais. "Ajustar pelo chat" segue para o resto.
- `replyChoiceOf(dmPolicy, allowFrom, self)`: allowlist com alguém além do dono marca "list"; só o dono (ou vazio,
  ou "*") marca "self". `listedNumbers` e `parseWaNumbers` (puros, testados): um número por linha/vírgula; sem
  "+" e com 10/11 dígitos ganha o 55. O estado traz `allowFrom` lido do `channels.whatsapp` da máquina.
- Clicar no cartão abre o campo logo abaixo (fora do botão); grava só em "Salvar lista"
  (`whatsapp:dm-policy` com `numbers`); o main valida 8 a 15 dígitos.

## Tutorial do Navegador concluía sem o agente ter navegado (18 out 2026)

- **Causa:** o passo "Deixar o agente navegar" marcava `navAgentUsed` em qualquer evento `chat:tool` cujo nome
  começasse com `mcp__navegador__`, inclusive o `use` (a tentativa) e o resultado com erro ("o Navegador da
  pessoa não está ligado para o agente"). Bastava o agente tentar com "agente pode usar" desligado e o
  tutorial "concluía". E "Abrir o Navegador e entrar num site" contava uma aba vazia.
- **Agora:** só um `result` com `ok` de ferramenta do Navegador marca o passo (`showTool` devolve o nome da
  ferramenta, inclusive no resultado sem nome, pela linha que ele fechou); "entrar num site" conta só abas
  com URL carregada. O tutorial ganhou "Refazer do zero" (só apaga a flag; plano, instalação e abas ficam),
  para quem já estava marcado errado.

## Tutorial 10 "Extensões no Navegador" removido (19 out 2026)

- Só o tutorial saiu (bloco em `tutoriais.ts`, flag `extSeen`, corpo `navegador-ext`); o recurso de extensões
  (🧩, Web Store na aba, `browser:extensions`) continua. O CRM passa a vir depois do Navegador (9) e vira o
  10 (a trilha exige números contínuos 1..N).

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

## CRM: caminho real da chave da API do Streak (19 out 2026)

- O passo 3 do tutorial 10 dizia "Streak › Configurações › Integrações (API)". Verificado ao vivo no Gmail da
  `agente-box` (pelo agente com o Navegador) e na documentação do Streak: o botão do Streak na barra do Gmail abre
  um menu com "Integrações e Automações" (irmão de "Configurações"), e a chave fica em "Integrações personalizadas
  – Use nossa API" (criar/copiar). O texto do passo agora segue esses rótulos.

## CRM: o agente gera a chave da API do Streak (19 out 2026)

- Passo 3 do tutorial 10 ganhou "Pedir ao agente para gerar a chave" (só com o Navegador instalado): liga o
  Navegador para o agente e manda o pedido pronto (`CRM_KEY_PROMPT`). O agente segue a skill
  `streak-crm-navegador` (seção "Gerar a chave da API": botão do Streak › Integrações e Automações › Integrações
  personalizadas) e grava com `node ~/.local/share/meu-bot/crm/streak.mjs chave-set <chave>`.
- `chave-set` (streak.mjs): único subcomando que roda sem chave gravada; confere a chave em `/v1/users/me`
  antes de salvar (0600, merge) e responde `{ok, usuario}` sem repetir a chave.
- No app: a linha da ferramenta mascara `chave-set ••••`; ao chegar o resultado do Bash, `crmAfterAgentKey`
  consulta o CRM, testa a chave e `crmAutoPipeline` escolhe o pipeline sozinho quando a conta tem um só (também
  roda em todo `refreshCrm`). Com vários, a pessoa escolhe no app, como antes.
- Verificado localmente: `chave-set abc` recusa pelo formato; chave inválida é recusada pelo Streak (chamada real).
  Na `agente-box`: streak.mjs novo copiado e a seção da chave acrescentada à skill instalada (a instalação mantém
  a skill existente, então atualizações do bundle não chegam sozinhas a máquinas já instaladas).

## Notificações do Navegador viram conversas (19 out 2026) · REA do Rambox

- **O que o Rambox faz** (app.asar 3.1.1, `.vite/build/injected.js`, lido com `@electron/asar` numa pasta
  isolada): injeta na página um substituto de `window.Notification`: classe cujo construtor normaliza as opções
  (ícone vira data URL por `fetch`, senão o logo do serviço) e chama `window.rambox.sendNotificationToApp({title,
  options})` (ponte do preload); `Notification.permission = "granted"` e `requestPermission` resolve "granted"
  (callback e promessa); o objeto devolvido tem `addEventListener`/`close` inertes (`close` avisa o app). O main
  mostra a notificação nativa e o clique foca o serviço. A sessão também libera a permissão "notifications".
- **No meu-bot** (só no Navegador, logo só Pro): `nav-notify-preload.ts` (preload de frame da partição, só http(s))
  expõe `window.meuBotNav.notify` → `ipcRenderer.sendToHost("nav:notification")`; o renderer injeta `NAV_NOTIFY_JS`
  em `dom-ready`/`did-finish-load` (substituto de `Notification`, idempotente) e trata o `ipc-message` do
  <webview>: `parsePageNotification` → filtro de sites → dedup 60 s → conversa "🔔 <site>" (uma por site, ou uma por
  notificação) sem roubar a aba ativa → `sendText` com a instrução das Configurações + título/corpo/url →
  `ui:notify` (clique leva à conversa) **quando** a pessoa escolheu (`avisar`: "tratado" = depois de o agente
  responder, com a resposta, o padrão; "chegada" = na hora, com o aviso do site; "nunca"). A permissão do
  Chromium continua negada: só o substituto age.
- **Configurações › "Notificações do Navegador"**: ligado/desligado, a instrução (padrão: traduzir e explicar para
  leigo em até cinco linhas), os sites com o sino ligado (vazio = nenhum; o 🔔/🔕 na barra do Navegador liga e
  desliga por site, e ligar no tutorial sem sites marca os fixos do espaço ativo) e o modo da conversa. O 📌 da
  barra saiu (fixar é por "＋ Adicionar site", que já vem com a URL aberta). `navNotify` no settings.json
  (`normalizeNavNotify`, patch parcial). Puro e testado: `lib/nav-notify.ts`.
- Pré-requisito: o site aberto numa aba do Navegador (a aba fica aberta enquanto a página Navegador existe).

## Espaços de trabalho do Navegador (19 out 2026) · REA do Rambox

- **No Rambox:** workspaces são "grupos" (`$workspaces.addGroup/editGroup`, `addApp`) com apps fixos num trilho
  (rail), cada app um webview permanente; os dados ficam na conta Rambox (API `customerApps`), não localmente.
  O que se aproveitou: trilho lateral, sites fixos sempre abertos, agrupamento escolhido pela pessoa.
- **No meu-bot:** `NavWorkspaces { ativo, lista: [{ id, nome, servicos: [{ id, nome,
  url, icone }] }] }`, por máquina em `settings.json › navEspacos` (`normalizeNavWorkspaces`, limites 20×30),
  gravado inteiro por `browser:workspaces-set` (o main valida e avisa as outras janelas da máquina, evento
  `browser:workspaces`); `browserOpen` devolve `espacos`; `SettingsView.navEspacos` deixa o tutorial saber antes
  de o Navegador abrir. Trilho (`paintNavRail`): sem "tipo" (o que o espaço representa, cliente ou projeto, é o nome que a pessoa
  dá; a escolha por tipo existiu por umas horas e saiu em 19/10), seletor do espaço (com o grupo "Ocultos": escolher um traz de volta), ＋ (novo), ⋯ (renomear/ocultar/remover; ocultar
  fecha as abas fixas dele e não apaga nada), lista dos sites fixos, "＋ Adicionar site"; 📌 na barra fixa a
  aba aberta. Abas fixas (`NavTab.serviceId`) nascem com o Navegador (`navMountWorkspace`), sem ✕ na tira; as de
  outros espaços ficam vivas (notificações) mas fora da tira (`navVisibleTabs`).
- **Tutorial 11 · Notificações do Navegador (Pro)**, visível sempre (sem `after`; o Pro é o passo 1): fixar o site; decidir a ação (a função nasce
  **desligada**; o passo liga com instrução/sites/modo ou "Pular esta etapa"); ver a conversa "🔔" aparecer
  (automático quando ela existe, ou "Vi a conversa aparecer"; "Testar agora com o que está na caixa" manda o
  agente abrir o site fixo no Navegador e aplicar a instrução só ao item não lido mais recente). "Refazer do
  zero" desliga.
- **Cuidados de volume** (`onPageNotification`): 10 s de aquecimento depois de a página carregar (sites que avisam
  o que já estava na caixa de entrada não disparam nada); `NavNotifyBudget` 3 por minuto por site, e o próximo
  aviso tratado diz quantas ficaram de fora; dedup de 60 s; só notificações novas, nunca o histórico.

## Balão "guardar numa skill" depois de o agente navegar (19 out 2026)

- Ao fim de um turno em que o agente usou ferramentas `mcp__navegador__*`, a conversa ganha um balão: "O agente
  usou o Navegador em <sites>. Quer guardar o que ele aprendeu numa skill?" com "Atualizar «skill»" para cada
  skill da máquina que combine (nome/descrição citam o host, um pedaço dele ou palavras do título da aba; até 2),
  "Criar uma skill do zero" e "Agora não". Os botões mandam um pedido pronto na própria conversa: atualizar o
  SKILL.md (seção "Diário" datada, sem apagar) ou criar `~/.claude/skills/<nome>/SKILL.md` com frontmatter.
- Os sites vêm das urls nos resumos das ferramentas (`navHostsIn`) ou, sem url, do host da aba ativa
  (`Tab.navSitesTurn`, zerado a cada turno). As skills vêm de `objectiveState.skills` (as da máquina, menos a do
  objetivo).
- (19/10) O agente da `agente-box` acrescentou ao streak.mjs da máquina `box-find --email`, `threads` e `thread-add`
  (vincular uma conversa do Gmail a um box, `PUT /v1/boxes/<box>/threads`, form `threadGmailId`); incorporados ao
  bundle para não se perderem na próxima reinstalação, e a skill da API os documenta. A regra v4 do CLAUDE.md
  (seção "Pedido vago") passa a proibir o agente de editar as ferramentas do app e de encaixar assunto novo no
  único pipeline existente. O balão de skill não aparece depois de um turno que já era o pedido de skill, e só
  um fica à vista por conversa.

## Limite do Fable: o turno refaz com o Opus 5.5 (19 out 2026)

- A CLI do Claude Code devolve "You've reached your Fable limit…" como **texto de resposta**. `runClaude` retém as
  primeiras ~120 letras de cada turno até descartar a hipótese (`LIMIT_RE`), então o aviso nunca chega à conversa:
  vira erro `model_limit`. O provedor refaz o mesmo turno com `--model ${MODEL_FALLBACK}` (padrão
  `claude-opus-5-5`, rótulo `MODEL_FALLBACK_LABEL`), emite o chunk de fallback ("Fable falhou (limite de uso da conta; o Opus 5.5 segue por 60 min)", o app
  mostra como os outros fallbacks) e fica no reserva por `LIMIT_HOLD_MS` (1 h) sem tentar o padrão a cada
  mensagem. No reserva, o system prompt diz ao modelo qual ele é. Se o reserva também bater limite, segue a
  corrente normal (agente → grok-4).
- Verificado na `agente-box` com o limite real ativo: resposta veio do Opus 5.5, o aviso de limite não apareceu,
  log "limite do modelo (…); refazendo com claude-opus-5-5".
- (19/10) Status line: o segmento do modelo mostra o nome do modelo que responde de fato (`/v1/meu-bot/status › model`: o reserva durante o limite, senão o `model` do ~/.claude/settings.json da máquina, em nome legível); grok-4 e backend antigo continuam com o modo.
- (19/10) O 📌 voltou à barra, ao lado do 🔔, com estado: aceso = a aba é site fixo do espaço (clique solta, a aba continua aberta); apagado = solta (clique fixa no espaço ativo; sem espaço, abre o trilho para criar um).
- (19/10) Extensões como no Brave: todas ficam no 🧩 ("Gerenciar extensões": clique no nome abre o popup, 📌 fixa/solta na barra, Remover); na barra só as fixadas (`navExtFixadas:<host>` no localStorage).
- (19/10) Zoom por site no Navegador: botão "%" na barra (alterna 100% ↔ 75%) e Cmd+= / Cmd+- / Cmd+0 (o main devolve as teclas do webview); lembrado por host em `navZoom` (localStorage) e reaplicado em dom-ready/did-finish-load. Resolve a planilha do Streak cortada à direita.
- (19/10) Recortes do Gmail: "Painel do Gemini" (✦, oculto por padrão: `.aUx:has([aria-label="Gemini"])`) e "Painel lateral direito" (◨, visível por padrão: `.bAw:has([role="complementary"])`, `.WN9Ejb.br3`). Eram eles que espremiam a planilha do Streak; vieram do DOM colado pela pessoa.
- (19/10) Recortes: a "Barra superior" também estica a área do InboxSDK (`.inboxsdk__custom_view_element{height:100vh}`): ela tinha altura fixa calculada com a barra e sobrava uma faixa em branco embaixo da planilha do Streak (medido ao vivo: 504 px numa aba de 584). Aplicação dos recortes enfileirada por aba (cliques rápidos não se atropelam) e o botão é atualizado no lugar, sem recriar a barra sob o mouse.

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

## CRM → WhatsApp (contexto nas respostas)

O plugin `meu-bot-crm` do OpenClaw também faz o caminho de volta: antes de cada resposta a um contato numa conversa
direta, o hook `before_prompt_build` busca `GET /v1/crm/contexto?phone=+N` e põe no prompt (`prependContext`) só o
essencial da caixa dele: nome, pipeline, etapa, próximo passo e visão geral do resumo com IA. Anotações fixas,
registros e histórico ficam de fora (podem ter coisa interna). Cache de 60 s por telefone; sem caixa, backend fora
ou `crm.json` com `contextoWhatsapp: false` (`crm.mjs config --contexto-whatsapp false`), nada é acrescentado.

## Limpar histórico do WhatsApp guarda antes no CRM (meu-bot-crm)

No meu-bot-crm, "Limpar histórico" passa antes por "Guardando a conversa no CRM…" ("Excluir conversa" só tira
da lista, sem zerar o agente, então não precisa guardar): o app
lê a conversa só deste contato (até 1000 mensagens por sessão, também quando ela está na sessão principal),
monta o mesmo Markdown da exportação e manda para `POST /v1/crm/whatsapp/arquivar` pelo túnel
(`src/main/whatsapp-crm.ts`). O backend acha ou cria o contato pelo telefone, grava a transcrição como anexo da
caixa mais recente dele com um registro na linha do tempo (sem caixa: em `contato.arquivos`, baixável na página
do contato) e pede ao motor o resumo consolidado, que fica em `whatsapp.arquivo` (o `whatsapp.resumo` da
conversa atual, escrito pelo crm-job, recomeça). O mesmo texto duas vezes não duplica (sha256). Se guardar falhar,
a confirmação volta com o erro e os botões "Tentar de novo" e "Limpar sem guardar"; nunca limpa sozinho. Sem IA,
a transcrição fica e o aviso diz "resumo não atualizado". No meu-bot comum nada muda.

## Google Contatos → CRM (automático)

O meu-bot-crm traz os contatos do Google sozinho: na página Contatos, "Conectar Google Contatos" abre o login do
Google no navegador do Mac (só leitura, API People oficial, PKCE com retorno em 127.0.0.1). O refresh token fica
cifrado no Keychain (userData/google-contatos.bin). O app sincroniza 20 s depois de abrir, a cada 30 min e no
"Sincronizar agora": lê `people/me/connections` e manda para `POST /v1/crm/contacts/import` da máquina (acha por
id do Google, telefone ou e-mail; completa sem apagar; quem não mudou não é regravado). A ficha ganha
"Google Contatos ↗". Código: `src/main/google/` e as rotas locais `/v1/crm/google/*` do proxy da extensão.

Configuração única (o client OAuth do app, igual para todos os clientes):
1. console.cloud.google.com → criar projeto "meu-bot CRM".
2. APIs e serviços → Biblioteca → ativar **People API**.
3. Tela de consentimento OAuth → Externo; nome "meu-bot CRM", e-mail de suporte; escopos `contacts` e `drive.file`,
   `openid`, `email`. Em teste, adicione os e-mails que vão usar (até 100); para todos, publique (o Google pede
   verificação do app para o escopo de contatos; até lá aparece "app não verificado" no login).
4. Credenciais → Criar credenciais → ID do cliente OAuth → tipo **App para computador** → baixar o JSON.
5. Salvar como `config/google-oauth.json` (fora do git) e empacotar, ou copiar para
   `~/Library/Application Support/meu-bot-crm/google-oauth.json` para testar sem reinstalar.

### WhatsApp → Google Contatos

Todo número novo que conversa com o agente no WhatsApp vai para o Google Contatos, no marcador "WhatsApp" (decisão
de 2026-10-20; exige a permissão `contacts` com escrita, e o app pede "Reconectar" se a conexão for só leitura).
O plugin anota cada número em `crm/whatsapp-contatos.json`; `crm-job.mjs contatos-whatsapp` completa com as
conversas antigas e o nome do WhatsApp (do histórico); o backend expõe `GET /v1/crm/whatsapp/contatos`; a cada
sincronização o app cria no Google só os que ele ainda não tem (pelos 10 últimos dígitos) e guarda os criados em
userData/google-whatsapp.json para nunca duplicar.

## Auditoria: quem fez o quê (20 out)

Cada máquina tem um registro de auditoria em `~/.local/share/meu-bot/auditoria.jsonl`, e só o
`backend-colima/auditoria.py` escreve nele. Cada linha registra `{ em, maquina, quem:{tipo,nome}, app, acao, alvo,
detalhe, prev, hash }`.
- **Quem pode aparecer:** `dono`, `admin` (pelo nome do app daquele admin), `agente` (pausa automática da guarda),
  `sistema` (backend: Mac novo, pedido de device) e `legado` (o antigo `suporte.log`, importado na 1ª gravação).
- **Corrente:** `hash = sha256(prev + JSON canônico sem hash)`. Se alguém apagar ou mudar uma linha, a corrente
  quebra dali em diante. `src/main/auditoria-core.ts` confere, e o teste prova que Python e TS calculam o selo igual.
- **Ações:** formam um catálogo fechado (`ACOES`), e o texto mostrado na tela sai dele.
- **Como o app grava:** manda o `auditoria.py` pela entrada padrão do SSH (`auditoriaSh`). O backend e a guarda usam a
  cópia em `~/.local/share/meu-bot/auditoria.py`, que o backend copia na subida.
- **O que entra:** limpar, excluir, restaurar, arquivar, renomear, pausar e retomar (do dono e do admin), guardar no
  CRM, parear e desconectar o WhatsApp, quem o agente responde, instalar e desinstalar o CRM, pedir plano, além das
  ações de suporte do admin (licença, device, reiniciar serviço, áudio, terminal, desligar suporte, excluir máquina).

**Cópia central**
- Fica no usuário Linux `auditoria` da caixa (agente-box), em `/home/auditoria/registro/<maquina>.jsonl`, com corrente
  própria e a hora do servidor.
- Quem entregou vem da chave SSH, não do que o app diz. O `/usr/local/bin/meu-bot-auditoria` é o comando forçado de
  cada chave, e o `authorized_keys` de lá é do root:
  - admin: só grava;
  - chave de entrega das pessoas: só grava;
  - super admin: grava e lê.
- Não há fila separada: a máquina é a fila. O app guarda até onde já entregou (`userData/auditoria-entregue.json`)
  e manda o resto depois de cada gravação. Linhas repetidas são ignoradas.
- Antes de desligar o suporte, o admin entrega o registro, porque depois perde o acesso à máquina.

**Admins**
- Cada admin tem um app e uma chave. O `scripts/suporte-setup.mjs` mantém `build/suporte/admins.json` e gera:
  - o `suporte.json` das pessoas (`admins:[{nome,chave}]`, uma linha `meu-bot-admin:<nome>` por admin no
    `authorized_keys` delas);
  - o `admins/<nome>.json` de cada admin (`admin`, `superAdmin`, caixa);
  - o `authorized_keys` da central.
- Comandos:
  - incluir ou trocar a chave de um admin: `--admin "Fulano" --chave "ssh-ed25519 …"`;
  - tirar um admin: `--remover "Fulano"` (ele perde o acesso quando a pessoa atualiza o app ou religa o suporte);
  - gerar o app de um admin: `./instalar.sh --admin --como "Fulano"`. Sem `--como`, sai o do super admin.

**Telas**
- **Pessoa:** Configurações › Suporte mostra "O que o suporte fez nesta máquina" e o botão "ver tudo" (50 últimas).
- **Super admin:** "🛡 Auditoria" no seletor do meu-bot-admin. Mostra:
  - as máquinas da central;
  - a história de cada uma, com filtros por tipo e texto;
  - os selos "central íntegra" e "cópia da máquina íntegra", e as linhas "apagadas da máquina";
  - **Exportar prova**: JSON com os hashes e um CSV legível.
- Os outros admins não veem o botão, e a central recusa a leitura deles.

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

## Backup completo e mudança de máquina (20 out)

O admin faz o backup de tudo o que é da pessoa numa VM e restaura numa outra.
- **Permissão:** só com a pessoa ligando "Permitir backup completo pelo admin" em Configurações › Suporte
  (`SupportShare.backup`, padrão desligado).
- **Na VM** (`backend-colima/meu-bot-backup.sh`, vai pela linha de comando do SSH em base64):
  - **criar:** para o gateway e o backend por ~1 min, empacota `.openclaw`, `.local/share/meu-bot`, `.hermes`,
    `.claude`, `.local/bin` e o crontab. Ficam fora os modelos de transcrição e voz, os caches, `npm`, `tmp` e
    `stage`. Grava um manifesto com o sha256 de cada arquivo e religa o que estava ligado.
  - **restaurar:** confere os sha256, guarda o que havia em `~/.meu-bot-antes-da-restauracao-<ts>/`, troca o `$HOME`
    antigo pelo novo nos arquivos conhecidos e deixa o gateway DESATIVADO.
  - **ativar-whatsapp** e **desativar-whatsapp:** fazem a troca. Nunca há `channels logout`, porque ele mataria a
    sessão nas duas máquinas.
- **No Mac** (`src/main/admin/backup-admin.ts`, regras em `backup-core.ts`):
  - o stdout do ssh passa pela cifra **age** para o destinatário de backup e vai direto para
    `userData/backups/*.mbbak`. Na volta, o arquivo é decifrado em stream direto no stdin do ssh. Não há texto claro
    em disco;
  - o par é criado pelo `suporte-setup.mjs`: a identidade fica em `~/.ssh/meu-bot-backup.age`, só no Mac do super
    admin (**guarde uma cópia offline**: sem ela os backups não abrem). A pública vai no app de todos os admins
    (`backupDestinatario`);
  - qualquer admin gera um backup; só o super admin restaura.
- **Mudança:**
  1. a pessoa instala o meu-bot na VM nova e liga o suporte;
  2. no admin, a página Suporte da máquina nova mostra "Restaurar um backup aqui", com o pré-voo (espaço, OpenClaw,
     WhatsApp já pareado, usuário);
  3. o app restaura e reinstala Claude Code, backend, guarda, CRM, transcrição e status line;
  4. "Trocar o WhatsApp para esta máquina" desliga o gateway na antiga, se ela ainda estiver no suporte, e liga na nova.
- **Auditoria:** registra `backup.criar`, `backup.restaurar` (com a máquina e o último hash da origem),
  `backup.desativar-origem` e `backup.ativar-whatsapp`.
- **Fora do pacote:** o hermes-agent instalado por npm em `~/.local/lib` e a voz das respostas (religar no tutorial).

## Caixa fixa do grupo no CRM ao limpar o histórico (23 out)

"Limpar histórico" de um grupo guarda a conversa no CRM antes, como a de um contato. Grupo não tem contato único,
então a conversa vai para **uma caixa fixa por grupo**, e o dono não escolhe numa lista (ela só cresce).

- **Dono da caixa é a máquina:** `POST /v1/crm/whatsapp/arquivar` com `grupo: { jid, nome }` acha a caixa pelo
  `fields.whatsappGrupo`; sem ela, abre uma no pipeline padrão, com o nome do grupo, na primeira etapa, já ligada
  (resposta `criada: true`, registro "📦 Caixa aberta para o grupo…"). Sem pipeline padrão responde 400 e nada é
  limpo. O app (`whatsapp-crm.ts` › `whatsappGroupArchiveToCrm`) só manda e conta o resultado; a fase "escolher",
  `boxKey`, `precisaCaixa` e a lista de caixas saíram.
- **Backend 1.0.2:** o `crm-api.js` com grupos tinha ficado em 1.0.0 nos servidores (a versão não subiu com a
  mudança), e o backend antigo respondia "telefone inválido" ao receber um grupo. A sondagem agora atualiza.

## Cópia dos dados da VM no Drive do dono (23 out)

Para ninguém ficar preso a uma VM: uma vez por dia o app manda os dados de cada máquina para o Google Drive **do
dono**. Nada de bucket do fornecedor; cada cliente guarda no Drive dele.

**Cinco conjuntos, cada um em pasta e nome próprios** (`meu-bot / <máquina> / <pasta> / <prefixo>-<máquina>-AAAA-MM-DD.tar.gz`),
para serem restaurados de forma independente. Tamanhos medidos na `agente-box-lv`:

| Conjunto | O que entra | Tamanho |
|---|---|---|
| CRM 🔒 | `crm/db` com anexos | 36 KB |
| Financeiro | `finance/db` com comprovantes | 3 KB |
| Agente 🔒 | `.claude/projects` e `.claude/skills` | 37 MB |
| Trabalho | painel Kommo, catálogo de sites, workspaces, `.hermes`, estado do meu-bot | 195 KB |
| Credenciais 🔒 | `.openclaw`, tokens de Kommo/Cloudflare/GitHub, `authorized_keys`, units systemd | 8 MB |

Os pacotes são feitos com `tar -C $HOME` e caminhos relativos, então **restaurar é extrair sobre o `$HOME`**.

- **Três conjuntos saem cifrados (🔒)**, com `age` e uma senha que o dono define na aba Conta Google (guardada no
  Keychain): Credenciais, e desde 24/10 também **CRM e Agente**, porque o pente fino achou 9 JWTs nos transcripts e
  1 nas conversas arquivadas (token colado no WhatsApp). **Sem senha definida eles são pulados**, com aviso na tela:
  segredo nunca sobe em texto claro, nem "só desta vez". O arquivo termina em `.tar.gz.age` e abre com
  `scripts/abrir-backup.mjs` ou `age -d` e a mesma senha. Perder a senha torna o pacote inabrível; o CRM e o
  Agente continuam com as 7 cópias locais na VM, e as credenciais são reemissíveis.
- **Os dois que sobem sem cifra (Financeiro e Trabalho) passam por varredura antes**, decisão do dono em 24/10:
  `achaSegredo` em `google-core.ts` procura JWT, token do GitHub, chave `sk-` e chave da AWS no pacote
  descomprimido. Achou, o conjunto não sobe e a tela diz o tipo. "Verificado limpo hoje" vira "verificado limpo a
  cada envio".
- **Os segredos do `.hermes`** (`auth.json` e os `.env`) são excluídos do conjunto Trabalho e entram no cifrado:
  o pacote sem cifra nunca carrega credencial.
- **Fica de fora porque se refaz sozinho:** modelos de voz e transcrição (1,6 GB), o clone `skills-cloudflare`
  (um `git clone` traz de volta), `.openclaw/{cache,tmp,extensions,logs}` (183 dos 208 MB), `.npm`, `.cache` e os
  plugins do Claude. E os `db/backup/` de cada store, que são cópia dentro de cópia.
- **Os `autenticador.*` do CRM** também saem: os segredos TOTP são cifrados por uma chave que mora **fora** do
  `db/` justamente para o backup não levá-la, então fora da máquina não abrem.
- Os padrões de exclusão são relativos ao `$HOME` e **sem `./`** na frente; com `./` eles não casam e o que
  deveria sair entra no pacote em silêncio. Há teste travando isso.
- **Quem envia:** o Mac, com a Conta Google do dono e escopo `drive.file` (o app só enxerga o que ele mesmo criou).
  **A VM não ganha credencial nenhuma.** Roda 2 min depois de a extensão do CRM subir e a cada 24 h.
- **Uma cópia por conjunto:** ao subir a nova, as anteriores daquela pasta são apagadas. A ordem é sempre subir
  primeiro e apagar depois. Só são apagados arquivos do padrão daquele conjunto **e daquela máquina**.
- **Cópia local também:** antes de subir, o pacote é gravado em `~/Documents/meu-bot/backup/<máquina>/`. Se o Drive
  falhar, ainda sobra um pacote fora da VM. O botão **Abrir a pasta no Mac** abre isso no Finder.
- **Desligar:** `dadosNoDrive: false` no `settings.json`, ou o botão na tela.
- **Auditoria:** registra `backup.dados-drive` com os conjuntos que subiram.

**Restaurar numa VM nova:** `tar -xzf <pacote>.tar.gz -C ~` para os quatro sem cifra. Em seguida
`POST /v1/crm/reindex`.

**Abrir o pacote cifrado:** o `age` de linha de comando não vem instalado, e um backup que não se abre não é
backup. Use o script do repositório, que usa a mesma biblioteca do app e só precisa do Node:

```sh
node scripts/abrir-backup.mjs ~/Downloads/credenciais-<máquina>-AAAA-MM-DD.tar.gz.age
```

Ele pede a senha no terminal **sem eco** (senha em argumento ficaria no histórico do shell e no `ps`), escreve o
`.tar.gz` ao lado com permissão 600 e mostra os comandos para conferir e restaurar. Senha errada dá erro claro, não
lixo. `--saida <pasta>` escolhe onde gravar. O arquivo decifrado tem credenciais em texto claro: apague depois.

Não confundir com o **backup completo e mudança de máquina** (acima): aquele é manual, cobre a máquina inteira e
depende da chave `~/.ssh/meu-bot-backup.age`. Este é automático, por conjunto, e a cifra é por senha do dono.
**Religar o WhatsApp numa VM nova continua sendo o fluxo `ativar-whatsapp`/`desativar-whatsapp`** do
`meu-bot-backup.sh`, que nunca faz `channels logout`: restaurar o arquivo não substitui esse passo.

## Chave própria do agente no CRM e exclusão que pede (24 out)

O agente do WhatsApp usava a **mesma** `OPENAI_COMPAT_KEY` do app e declarava a própria identidade num cabeçalho
(`X-Crm-Por`) que nenhuma rota conferia. Em 23/10 ele esvaziou e apagou um pipeline inteiro por conta própria,
dirigido por mensagens de terceiro. Agora:

- **`CRM_AGENT_KEY`** no `.env` do backend (`install.sh` cria; em `.env` antigo, acrescenta sem tocar no resto).
  `crm/backend.mjs` usa essa chave; sem ela cai na do app e avisa uma vez no stderr para reinstalar.
- **Identidade carimbada pelo servidor** (`papelDe` em `server.js`): `app` ou `agente`, pela chave usada. O
  `X-Crm-Por` virou só sub-rótulo do app (ex.: `google`) e não eleva ninguém. O feed `mudancas.jsonl` passa a
  ser auditoria confiável.
- **Apagar é do dono.** Qualquer `DELETE` vindo da chave do agente volta 403 `exclusao_requer_dono`, registra
  `exclusao.pedida` no feed e, quando há box, deixa um comentário "🗑 O agente pediu para apagar…" para o dono
  confirmar no app ou no Gmail. A skill `crm-api` diz isso ao agente.

**Limite honesto:** o agente roda como o mesmo usuário Unix do backend e consegue ler a chave do app no `.env`.
A separação sobe o custo de "mudar um cabeçalho" para "ler de propósito um arquivo que a regra proíbe", e torna
cada exclusão auditável pela chave usada. Não é fronteira dura; fronteira dura é outro usuário Unix ou um proxy.

**Segredo recebido em mensagem** (regra v5 do CLAUDE.md do agente, `install-navegador-mcp.sh`): grava em
`~/.config/<serviço>/` e responde "guardado"; nunca repete o valor em texto, resumo, comentário ou skill. Era a
causa raiz dos tokens nos transcripts.

**Portão de senha dos sites** (`site-middleware.js`): senha errada custa 1,5 s (sem estado, cabe no Pages
Functions) e o cookie é salgado com o commit do deploy, então troca a cada publicação.

**Limpar histórico do WhatsApp:** se a exportação bater no teto de 1000 mensagens, o app recusa limpar em vez
de guardar 1000 e zerar o resto em silêncio.

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

## Backup: tar 1 ("file changed as we read it") não é erro (25 out)

Na `grokbot-1` o conjunto "trabalho" passou a falhar com `tar: .hermes: file changed as we read it`: o Hermes grava
sessões o tempo todo e o GNU tar sai com 1 quando um arquivo mudou durante a leitura, com o pacote inteiro mesmo assim.
`comandoPacoteSh` (google-core.ts, puro, testado com um `tar` falso) é agora o dono do comando remoto: lista só o que
existe, sai com 3 sem nada, trata 1 como aviso (stderr + linha no log) e sucesso, e mantém 2 (fatal) como erro.
Medido depois: 218 MB para "trabalho" na grokbot-1, abaixo dos 512 MB.

## CRM e financeiro numa máquina sem OpenClaw (25 out)

- `install-crm.sh` deixou de recusar máquina sem OpenClaw (saía com 2: "instalador saiu com código 2" no tutorial 10 da
  `grokbot-1`). Sem OpenClaw entram a CLI `crm.mjs`, as skills `crm-api`/`streak-crm-api` e a pasta `crm/` (marcador
  `index.js` para a sondagem); o plugin do WhatsApp (hooks, notas automáticas, `crm-job.mjs`) é só do OpenClaw e a
  saída diz isso. `install-finance.sh` já fazia o mesmo.
- `crm/backend.mjs` e `finance/backend.mjs` achavam o `.env` do backend sempre na pasta herdada do Hermes: na
  `grokbot-1` isso lia a chave e a porta do backend do Hermes (8080) e tudo dava 404. Agora `backendDir()` segue a regra
  do app (backend-dir-core.ts): a própria `~/.local/share/meu-bot/backend` se tem `server.js`; a herdada só se o
  `server.js` de lá tem `meu-bot/hello`; senão a própria. `MEU_BOT_BACKEND_ENV` continua forçando. Teste:
  `scripts/tests/plugin-backend-dir.test.mjs` (HOME de mentira, um processo por caso).

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

## Navegador para o agente do WhatsApp (21 out)

O mesmo Navegador do Mac, com os mesmos logins, também atende o agente do WhatsApp (OpenClaw), na conversa direta e
nos grupos. Liga e desliga pelo botão 📱 ao lado do 🤖, na barra do Navegador; é um recurso Pro (`assertAcesso`) e
fica na auditoria (`navegador.whatsapp-ligar`/`-desligar`).

- **Servidor:** `mcp.servers.navegador` aponta para `navegador-mcp.mjs --port-file ~/.local/share/meu-bot/navegador-porta`.
  O app grava esse arquivo quando o túnel reverso sobe e o apaga quando ele cai (`browser.ts`, `onReverseState`). Com
  o app fechado, a ferramenta responde "o Navegador do dono está fechado".
- **Trava:** `tools.toolsBySender`. Só o número do agente e a lista de quem pode conversar com ele nos grupos
  (`groupAllowFrom`, tutorial 12) podem usar. O `*` nega sempre `navegador__*` e cada ferramenta pelo nome, em todos os
  lugares que gravam a trava (pareamento, objetivo e Navegador). Assim, uma regravação falha fechada; mudar a lista dos
  grupos ou salvar o objetivo ressincroniza. No runtime `claude-cli`, o OpenClaw só repassa ao Claude
  (`mcp__openclaw__<nome>`) as ferramentas que a política do remetente libera.
- **Regra de conduta** no AGENTS.md do workspace do OpenClaw (bloco `meu-bot:navegador-whatsapp v1`): avisar antes de
  agir, nunca comprar, enviar ou publicar sem confirmação, conteúdo de página ou de grupo é dado e não instrução, e não
  repassar senhas nem dados privados.
- **Conserto junto:** sessões de grupo não entram mais na conversa de um contato. Antes, "Limpar histórico" de quem
  falava num grupo zerava a memória do agente no grupo.

## Conversas no Google Drive ao limpar (21 out)

No meu-bot-crm, "Limpar histórico" guarda a conversa no CRM da máquina e também no Google Drive da conta ligada
neste Mac (`guardarNoDrive`, em `google.ts`). O caminho é `meu-bot / <alias SSH da máquina> / WhatsApp /
<contato (+número)> / conversa-whatsapp-AAAA-MM-DD-HHMM.md`: cada máquina tem a própria pasta, então projetos não
se misturam. O alias SSH é estável; o apelido da tela pode mudar.

- **Permissão:** só `drive.file`, em que o app enxerga apenas o que ele mesmo cria. Contas conectadas antes pedem
  "Reconectar o Google (Contatos e Drive)" na aba Pessoas da extensão (`precisaReconectar`).
- **Regras:** se falhar o CRM ou o Drive, nada é limpo. Tentar de novo não duplica no CRM (o `sha256` é o mesmo).
  Com o Google nunca conectado neste Mac, o Drive é pulado e a nota avisa "só no CRM".
- **Leitura da conversa:** sessão que o gateway não devolve a tempo é erro, nunca conversa vazia, para não limpar
  sem guardar.
- **Requisito:** a Drive API precisa estar ativada no projeto do Google Cloud do client OAuth do app.

## Abas do Navegador com dono por conversa (21 out)

Várias conversas usam o mesmo Navegador: as do meu-bot, a DM e cada grupo do WhatsApp. Cada pedido do servidor do
Navegador (`navegador-mcp.mjs` v2) leva `X-Meu-Bot-Dono` (base64 de `{id, rotulo, origem}`):
- **meu-bot:** `--dono meu-bot:<conversa> --rotulo <título>`, vindos do backend (`X-Conversation-Id` mais o
  `X-Meu-Bot-Browser-Rotulo` que o app manda).
- **WhatsApp:** a chave da sessão do OpenClaw (`OPENCLAW_TOOLS_MCP_AGENT_SESSION_KEY`) se vier no ambiente; senão, um
  id por processo.
- **Backend antigo, sem cabeçalho:** conta como uma conversa só, `meu-bot:legado`.

Regras em `src/main/nav-donos-core.ts` (testadas), aplicadas em `nav-api.ts`:
- `abrir` sem aba cria ou reaproveita uma aba da própria conversa, nunca a da frente; no máximo 3 por conversa.
- Ações sem aba vão para a aba da conversa. Ler e print valem em qualquer aba.
- Mexer na aba de outra conversa é recusado ("em uso por outra conversa; use abrir com nova=true").
- A posse expira em 10 min sem uso. Ações na mesma aba entram numa fila.
- Ferramenta nova `fechar`, só para aba da própria conversa.
- Pedido do WhatsApp abre a aba em segundo plano (`browser:ask` com `fundo`): a tela da pessoa não muda.

**Na tela:** cada aba mostra o ID (`aba <n>`, o número que o agente usa) ou o selo da conversa dona: `📱 d585b772`
(os 8 primeiros caracteres da sessão do OpenClaw, o mesmo "ID" da aba da conversa), `🤖 <id da conversa>` ou
`✳️ Claude Code (Mac)` (origem `claude-code`, o Claude Code deste Mac pelo socket). Um clique
copia a referência: máquina, aba, url e dono, com chave e sessão. A máquina com o servidor v1 é atualizada sozinha
(`navegadorInstalled` e `mcpfile` conferem o marcador `meu-bot-navegador v2`).

## Primeiro pipeline do CRM no tutorial 10 (21 out)

O CRM só anota conversas do WhatsApp com um pipeline padrão. A box-lv tinha o CRM instalado e nenhum pipeline, e a
pessoa só recebia no WhatsApp o erro da CLI (`config --pipeline <key>`).

- **Tutorial 10 (`crm-gmail`):** ganhou o passo **"Criar o primeiro pipeline"**, antes do Streak e do teste. Ele conclui
  pelo estado real (`ctx.crm.local.padrao`): quem já tem pipeline padrão continua concluído.
- **Corpo do passo** (`renderCrmPipeline`):
  - modelos prontos de mídia paga ("Operação de mídia paga" e "Testes de anúncio") ou "Do meu jeito", em `lib/crm-modelos.ts` com
    `validarPipeline`: de 2 a 12 etapas, sem repetir;
  - com vários pipelines e nenhum padrão, escolher qual o WhatsApp usa.
- **Main** (`crm-local.ts`): `GET /v1/crm/pipelines` e `/config`, `POST /pipelines` e `PUT /config`, pelo túnel. Canais
  `crm:local`, `crm:pipeline-criar` e `crm:pipeline-padrao`; na auditoria, `crm.pipeline-criar` e
  `crm.pipeline-padrao`.
- **Aviso no WhatsApp:** `regras.mjs` › `avisoSemPipeline` dá o caminho no app (e "me peça aqui: cria um pipeline…"),
  com texto próprio para o CRM próprio e para o Streak.
- **O plugin do CRM agora se atualiza sozinho:** o probe lê `crm` e `crmVersion` e o seletor roda `installCrm` quando
  `deveAtualizar`. Só onde o CRM já está instalado. Versão 1.1.0.

## Skill do token do Cloudflare e ferramenta `guardar` (22 out)

- **Ferramenta `guardar` do Navegador** (`navegador-mcp.mjs` v4): lê um valor na página, por seletor ou por expressão
  regular, e grava direto num arquivo da máquina. Só dentro de `~/.config/`, sem link, com pasta 0700 e arquivo 0600.
  Ao modelo volta só o número de caracteres: a credencial não passa pela conversa. A trava do WhatsApp nega
  `navegador__guardar` para quem não está liberado, como as outras ferramentas.
- **Skill `cloudflare-token`** (`backend-colima/skill-cloudflare-token.md`): é semeada pelo `install-navegador-mcp.sh`
  junto com o Navegador e não sobrescreve a versão que o agente tiver ajustado. Ela cria um token só de leitura
  (DNS:Read e Zone:Read, uma zona) pelo dashboard. Escolhe as opções das listas de React por `js` com `[role=option]`,
  para antes do "Create Token" para o dono conferir, usa `guardar` e testa com `verify` e uma leitura do DNS. Recusa
  pelo WhatsApp. Se algo do token vazar, faz "Roll". Validada na agente-box-lv em 22 out.
- **Acervo:** o primeiro cartão é "Token do Cloudflare (só leitura)". Skills que já vêm com o meu-bot têm `usar`, com o
  botão "Criar o token" e o pedido pronto, em vez de "Pedir ao agente para instalar".

## Links do terminal e tutorial 13 · Conectar contas na máquina (22 out)

- **Links do terminal** abrem no Navegador do app (Cmd+clique abre no navegador do Mac).
- **Retorno de login de CLI** (`browser.ts` › `retornoParaMaquina`): numa janela de máquina por SSH, quando a página vai
  para `http://localhost:<porta>/…` com cara de retorno OAuth, o app entrega esse endereço na máquina por SSH (`curl`) e
  segue para o redirecionamento ou mostra "Login concluído". É assim que o `wrangler login` termina, mesmo com o
  navegador no Mac.
- **Tutorial 13 (`contas-cli`, after 1, só em máquina por SSH):** "Conectar" roda o login da ferramenta na máquina e o
  link abre sozinho no Navegador. Não precisa de terminal.
  - **Cloudflare:** `wrangler login --scopes account:read user:read pages:write zone:read`, só sites e domínios.
    - O `wrangler login` puro pede quase a conta inteira: Workers, D1, e-mail e segredos.
    - Quando a conta foi logada com mais que isso, o passo avisa "acesso amplo" e "Conectar de novo" troca o acesso.
    - Sem o Navegador (sem Pro), o login vai por código de dispositivo (`--device`).
  - **GitHub:** `gh auth login -w` sem terminal, por código de dispositivo. O código aparece no passo com o botão
    Copiar. O passo é opcional: "Não uso GitHub".
  - **Status:** `contas-cli-core.ts` › `STATUS_SH`, um SSH só.
    - Sem o arquivo de login do wrangler, não chama o `npx`.
    - A saída vai para um arquivo com `timeout`: num pipe, o `npm exec` às vezes fica pendurado.
  - **Canais:** `contas:status` (shared); `contas:entrar`, `contas:cancelar` e `contas:sair` (client); evento
    `contas:evento`.
  - **Quem usa a conta:** a credencial fica na máquina. No WhatsApp, só o dono tem `exec`; grupos e as outras pessoas
    da lista não rodam comandos.

## Terminal controlado de fora, divisão por arrasto e trava de leitura (22 out)

- **MCP de controle do app para o Claude Code** (`scripts/app-mcp.mjs`, um arquivo, sem npm; registrado com
  `claude mcp add --scope user meu-bot-app -- node …/scripts/app-mcp.mjs`): fala com os sockets de `/tmp/<app>-<uid>/`
  (`term.sock` e `nav-<máquina>.sock`) e expõe `apps`, `app_abrir`, `terminais`, `terminal_abrir/ler/digitar`,
  `tela_dividir/juntar` e `nav_*` (abas, abrir, ler, clicar, digitar, tecla, print, recarregar, voltar, js, fechar), com
  a identidade `claude-code:mac`. Ao fechar a entrada, espera as chamadas em andamento (`app_abrir` leva segundos).
- **Terminal API** (`src/main/term-api.ts`, núcleo `term-api-core.ts` testado): socket `term.sock` em
  `/tmp/<app>-<uid>/` (0600), **só neste Mac**: nunca vai pelo túnel (lá quem pede seria o agente, e o terminal é o
  shell da pessoa). `GET /terminais`; `POST /abrir {maquina?}` manda `term:ask` à janela da máquina e espera a sessão
  nova (`waitNewTerminal`); `POST /ler {id, linhas?}` devolve a tela sem ANSI (o `\r` recomeça a linha); `POST
  /digitar {id, texto, enter?}` ou `{id, tecla}` (`enter`, `tab`, `esc`, `ctrl+c`…, até 4000 caracteres). O
  conteúdo digitado nunca vai para o log.
- **ID e selo no terminal:** o topo de cada terminal mostra `ID <sessão>` (clique copia a referência) e, por 10 min
  depois do último uso pela API, o selo de quem usou e o quê (`✳️ Claude Code (Mac) · digitou às 00:19`); o selo
  também aparece na aba "Terminal N". Quem pede manda `X-Meu-Bot-Dono` (o mesmo do Navegador); sem cabeçalho vira
  "controle local (sem identificação)". Evento `term:dono`.
- **Várias abas:** botão "+ Novo terminal" no topo do terminal, Option+clique em "Terminal" na lateral ou
  Cmd+Shift+J.
- **Divisão dentro do Navegador (22 out):** `navLado` = aba fixada ao lado da ativa (Option+clique na aba; de novo
  tira; clicar na aba do lado troca as duas; fechar uma delas desfaz). `navAplicarLado()` põe `.nav-box.lado` em grid
  (ativa | divisor `.nav-split-handle` | lado) e marca os webviews com `nav-view-esq`/`nav-view-dir`; a barra de
  endereço, ←/→ e ★ seguem a ativa. Lembrado em `navAbas:<host>` (`lado`). A barra de favoritos sempre começa à
  vista: esconder vale só até fechar o app (`navFavsShown` só em memória; a chave antiga `navFavsShown` é apagada).
- **Várias colunas:** `splitPages` (lista) em vez de uma página só. **Nada muda de lugar no DOM** (mover um
  `<webview>` recarrega o Navegador): com a divisão ligada, `#panels` vira um grid (`--grade`: o que está na frente |
  divisor | colunas) e cada painel à vista ganha `split-cell` + `grid-column`; `layoutSplit()` deriva o layout inteiro
  do estado e roda depois de qualquer mudança (`relayoutSplit` em `activate`, `activatePage`, `deactivatePage`,
  `syncRest`). O `#split-panel` saiu do HTML; o `#split-handle` vive dentro de `#panels` (coluna 2). Quantas aparecem segue a largura (`maxColunas`: 320 px da conversa + 260 px por coluna, teto
  8); as que não cabem ficam `[hidden]` e voltam ao alargar. Arrastar outra aba para a direita acrescenta coluna
  (cheia: substitui a última, `splitAdd`); para a esquerda tira só aquela; clicar numa aba com a tela dividida troca a
  última coluna. Preferência `{pageIds, ratio}` (aceita o antigo `{pageId}`). Controle local: `/dividir` acrescenta,
  `/juntar {id|pagina}` tira uma, `/juntar {}` tira todas.
- **Coluna vazia (a cobrinha):** página `vazia-N` sem aba, com a cobrinha da tela vazia (`mountSnake`), uma dica e ×.
  A cobrinha só fica ao lado de algo de verdade: fechar a página de uma coluna deixa uma vazia no lugar
  (`vaziaNoLugar`) só se outra página de verdade continua ao lado (senão a divisão acaba); fechar a última conversa
  com a tela dividida (`semConversaNaDivisao`, em `afterTabGone`) tira as vazias, acaba a divisão e põe a página da
  coluna alvo em tela cheia (sem página nenhuma, fica a cobrinha da tela vazia). A próxima
  página aberta com a tela dividida (aba, lateral, paleta, controle local) entra na **coluna alvo** (`alvoAtual`: a
  primeira vazia, senão a última clicada, marcada com um fio no topo). Paleta "Nova coluna vazia";
  `/dividir {pagina:"vazia"}`. As vazias não entram na preferência lembrada.
- **WhatsApp lado a lado e janela estreita:** Option+clique numa conversa ou grupo da lista abre numa coluna nova
  (`openWaChat`/`openWaGroup` com `aoLado`). Mínimos menores (conversa 300 px, coluna 260 px; recolhe abaixo de
  566 px); se mesmo assim a direita recolher com a lateral aberta, `splitOn` esconde a lateral (Cmd+B traz). Sem
  conversa do meu-bot não há divisão: a página vai para a frente em tela cheia, e com qualquer aba de página aberta a
  cobrinha não aparece (`syncRest` traz a última página). Janela estreita com a direita recolhida: clicar numa página
  sai da divisão.
- **Divisão por arrasto:** sai o ⫿ da aba. Arrastar a aba de uma página para a metade direita do conteúdo põe lado a
  lado; para a esquerda (estando lado a lado) volta à tela inteira. A camada `.split-drop` cobre o conteúdo durante o
  arrasto (o `<webview>` engole os eventos) e aparece um tique depois do `dragstart` (no mesmo tique o Chromium
  cancela o arrasto).
- **Abas novas pedidas cedo demais:** `browser:ask` de aba nova chegando antes de o Navegador ficar pronto (app
  abrindo, partição ainda nula, ou a página fechada) era descartado e o agente recebia "a aba nova não apareceu".
  Agora entra em `navPedidosNovos` e é atendido no fim de `openNavTab`; com o Navegador fechado, ele abre.
- **Trava por remetente (22 out, 2ª rodada):** no claude-cli o OpenClaw passa `--tools` só com as nativas permitidas e
  trata `grep` como a capacidade `read` (Glob/LS nem existem no mapa), então negar `read` já cobre o Grep. O que vazava
  eram as ferramentas do próprio OpenClaw (MCP `openclaw`): `DESCONHECIDO_DENY` ganhou `web_fetch` (alcança o gateway
  local), `message` (mensagem a terceiros), `group:sessions` (histórico de outros clientes) e `group:ui`
  (navegador/terminal/tela); `NON_OWNER_DENY`/`OTHERS_DENY` ganharam `group:automation`, `group:nodes`, `terminal`,
  `skill_workshop` e `sessions_spawn`. Aplicado à mão na box-lv (backup `openclaw.json.bak-trava2-*`).
- **Trava de leitura para desconhecidos:** com o WhatsApp aberto (`dmPolicy: open`), o `"*"` do
  `tools.toolsBySender` não negava `read`: um cliente podia pedir o conteúdo de `~/.config` (tokens) ou da
  configuração. `DESCONHECIDO_DENY = ["read"]` (`navegador-whatsapp-core.ts`) entra só no `"*"`; quem é liberado por
  número (equipe) não herda (`travaNavegador`). `code_execution` (do `group:runtime`) passa a ser negado junto com
  `exec` para todos que não são o dono. Aplicado à mão na box-lv (backup `openclaw.json.bak-trava-*`, hot reload).
- **Skill `subir-site-cloudflare`** (semente em `backend-colima/`, cartão no Acervo): projeto Pages, deploy com
  `npx wrangler@4`, domínio no projeto, CNAME com proxy, espera `active` e testa por `@1.1.1.1` + `curl --resolve`
  para não envenenar o cache de DNS negativo do computador (o Tailscale guardou o NXDOMAIN por ~30 min no teste).
- **Chaveiro em staging (22 out):** `main.ts` passa `--use-mock-keychain` ao Chromium nas variantes `*-staging`: a
  chave dos cookies (e do `safeStorage`) deixa de ficar no Keychain, então o rebuild não pede mais a senha do Mac. Na
  troca, cookies do Navegador e blobs do `safeStorage` (Google, Tailscale) daquela variante ficam ilegíveis uma vez
  (refazer o login). Produção continua no Keychain.
- **Chaveiro a cada rebuild:** o item "<app> Safe Storage" guarda uma lista `partition_id` com o **cdhash** de cada
  build (certificado autoassinado não tem Team ID), então cada rebuild pede a senha de novo mesmo com "Permitir
  Sempre". A regra do certificado (`certificate leaf`) já é estável; só um certificado Apple (Team ID) resolve de vez.

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

## Licença lida por SSH quando o backend não tem a rota (24 out)

Sintoma: o admin liberou o Pro da `grokbot-1` (gravou `licenca.json` lá, e o próprio admin passou a mostrar "pro"),
mas o meu-bot da pessoa continuou free. Causa: o app lia a licença só por `GET /v1/meu-bot/license`, rota do
backend-colima; a `grokbot-1` roda o backend original do Hermes, sem ela, e `fetchLicense` devolvia null ("backend
antigo"). Correção: `src/main/licenca-maquina.ts` (`lerLicenca`): backend primeiro; sem resposta e fora de `local`,
lê `licenca.json` + `maquinas.json` por SSH (`readLicenseViewSsh`, que era o `readLicenseView` do admin e saiu de
`admin/support-admin.ts` para cá; o admin importa daqui). `license:get`, `browser:open` e os gates de
`acesso.ts` (Pro, CRM próprio, financeiro) usam `lerLicenca`.

## Backend do meu-bot agnóstico de agente (25 out)

Princípio: o app não depende de qual agente roda o WhatsApp na máquina (Hermes, OpenClaw, PicoClaw). O backend do
meu-bot (`backend-colima`) é serviço nosso e tem pasta própria. Até aqui ele vivia numa pasta herdada do Hermes
(`~/.hermes/agente-rene/backend-sdk-claude`, porta 8080) e a sondagem chamava de "backend instalado" qualquer
`server.js` que estivesse lá; na grokbot-1 esse `server.js` é o do Hermes, e daí vinham o "Reinstalar backend" perigoso
(o `install.sh` já recusava, mas o seletor oferecia) e "o backend desta máquina é anterior ao financeiro".

- **`src/main/backend-dir-core.ts`** (puro, testado com bash num HOME de mentira): `BACKEND_DIR_CANONICAL` =
  `~/.local/share/meu-bot/backend` (ao lado da licença e do CRM), `BACKEND_DIR_LEGACY` = a herdada, e `BACKEND_DIR_SH`,
  trecho de shell que deixa em `$BD` a pasta do nosso backend (a própria se existe; a herdada só quando o `server.js` de
  lá tem a rota `meu-bot/hello`, que só o nosso tem) e `$FOREIGN=1` quando a herdada tem outro backend.
- **Quem usa:** a sondagem (`hostProbe.ts`: `env`, `server`, `VERSION`, porta do `.env`, modelos; `backendInstalled`
  agora só para o nosso; campo novo `backendForeign`), o túnel (`tunnel.ts` lê a chave de `$BD/.env`), a chave xAI
  (`xaiKey.ts`), o log do backend no admin (`support-admin.ts`), o `install.sh` (mesma regra em bash; `MEU_BOT_BACKEND_DIR`
  força), o `install-grok-oauth.sh` e o backup (os dois `.env` na lista de caminhos).
- **Instalações existentes não mudam:** colima e as `agente-*` têm o nosso `server.js` na herdada e continuam lá.
  Instalação nova (ou máquina com outro backend na herdada) vai para a pasta própria; com a 8080 ocupada, o seletor já
  escolhe a primeira porta livre e grava só para a máquina (`portaParaInstalar`), e o texto diz de quem é a 8080.
- **Auto-update do backend:** a trava deixou de ser "gateway é Hermes" e passou a ser estrutural: `backendInstalled`
  falso para backend que não é nosso → `precisaAtualizarBackend` devolve "nao".
- **Licença e CRM numa máquina só com Hermes:** a extensão do CRM, a importação do Google e "Guardar no CRM" exigem a
  licença lida pelo NOSSO backend (`crmDaMaquinaOk`, `lerLicencaDaMaquina` → `{view, viaBackend}`): Pro lido por SSH
  numa máquina sem o nosso backend não carrega nada, para não haver 404 (`assertCrmProprio` explica "instale o
  backend"). O `install.sh` sobe por PM2 onde não há systemd (grokbot-1) e "reinstalar" vira `pm2 restart --update-env`.
- **grokbot-1:** backend do meu-bot instalado em `~/.local/share/meu-bot/backend` na porta 8081, sob PM2
  (`meu-bot-backend`, `pm2 save`); o do Hermes segue na 8080 com o WhatsApp. No app, o chat dessa máquina passa a usar
  `claudecode`/`agente` (os modelos `rene*` são do backend do Hermes); financeiro e licença pela API nossa.
- **Limpar histórico no Hermes (25 out):** `whatsappClearPlan` devolve o id da sessão viva do contato (`sessionIds`; sem
  "principal" compartilhada) e `whatsappClearSessions` encerra pelo `HERMES_END_SH`: `SessionDB.end_session(id,
  "session_reset")` com o Python do runtime do Hermes, exatamente o que o `/reset` do gateway faz; na próxima mensagem o
  gateway vê a rota encerrada e abre sessão nova (auto-cura dele). A lista mantém o contato (sessões encerradas contam
  para presença, não para ler); o fluxo da tela é o mesmo do OpenClaw: guardar no CRM (agora pelo nosso backend na
  8081) e depois limpar. "Pausar" segue fora: o `hermes pause` é parada geral, não por contato.
- **Grupos numa máquina sem OpenClaw (25 out):** a área "Grupos" aparecia na grokbot-1 (a skill whatsapp-grupos da
  época do Hermes ainda lista os grupos) e, sem `openclaw.json`, `gruposDaMaquina` julgava a política com uma
  configuração vazia e acusava "A configuração admite TODOS os grupos": alarme falso. Agora `todosAdmitidos` só é
  calculado com o `channels.whatsapp` em mãos, e o menu "…" de grupo no Hermes tem só "Copiar ID" e "Atualizar lista"
  (`waGroupMenuTemplate(agente, gateway)`).
- **Backup do Drive numa máquina com Hermes (25 out):** o pacote "trabalho" (sem cifra) levava o `.hermes` inteiro:
  na grokbot-1 são 2,5 GB (node_modules do backend do Hermes 1,2 GB, venv do Whisper 433 MB, caches) e o envio parava
  em "passou de 512 MB"; pior, `.hermes/.env` (tokens) e `.hermes/whatsapp/session` (sessão do WhatsApp) iam no pacote
  sem cifra, porque os padrões `.hermes/*/.env` não casam na raiz. Agora `CONJUNTOS_DADOS.trabalho.excluir` tira
  `node_modules`, `venv-whisper`, `cache`, `tmp`, `logs`, `sandboxes`, `audio_cache`, `bin`, `.env*`, `whatsapp/session*`
  e `whatsapp/backups`; `credenciais` (cifrado) ganha `.hermes/.env` e `.hermes/whatsapp/session`. Sem senha de backup
  definida em Conta Google, credenciais continuam não subindo: regra de sempre (credencial nunca vai sem cifra).
- **Grupos no Hermes: Limpar histórico e Excluir (25 out):** pedido do dono: "Limpar" e "Excluir" nos dois menus, grupo e
  conversa, nos dois gateways. No OpenClaw "Excluir da lista" passou a aparecer sempre (não só com o agente desligado).
  No Hermes: `HERMES_GROUPS_PY` lista as sessões de grupo (uma por grupo e por remetente, nome de quem falou no
  `origin_json.user_name`), `hermesGroupSessions`/`hermesGroupOfKey` (puros), `whatsappGroupThread` monta a conversa
  com `autor` por sessão, `whatsappGroupClearPlan` conta as sessões vivas e `whatsappGroupClear` encerra todas pelo
  `HERMES_END_SH`. `hostIsHermes` decide pelo gateway da última consulta ou por `~/.hermes/whatsapp` por SSH.
- **Ouvir áudios e voz no Hermes (25 out):** "Ativar transcrição" na grokbot-1 rodava o `install-transcricao.sh`, que é
  do OpenClaw, e parava em "esta máquina não tem OpenClaw". No Hermes a transcrição já existe (config.yaml: `stt.enabled`,
  provedor `mac-whisper` com faster-whisper local de reserva) e a voz é `voice.auto_tts`. `src/main/hermes-audio.ts`
  lê isso com o Python do runtime do Hermes; o handler `whatsapp:status` completa `audioIn`/`audioOut` quando o
  gateway é Hermes; `installAudio` recusa com a explicação; a tela mostra "✓ ativo: o Hermes transcreve" e a voz só
  como leitura, sem botões de instalar.


## Curva ABC: submódulo de Finanças (26 out)

Aba "Curva ABC" ao lado da "Visão geral" na página Finanças. Compras (saídas, valor < 0) ou vendas (entradas, valor > 0),
agrupadas por favorecido (fornecedor/cliente) ou por categoria, nos últimos 1, 3, 6 ou 12 meses, na moeda de exibição.

- Regra única no modelo (`finance-modelo.js › curvaABC`, pura, testada): ordena do maior para o menor e classifica pelo
  acumulado ANTES do item: A enquanto < 80%, B enquanto < 95%, C o resto (o item que cruza os 80% ainda é A). Favorecido
  agrupa pela chave sem caixa/acento (`favorecidoKey`) e mostra o nome do lançamento mais recente.
- API: `GET /v1/finance/abc?lado=compra|venda&por=favorecido|categoria&meses=1..24[&ate=AAAA-MM]` → total, classes
  (itens, valor, %) e itens (pos, nome, valor, %, acumulado, lançamentos, classe). App: `financeAbc` (IPC `finance:abc`).
- Backend 1.1.1: as máquinas recebem a rota pela atualização automática do seletor.

### Importar do Google Sheets (26 out)

Na aba Curva ABC, cartão "Importar do Google Sheets": cola o link, escolhe compras ou vendas, pré-visualiza e importa.
- O Mac lê as células com a Conta Google do app (`planilhaLer`, escopo de planilhas): a planilha precisa estar
  compartilhada com a conta conectada na aba Conta Google daquela variante do app. Sem aba, lê a primeira (A1:Z5000).
- A máquina interpreta e grava (`finance-modelo.js › linhasDePlanilha` + `POST /v1/finance/importar`): cabeçalho com
  Data, Fornecedor/Cliente/Nome e Valor (achado até a linha 20; título acima é ignorado); Categoria, Tipo e Obs opcionais.
  Cada linha passa pelo mesmo `novoLancamento`, com origem "planilha", status confirmado e `ref` (fonte + data +
  favorecido + valor + ocorrência): reimportar a mesma planilha só traz o que é novo. Compra sem categoria cai em
  "Fornecedores" (criada se faltar); venda em "Vendas". `simular` = prévia sem gravar. Auditoria: `financeiro.importar`.
- Backend 1.1.2.

### Curva ABC por produto e vendas só reais (26 out)

- Lançamento ganhou `produto` e `qtd` (peças) opcionais; a planilha os lê das colunas Produto/Item/SKU/Modelo/Referência
  e Quantidade/Qtd/Peças. A curva ganhou `por=produto` (padrão da API e da tela): agrupa por produto sem caixa/acento,
  soma as peças e conta à parte (`semProduto`) o que entrou sem produto. Exemplo da planilha de vendas do Junior:
  `Data | Cliente | Produto | Quantidade | Valor`, uma linha por item vendido.
- Curva de vendas conta só dinheiro que entrou: ficam de fora as categorias de ganho indireto (estimado, "tempo
  poupado") e o saldo inicial. Antes elas apareciam como "clientes" (LV, 26/10).
- Backend 1.1.3.

## Vendas do CRM alimentam o financeiro (26 out)

`backend-colima/crm-finance-vendas.js`: o sentido inverso do finance-crm-sync.js. Pipeline de vendas = qualquer um com
campos Produto e Valor e uma etapa de venda concluída (Vendido/Ganho/Fechado/Pago/Concluído); sem nenhum, nasce o
pipeline **Vendas** (`p_vendas`: Cliente, Produto, Quantidade, Valor, Data da venda; Negociando › Vendido › Perdido).
Cada box na etapa de venda vira lançamento de renda com `ref = crm:<box>` (categoria Vendas criada se faltar, produto,
qtd, cliente = campo Cliente, senão o 1º contato, senão o nome do box; data = Data da venda, senão quando entrou na
etapa). `financeApi.sincronizarExternos` é idempotente: sem diferença não grava; box alterado regrava o mesmo id; box
que sai da etapa tira o lançamento. O server.js dispara a cada mudança do CRM (debounce 2 s) e 15 s depois de subir,
só com CRM e financeiro liberados. A skill crm-api diz ao agente para registrar a venda no CRM e não também no
financeiro. Teste: `scripts/tests/crm-finance-vendas.test.mjs`. Backend 1.1.4.

## Conta Google por máquina (26 out)

Como o WhatsApp, cada máquina (VM) tem a sua Conta Google: o refresh token fica cifrado no Keychain em
`userData/google-conta/<máquina>.bin`, e Gmail, Agenda, Planilhas, a importação do financeiro e o backup no Drive usam
a conta da máquina da janela (`acessoValido(host)`, `contaStatus(host)`). Motivo: com um token por app, a VM da LV
mostrava a conta do dono e desconectar numa máquina desconectava todas (agente-box caiu junto).
- Desconectar apaga só o token daquela máquina; a revogação no Google (que derruba a autorização da CONTA inteira) só
  acontece quando nenhuma outra máquina, nem o token antigo do Mac, usa a mesma conta (`contaEmUsoEmOutra`, por `sub`).
- O token antigo, único do Mac (`userData/google-conta.bin`), não vale sozinho em nenhuma máquina: a tela mostra
  "Usar <e-mail> nesta máquina" (`google-conta:adotar-do-mac`), cópia explícita para a máquina da janela.
- O login abre no Navegador da própria máquina (partição `persist:navegador-<host>`), então os cookies também são dela.
- Fica de fora: o token de Contatos do CRM (`google-contatos.bin`, usado em "guardar conversa no Drive") ainda é um
  por app.

## Espera que não parece erro (26 out)
As telas mostravam "Consultando…" cinza e parado enquanto a máquina respondia por SSH/túnel; com 10–20 s de demora
parecia travado e a pessoa clicava de novo. Agora toda espera de dado da máquina usa `lib/carregando.ts`: ponto
pulsando, o tempo a partir de 3 s ("Lendo os grupos… 7 s") e, a partir de 10 s, "A máquina está respondendo devagar;
continuo buscando. Não precisa clicar de novo." O relógio é por rótulo e não zera quando a tela se redesenha. Vale para
Conta Google, Finanças e Curva ABC, grupos e conversas do WhatsApp, passos do guia, CRM, Navegador e as páginas do
meu-bot-admin. Tela nova que espera a máquina: use `carregando("…")` no lugar de um `<p class="hint">`.
