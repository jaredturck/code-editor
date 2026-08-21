#!/usr/bin/env bash
# orbit-audit-secrets — scan for hardcoded secrets, API keys, tokens
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

PATTERNS=(
  "api[_-]?key\s*[:=]\s*['\"][a-zA-Z0-9_\-]{16,}"
  "secret[_-]?key\s*[:=]\s*['\"][a-zA-Z0-9_\-]{16,}"
  "password\s*[:=]\s*['\"][^'\"]{8,}"
  "token\s*[:=]\s*['\"][a-zA-Z0-9_\-]{16,}"
  "sk-[a-zA-Z0-9]{32,}"
  "AKIA[0-9A-Z]{16}"
  "ghp_[a-zA-Z0-9]{36}"
)

HITS=()
for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r line; do
    HITS+=("$line")
  done < <(grep -rni --include="*.js" --include="*.ts" --include="*.py" --include="*.env" --include="*.json" -E "$pattern" . 2>/dev/null | grep -v node_modules | grep -v ".git" | head -5 || true)
done

COUNT=${#HITS[@]}
HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -cs . 2>/dev/null || echo "[]")

printf '{"script":"orbit-audit-secrets","success":true,"summary":"%d potential secrets found","data":{"count":%d,"findings":%s}}\n' \
  "$COUNT" "$COUNT" "$HITS_JSON"
