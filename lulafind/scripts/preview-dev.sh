#!/usr/bin/env bash
# One-command recovery for the live preview.
#
# Why this exists: this sandbox recycles between sessions, which wipes the
# running dev server AND node_modules/ (gitignored, so it is not snapshotted).
# Without this script every restart means "npm install, then npm start" by
# hand. Run it and the preview comes back on :4200, bound to 0.0.0.0 so the
# *.e2b.app proxy can reach it.
#
#   bash scripts/preview-dev.sh          # install if needed, then ng serve
#   SKIP_INSTALL=1 bash scripts/preview-dev.sh   # skip the install check
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  if [ ! -x node_modules/.bin/ng ]; then
    echo "==> Dependencies missing (fresh container). Installing..."
    npm install --no-audit --no-fund
  else
    echo "==> Dependencies present, skipping install."
  fi
fi

echo "==> Starting dev server on 0.0.0.0:4200 ..."
exec npm start
