# Política de segurança

## Como relatar uma falha

Achou uma vulnerabilidade no meu-bot (app, backend das máquinas, extensões, site ou API da conta)? Não abra uma issue
pública: use o **relato privado de vulnerabilidade** do GitHub, em
<https://github.com/diegofornalha/meu-bot/security/advisories/new>. Só os mantenedores veem o relato.

Descreva o que achou, como reproduzir e qual o impacto. Respondemos pelo próprio advisory, normalmente em até 7 dias,
e publicamos a correção numa release antes de tornar o relato público.

## Versões que recebem correção

O app se atualiza sozinho, então a correção sai na **estável mais recente** (release `v<versão>` em
[Releases](https://github.com/diegofornalha/meu-bot/releases)) e, antes dela, no staging (`v<versão>-staging.N`).
Versões anteriores não recebem correção: basta deixar o app atualizar.

## O que fica fora

- Falhas em serviços de terceiros (Claude Code, OpenClaw, Cloudflare, GitHub): relate ao serviço.
- Uma máquina que a própria pessoa configurou com acesso fraco (senha de SSH, porta aberta sem necessidade).
