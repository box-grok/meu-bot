#!/usr/bin/env bash
# Implanta o openai-compat.js (com o modelo "agente") na grokbot-1, com backup, testes e smoke.
set -euo pipefail
H=grokbot-1; D='~/.hermes/agente-rene/backend-sdk-claude'
TS=$(date +%Y%m%d%H%M%S)
ssh -o BatchMode=yes -o ConnectTimeout=40 $H "cp $D/services/openai-compat.js $D/services/openai-compat.js.bak-$TS && echo backup=$TS"
scp -q -o BatchMode=yes -o ConnectTimeout=40 "$(dirname "$0")/services/openai-compat.js" $H:$D/services/openai-compat.js
ssh -o BatchMode=yes -o ConnectTimeout=40 $H "cd $D && node --check services/openai-compat.js && (bash scripts/run-tests.sh 2>&1 | tail -4)"
ssh -o BatchMode=yes -o ConnectTimeout=40 $H "bash -lc 'pm2 restart hermes-mythos-lucas >/dev/null && sleep 4 && pm2 status hermes-mythos-lucas | grep -E online\|errored'"
ssh -o BatchMode=yes -o ConnectTimeout=40 $H "cd $D && K=\$(grep ^OPENAI_COMPAT_KEY= .env | cut -d= -f2-) && curl -s -H \"Authorization: Bearer \$K\" localhost:8080/v1/models | grep -o '\"id\":\"[a-z-]*\"' | tr '\n' ' ' && echo && curl -s -m 300 -H \"Authorization: Bearer \$K\" -H 'Content-Type: application/json' localhost:8080/v1/chat/completions -d '{\"model\":\"agente\",\"messages\":[{\"role\":\"user\",\"content\":\"crie teste-bypass.txt no diretório atual com FUNCIONOU e responda só com o conteúdo e o caminho absoluto do arquivo\"}]}' | head -c 400; echo; rm -f ~/agent-workspace/teste-bypass.txt"
echo "deploy ok (rollback: cp $D/services/openai-compat.js.bak-$TS $D/services/openai-compat.js && pm2 restart hermes-mythos-lucas)"
