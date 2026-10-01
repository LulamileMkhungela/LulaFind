#!/usr/bin/env bash
# Bring the LulaFind preview up from a cold container in one command.
#
# This container recycles node_modules, /tmp and the built www/ folder between
# sessions, so `ng serve` is always down and always needs its dependencies back.
# This script does the whole restore and then serves the built app statically,
# which comes up in about a second and needs no build tooling at request time.
#
#     bash tools/preview-up.sh          # restore + serve on 4200
#     PORT=4300 bash tools/preview-up.sh
#
# It rebuilds only when the bundle is missing or older than the sources, so a
# second run is instant.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lulafind" && pwd)"
cd "$APP"

echo "== LulaFind preview =="

# 1. Dependencies. Nothing can build or run without them.
if [ ! -x node_modules/.bin/ng ]; then
  echo "-- installing dependencies (first run only)"
  npm install --no-audit --no-fund
else
  echo "-- dependencies present"
fi

# 2. The built bundle. Rebuild when it is absent or any source file is newer,
#    so the preview can never quietly show stale code.
NEEDS_BUILD=0
if [ ! -f www/browser/index.html ]; then
  NEEDS_BUILD=1
elif [ -n "$(find src angular.json package.json -newer www/browser/index.html 2>/dev/null | head -1)" ]; then
  NEEDS_BUILD=1
fi

if [ "$NEEDS_BUILD" = "1" ]; then
  echo "-- building bundle"
  npm run build:snapshot
else
  echo "-- bundle is up to date"
fi

# 3. Serve it. server.mjs finds whichever layout holds an index.html.
echo "-- starting server"
exec node server.mjs
