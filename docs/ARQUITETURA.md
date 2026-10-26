# Arquitetura do meu-bot (mapa para manutenção)

O app é organizado por **domínio**: cada pasta é dona de um assunto, com as regras puras (`*-core.ts`, testadas com
`node --test`) separadas do IO (SSH, Electron, rede). Ao mexer num assunto, comece pela pasta dele.

## Processo principal (`src/main/`)

| Pasta | Do que é dona |
|---|---|
| `main.ts` | Arranque: instância única, menu, seletor, túneis, registro dos IPC (raiz de composição) |
| `app/` | Janelas, menu, settings, variantes do produto, userData, zoom, atalhos, entrada rápida, internet, processos filhos |
| `maquina/` | Máquinas por SSH: túnel, backend (sondagem, instalação, pasta), backend local, seletor, ~/.ssh/config, Tailscale |
| `atualizacao/` | Atualização automática do app (release, download, troca) |
| `conversa/` | Conversas com o meu-bot: histórico, contexto, memória, exportação, ordem das abas, conversas vistas pelo admin |
| `terminal/` | Abas de terminal (PTY remoto via `pty-broker.py`) e controle externo do terminal |
| `navegador/` | Aba Navegador: webviews, permissões, abas por conversa, API do agente, Navegador do agente do WhatsApp |
| `whatsapp/` | WhatsApp do agente: status/pareamento, conversas, grupos, marcas, pausa, Hermes e OpenClaw, capacidades, áudio |
| `crm/` | CRM pelo WhatsApp e CRM próprio (pelo túnel), guardar conversa no CRM |
| `financeiro/` | Financeiro da máquina pelo túnel (inclui Curva ABC e importação de planilha) |
| `google/` | Conta Google por máquina (OAuth), Gmail/Agenda/Planilhas, Contatos do CRM, backup no Drive |
| `licenca/` | Licença da máquina e os portões dos módulos pagos |
| `agente/` | Contas e ferramentas do agente na máquina: login do Claude Code, CLIs, xAI, objetivo do WhatsApp, status line |
| `auditoria/` | Registro de quem fez o quê em cada máquina |
| `suporte/`, `client/`, `admin/` | Suporte: código de suporte; lado da pessoa; lado do meu-bot-admin |
| `ipc/` | Registro dos canais (shared/client/admin) e a política de variante de cada canal |
| `extensao-gmail/` | Extensões embutidas no Navegador (CRM no Gmail, autenticador) |

Regras:
- **Dependência de fora para dentro:** `ipc/` e `main.ts` chamam os domínios; um domínio não importa `ipc/`.
- **Regra pura em `*-core.ts`**, sem Electron: é ela que leva teste. O arquivo sem `-core` só faz IO.
- **Um dono por formato:** quem lê/grava um arquivo na máquina é um módulo só (ex.: `whatsapp/whatsapp-marks.ts` para
  `whatsapp-lista.json`); os outros usam as funções dele.
- Caminho de arquivo compilado: `path.join(__dirname, "..", "..", <preload|renderer>, …)` a partir de um domínio.

## Outras partes
- `src/preload/` — pontes de IPC por janela. `src/shared/ipc.ts` — contrato entre main e telas.
- `src/renderer/` — telas (ES modules sem bundler). `renderer.ts` é a raiz de composição: elementos e estado da
  janela (abas de conversa, lateral, paleta, modo, zoom) e a ligação das páginas. Cada assunto tem sua pasta:

| Pasta | Do que é dona |
|---|---|
| `app/` | `ctx.ts` (ponte para o renderer), `paginas.ts` (páginas em aba própria e modo dividido), `rede.ts` (barra offline) |
| `agente/` | Entrar no Claude Code, contas do Claude (rodízio), xAI (Grok), oferta de skill depois de navegar |
| `whatsapp/` | `agente-whatsapp.ts` (linha, pareamento, política, voz), `conversas.ts` (lista e marcas), `grupos.ts`, `chat.ts` |
| `tutoriais/` | `tutoriais.ts` (página e guia ao vivo), `guia-secoes.ts` (passos: suporte, status line, contas, Navegador…) |
| `crm/` | Passo do CRM no guia (instalação, chave, pipeline, teste) |
| `finance/`, `conta-google/`, `admin/` | Finanças (e o passo dela no guia), Conta Google, páginas do meu-bot-admin |
| `navegador/`, `terminal/` | Aba Navegador (abas, espaços, favoritos, notificações, zoom) e abas de terminal |
| `conversa/` | Envio e streaming (`envio.ts`), voltar ao chat (`ponte-chat.ts`), ferramentas em uso (`atividade.ts`) |
| `inicio/`, `acervo/`, `licenca/` | Abertura/onboarding/tour, Acervo de skills e objetivo, plano e licença |
| `configuracoes/`, `atualizacao/` | Diálogo de configurações, alertas e fallback; atualização do app |
| `lib/` | Regras puras com teste (`scripts/tests/`) |

Regras do renderer:
- **Página não importa `renderer.ts` em tempo de execução.** O que ela usa da raiz vem por `ctx.<nome>` (`app/ctx.ts`):
  o `renderer.ts` registra getters no bloco `ctx:inicio…ctx:fim`. Tipos podem vir por `import type`.
- **Nada de `ctx` no carregamento do módulo**: o `ctx` só vale depois que o `renderer.ts` começa a rodar. Eventos e
  estado inicial de cada página ficam numa função `ligar…()` que o `renderer.ts` chama.
- Uma variável que outro arquivo grava fica com quem grava (ou ganha uma função para mudar); import não se grava.
- `backend-colima/` — o backend que roda em cada máquina (Node puro): `server.js` (rotas), `crm-*` e `finance-*`
  (modelo puro + API), pontes `finance-crm-sync.js` e `crm-finance-vendas.js`, plugins `crm/` e `finance/`.
- `scripts/tests/` — um teste por módulo puro, importando de `dist/`.

## Próximas fases da organização
1. ~~Processo principal por domínio~~ (26/10).
2. ~~Telas por domínio~~ (26/10): `renderer.ts` de 7,5 mil para 2 mil linhas. Falta: o núcleo da janela que ficou
   nele (abas de conversa, lateral, paleta) e trazer para as páginas o estado que ainda mora no renderer (`ctx` com setter).
3. `src/shared/ipc.ts` (1,5 mil linhas) em contratos por domínio, reexportados pelo `ipc.ts`.
4. `docs/GUIA.md` (3 mil linhas) em um guia por domínio, com este arquivo como índice.
