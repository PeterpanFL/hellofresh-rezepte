#!/bin/bash
# Removes the automatic upload again.
LABEL="com.haukethomsen.hellofresh.upload"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/hellofresh-rezepte"
security delete-generic-password -s hellofresh-rezepte >/dev/null 2>&1 || true
echo "Automatischer Upload entfernt."
