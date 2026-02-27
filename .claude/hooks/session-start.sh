#!/bin/bash
set -euo pipefail

# Only run in remote (ccweb) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "[session-start] Installing dependencies..." >&2
npm install

echo "[session-start] Building project..." >&2
npm run build

echo "[session-start] Setup complete." >&2
