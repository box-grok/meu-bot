# CI e Claude no GitHub

> Índice: [../GUIA.md](../GUIA.md). Os workflows ficam em `.github/workflows/`.

## Testes (`testes.yml`)

Roda em todo PR, em todo push na `main` e sob demanda (`workflow_dispatch`). Num macOS com Node 26:
`npm ci`, `npm run typecheck` e `npm test`. Não usa segredos, então funciona também em PR de fork.
O Claude dispara a rodada pelo `gh workflow run testes.yml --ref <branch>`, porque push feito com
`GITHUB_TOKEN` não aciona `pull_request`.

## Claude sob demanda (`claude.yml`)

Comente `@claude <pedido>` num PR, numa issue, num comentário de revisão ou na própria revisão. Só
`OWNER`, `COLLABORATOR` e `MEMBER` acionam (o repo é público e o uso sai da assinatura).
Exemplos: `@claude revisa este PR`, `@claude corrige o teste que falhou`, `@claude explica o que muda em src/main.ts`.

## Claude automático (`claude-auto.yml`)

- **Issue nova vira PR:** issue aberta por `diegofornalha` ou `box-grok` é implementada, testada e vira PR
  (`claude/issue-N`). Se pede decisão, credenciais, acesso a máquinas, mudança em workflows ou é ambígua,
  o Claude só comenta o que falta decidir.
- **Teste que falha no PR é diagnosticado:** quando o Testes falha num PR desses dois, o Claude comenta a causa
  provável e, se a branch for deste repo (não fork), corrige e roda os testes de novo, uma vez.
- **Pular:** rótulo `sem-claude` na issue.

## Token

Segredo `CLAUDE_CODE_OAUTH_TOKEN` do repositório (Settings → Secrets and variables → Actions). Gere com
`claude setup-token`; vale 1 ano, então renove antes de vencer ou os dois workflows do Claude param.
