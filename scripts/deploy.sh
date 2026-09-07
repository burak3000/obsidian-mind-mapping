#!/usr/bin/env bash
# Builds the plugin from the latest code and deploys it to the Tiyatro
# Obsidian vault (default), restarting Obsidian against that vault.
#
# Windows equivalent: scripts/deploy.ps1 — keep both in sync if the deploy
# steps change.
#
# Usage: scripts/deploy.sh [VAULT_DIR]
#   VAULT_DIR   Optional. Overrides the default target vault folder.
set -euo pipefail

REPO_DIR="/Users/burakucbinli/projects/obsidian-mind-mapping"
PLUGIN_ID="mindmap-view"
VAULT_DIR="${1:-/Users/burakucbinli/Library/Mobile Documents/iCloud~md~obsidian/Documents/Tiyatro}"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"

echo "==> Building plugin from $REPO_DIR"
cd "$REPO_DIR"
npm run build

echo "==> Closing Obsidian (if running)"
osascript -e 'tell application "Obsidian" to if it is running then quit' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
	pgrep -x Obsidian >/dev/null 2>&1 || break
	sleep 0.5
done
pkill -x Obsidian 2>/dev/null || true

echo "==> Copying plugin files to $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp "$REPO_DIR/dist/main.js" "$REPO_DIR/dist/manifest.json" "$REPO_DIR/dist/styles.css" "$PLUGIN_DIR/"

echo "==> Opening Obsidian with vault: $VAULT_DIR"
open -a Obsidian "$VAULT_DIR"

echo "==> Done"
