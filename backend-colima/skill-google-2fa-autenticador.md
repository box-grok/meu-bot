---
name: google-2fa-autenticador
description: Ativar a verificação em duas etapas da conta Google com o Autenticador do meu-bot (extensão Autenticador do Navegador). Use quando o dono pedir para "ativar a verificação em duas etapas", "colocar o autenticador no Google", "2FA do Gmail", ou quando o Google pedir código do app autenticador. Também serve de modelo para outros sites (Meta, GitHub, Cloudflare).
---
<!-- meu-bot skill google-2fa-autenticador v4 -->

# Verificação em duas etapas do Google com o Autenticador do meu-bot

O meu-bot tem um **Autenticador** (extensão no Navegador, ícone na barra de extensões): ele guarda o segredo do app
autenticador **só na máquina, cifrado**, e mostra o código de 6 dígitos do momento. Nenhuma rota devolve o segredo.
Prefira sempre o caminho A: o segredo sai do QR direto para a máquina, sem passar pela conversa.

## A. Com o dono no Navegador (padrão)

Guie em passos curtos, um por vez, e confira com `print` da aba antes do próximo:

1. Abra `https://myaccount.google.com/signinoptions/twosv` na aba do Navegador (o Google pode pedir a senha de novo).
   Se a verificação em duas etapas estiver desligada, o dono ativa primeiro (o Google pede um telefone).
2. Em **App autenticador** (`https://myaccount.google.com/two-step-verification/authenticator`), clique em
   **Configurar autenticador** (ou **Alterar app autenticador**, se já houver um). Aparece o **QR code**.
3. Com o QR na tela, o dono clica no ícone da extensão **Autenticador** e em **Ler QR da página**. A conta entra
   ("Google · e-mail") e o código de 6 dígitos aparece; um clique copia.
4. No Google, **Próxima**, cole o código no campo e **Verificar**. Pronto: o app autenticador fica ligado.
4b. **Backup (sempre, logo em seguida):** abra `https://myaccount.google.com/two-step-verification/backup-codes` e
   peça para o dono gerar os **10 códigos de backup** e guardar **fora do computador** (impresso, gerenciador de
   senhas ou pendrive). Cada código entra uma vez na conta, mesmo sem o Mac ou o Autenticador. O meu-bot não exporta o
   QR nem o segredo (regra do Autenticador); se o dono quiser uma cópia do QR, só enquanto ele ainda está na tela do
   Google, por captura de tela guardada fora do computador.
5. Se o dono quiser que você (o agente) possa usar o código depois (ex.: entrar numa ferramenta por ele), ele clica na
   conta na extensão: "Clique para deixar o agente usar". Sem isso você **não vê** o código, e está certo assim.

Problemas comuns: "o QR da página não é de autenticador" = o QR ainda não abriu (clique em Configurar autenticador);
"já existe uma conta" = já havia uma do mesmo e-mail: apague a antiga na extensão antes de ler o QR novo (o Google
invalida o segredo antigo quando gera outro).

## O que já aprendemos (agente-box-lv, 22/10/2026)

- **Funcionou:** QR → extensão Autenticador → "Ler QR da página" → Adicionar → código → Google **Avançar** → código →
  **Verificar**. Depois disso a página do autenticador passa a mostrar "Ativar a verificação em duas etapas".
- **O último passo é do dono:** "Ativar a verificação em duas etapas" (em `signinoptions/twosv`) pede para confirmar
  a identidade de novo. Se várias confirmações forem pedidas em seguida, ou de um navegador que o Google ainda não
  conhece, ele recusa ("Não foi possível confirmar sua identidade"). Não insista nem automatize: peça para o dono
  ativar ele mesmo, pelo navegador ou celular de sempre, ou esperar algumas horas e tentar de novo no Navegador.
- **Backup do QR:** se o dono quiser guardar a imagem do QR, guarde só como arquivo do Mac em pasta privada (0700/0600),
  fora da conversa. A imagem vale como o segredo: quem tem gera os códigos. Diga isso a ele.
- **Códigos de backup do Google** só ficam disponíveis depois que a verificação em duas etapas está ativa.
- **Em conta Google, o agente guia e o dono clica.** Automação seguida (cliques e digitação por script) faz o Google
  abrir "Confirme suas informações para continuar… evitando abusos de bots" (`accounts.google.com/uplevelingstep`).
  Nessa tela, prefira **Ler QR code** ao SMS: o dono aponta a câmera do celular, o celular envia a confirmação ao Google
  (pode contar como um SMS comum) e a página segue sozinha. Não clique nem digite por ele nessas telas de verificação.

## B. Sem QR na tela (só se o A não der)

Na tela do QR, o Google tem **Não consegue ler?** que mostra a **chave de configuração** (32 letras). Peça ao dono
para colar a chave na extensão (campo de chave, "Sem QR? Use a chave de configuração que o site mostra"). Só se ele
pedir que você faça, use a CLI, sabendo que a chave passa pela conversa:

```
node ~/.local/share/meu-bot/crm/crm.mjs autenticador-adicionar --segredo "<chave sem espaços>" --emissor Google --conta "<e-mail>" [--agente sim]
node ~/.local/share/meu-bot/crm/crm.mjs autenticador-codigo google      # só com --agente sim (ou liberado na extensão)
```

Depois digite o código no campo do Google (`digitar`) e clique em **Verificar**. Não repita a chave em respostas.

## Regras

- Nunca peça a senha do Google ao dono: ele digita na própria página.
- Não guarde URLs com `rapt=` (token temporário de reautenticação): abra sempre pelos endereços acima.
- Códigos de backup do Google: nunca os leia em voz alta, não os copie para a conversa nem para arquivos da máquina.
