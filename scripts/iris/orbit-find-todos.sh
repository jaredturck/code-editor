#!/usr/bin/env bash
# orbit-find-todos — extract TODO/FIXME/HACK/NOTE comments
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

TODOS=$(grep -rn --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" --include="*.py" \
  -E "(TODO|FIXME|HACK|XXX|NOTE|BUG)(\(.*?\))?:" . \
  2>/dev/null | grep -v node_modules | grep -v ".git" | head -40 || true)

COUNT=$(echo "$TODOS" | grep -c . || echo 0)
TODOS_JSON=$(echo "$TODOS" | jq -R . | jq -cs .)

printf '{"script":"orbit-find-todos","success":true,"summary":"%d TODO/FIXME items found","data":{"count":%d,"items":%s}}\n' \
  "$COUNT" "$COUNT" "$TODOS_JSON"
