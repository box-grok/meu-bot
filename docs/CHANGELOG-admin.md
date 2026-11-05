# meu-bot-admin-gestao: o que mudou

O app de gestão: suporte às pessoas, licenças e plano, espelho das máquinas, auditoria, usuários e produtos. Este
arquivo acompanha só ele, em linguagem de quem usa; o `CHANGELOG.md` ao lado é o do meu-bot e dos apps das pessoas.
As versões são as mesmas do meu-bot (um número para todos os apps); aqui entra o que cada uma trouxe para o admin.

## Ainda não lançado

### Novo

- **O agente do WhatsApp da conta nova é escolha do admin.** No "Criar usuário", ao lado do nome: Hermes (o padrão de
  sempre, com transcrição) ou OpenClaw. Com o OpenClaw, a conta nasce com a escolha gravada e o onboard acontece no
  pareamento, no meu-bot dela. O sistema é agnóstico: a mesma máquina recebe os dois.
- **Nova VPS com um clique.** No seletor de pessoas, ao lado de "Adicionar": com o endereço e um nome curto, o admin
  leva uma VPS recém-criada ao fluxo inteiro: alias root neste Mac, máquina na lista, Preparar máquina (swap, cota,
  governança, pacotes, gh, Hermes, transcritor, OpenClaw, Claude Global), primeiro usuário `box-1`, e o bloco pronto
  para o modelo de máquinas. A VPS precisa nascer com a chave deste Mac cadastrada no painel do provedor; senha não
  entra no app. Termina dizendo o que fica para você: login do root no Claude Code, Cloudflare do link público e o QR.
- **Nome próprio: meu-bot-admin-gestao.** O app deixa de se chamar meu-bot-admin. Na primeira abertura ele traz as
  pessoas, configurações e produtos do app antigo, que fica no lugar como cópia de segurança. Quem tinha o
  meu-bot-admin instala o novo uma vez; dali em diante ele se atualiza sozinho.

### Corrigido

- **A janela da pessoa abria com a cara do meu-bot da pessoa** (Tutoriais, Acervo, Conta Google, caixa de mensagem)
  em vez da lateral de gestão. Um canal novo da busca na página não estava na lista permitida e derrubava a janela
  na abertura. Agora a lateral volta: Suporte com plano e licença, Auditoria e, como root, Usuários.
- **O app subia sem o arquivo de suporte** (nome do admin, caixa de entrada, chave de backup) quando era empacotado
  pelo rebuild automático: a pasta `build/suporte` não ia junto. Vai sempre.
- **"Excluir máquina" numa máquina fora do ar** parecia não fazer nada: tentava limpar o WhatsApp lá, demorava minutos
  para falhar, e a opção "mesmo assim" sumia em 10 s. Agora, com a máquina fora do ar, o primeiro clique já oferece
  o "mesmo assim", que fica até você trocar de seleção.
- **"Sincronizar ssh" diz o que faz com pessoas do suporte:** o endereço delas vem do código que a pessoa manda;
  máquina com IP novo ou reinstalada entra por "Adicionar pessoa", e a antiga sai por "Excluir máquina".

## 0.78.4 (4 nov)

### Novo

- **⇅ "Sincronizar ssh" no seletor de pessoas**, na linha de "Adicionar": acrescenta ao `~/.ssh/config` deste Mac as
  máquinas do projeto que faltam e põe cada uma na lista como pessoa, uma a uma. A caixa de entrada ausente deixa de
  ser aviso a cada minuto.
- **Preparar máquina ganha "OpenClaw para todos"** (`/opt/openclaw`), como já havia para o Hermes; o pedido ao agente
  instala global como root.
- **Áudio do WhatsApp:** a máquina é preparada pelo root e o app liga a transcrição sozinho.

### Corrigido

- **Adotar uma máquina reinstalada** (mesmo endereço, chave do servidor nova) substitui a entrada velha, levando
  apelido, plano e usuário de login.
- **Adotar um alias que já é pessoa** mantém a pessoa (apelido, plano, histórico); alias renomeado no
  `~/.ssh/config` renomeia a pessoa.
- **Usuários:** a lista não falha quando o último usuário não tem o backend; "Criar usuário" não instala o OpenClaw
  numa máquina Hermes e diz por que não leu os usuários.

## 0.3.0 (28 out)

### Novo

- **Preparar máquina:** aba com o checklist do root que aplica o que falta; "Criar usuário" usa o mesmo caminho.
- **Usuários:** versão do backend por box e "Atualizar todas"; log ao vivo do criar e do preparar; nome já vem com o
  próximo número da sequência; limite de disco; usuários sempre ligados (linger); apagar num clique; RAM e CPU por
  usuário, com governança de cota e aviso no WhatsApp da pessoa.
- **Link Público Global:** um link `https://<nome>.<domínio>/` por usuário; admin e pessoa publicam, listam e tiram do ar.
- **Claude Code Global:** rodízio de contas do root, ligar e desligar por usuário, conferência no rodízio.
- **Status line:** o admin instala ao criar a conta.
- **Licença:** orientação de pagamento por conta, gerida no admin.
- **Hermes para todos** (`/opt/hermes`) e o WhatsApp acha o Hermes onde ele estiver.
- **meu-bot-admin-mac:** as contas deste Mac num app dedicado, separado deste.
- **Apelido da conta:** um só, gravado na máquina, igual no admin e no meu-bot.

### Corrigido

- Gravações no `pessoas.json` releem depois do SSH e não apagam o que entrou no meio.
- Usuários de login entram e saem sozinhos dos seletores do meu-bot e do admin.

## 0.2.0 e antes (até 26 out)

- **Espelho só leitura da máquina da pessoa:** saúde, WhatsApp, registros e progresso nos tutoriais, com as ações de
  suporte (reiniciar gateway, reiniciar backend, ativar transcrição, desligar o suporte) em dois cliques.
- **Auditoria** como aba da janela da pessoa, abaixo de Suporte; status da licença em pt-BR.
- **Produtos (MVPs)** em janela própria, fora do seletor, com formulário curto.
- **Excluir conversa** do meu-bot direto pelo "…", e ela some também no app da pessoa.
- **Seletor de pessoas:** abas por tipo de máquina; cada pessoa vira um `Host suporte-…` no `~/.ssh/config`, com
  chave e known_hosts próprios do suporte.
