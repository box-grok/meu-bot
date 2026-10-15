# Guia rápido: transcripts, conversas e git por SSH

## 0. SSH padrão

Alias `mac-cursor` em `~/.ssh/config` de quem conecta, passando pelo Tailscale:

```
Host mac-cursor
  HostName <nome-tailscale-do-mac>
  User box
  ProxyCommand tailscale nc %h %p
```

Uso:

```bash
cat ~/.ssh/config                      # conferir o alias
ssh mac-cursor "comando"               # roda um comando no Mac
ssh mac-cursor "ps aux | grep -i comet | grep -v grep"
```

## 1. Transcripts do Claude Code (JSONL)

Onde ficam (uma pasta por diretório de trabalho, `/` vira `-`):

| Máquina | Pasta |
|---|---|
| Mac | `~/.claude/projects/-Users-box/` |
| Box Linux | `~/.claude/projects/-home-box/` (e uma pasta por projeto, ex. `-home-box--hermes-agente-rene-...`) |

O nome do arquivo é um UUID, **não** tem data. A sessão mais recente é a de modificação mais recente:

```bash
ls -t ~/.claude/projects/-home-box/*.jsonl | head -1
```

Cada linha é um JSON. Campos que importam: `type` (`user` / `assistant`), `timestamp` (UTC), `message.content` (lista de blocos; o texto está nos blocos `{"type":"text","text":...}`).

Última resposta do assistente:

```bash
f=$(ls -t ~/.claude/projects/-home-box/*.jsonl | head -1)
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' "$f" | tail -n 40
```

Procurar um assunto em todas as sessões:

```bash
grep -l -i "fallback" ~/.claude/projects/*/*.jsonl
```

Pelo Mac remoto: `ssh mac-cursor 'f=$(ls -t ~/.claude/projects/-Users-box/*.jsonl | head -1); jq -r ... "$f"'`.

## 2. Conversas do meu-bot

Pasta: `~/Library/Application Support/meu-bot/`

| Arquivo | Conteúdo |
|---|---|
| `conversations.json` | `{ version, conversations: [...] }` |
| `settings.json` | preferências do app e a flag `onboarding` |
| `memory.json` | `notas`, `perfil` |

Cada conversa: `id`, `title` (só existe se foi renomeada), `model`, `host`, `messages` (`[{role, content}]`), `createdAt`/`updatedAt` (UTC), `order`, `archived`, `openAsTab`.

```bash
cd ~/Library/Application\ Support/meu-bot
jq -r '.conversations[] | "\(.createdAt)  \(.host)  \(.title // "(sem título)")"' conversations.json
jq '{onboarding, lastHost, backendModel, theme, fontSize, backendPort}' settings.json
```

`onboarding`: `pending` (força na próxima janela), `done` ou `skipped`. Quais seções das Configurações abrem e se a barra lateral aparece **não** ficam em arquivo (localStorage da janela).

## 3. Git do meu-bot por SSH

Repositório: `~/Desktop/meu-bot`.

```bash
ssh mac-cursor "cd ~/Desktop/meu-bot && git fetch -q && git status -sb"
ssh mac-cursor "cd ~/Desktop/meu-bot && git log -5 --format='%h %ci %s'"
ssh mac-cursor "cd ~/Desktop/meu-bot && git diff --stat"
ssh mac-cursor "cd ~/Desktop/meu-bot && git show --stat 802502d"
```

`## main...origin/main` sem `[ahead N]` = nada pendente para enviar. Depois de um `git pull` que muda código, gerar o app de novo: `./instalar.sh` (ou `./instalar.sh --abrir`).
