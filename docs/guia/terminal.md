# Terminal

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

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
