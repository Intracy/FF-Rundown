#!/usr/bin/env bash
# Doppelklick im Finder startet Taktgeber und öffnet den Browser. Fenster offen lassen.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  osascript -e 'display dialog "Node.js fehlt. Bitte Node.js 22 LTS von nodejs.org installieren und danach erneut starten." buttons {"OK"} default button 1 with icon caution'
  open "https://nodejs.org"
  exit 1
fi
PORT="${PORT:-8787}"
( sleep 4; open "http://localhost:$PORT" ) &
./start.sh
