#!/usr/bin/env bash
# orbit-snapshot-workspace — returns a compact JSON snapshot for agent orientation
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

PKG_NAME=$(node -e "try{const p=require('./package.json');console.log(p.name||'')}catch{}" 2>/dev/null || echo "")
PKG_VERSION=$(node -e "try{const p=require('./package.json');console.log(p.version||'')}catch{}" 2>/dev/null || echo "")
FILE_COUNT=$(find . -type f ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" 2>/dev/null | wc -l | tr -d ' ')
SRC_FILES=$(find ./src -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log --oneline -1 2>/dev/null || echo "no git")

printf '{"script":"orbit-snapshot-workspace","success":true,"summary":"%s v%s, %s total files, branch: %s","data":{"name":"%s","version":"%s","totalFiles":%s,"srcFiles":%s,"branch":"%s","lastCommit":"%s","cwd":"%s"}}\n' \
  "$PKG_NAME" "$PKG_VERSION" "$FILE_COUNT" "$BRANCH" \
  "$PKG_NAME" "$PKG_VERSION" "$FILE_COUNT" "$SRC_FILES" "$BRANCH" "$LAST_COMMIT" "$(pwd)"
