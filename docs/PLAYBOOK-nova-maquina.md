# Playbook: ligar uma nova máquina ao meu-bot

Roteiro técnico para repetir o que foi feito com a `grokbot-1`, a `agente-box` e o Colima quando
chegar outra máquina (outro computador do Grok Bot, outra VM, outro acesso). Cada passo tem o
comando, o que esperar e o que costuma dar errado. Quem executa é o Claude Code no Mac ou você.

---

## 0. Reconheça o tipo de máquina

Rode no host:

```bash
tr '\0' ' ' < /proc/1/cmdline; echo        # quem é o PID 1
cat /proc/1/cgroup | head -1               # cgroup
mount | grep ' / '                         # sistema de arquivos raiz
ip -br addr                                # endereços
id; sudo -n true && echo "sudo ok"         # usuário e sudo
command -v systemctl pm2 node claude       # o que existe
```

| Sinal | Significa |
|---|---|
| PID 1 = `/tini -- /pod-daemon …`, cgroup `pod-…`, raiz `overlay` em `/var/lib/isod/…`, IP `172.30.x.x` | **Computador do Grok Bot**: contêiner na infra deles. Sem systemd, sem sudo, NAT, o host pode pausar a máquina (`virtio_balloon`). Init de usuário = PM2. Porta 22 é o **Tailscale SSH** servido por um `tailscaled` que roda sob PM2. |
| PID 1 = `systemd`, IP público na interface, `sudo` funciona | **VM sua** (hospedagem). Tudo normal: systemd, root, firewall seu. |
| `~/.colima/ssh_config` incluído no `~/.ssh/config`, host `colima` em `127.0.0.1:<porta>` | **VM do Colima no Mac** (Lima). Usuário = seu usuário do Mac, home `/home/<user>.guest`, pouca memória (4 GB por padrão). |

Isso decide como o backend vai ficar vivo (systemd, PM2 ou nohup) e o que dá pra consertar quando
a máquina trava (num pod do Grok Bot, só o que é seu dentro dele; o resto é o botão de reiniciar
no app do Grok Bot).

---

## 1. Acesso SSH sem senha

1. Chave: a do Mac é `~/.ssh/id_ed25519.pub`. Cole em `~/.ssh/authorized_keys` do usuário remoto
   (`chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys`).
2. Num computador do Grok Bot o SSH chega pela rede Tailscale. Confira dos dois lados:
   ```bash
   tailscale status            # no Mac: a máquina aparece? "direct" ou "relay"?
   tailscale ping 100.x.y.z    # responde?
   ```
3. Bloco no `~/.ssh/config` do Mac (o meu-bot e o Cursor leem daqui; `Include` também vale):
   ```
   Host nome-curto
       HostName 100.x.y.z        # IP Tailscale ou público
       User box
       IdentityFile ~/.ssh/id_ed25519
       IdentitiesOnly yes
       ServerAliveInterval 60
       ServerAliveCountMax 3
   ```
4. Teste com paciência, porque um pod sob carga demora até 90 s para aceitar:
   ```bash
   ssh -o BatchMode=yes -o ConnectTimeout=90 nome-curto 'uptime; free -m | sed -n 2p'
   ```

Pegadinhas: `nc -z` com 5 s diz "fechada" enquanto o ssh com 40 s entra. Nunca conclua "fora do ar"
com timeout curto. `pkill -f claude` por SSH pode matar a própria sessão (o comando contém a
palavra). Em zsh, glob sem resultado aborta o script (`setopt nullglob` ou teste com `[ -e ]`).

---

## 2. Node e Claude Code no host

```bash
node -v                                   # precisa >= 18; sem node, o instalador baixa o 20 (.tar.gz; .tar.xz falha se não houver xz)
ls -l ~/.local/bin/claude || command -v claude
grep -c '"oauthAccount"' ~/.claude.json   # 1 = logado
```

- Instalar o Claude Code **nativo, no usuário** (não dependa de um global do root):
  `curl -fsSL https://claude.ai/install.sh | bash` → `~/.local/bin/claude`.
- Login é interativo e precisa de navegador: `ssh -t nome-curto claude` e dentro `/login`.
  Confira depois com o `grep` acima. Sem login o backend responde 401 `claude_auth`.
- **Root não roda bypass** (`--dangerously-skip-permissions` é recusado como root). Crie um usuário
  comum (`useradd -m -s /bin/bash box`, `usermod -aG sudo box`, `echo 'box ALL=(ALL) NOPASSWD:ALL' >
  /etc/sudoers.d/box`) e faça tudo nele.
- `~/.claude/settings.json` mínimo para bypass por padrão:
  `{"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true}`.
  O `/login` pode reescrever esse arquivo e o `.bashrc`; confira depois do login.

---

## 3. Backend do meu-bot

O app espera, no host, `~/.hermes/agente-rene/backend-sdk-claude/.env` com `OPENAI_COMPAT_KEY` e um
servidor OpenAI-compatível na porta 8080 (configurável) em `127.0.0.1`.

### 3a. Backend genérico (`backend-colima/`), para qualquer máquina com Claude logado

Pelo app: seletor → máquina → "Instalar backend". Ou à mão:

```bash
scp backend-colima/{server.js,session-map.js,meu-bot-backend.service,install.sh} nome-curto:~/.meu-bot-install/
ssh nome-curto 'PORT=8080 bash ~/.meu-bot-install/install.sh'
```

O que o `install.sh` faz: usa Node existente (>= 18) ou baixa; cria o diretório, `.env` com chave
aleatória (0600) e `CLAUDE_BIN`; serviço **systemd de usuário** com linger (ou de sistema quando
root; ou `nohup` sem systemd); termina com `GET /v1/models`. Modelos: `claudecode` (chat, 8 turnos,
permissão padrão) e `agente` (30 turnos, `--dangerously-skip-permissions`, cwd `~/agent-workspace`).

**Num computador do Grok Bot** não há systemd: o fallback `nohup` não sobrevive a reinício. Prefira
PM2, que já é o init de usuário lá:
```bash
cd ~/.hermes/agente-rene/backend-sdk-claude && pm2 start server.js --name meu-bot-backend && pm2 save
```

### 3b. Backend do Hermes/René (o original da `grokbot-1`)

Fica em `~/.hermes/agente-rene/backend-sdk-claude` (Express, pm2 `hermes-mythos-lucas`, `claude-query.js`
spawnando a CLI). Modelos `claudecode`, `rene`, `rene-dm`, `rene-buffer`, `agente`. Mudanças lá são
sempre **opt-in por cabeçalho** e com backup:
```bash
TS=$(date +%Y%m%d%H%M%S); cp services/openai-compat.js services/openai-compat.js.bak-$TS
# editar; node --check; bash scripts/run-tests.sh; pm2 restart hermes-mythos-lucas
```
Rollback: restaurar o `.bak-<TS>` e `pm2 restart`. O deploy versionado está em
`backend-vm/` com `deploy-agente.sh`. Em scripts de deploy use `set -o pipefail` ou grave a saída
em arquivo: `cmd | tail` devolve o status do `tail` e mascara falha.

### 3c. Verificação (vale para os dois)

```bash
K=$(grep ^OPENAI_COMPAT_KEY= .env | cut -d= -f2-); H="Authorization: Bearer $K"; J="Content-Type: application/json"
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/v1/models                       # 401 sem chave
curl -s -H "$H" localhost:8080/v1/models                                               # lista modelos
curl -s -H "$H" -H "$J" localhost:8080/v1/chat/completions -d '{"model":"claudecode","messages":[{"role":"user","content":"responda só: ok"}]}'
curl -sN -H "$H" -H "$J" -H 'X-Stream-Mode: live' localhost:8080/v1/chat/completions -d '{"model":"claudecode","stream":true,"messages":[{"role":"user","content":"conte de 1 a 12"}]}' | head -8
# retomada: duas chamadas com X-Conversation-Id: t1 e X-Conversation-Seen: 0 / 2 → a segunda vem com X-Session-Resumed: true
# bypass: pedir ao modelo "agente" para criar um arquivo e ler de volta
```

Do Mac, pelo mesmo caminho do app:
```bash
K=$(ssh nome-curto 'grep ^OPENAI_COMPAT_KEY= ~/.hermes/agente-rene/backend-sdk-claude/.env | cut -d= -f2-')
ssh -f -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 nome-curto
curl -s -H "Authorization: Bearer $K" -H 'Content-Type: application/json' 127.0.0.1:18080/v1/chat/completions -d '{"model":"claudecode","messages":[{"role":"user","content":"túnel ok?"}]}'
```

---

## 4. A máquina no meu-bot

- Ela aparece sozinha no seletor (hosts do `~/.ssh/config` + `local`). A sondagem roda por ssh avulso
  e devolve: acessível, usuário/SO, backend instalado (há `.env` e `server.js`), ouvindo (porta),
  `claude` presente, logado (`oauthAccount`), Node, modelos anunciados.
- Estados e o que fazer: **inacessível** → rede/pod (seção 6); **Claude não logado** → passo 2;
  **sem backend** → botão Instalar (3a); **instalado mas parado** → Reinstalar sobe o serviço.
- Cada conversa guarda o `host`; o túnel é um por máquina (ControlMaster em `/tmp/meu-bot-<uid>/`,
  forward `-N -L`, chave lida por ssh, nunca persistida). Log: `~/Library/Application Support/meu-bot/meu-bot.log`,
  linhas `[tunnel] [host]`.
- Atalho na mesa pelo seletor: `<host>.app` chama o binário com `--host=<host>`; `--alivio=<host>` abre
  a janela de alívio. Com o app aberto, isso chega por `second-instance` (lock de instância única).
  `open -a App --args` **não** funciona com o app já aberto: o macOS descarta os argumentos.

---

## 5. Alívio de um computador do Grok Bot

Instalar o script no pod:
```bash
ssh nome-curto 'mkdir -p ~/bin' && scp scripts/alivio/alivio-pod.sh nome-curto:~/bin/ && ssh nome-curto 'chmod +x ~/bin/alivio-pod.sh'
```
O que ele faz: encerra CLIs do Claude do backend com mais de 30 min (`LIMITE_S`), Chrome headless; com
`--tailscale`, agenda `pm2 restart tailscaled` em 2 s por `nohup` (a sessão cai e volta; estado e IP
preservados). Log em `~/alivio.log`. Não toca em serviços do Grok Bot nem no PM2 inteiro.

Botão na mesa (`aliviar <host>.app`):
```bash
osacompile -o "$HOME/Desktop/aliviar nome-curto.app" -e "do shell script \"'$HOME/Desktop/meu-bot.app/Contents/MacOS/meu-bot' --alivio=nome-curto >/dev/null 2>&1 &\""
rm -f "$HOME/Desktop/aliviar nome-curto.app/Contents/Resources/Assets.car"   # senão o Finder mostra o ícone de script
defaults write "$HOME/Desktop/aliviar nome-curto.app/Contents/Info.plist" LSUIElement -bool true
```
(ícone: copiar um `applet.icns` seu para `Contents/Resources/`.) Não use `tell application "Terminal"`
no applet: pede permissão de Automação e, sem resposta, o clique não faz nada.

Hoje o alívio está fixo na `grokbot-1` dentro do app (`relief.ts` recebe o host do argumento, então
outro `--alivio=<host>` já funciona desde que o script exista em `~/bin` do host).

---

## 6. Quando a máquina não responde

Ordem de diagnóstico:
1. `tailscale status` no Mac: a máquina está "active"? Isso é só o cadastro; não prova nada.
2. `ssh -o ConnectTimeout=90 host uptime`: entrou? Carga alta (> nº de vCPUs) = sobrecarga; muitos
   processos em estado `D` = disco/pausa do host.
3. Entrou mas lento → botão de alívio. Não entrou em 90 s → pod congelado pelo host do Grok Bot:
   reiniciar o computador **pelo app do Grok Bot**. Não há como fazer isso por dentro.
4. Depois que voltar: `pm2 status` (tudo online?), `pm2 logs tailscaled --lines 20` (por que
   reiniciou?), `tail ~/alivio.log`.

Causas vistas na `grokbot-1`: `tailscaled` reiniciado pelo PM2 sob carga (derruba a porta 22 por
segundos), CLIs do `rene` presas por 30 a 60 min, Chrome headless, 15 zumbis, `virtio_balloon`
pausando o pod centenas de vezes por dia. Alívio trata o sintoma; a causa é a VM pequena para o que
roda nela e turnos sem limite de tempo no backend do René.

---

## 7. Checklist resumido para uma máquina nova

- [ ] Reconhecer o tipo (seção 0) e anotar IPs/usuário no mapa de máquinas do `GUIA.md`.
- [ ] Chave no `authorized_keys`; bloco no `~/.ssh/config`; `ssh host uptime` com 90 s.
- [ ] Usuário comum (não root); Claude Code nativo em `~/.local/bin`; `/login` via `ssh -t`.
- [ ] Backend: Instalar pelo seletor (ou `install.sh`); num pod do Grok Bot, subir por PM2 + `pm2 save`.
- [ ] Verificação 3c: 401, modelos, chat, stream live, retomada, bypass.
- [ ] No meu-bot: abrir a janela da máquina, mandar uma mensagem; criar o atalho na mesa.
- [ ] Se for pod do Grok Bot: `alivio-pod.sh` em `~/bin`, botão de alívio na mesa.
- [ ] Segurança: se tiver IP público, `PasswordAuthentication no` no sshd depois que a chave funcionar.
