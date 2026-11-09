#!/bin/bash
# Sets up the automatic upload from the ScanSnap folder (run once in Terminal: bash install.sh).
set -euo pipefail

DEFAULT_DIR="$HOME/Downloads/Hello Fresh"
SUPABASE_URL="https://zbacitfskqbdzcozdmwr.supabase.co"
SUPABASE_KEY="sb_publishable_NA3PnoL8wuRjsyk6JI96AQ_8A3RP4g2"
LABEL="com.haukethomsen.hellofresh.upload"
APP_DIR="$HOME/Library/Application Support/hellofresh-rezepte"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"

read -r -p "Scan-Ordner [$DEFAULT_DIR]: " SCAN_DIR
SCAN_DIR="${SCAN_DIR:-$DEFAULT_DIR}"
read -r -p "E-Mail deines Rezepte-Logins: " EMAIL
read -r -s -p "Passwort (wird im Schlüsselbund gespeichert): " PASSWORD; echo

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$HERE/upload.sh" "$APP_DIR/upload.sh"
chmod +x "$APP_DIR/upload.sh"
cat > "$APP_DIR/config" <<CFG
SCAN_DIR="$SCAN_DIR"
SUPABASE_URL="$SUPABASE_URL"
SUPABASE_KEY="$SUPABASE_KEY"
EMAIL="$EMAIL"
CFG
security add-generic-password -U -s hellofresh-rezepte -a "$EMAIL" -w "$PASSWORD"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$APP_DIR/upload.sh</string></array>
  <key>WatchPaths</key><array><string>$SCAN_DIR</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hellofresh-rezepte.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hellofresh-rezepte.log</string>
</dict>
</plist>
PL

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Eingerichtet. Neue PDFs in \"$SCAN_DIR\" werden automatisch hochgeladen."
echo "Log: ~/Library/Logs/hellofresh-rezepte.log"
echo "Testlauf jetzt:"
/bin/bash "$APP_DIR/upload.sh" && tail -n 5 "$HOME/Library/Logs/hellofresh-rezepte.log" 2>/dev/null || true
