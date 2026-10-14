# meu-bot

Bot de mesa pessoal para macOS: uma janela de chat que conversa com o backend do Hermes na
sua VM. O backend (`claude-chat-backend`, porta 8080 na VM) roda o Claude Code por baixo,
com a assinatura já logada lá. Não há chave de API no app.

Inspirado na arquitetura do Grok Bot (cliente fino + "computador do bot"), mas com código
próprio e a VM sob seu controle.

## Requisitos

- macOS, Node.js 24+ e npm.
- Acesso SSH sem senha à VM, com um alias no `~/.ssh/config` (padrão: `grokbot-1`).
- Na VM, o backend `~/.hermes/agente-rene/backend-sdk-claude` rodando na porta 8080 e com
  `OPENAI_COMPAT_KEY` no `.env`. O app lê essa chave pela própria conexão SSH, em memória.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Na primeira mensagem o app busca a chave na VM e abre um túnel SSH para a porta do backend.
O selo no topo mostra o estado: "buscando chave…", "abrindo túnel…", "túnel ativo · modelo".

## Abas

"Nova conversa" (Cmd+T) abre uma aba nova e mantém as anteriores vivas, cada uma com o próprio
histórico. Feche com o × ou Cmd+W. Uma aba em segundo plano mostra um ponto azul quando chega resposta.
As conversas ficam salvas em `conversations.json` no userData e voltam quando o app reabre;
fechar uma aba apaga aquela conversa. Dois cliques no título da aba renomeiam; o nome fica salvo. Arraste as abas pra reordenar; a ordem também fica salva.

## Configurações

- **Host SSH da VM**: lista com os hosts do seu `~/.ssh/config`; também aceita digitar.
- **Modelo do backend**: `rene-dm` (agente René com ferramentas, pode levar minutos),
  `rene` (MCP completo) ou `claudecode` (chat puro, rápido).
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
