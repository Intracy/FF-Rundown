#!/usr/bin/env bash
# Taktgeber starten (Linux, Raspberry Pi, macOS-Terminal). Baut beim ersten Mal automatisch.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js fehlt. Bitte Node.js 22 LTS installieren: https://nodejs.org"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "Node.js $major ist zu alt, bitte Version 20 oder neuer installieren."; exit 1; }
[ -f .env ] && set -a && . ./.env && set +a
if [ ! -d node_modules ]; then echo "Installiere Abhängigkeiten …"; npm ci --no-audit --no-fund; fi
if [ ! -f dist/index.html ] || [ ! -f server/core.mjs ] || [ -n "$(find src -newer dist/index.html -print -quit 2>/dev/null)" ]; then echo "Baue die App …"; npm run build; fi
exec node server/index.mjs
