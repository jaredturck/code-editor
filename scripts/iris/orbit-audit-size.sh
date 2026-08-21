#!/usr/bin/env bash
# orbit-audit-size — find largest files and directories
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

LARGE_FILES=$(find . -type f ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" \
  -exec du -h {} + 2>/dev/null | sort -rh | head -20)
LARGE_DIRS=$(du -h --max-depth=2 . 2>/dev/null | sort -rh | head -15 | grep -v "^\." || true)

LARGE_FILES_JSON=$(echo "$LARGE_FILES" | jq -R . | jq -cs .)
LARGE_DIRS_JSON=$(echo "$LARGE_DIRS" | jq -R . | jq -cs .)

printf '{"script":"orbit-audit-size","success":true,"summary":"Size audit complete","data":{"largestFiles":%s,"largestDirs":%s}}\n' \
  "$LARGE_FILES_JSON" "$LARGE_DIRS_JSON"
