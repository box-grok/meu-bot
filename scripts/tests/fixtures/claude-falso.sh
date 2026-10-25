#!/usr/bin/env bash
# `claude` de mentira para o teste de rodízio de contas (contas-rodizio.test.mjs). Fala stream-json como a CLI.
# FAKE_DIR guarda o contador de chamadas e o log (uma linha por chamada: nº | CLAUDE_CONFIG_DIR | args).
# Roteiro por chamada: 1 → resposta normal (abre a sessão S); 2 → limite atingido (rate_limit_event rejected);
# 3 em diante → resposta normal com a mesma sessão. `--version` não conta.
set -u
if [ "${1:-}" = "--version" ]; then echo "2.1.310 (Claude Code)"; exit 0; fi
: "${FAKE_DIR:?}"
n=$(( $(cat "$FAKE_DIR/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_DIR/n"
printf '%s|%s|%s\n' "$n" "${CLAUDE_CONFIG_DIR:-}" "$*" >> "$FAKE_DIR/log"
cat > /dev/null  # o prompt vem no stdin
S="sess-0001-aaaa"
resets=$(( $(date +%s) + 3600 ))
echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$S\"}"
if [ "$n" -eq 2 ]; then
  echo "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"rejected\",\"resetsAt\":$resets,\"rateLimitType\":\"five_hour\",\"utilization\":1},\"session_id\":\"$S\"}"
  echo "{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true,\"result\":\"You've hit your limit · resets 5pm\",\"session_id\":\"$S\"}"
  exit 1
fi
# A transcrição que o --resume acha: ~/.claude/projects/<cwd com / e . trocados por ->/<S>.jsonl
proj="$HOME/.claude/projects/$(printf '%s' "$PWD" | sed 's/[\/.]/-/g')"
mkdir -p "$proj"; echo '{"type":"user"}' >> "$proj/$S.jsonl"
echo "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\",\"resetsAt\":$resets,\"rateLimitType\":\"five_hour\",\"utilization\":0.42},\"session_id\":\"$S\"}"
echo '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"text"}}}'
echo "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"olá da chamada $n em ${CLAUDE_CONFIG_DIR:-padrao}\"}}}"
echo '{"type":"stream_event","event":{"type":"content_block_stop"}}'
echo "{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"$S\",\"result\":\"olá da chamada $n\",\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}"
exit 0
