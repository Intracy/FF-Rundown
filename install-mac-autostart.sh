#!/usr/bin/env bash
# Startet Taktgeber automatisch bei der Anmeldung am Mac (ohne Terminal-Fenster).
# Entfernen: ./install-mac-autostart.sh --remove
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
PLIST="$HOME/Library/LaunchAgents/de.taktgeber.server.plist"
if [ "$1" = "--remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Autostart entfernt."
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="$(command -v node)" || { echo "Node.js fehlt (https://nodejs.org)."; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
mkdir -p "$HOME/Library/LaunchAgents" data
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.taktgeber.server</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server/index.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>${PORT:-8787}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Taktgeber startet jetzt automatisch: http://localhost:${PORT:-8787} (Log: data/server.log)"
