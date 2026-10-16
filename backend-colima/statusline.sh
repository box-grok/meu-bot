#!/usr/bin/env bash
# Claude Code status line
# Displays model, context usage, plan limits, and account info.
#
# Origem: diegofornalha/claude-statusline (.claude/statusline.sh). A única diferença é o bloco
# "meu-bot" mais abaixo, que persiste os limites em ~/.cache/claude-statusline/ratelimits.json
# para o backend do meu-bot servir em /v1/meu-bot/status. Instalado por install-statusline.sh.

export LC_NUMERIC=C

input=$(cat)

# meu-bot: quais segmentos aparecem (~/.claude/statusline-segments.json, editado em Tutoriais › Status line).
# Sem o arquivo, todos. O rodapé do meu-bot lê o mesmo arquivo pelo backend: barra e rodapé combinam.
SEG_PREFS="${HOME}/.claude/statusline-segments.json"
# (`// true` do jq trocaria false por true; por isso o if/has.)
seg_on() { [ -f "$SEG_PREFS" ] || return 0; [ "$(jq -r --arg k "$1" 'if has($k) then .[$k] else true end' "$SEG_PREFS" 2>/dev/null)" != "false" ]; }

# ─── Email + Assento (cache de 10min, OAuth profile API) ─────────────────────
CACHE_DIR="${HOME}/.cache/claude-statusline"
PROFILE_CACHE="${CACHE_DIR}/profile.json"
PROFILE_CACHE_MAX=600

[ -d "$CACHE_DIR" ] || (umask 077 && mkdir -p "$CACHE_DIR")

email=""
assento=""
if [ -f "$PROFILE_CACHE" ]; then
  cache_age=$(( $(date +%s) - $(stat -c %Y "$PROFILE_CACHE" 2>/dev/null || stat -f %m "$PROFILE_CACHE" 2>/dev/null || echo 0) ))
  if [ "$cache_age" -lt "$PROFILE_CACHE_MAX" ]; then
    email=$(jq -r '.email // empty' "$PROFILE_CACHE" 2>/dev/null)
    assento=$(jq -r '.assento // empty' "$PROFILE_CACHE" 2>/dev/null)
  fi
fi
if [ -z "$email" ] && seg_on account; then
  creds=""
  if command -v security &>/dev/null; then
    creds=$(security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w 2>/dev/null)
    [ -z "$creds" ] && creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
  fi
  [ -z "$creds" ] && [ -f "$HOME/.claude/.credentials.json" ] && creds=$(cat "$HOME/.claude/.credentials.json" 2>/dev/null)
  if [ -n "$creds" ]; then
    at=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
    if [ -n "$at" ]; then
      profile_json=$(curl -s --max-time 3 "https://api.anthropic.com/api/oauth/profile" \
        -H "Authorization: Bearer ${at}" -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null)
      email=$(echo "$profile_json" | jq -r '.account.email // empty' 2>/dev/null)
      tier=$(echo "$profile_json" | jq -r '.organization.rate_limit_tier // empty' 2>/dev/null)
      if echo "$tier" | grep -qi "max\|5x"; then
        assento="Premium"
      else
        assento="Padrão"
      fi
      if [ -n "$email" ]; then
        jq -n --arg e "$email" --arg a "$assento" '{email: $e, assento: $a}' > "$PROFILE_CACHE"
      fi
    fi
  fi
fi

# ─── Countdown from Unix epoch timestamp ─────────────────────────────────────
time_until_reset() {
  local reset_ts="$1"
  local now_ts diff_mins
  now_ts=$(date +%s)
  diff_mins=$(( (reset_ts - now_ts) / 60 ))
  if [ "$diff_mins" -le 0 ]; then
    echo "now"
  elif [ "$diff_mins" -ge 1440 ]; then
    local d=$(( diff_mins / 1440 )) h=$(( (diff_mins % 1440) / 60 ))
    echo "${d}d${h}h"
  elif [ "$diff_mins" -ge 60 ]; then
    local h=$(( diff_mins / 60 )) m=$(( diff_mins % 60 ))
    echo "${h}h${m}m"
  else
    echo "${diff_mins}min"
  fi
}

# ─── Format numbers with k/M suffixes ────────────────────────────────────────
fmt() {
  awk "BEGIN {
    n = $1
    if (n >= 1000000) printf \"%.1fM\", n/1000000
    else if (n >= 1000) printf \"%.1fk\", n/1000
    else printf \"%d\", n
  }"
}

# ─── Parse stdin JSON ────────────────────────────────────────────────────────
model=$(echo "$input" | jq -r '.model.display_name // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
ctx_tokens=$(echo "$input" | jq -r '
  (.context_window.current_usage.input_tokens // 0) +
  (.context_window.current_usage.output_tokens // 0) +
  (.context_window.current_usage.cache_creation_input_tokens // 0) +
  (.context_window.current_usage.cache_read_input_tokens // 0)
' 2>/dev/null)

# Rate limits (from stdin — no API call needed)
session_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
session_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty' 2>/dev/null)

# meu-bot: persiste os limites que o Claude Code acabou de mandar, para o backend servir em
# /v1/meu-bot/status (account-status.js lê ~/.cache/claude-statusline/ratelimits.json). Só grava
# quando há dado; `updated` vira o "há N min" do app. O semanal vai para o cache mesmo não aparecendo
# nesta barra: quem o exibe é o painel do meu-bot.
weekly_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)
weekly_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty' 2>/dev/null)
# MEU_BOT_STATUSLINE_TEST=1: o teste do tutorial (JSON simulado) não pode gravar limites falsos no cache.
if [ -z "${MEU_BOT_STATUSLINE_TEST:-}" ] && { [ -n "$session_pct" ] || [ -n "$weekly_pct" ]; }; then
  RATELIMITS_CACHE="${CACHE_DIR}/ratelimits.json"
  jq -n --arg s "$session_pct" --arg sr "$session_resets" --arg w "$weekly_pct" --arg wr "$weekly_resets" --arg u "$(date +%s)" \
    '{session_pct: ($s | tonumber? // null), session_resets: ($sr | tonumber? // null),
      weekly_pct: ($w | tonumber? // null), weekly_resets: ($wr | tonumber? // null), updated: ($u | tonumber)}' \
    > "${RATELIMITS_CACHE}.tmp" 2>/dev/null && mv -f "${RATELIMITS_CACHE}.tmp" "$RATELIMITS_CACHE"
fi

ctx_int=$(printf "%.0f" "${used_pct:-0}" 2>/dev/null || echo 0)

session_str=""
if [ -n "$session_pct" ]; then
  session_int=$(printf "%.0f" "${session_pct:-0}" 2>/dev/null || echo 0)
  session_time=$([ -n "$session_resets" ] && time_until_reset "$session_resets" || echo "")
  session_str="Sessão: ${session_int}%$([ -n "$session_time" ] && echo " · ${session_time}")"
fi
weekly_str=""
if [ -n "$weekly_pct" ]; then
  weekly_int=$(printf "%.0f" "${weekly_pct:-0}" 2>/dev/null || echo 0)
  weekly_time=$([ -n "$weekly_resets" ] && time_until_reset "$weekly_resets" || echo "")
  weekly_str="Semanal: ${weekly_int}%$([ -n "$weekly_time" ] && echo " · ${weekly_time}")"
fi


# ─── Build segments ──────────────────────────────────────────────────────────
seg_count=0
add_seg() {
  seg_colored[$seg_count]="$1"
  seg_plain[$seg_count]="$2"
  seg_count=$((seg_count + 1))
}

# Model
if [ -n "$model" ] && seg_on model; then
  add_seg "$(printf "\033[0;33m%s\033[0m" "$model")" "$model"
fi

# Context window
if seg_on ctx && [ "${ctx_int:-0}" -gt 0 ] 2>/dev/null; then
  ctx_total=${ctx_size:-0}
  divisor=${ctx_int:-1}
  [ "$divisor" -eq 0 ] 2>/dev/null && divisor=1
  [ "$ctx_total" -eq 0 ] 2>/dev/null && ctx_total=$((ctx_tokens * 100 / divisor))
  ctx_label="Ctx: ${ctx_int}% · $(fmt "${ctx_tokens:-0}")/$(fmt "${ctx_total:-0}")"
  add_seg "$(printf "\033[0;36m%s\033[0m" "$ctx_label")" "$ctx_label"
fi

# Email + assento
if [ -n "$email" ] && seg_on account; then
  email_label="$email"
  [ -n "$assento" ] && email_label="${email} (${assento})"
  add_seg "$(printf "\033[0;33m%s\033[0m" "$email_label")" "$email_label"
fi

# Session limit
if seg_on session && [ -n "$session_str" ]; then add_seg "$(printf "\033[0;36m%s\033[0m" "$session_str")" "$session_str"; fi
# Weekly limit (magenta)
if seg_on weekly && [ -n "$weekly_str" ]; then add_seg "$(printf "\033[0;35m%s\033[0m" "$weekly_str")" "$weekly_str"; fi


# ─── Detect terminal width ───────────────────────────────────────────────────
term_width=${COLUMNS:-0}
[ "$term_width" -eq 0 ] 2>/dev/null && term_width=$(stty size </dev/tty 2>/dev/null | awk '{print $2}')
[ -z "$term_width" ] || [ "$term_width" -eq 0 ] 2>/dev/null && term_width=$(tput cols </dev/tty 2>/dev/null)
[ -z "$term_width" ] || [ "$term_width" -eq 0 ] 2>/dev/null && term_width=200
term_width=$((term_width - 6))

# ─── Greedy line wrapping ────────────────────────────────────────────────────
sep=" | "
sep_len=3
output=""
line=""
line_len=0
first_on_line=true

for i in $(seq 0 $((seg_count - 1))); do
  plain="${seg_plain[$i]}"
  colored="${seg_colored[$i]}"
  seg_len=${#plain}

  if $first_on_line; then
    needed=$seg_len
  else
    needed=$((seg_len + sep_len))
  fi

  if ! $first_on_line && [ $((line_len + needed)) -gt "$term_width" ]; then
    [ -n "$output" ] && output="${output}\n"
    output="${output}${line}"
    line="$colored"
    line_len=$seg_len
    first_on_line=false
  else
    if $first_on_line; then
      line="$colored"
      line_len=$seg_len
      first_on_line=false
    else
      line="${line}${sep}${colored}"
      line_len=$((line_len + needed))
    fi
  fi
done

[ -n "$line" ] && { [ -n "$output" ] && output="${output}\n${line}" || output="$line"; }

printf "%b" "$output"
