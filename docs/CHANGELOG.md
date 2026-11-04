# Changelog

O que mudou no meu-bot, em linguagem de quem usa. Cada item é uma frase; detalhe de implementação fica
no [diário técnico](GUIA.md).

> **Sobre a numeração.** O meu-bot foi de 0.4.0 direto para 0.78.4. Não houve 77 versões no meio: o salto
> alinha a numeração com a do Grok Bot, de onde este app nasceu, para dar para comparar os dois lado a
> lado. As quatro releases anteriores (v0.1.0 a v0.4.0-staging.3) não têm entrada própria aqui; esta
> primeira entrada descreve o app inteiro como ele está hoje.

---

## 4 de novembro de 2026

### v0.78.4 · O app de mesa, o WhatsApp e as máquinas

Primeira entrada do changelog. Reúne tudo o que o app faz hoje, depois de 455 mudanças.

#### Novo

**Conversa e janela**

- Uma janela por máquina, como o Cursor com SSH: o app abre num seletor (`local`, `colima`, `agente-box`,
  `grokbot-1`) e cada janela mostra só as conversas daquela máquina.
- Abas de conversa que ficam vivas em segundo plano, com ponto azul quando chega resposta, renomear com
  dois cliques e reordenar arrastando. A ordem e os nomes sobrevivem a fechar o app.
- Paleta de comandos com ⌘K, que acha conversas, ações e configurações.
- Entrada rápida: ⌘⇧Espaço de qualquer app abre uma janelinha e o Enter manda para a conversa ativa.
- Lista lateral com ⌘B, agrupada por data, com busca que ignora acento e arquivar.
- Exportar uma conversa em Markdown ou JSON, e ramificar a partir de qualquer mensagem.
- Resumo contínuo: passando do orçamento de contexto, o meio da conversa vira um resumo gerado em
  segundo plano, e uma memória local de perfil e notas entra em toda mensagem.
- Modo de depuração com uma faixa no topo mostrando build, batimento do processo principal, estado do
  túnel e o que chega de fora.

**WhatsApp**

- O agente atende no WhatsApp por três gateways intercambiáveis: Hermes, OpenClaw e PicoClaw. A pessoa
  escolhe em "Escolha o agente" e pode trocar depois; a tela explica o que cada um não faz.
- Pareamento por QR dentro do app, sem abrir terminal.
- Pausar o agente por contato, por 2 h, 24 h ou até retomar. O que chegou durante a pausa aparece na
  conversa numa bolha tracejada.
- Um dono por agente: quem manda nele, quem ele responde e quem ele ignora, com a regra num lugar só.
- Grupos, marcas nas conversas, renomear contato e "digitando…" enquanto o agente pensa.
- Guarda anti-laço, para o agente não ficar respondendo outro robô sem parar.
- Voz: o agente responde em áudio, com escolha de voz.

**As máquinas**

- O seletor sonda todas as máquinas em paralelo, mostra o estado de cada uma e instala o backend onde
  falta, com um clique.
- Aba Terminal com PTY remoto, várias abas por máquina.
- Aba Navegador com webviews, abas por conversa, espaços, favoritos e uma API para o agente navegar.
- Túnel SSH com ControlMaster, que revalida ao acordar o Mac.
- Botão ⇅ no seletor que preenche o `~/.ssh/config` a partir do arquivo de hosts do projeto.
- Tailscale SSH sem pedir aprovação, detectado pelo seletor e desligável pela API do tailnet.
- Vigia do `tailscaled`, para a máquina não sumir da rede.

**Contas, CRM e dinheiro**

- Conta Google por máquina, com Gmail, Agenda, Planilhas, Contatos e backup no Drive.
- CRM próprio dentro do Gmail, por extensão, aberto pela licença da máquina.
- Financeiro da máquina, com Curva ABC e importação de planilha.
- Licença da máquina com portões por módulo pago.
- Registro de auditoria de quem fez o quê em cada máquina.

**Administração (meu-bot-admin)**

- Aba Usuários que cria contas de login na máquina já com tetos de memória e CPU, para um cliente não
  derrubar os vizinhos.
- Código de suporte, que deixa o admin ver o que a pessoa escolheu mostrar.
- Log ao vivo de criar e preparar um usuário.

**Tutoriais**

- Trilha de tutoriais guiados ao vivo, numerados na ordem, com cartões, "pular" e arquivados.

#### Melhorado

- Streaming real: o texto chega palavra a palavra, e o Claude Code retoma a sessão em vez de reler tudo.
- Corrente de fallback de modelo configurada no backend, com aviso na conversa quando troca.
- Status line no rodapé com modelo, contexto, conta e os limites de 5 h e 7 dias do Claude, avisando ao
  passar de 80, 90 e 95%.
- Quando a máquina não tem a status line, o seletor avisa e oferece instalar, sem travar a abertura.
- O app detecta o que cada máquina sabe fazer por uma tabela de capacidades, nunca pelo nome do
  framework, então um gateway novo entra sem espalhar condição pelo código.
- Fuses do Electron travados no app gerado: sem executar como Node, sem inspeção por linha de comando e
  com integridade do pacote ligada.
- Canal staging ao lado do estável, como o VS Code Insiders, com ícone de faixa laranja, dados e porta
  próprios.
- Atualização automática no app instalado: baixa em segundo plano com retomada e progresso, guarda a
  versão preparada entre aberturas, só instala a versão que o botão mostrou, troca sozinha com o Mac
  ocioso ou ao fechar, e volta para a versão anterior se a nova não abrir.
- Cada zip de release sai com assinatura Ed25519, e o app só instala o que a chave da release assinou,
  sem nunca reassinar.

#### Corrigido

- O estado do WhatsApp aparece rápido ao abrir, sem "desconectado" falso.
- Gerar o QR com a sessão deslogada começa do zero em vez de insistir numa sessão morta.
- Apagar um usuário funciona mesmo com a conta sempre ligada.
- O backend e os plugins da máquina só sobem de versão, nunca rebaixam, mesmo com o estável e o staging
  falando com a mesma máquina.

---

## Antes disto

As releases v0.1.0 (22 de outubro de 2026) a v0.4.0-staging.3 (28 de outubro de 2026) saíram sem
changelog. O histórico está nos commits e nas notas de release do GitHub.
