# Contornos de limitações do Hermes e do OpenClaw

## Regra (30 out)

Todo pedaço do meu-bot que **contorna** uma limitação de ferramenta de terceiros (Hermes, OpenClaw) entra nesta
tabela e leva um cabeçalho padrão no código. O objetivo é poder **apagar o contorno** no dia em que a ferramenta
trouxer a função, sem arqueologia: a tabela diz o que é nosso, o que seria o nativo, qual issue acompanha e,
principalmente, **como saber que já dá para tirar** (um critério verificável por comando ou pela sonda, não uma
opinião). O app prefere o nativo quando ele existir: a decisão é por **capacidade** (`whatsapp-capacidades.ts`),
nunca por versão fixa.

Cabeçalho no código (acima da função, constante ou no topo do arquivo), texto exato:

```
CONTORNO #N (Hermes): <limitação> (<issue>).
O que fazemos: <uma frase>.
Sai quando: <critério verificável>.
Tabela: docs/guia/contornos.md.
```

O teste `scripts/tests/contornos.test.mjs` confere que todo `CONTORNO #N` do código está na tabela (e vice-versa) e
que cada cabeçalho diz "Sai quando:".

## Tabela

| # | Limitação | O que fizemos | Onde mora | Issue upstream | Sai quando (verificável) | O que se perde ao remover |
|---|---|---|---|---|---|---|
| 1 | O Hermes não tem pausa por contato no WhatsApp (só a lista `WHATSAPP_ALLOWED_USERS`, lida na subida do gateway) | Pausar = tirar o número da lista e reiniciar o gateway; retomar = devolver (PR #16). Fora da lista aparece "pausado"; retomar em "só você" vira "você + ele" | `hermesPausaPlano` e `hermesNaoResponde` (`whatsapp-hermes-core.ts`), `aplicarPlanoAllowlist` (`whatsapp.ts`), filtro de pausados em `setDmPolicyHermes`/`lerGateway` | [NousResearch/hermes-agent#146672](https://github.com/NousResearch/hermes-agent/issues/146672) | Toda máquina Hermes do mapa com `pausaplugin` (#2) ou `pausanativa=1` no status: o ramo `"allowlist"` de `hermesPausaModo` some e estas funções com ele | Pausar numa máquina sem o plugin |
| 2 | Idem, e além disso: sem prazo, o agente nem vê as mensagens do pausado, e não dá para pedir pelo WhatsApp | Plugin do Hermes `meu-bot-pausa` no hook `pre_gateway_dispatch`: descarta a mensagem de quem está pausado lendo a marca do app (`whatsapp-lista.json › paused`, com `ate`), guarda o que chegou em `whatsapp-pausados.jsonl`, entrega ao agente numa nota só ao retomar; `/pausar 2h\|24h`, `/retomar`, `/pausados`. O app mostra o que chegou na pausa e pausa só pela marca quando o plugin está carregado | `backend-colima/hermes-plugins/meu-bot-pausa/`, `whatsapp-hermes-pausa-core.ts` (instalação), `HERMES_PAUSA_SH`/`hermesPausaModo` (`whatsapp-hermes-core.ts`), `whatsapp-pausados.ts`, `capacidadesDe(…, { pausaModo })` | [#146672](https://github.com/NousResearch/hermes-agent/issues/146672) | `pausanativa=1` no status do WhatsApp. Hoje a sonda é um palpite declarado (`hermes whatsapp --help` cita "pause"); trocar pelo sinal real da release que fechar a issue. Aí `hermesPausaPluginRemoverSh` tira o plugin | As mensagens recebidas na pausa visíveis no app e a nota única ao retomar, se o nativo não as der |
| 3 | `hermes pm install --extra stt-whisper` recusa num usuário novo de Hermes global (/opt/hermes): "tools not on PATH before venv sync: ffmpeg, ripgrep" — as ferramentas são por `HERMES_HOME` | `hermesPmExtraSh` instala só as ferramentas que ele listou e tenta de novo (sem `--tools-only`, que traria o Chromium) | `hermesPmExtraSh` (`whatsapp-hermes-core.ts`) | a abrir (anotar o número aqui) | `hermes pm install --extra stt-whisper` sair 0 num usuário recém-criado de Hermes global, sem o passo extra (teste manual no admin: criar usuário → Ativar transcrição numa máquina sem `/opt/transcriber`) | Nada: só a segunda tentativa |
| 4 | Cada usuário baixava o próprio transcritor e modelo (~1,5 GB) e rodava um Whisper por gateway | Transcritor compartilhado em `/opt/transcriber` (root, 755) e cada Hermes aponta por `HERMES_LOCAL_STT_COMMAND` (`local_command`) | `transcritorSh` (`usuarios-core.ts`), `hermesSttLigarSh`, `HERMES_STT_COMPARTILHADO_SH` (`whatsapp-hermes-core.ts`) | sem issue (desenho de produto, não bug) | O Hermes oferecer STT compartilhado entre `HERMES_HOME`s | RAM e disco por usuário |

Candidatas a entrar (ainda sem cabeçalho): `hermesPrecisaReiniciar` (o gateway não relê o `.env`, nem a lista —
[#146672](https://github.com/NousResearch/hermes-agent/issues/146672)); porta do bridge por uid (`portaBridgeHermes`).

## Como o app decide (30 out)

`hermesPausaModo` (`whatsapp-hermes-core.ts`) lê três linhas da sonda `HERMES_PAUSA_SH`: `pausaplugin` (versão no
`.ok` do plugin), `pausavivo` (versão que o `register()` do plugin gravou ao carregar) e `pausanativa`. Nativa vence
plugin, que vence allowlist; plugin só conta quando instalado **e** carregado na mesma versão (entre instalar e o
gateway reiniciar, o app ainda pausa pela lista — sem janela de "pausei e nada aconteceu"). `capacidadesDe` traduz em
`pausaPrazo` (menu com 2 h / 24 h / até retomar; pausa só pela marca) e `pausaNativa`. Remover o contorno #2 é:
trocar a sonda `pausanativa` pelo sinal real, confirmar que o nativo dá o que a tabela diz que se perde, e deixar
`ensureHermesPausa` (picker.ts/client.ts) parar de instalar quando `pausanativa=1` (já faz: a capacidade `pausaPrazo`
fica verdadeira e ele não instala).
