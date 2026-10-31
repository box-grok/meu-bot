#!/usr/bin/env bash
# Hook Stop do Claude Code: trabalho concluído sem PR? Varre o checkout e os worktrees deste repositório e, quando acha um
# branch (≠ main) com a árvore limpa, commits à frente de origin/main, último commit recente e nenhuma PR aberta no
# diegofornalha/meu-bot, devolve `decision: block` com a razão: a sessão então abre a PR pela skill `contribuir`, com o
# corpo certo (um shell não escreve "O que acontece / Por quê / Como conferir"). Nada é publicado daqui.
# Lembra uma vez por (branch, commit): carimbo em .claude/.pr-check-<branch>-<sha> (fora do git). `stop_hook_active` no
# JSON de entrada é a volta da própria instrução: sai calado para não entrar em loop. `--check` mostra o que faria.
# Fora da varredura: branches listados em .claude/pr-lembrete-ignorar (integração local, ex.: local-teste) e branches cujo
# último commit é um merge (branch de integração, não de PR).
set -u
export PATH="$HOME/.local/bin:$PATH"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$HOME/Library/Logs/meu-bot-pr-lembrete.log"
REPO="diegofornalha/meu-bot"; DONO_FORK="box-grok"; JANELA_S=3600
mkdir -p "$(dirname "$LOG")" "$RAIZ/.claude"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

modo="${1:-hook}"
if [ "$modo" = hook ]; then
  entrada="$(cat 2>/dev/null || true)"
  case "$entrada" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0;; esac
fi
command -v gh >/dev/null 2>&1 || exit 0
agora=$(date +%s)
achados=()
while IFS= read -r dir; do
  [ -d "$dir" ] || continue
  branch=$(git -C "$dir" branch --show-current 2>/dev/null) || continue
  [ -n "$branch" ] && [ "$branch" != main ] || continue
  grep -qxF "$branch" "$RAIZ/.claude/pr-lembrete-ignorar" 2>/dev/null && continue
  [ "$(git -C "$dir" log -1 --format=%P 2>/dev/null | wc -w | tr -d " ")" -le 1 ] || continue
  [ -z "$(git -C "$dir" status --porcelain 2>/dev/null)" ] || continue
  frente=$(git -C "$dir" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  [ "$frente" -gt 0 ] || continue
  ultimo=$(git -C "$dir" log -1 --format=%ct 2>/dev/null || echo 0)
  [ $((agora - ultimo)) -lt "$JANELA_S" ] || continue
  sha=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null) || continue
  carimbo="$RAIZ/.claude/.pr-check-$(printf '%s' "$branch" | tr '/' '_')-$sha"
  [ -e "$carimbo" ] && continue
  if ! pr=$(gh pr list -R "$REPO" --head "$DONO_FORK:$branch" --state open --json number -q '.[0].number' 2>>"$LOG"); then
    log "gh falhou para $branch (sem login ou sem rede); nada a fazer"; exit 0
  fi
  touch "$carimbo"
  [ -n "$pr" ] && continue
  achados+=("$branch em $dir ($frente commit(s), último: $(git -C "$dir" log -1 --format=%s | cut -c1-90))")
done < <(git -C "$RAIZ" worktree list --porcelain 2>/dev/null | awk '/^worktree /{sub(/^worktree /, ""); print}')

[ "${#achados[@]}" -gt 0 ] || exit 0
razao="Trabalho commitado sem pull request: $(printf '%s; ' "${achados[@]}")Se o branch é seu (você fez esses commits nesta sessão), abra a PR agora pela skill contribuir (push para o fork + gh pr create, com as seções da skill). Se o branch é de outra sessão, só diga isso ao usuário e pare."
log "lembrete: ${achados[*]}"
if [ "$modo" = --check ]; then printf '%s\n' "$razao"; exit 0; fi
razao_json=$(printf '%s' "$razao" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')
printf '{"decision":"block","reason":"%s"}\n' "$razao_json"
