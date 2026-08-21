#!/usr/bin/env bash
# orbit-find-config — locate all config files
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

FILES=$(find . \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" -o -name "*.ini" -o -name "*.env" -o -name ".env*" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" 2>/dev/null | sort | head -40)

COUNT=$(echo "$FILES" | grep -c . || echo 0)
FILES_JSON=$(echo "$FILES" | jq -R . | jq -cs .)

printf '{"script":"orbit-find-config","success":true,"summary":"%d config files found","data":{"count":%d,"files":%s}}\n' \
  "$COUNT" "$COUNT" "$FILES_JSON"
