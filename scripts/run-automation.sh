#!/bin/bash
# run-automation.sh <name> [--trigger=schedule|manual|agent]
# Thin wrapper: load .env, then exec the Node runner. Schedulers (launchd,
# systemd) call this, so a malformed .env line must never kill a run.
set -euo pipefail
ROOT="${AGENTS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${AGENTS_ENV_FILE:-$ROOT/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE" 2>/dev/null || echo "[run-automation] WARNING: bad line in $ENV_FILE (continuing)" >&2
  set +a
fi
export AGENTS_ROOT="$ROOT"
exec node "$ROOT/scripts/run-automation.mjs" "$@"
