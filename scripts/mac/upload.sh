#!/bin/bash
# Uploads new ScanSnap PDFs from the scan folder into the Supabase inbox (<user_id>/inbox/ in bucket recipe-scans).
# The web app picks them up from there, cuts out the images and reads the text.
# Uploaded files move to "<scan folder>/hochgeladen". Started by launchd (see install.sh); logs to ~/Library/Logs.
set -u

CONFIG="$HOME/Library/Application Support/hellofresh-rezepte/config"
# shellcheck source=/dev/null
source "$CONFIG"   # SCAN_DIR, SUPABASE_URL, SUPABASE_KEY, EMAIL
KEYCHAIN_SERVICE="hellofresh-rezepte"
DONE_DIR="$SCAN_DIR/hochgeladen"
LOCK="/tmp/hellofresh-rezepte-upload.lock"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"Meine Rezepte\"" >/dev/null 2>&1 || true; }

# One run at a time (launchd fires again while ScanSnap is still writing).
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock older than 10 minutes is stale.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

if ! ls "$SCAN_DIR" >/dev/null 2>&1; then
  log "Kein Zugriff auf $SCAN_DIR"
  notify "Kein Zugriff auf den Scan-Ordner. Siehe README (Festplattenvollzugriff für bash)."
  exit 1
fi

shopt -s nullglob nocaseglob
files=()
now=$(date +%s)
for f in "$SCAN_DIR"/*.pdf; do
  # Skip files ScanSnap may still be writing (changed in the last 10 seconds).
  mtime=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
  [ $((now - mtime)) -ge 10 ] && files+=("$f")
done
[ ${#files[@]} -eq 0 ] && exit 0

PASSWORD=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$EMAIL" -w 2>/dev/null) || { log "Passwort nicht im Schlüsselbund"; exit 1; }
auth=$(curl -sS -m 30 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_KEY" -H "content-type: application/json" \
  --data-binary @- <<JSON
{"email": "$EMAIL", "password": "$(printf '%s' "$PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')"}
JSON
)
TOKEN=$(printf '%s' "$auth" | sed -n 's/.*"access_token": *"\([^"]*\)".*/\1/p')
USER_ID=$(printf '%s' "$auth" | sed -n 's/.*"user": *{ *"id": *"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ] || [ -z "$USER_ID" ]; then
  log "Anmeldung fehlgeschlagen: $(printf '%s' "$auth" | head -c 200)"
  notify "Anmeldung bei Supabase fehlgeschlagen."
  exit 1
fi

mkdir -p "$DONE_DIR"
count=0
for f in "${files[@]}"; do
  base=$(basename "$f")
  # Storage keys: ASCII only. A timestamp prefix keeps two scans with the same name apart.
  safe=$(printf '%s' "${base%.*}" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null | tr -c 'A-Za-z0-9._-' '_')
  key="$USER_ID/inbox/$(date '+%Y%m%d-%H%M%S')-${safe:-scan}.pdf"
  code=$(curl -sS -m 120 -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/storage/v1/object/recipe-scans/$key" \
    -H "apikey: $SUPABASE_KEY" -H "authorization: Bearer $TOKEN" -H "content-type: application/pdf" \
    --data-binary @"$f")
  if [ "$code" = "200" ]; then
    target="$DONE_DIR/$base"
    [ -e "$target" ] && target="$DONE_DIR/$(date '+%Y%m%d-%H%M%S')-$base"
    mv "$f" "$target"
    count=$((count + 1))
    log "Hochgeladen: $base"
  else
    log "Fehler $code bei $base"
  fi
  sleep 1   # distinct timestamps
done
[ $count -gt 0 ] && notify "$count Scan(s) hochgeladen. Öffne die Rezepte-App zum Verarbeiten."
exit 0
