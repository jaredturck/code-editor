#!/usr/bin/env bash
# orbit-explore-project — returns project structure, tech stack, and entry points as JSON
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

# Detects the project stack from repository markers before running focused discovery.
detect_stack() {
  local stack=()
  [ -f package.json ] && stack+=("node")
  [ -f requirements.txt ] || [ -f pyproject.toml ] && stack+=("python")
  [ -f Cargo.toml ] && stack+=("rust")
  [ -f go.mod ] && stack+=("go")
  [ -f pom.xml ] && stack+=("java-maven")
  [ -f build.gradle ] && stack+=("java-gradle")
  [ -f composer.json ] && stack+=("php")
  [ -f Gemfile ] && stack+=("ruby")
  echo "${stack[@]:-unknown}"
}

STACK=$(detect_stack)
FILE_COUNT=$(find . -type f ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' 2>/dev/null | wc -l | tr -d ' ')
TOP_DIRS=$(find . -maxdepth 2 -type d ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' 2>/dev/null | head -30 | sort)
ENTRY_POINTS=$(find . -name "index.*" -o -name "main.*" -o -name "app.*" ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | head -10)
PKG_NAME=$(node -e "const p=require('./package.json'); console.log(p.name||'')" 2>/dev/null || echo "")
PKG_DESC=$(node -e "const p=require('./package.json'); console.log(p.description||'')" 2>/dev/null || echo "")

printf '{"script":"orbit-explore-project","success":true,"summary":"%s project, %s files","data":{"stack":"%s","fileCount":%s,"packageName":"%s","packageDescription":"%s","topDirs":%s,"entryPoints":%s}}\n' \
  "$STACK" "$FILE_COUNT" "$STACK" "$FILE_COUNT" "$PKG_NAME" "$PKG_DESC" \
  "$(echo "$TOP_DIRS" | jq -R . | jq -cs .)" \
  "$(echo "$ENTRY_POINTS" | jq -R . | jq -cs .)"
