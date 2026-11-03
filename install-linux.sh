#!/usr/bin/env bash
# Installiert Taktgeber als Dienst (Debian, Ubuntu, Raspberry Pi OS; x86 und ARM).
# Erneut ausführen = Update (Daten in /opt/taktgeber/data bleiben). Entfernen: sudo ./install-linux.sh --remove
set -e
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 1; }
DIR=/opt/taktgeber
if [ "$1" = "--remove" ]; then
  systemctl disable --now taktgeber 2>/dev/null || true
  rm -f /etc/systemd/system/taktgeber.service
  systemctl daemon-reload
  echo "Dienst entfernt. Daten liegen weiter in $DIR/data."
  exit 0
fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Installiere Node.js 22 …"
  apt-get update -qq && apt-get install -y -qq ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
id taktgeber >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin taktgeber
mkdir -p "$DIR"
SRC="$(cd "$(dirname "$0")" && pwd)"
tar -C "$SRC" --exclude=node_modules --exclude=data --exclude=.git -cf - . | tar -C "$DIR" -xf -
[ -f "$DIR/.env" ] || { cp "$DIR/.env.example" "$DIR/.env"; [ -n "$PORT" ] && sed -i "s/^PORT=.*/PORT=$PORT/" "$DIR/.env"; }
mkdir -p "$DIR/data"
chown -R taktgeber:taktgeber "$DIR"
cd "$DIR"
sudo -u taktgeber npm ci --no-audit --no-fund
sudo -u taktgeber npm run build
cp "$DIR/taktgeber.service" /etc/systemd/system/taktgeber.service
systemctl daemon-reload
systemctl enable --now taktgeber
systemctl restart taktgeber
P=$(grep -E '^PORT=' "$DIR/.env" | cut -d= -f2); P=${P:-8787}
echo
echo "Taktgeber läuft: http://$(hostname -I | awk '{print $1}'):$P"
echo "Status: systemctl status taktgeber · Log: journalctl -u taktgeber -f"
