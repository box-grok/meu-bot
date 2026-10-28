# Backlog: WhatsApp pela API oficial (Cloud API da Meta)

Branch `feat/whatsapp-api-oficial` (no GitHub). Nada disto está em staging nem em produção. Trabalhe num worktree
próprio a partir do branch, não na pasta principal `~/Desktop/meu-bot` (outras sessões usam ela).

## Por quê

OpenClaw, Hermes e PicoClaw conectam o WhatsApp pelo protocolo do WhatsApp Web (cliente não oficial), e dezenas de
números saem pelo mesmo IP da VPS: risco de bloqueio. Decisões do usuário (28 out):
- **API oficial como 4ª opção** em "Escolha o agente"; os outros três continuam iguais (instalador híbrido).
- **Cada cliente usa a própria conta da Meta** (app + número do Meta Business dele); cola token e IDs no meu-bot.
- **Webhook por Cloudflare Tunnel** na máquina (endereço HTTPS só para o receptor; nenhuma porta aberta).
- **Faz parte do Pro.**
- Para quem continuar nos não oficiais: opção de a conexão sair **pelo IP do Mac da pessoa** (fase 3).

Plano completo: `~/.claude/plans/pode-planejar-essa-melhoria-floofy-octopus.md` (no Mac do usuário).

## Feito (7 commits, 694 testes passando)

| Commit | O quê |
|---|---|
| `5ef943c` | `backend-colima/wa-cloud-core.js` (puro) e `wa-cloud.js` (serviço só em 127.0.0.1): GET de verificação, HMAC-SHA256 do corpo bruto, 200 na hora + fila por contato, duplicatas, política self/open/list + pausados, chama o backend (`model whatsapp` para o dono, `whatsapp-cliente` para os outros, `X-Conversation-Id wa-<n>`, Seen para o `--resume`), envia pela Graph API, histórico `~/.local/share/meu-bot/wa-cloud/<n>.jsonl`, sem Pro não responde. |
| `bc1d5e6` | `server.js` aceita `WA_CLOUD_KEY` (papel do agente) e o perfil `whatsapp-cliente`; `nivel-ferramentas.js` `BLOQUEIO_CLIENTE` (sem comandos, escrita, leitura de arquivos nem WebFetch). |
| `a1fe106` | `install-wa-cloud.sh` / `uninstall-wa-cloud.sh` / `meu-bot-wa-cloud.service`; `install.sh` copia o receptor e o reinicia se ligado; `BUNDLE_FILES`; backend `VERSION 1.4.0`. |
| `7117674` | App: `Gateway`/`WhatsappAgente` com `"cloud-api"`, capacidade `credencial` (≠ `parear`), `usa_cloud()` e `usa_hermes` não pega mais o cloud-api; `whatsapp-cloud-core.ts` (status sem vazar segredo, `cloudApiStatus`, `politicaCloud`). |
| `b21ade4` | `whatsapp:cloud-conectar` (Pro): confere token + ID na Graph API deste Mac, liga o receptor, grava `~/.config/meu-bot/wa-cloud.env` (0600, base64 pelo stdin) e o dono; desconectar, trocar de agente e "quem responde". |
| `d534b4d` | Tela: cartão "API oficial (Meta)"; `GuideStep.variante` + `passoPara` (o QR vira "Conectar à Meta", formulário `renderCloudConectar`, token de verificação com Copiar; áudio conclui sozinho). |
| `62b4c2c` | Espelho: lista/conversa/limpar/pausar pelos jsonl do receptor (chaves `wa-cloud:<n>`). |

Testado na VM de teste (colima): instalou, ouviu só em 127.0.0.1:8090; sem Pro não chamou o agente; com Pro o agente
respondeu ("funcionou", 4,2 s) e o envio caiu no 401 da Graph com token falso. VM limpa depois (backend dela ficou 1.4.0).

## A fazer

### 1. Túnel público (Cloudflare) — bloqueado: precisa do usuário
- Ele precisa informar o **domínio na Cloudflare** e criar um **token de API com Tunnel:Edit e DNS:Edit**.
- O **meu-bot-admin** guarda o token só no Keychain (modelo `src/main/app/secrets.ts`) e, numa ação nova da página
  Suporte ("Preparar WhatsApp oficial"), cria o túnel da máquina: instala `cloudflared` como serviço (só saída),
  ingress **apenas** `wa-<máquina>.<domínio>/webhook → 127.0.0.1:<WA_CLOUD_PORT>` (o resto 404), cria o DNS, e mostra
  o endereço. Auditoria `whatsapp.oficial.preparar`. Várias contas na mesma VM: hostname e porta por conta.
- Depois, `renderCloudConectar` mostra o endereço real em vez de "o suporte prepara".
- Verificar de fora: `curl https://wa-<m>.<dom>/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=1`
  responde 1; `/v1/*` do backend continua inacessível.

### 2. Teste de ponta a ponta com a Meta — precisa do usuário
App de desenvolvedor em developers.facebook.com (Business + WhatsApp), com o número de teste gratuito. Conferir:
resposta do agente no WhatsApp; espelho no app e no admin; "só eu"/lista/pausa; contato desconhecido não lê arquivos.

### 3. Acoplamentos que ainda assumem OpenClaw
- `backend-colima/server.js` `sendWhatsappSelf` (avisos de segurança ao dono via `openclaw message send`): no
  cloud-api enviar pelo receptor; fora da janela de 24 h só com template aprovado (ou não envia; avisar).
- `backend-colima/crm/crm-job.mjs` lê `chat.history` do OpenClaw: ler o jsonl do receptor.
- Conferir telas que ainda comparam o nome do gateway: `waChannelPrompt`, `waAgentPrompt`, rótulo `via` em
  `paintWhatsapp` (`src/renderer/whatsapp/agente-whatsapp.ts`), `hostProbe.ts` (detecção do gateway no probe).

### 4. Documentação
Seção em `docs/guia/whatsapp.md` (receptor, credenciais, capacidades, segurança do cliente) e o túnel em
`docs/guia/suporte-admin.md`.

### 5. Fase 2 — áudio na API oficial
Ouvir: baixar `/media/<id>` com o token e usar `meu-bot-transcrever` (`install-transcricao.sh` hoje sai com 2 sem
OpenClaw). Responder em voz: `meu-bot-falar` (WAV) → ogg/opus (ffmpeg) → upload `/media` → `type: audio`; ligar
`capacidades.audio` e tirar a variante do passo de áudio.

### 6. Fase 3 — IP pelo Mac (só OpenClaw/Hermes/PicoClaw, opcional, desligado por padrão)
Proxy HTTP CONNECT no app + `ssh -R` no túnel que o app já mantém (`src/main/maquina/tunnel.ts`); drop-in da unidade
do gateway com `HTTPS_PROXY` (o OpenClaw documenta suporte: `docs/channels/whatsapp.md:141` na instalação). Verificar
Hermes (Baileys) e PicoClaw (whatsmeow). Mac desligado = WhatsApp desconectado (não cair para o IP da VPS); status
"esperando o Mac de <pessoa>".

### 7. Publicar
Juntar o branch na `main`/branch de release, `release:staging`, teste do usuário, `release` (backend 1.4.0 entra;
o `release.mjs` exige versão subida nos componentes alterados).

## Cuidados
- Nunca pôr `HOST=0.0.0.0` no backend; o túnel aponta só para `/webhook` do receptor.
- O HMAC é sobre o Buffer bruto (reserializar o JSON quebra).
- Segredos só no `wa-cloud.env` (0600); o status e a tela nunca recebem o valor.
- Sem Pro em vigor o receptor não responde (`licenca.proOk`).
