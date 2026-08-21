#!/usr/bin/env bash
# orbit-explore-deps — dependency summary with version info
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

if [ -f package.json ]; then
  DEPS=$(node -e "
    const p = require('./package.json');
    const d = {...(p.dependencies||{}), ...(p.devDependencies||{})};
    const keys = Object.keys(d).slice(0, 40);
    console.log(JSON.stringify(keys.map(k=>({name:k,version:d[k]}))))
  " 2>/dev/null || echo "[]")
  printf '{"script":"orbit-explore-deps","success":true,"summary":"Node.js project dependencies","data":{"type":"node","deps":%s}}\n' "$DEPS"
elif [ -f requirements.txt ]; then
  DEPS=$(cat requirements.txt | grep -v "^#" | grep -v "^$" | head -40 | jq -R '{"name": split("==")[0], "version": (split("==")[1] // "any")}' | jq -cs .)
  printf '{"script":"orbit-explore-deps","success":true,"summary":"Python project dependencies","data":{"type":"python","deps":%s}}\n' "$DEPS"
else
  echo '{"script":"orbit-explore-deps","success":false,"summary":"no recognized dependency file found","data":{}}'
fi
