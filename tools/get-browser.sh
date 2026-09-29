#!/usr/bin/env bash
# Makes a real Chrome available to tools/e2e-drive.mjs.
#
# Why this script exists: this container cannot reach the usual browser download
# hosts (playwright.azureedge.net and the chrome-for-testing bucket both fail),
# and apt cannot reach deb.debian.org, so `npx playwright install` and
# `apt-get install chromium` are both dead ends here. The npm registry *is*
# reachable, and @sparticuz/chromium ships a compressed Chromium inside its
# tarball - so the browser comes from npm and its shared libraries come from the
# same package, unpacked into /tmp.
#
# Run it once per fresh container, then:
#   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-drive.mjs
set -euo pipefail

WORK=/tmp/br
LIBS=/tmp/alibs
CHROME=/tmp/chromium

if [ -x "$CHROME" ] && ldd "$CHROME" 2>/dev/null | grep -q 'not found'; then
  echo "chromium is present but its libraries are missing - reinstalling"
fi

mkdir -p "$WORK"
cd "$WORK"
[ -f package.json ] || npm init -y >/dev/null
[ -d node_modules/@sparticuz/chromium ] || npm install --no-audit --no-fund @sparticuz/chromium puppeteer-core

# @sparticuz/chromium unpacks the browser on first use, but it looks for the
# library set next to it, so do both steps explicitly.
node -e "
const c = require('@sparticuz/chromium');
c.default.executablePath().then((p) => console.log('chromium:', p));
"

mkdir -p "$LIBS"
node -e "
const fs = require('fs'), zlib = require('zlib');
const buf = fs.readFileSync('$WORK/node_modules/@sparticuz/chromium/bin/al2023.tar.br');
fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(buf));
"
tar -xf /tmp/al2023.tar -C "$LIBS"

if LD_LIBRARY_PATH="$LIBS/lib" "$CHROME" --version >/dev/null 2>&1; then
  echo "ok: $(LD_LIBRARY_PATH=$LIBS/lib $CHROME --version)"
  echo "run the drive with: LD_LIBRARY_PATH=$LIBS/lib node tools/e2e-drive.mjs"
else
  echo "chromium still will not start; run: ldd $CHROME | grep 'not found'" >&2
  exit 1
fi
