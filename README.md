# meu-bot

Bot de mesa pessoal para macOS: uma janela de chat que conversa com o backend do Hermes na
sua VM. O backend (`claude-chat-backend`, porta 8080 na VM) roda o Claude Code por baixo,
com a assinatura já logada lá. Não há chave de API no app.

Inspirado na arquitetura do Grok Bot (cliente fino + "computador do bot"), mas com código
próprio e a VM sob seu controle.

> Para ligar outra máquina (outro computador do Grok Bot, VM ou o Colima): `docs/PLAYBOOK-nova-maquina.md`.
> Detalhes de implementação e pegadinhas: `docs/GUIA.md`.

## Requisitos

- macOS, Node.js 24+ e npm.
- Uma janela por máquina, como o Cursor com SSH: o app abre no seletor de máquinas (`local` = este
  Mac sem SSH, `colima`, `agente-box`, `grokbot-1`…), cada janela mostra só as conversas da sua
  máquina e Cmd+Shift+N abre outra. Fechar a última janela deixa o app no Dock. Configurações mostram o estado de cada host
  e instalam o backend (`backend-colima/`) com um clique.
- Acesso SSH sem senha à VM, com um alias no `~/.ssh/config` (padrão: `colima`, a VM local do Colima; `grokbot-1` para a VM remota).
  Num Mac novo, o botão ⇅ "sincronizar ssh" do seletor preenche o `~/.ssh/config` a partir de `config/ssh-hosts.conf`;
  o Cursor lê o mesmo arquivo.
- Na VM, o backend `~/.hermes/agente-rene/backend-sdk-claude` rodando na porta 8080 e com
  `OPENAI_COMPAT_KEY` no `.env`. O app lê essa chave pela própria conexão SSH, em memória.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Na primeira mensagem o app busca a chave na VM e abre um túnel SSH para a porta do backend.
O selo no topo mostra o estado: "buscando chave…", "abrindo túnel…", "túnel ativo · modelo".

## Funcionalidades (v2)

- **Markdown** nas respostas, com blocos de código realçados e botão Copiar; links abrem no navegador.
- **Modelo por conversa** no seletor ao lado da caixa de texto (`claudecode`, `agente`, `rene-dm`, `rene`, `grok-4`).
  O backend tem uma corrente de fallback (`providers.json`: agente → grok-4) e avisa na conversa quando troca.
- **Lista lateral** (☰ ou Cmd+B) com todas as conversas agrupadas por data, busca sem acento, arquivar.
- **Exportar** (.md/.json) e **ramificar** a partir de qualquer mensagem (ícones no hover da mensagem: copiar e ramificar, com tooltip).
- **Menu de contexto** nas abas (botão direito) e **notificações** quando a resposta termina em segundo plano.
- **Paleta de comandos** (⌘K): conversas, ações e configurações.
- **Fonte e tema** nas Configurações.
- **Resumo contínuo**: acima do orçamento de contexto, o meio da conversa vira um resumo gerado pelo
  `claudecode` em background; **memória** local (perfil e notas) injetada em toda mensagem e
  preenchida automaticamente a cada N turnos.
- **Túnel SSH com ControlMaster** (uma autenticação, clientes leves), revalidação ao acordar o Mac,
  botão **Parar** para cancelar uma resposta.
- **Streaming real** e **retomada de sessão** no backend da VM (opt-in por cabeçalho; código em
  `backend-vm/`). O texto chega token a token e o Claude Code lembra da conversa sem reler tudo.
- **Entrada rápida**: Cmd+Shift+Espaço de qualquer app abre uma janelinha; Enter manda pra conversa ativa.

## Abas

"Novo" (Cmd+N) abre uma aba nova e mantém as anteriores vivas, cada uma com o próprio
histórico. Feche com o × ou Cmd+W. Uma aba em segundo plano mostra um ponto azul quando chega resposta.
As conversas ficam salvas em `conversations.json` no userData e voltam quando o app reabre;
fechar uma aba apaga aquela conversa. Dois cliques no título da aba renomeiam; o nome fica salvo. Arraste as abas pra reordenar; a ordem também fica salva.

## Configurações

- **Host SSH da VM**: lista com os hosts do seu `~/.ssh/config`; também aceita digitar.
- **Máquina**: escolhida no seletor que abre com o app (`local` = este Mac sem SSH, mais os hosts do
  `~/.ssh/config`). Cada máquina é uma janela; Cmd+Shift+N abre outra. O seletor sonda todas em
  paralelo, mostra o estado e instala o backend onde falta.
- **Modelo padrão nesta máquina**: `agente` (bypass: ferramentas com `--dangerously-skip-permissions`
  em `~/agent-workspace`, pode levar minutos), `claudecode` (chat puro, rápido), `rene-dm` ou `rene`,
  estes dois só na `grokbot-1`. Modelos que a máquina não tem ficam desabilitados.
- **Porta do backend na VM**: padrão 8080.

Configuração em `~/Library/Application Support/meu-bot/settings.json`. Transcripts em
`~/Library/Application Support/meu-bot/transcripts/`.

## Gerar o app

```bash
npm run dist
```

Produz `out/meu-bot-darwin-arm64/meu-bot.app` com os fuses do Electron travados
(RunAsNode e inspeção por linha de comando desligados, integridade do ASAR ligada)
e assinatura ad-hoc para uso local.

## Como funciona

- `src/main/tunnel.ts`: lê a chave do backend na VM via `ssh`, abre `ssh -N -L` para a porta
  do backend numa porta local livre, com retentativas porque a VM oscila no Tailscale.
- `src/main/backend.ts`: envia o histórico recente (últimas 12 mensagens) para
  `/v1/chat/completions` pelo túnel, sem stream, com timeout de 2 min (chat) ou 10 min (agente).
  O backend achata o histórico num prompt e abre uma sessão nova do Claude Code a cada turno,
  por isso o histórico é limitado.
- `src/preload/preload.ts`: a única ponte entre a interface e o processo principal.
- `src/renderer/`: interface em HTML/CSS/TS puro, com CSP estrita.
