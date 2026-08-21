#!/usr/bin/env bash
# orbit-explore-git — git log summary, branch status, recent changes
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo '{"script":"orbit-explore-git","success":false,"summary":"not a git repo","data":{}}'
  exit 0
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
RECENT=$(git log --oneline -10 2>/dev/null | jq -R . | jq -cs .)
STATUS=$(git status --porcelain 2>/dev/null | head -20 | jq -R . | jq -cs .)
AHEAD_BEHIND=$(git status -sb 2>/dev/null | head -1 || echo "")

printf '{"script":"orbit-explore-git","success":true,"summary":"branch: %s","data":{"branch":"%s","aheadBehind":"%s","recentCommits":%s,"changedFiles":%s}}\n' \
  "$BRANCH" "$BRANCH" "$AHEAD_BEHIND" "$RECENT" "$STATUS"
