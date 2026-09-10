#!/usr/bin/env bash
# Installs an already-downloaded mindmap-view release (a .zip, its
# extracted folder, or the extracted mindmap-view/ folder itself) into an
# Obsidian vault, restarting Obsidian against that vault.
#
# Unlike deploy.sh (which builds the plugin from the current source tree),
# this installs a release you already have on disk — e.g. downloaded from
# a GitHub Release (see .github/workflows/release.yml) — possibly onto a
# machine that doesn't even have this repo checked out.
#
# Windows equivalent: scripts/install-release.ps1 — keep both in sync if
# the install steps change.
#
# Usage: scripts/install-release.sh VAULT_DIR [SOURCE]
#   VAULT_DIR   Required. Path to the target Obsidian vault folder.
#   SOURCE      Optional. Defaults to the current directory. See -h/--help
#               for the accepted forms.
set -euo pipefail

PLUGIN_ID="mindmap-view"

usage() {
	cat <<EOF
Usage: $(basename "$0") VAULT_DIR [SOURCE]

Installs an already-downloaded mindmap-view release into an Obsidian vault.

Arguments:
  VAULT_DIR   Required. Path to the target Obsidian vault folder.
  SOURCE      Optional. Defaults to the current directory ('.'). Accepts,
              auto-detected:
                - a .zip file (auto-extracted; requires 'unzip' on PATH)
                - a folder containing a mindmap-view/ subfolder
                - the extracted mindmap-view/ folder itself, i.e. SOURCE
                  directly contains main.js, manifest.json, styles.css
              If both forms are present, the nested mindmap-view/
              subfolder wins.

Options:
  -h, --help  Show this help message and exit.

Examples:
  $(basename "$0") "/path/to/vault"
  $(basename "$0") "/path/to/vault" ~/Downloads/mindmap-view-v0.0.2.zip
  $(basename "$0") "/path/to/vault" ~/Downloads/mindmap-view-v0.0.2
EOF
}

# --- Argument parsing ------------------------------------------------------
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi

if [[ $# -lt 1 ]]; then
	echo "Error: VAULT_DIR is required." >&2
	echo >&2
	usage >&2
	exit 1
fi

VAULT_DIR="$1"
SOURCE="${2:-.}"

# --- Cleanup for a temp extraction dir, if we end up creating one ----------
TEMP_DIR=""
cleanup() {
	if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
		rm -rf "$TEMP_DIR"
	fi
}
trap cleanup EXIT

# --- Vault sanity check ------------------------------------------------
if [[ ! -d "$VAULT_DIR" ]]; then
	echo "Error: VAULT_DIR does not exist: $VAULT_DIR" >&2
	exit 1
fi

if [[ ! -d "$VAULT_DIR/.obsidian" ]]; then
	echo "Warning: $VAULT_DIR/.obsidian not found — this may not be an Obsidian vault. Continuing anyway." >&2
fi

PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"

# --- Resolve SOURCE: .zip / nested folder / flat folder ---------------------
# Case-insensitive match (a ".ZIP" from a case-preserving filesystem or a
# browser download should still be recognized) — matches install-release.ps1's
# case-insensitive check. `tr` rather than bash 4+'s "${VAR,,}" for
# portability: macOS ships bash 3.2 by default, which doesn't support it.
SOURCE_LOWER="$(printf '%s' "$SOURCE" | tr '[:upper:]' '[:lower:]')"
if [[ "$SOURCE_LOWER" == *.zip ]]; then
	if [[ ! -f "$SOURCE" ]]; then
		echo "Error: zip file not found: $SOURCE" >&2
		exit 1
	fi
	if ! command -v unzip >/dev/null 2>&1; then
		echo "Error: 'unzip' is required to extract $SOURCE but was not found on PATH." >&2
		echo "Fallback: extract the zip yourself and pass the extracted folder as SOURCE instead." >&2
		exit 1
	fi
	TEMP_DIR="$(mktemp -d)"
	echo "==> Extracting $SOURCE"
	unzip -q "$SOURCE" -d "$TEMP_DIR"
	SOURCE="$TEMP_DIR"
fi

if [[ ! -d "$SOURCE" ]]; then
	echo "Error: SOURCE not found: $SOURCE" >&2
	exit 1
fi

# Nested form (SOURCE/mindmap-view/...) wins if both forms look present.
if [[ -d "$SOURCE/$PLUGIN_ID" ]]; then
	RELEASE_DIR="$SOURCE/$PLUGIN_ID"
elif [[ -f "$SOURCE/main.js" ]]; then
	RELEASE_DIR="$SOURCE"
else
	echo "Error: could not find a $PLUGIN_ID release under $SOURCE" >&2
	echo "Looked for: $SOURCE/$PLUGIN_ID/ (nested form) and $SOURCE/main.js (flat form)" >&2
	exit 1
fi

# --- Validate release contents ----------------------------------------------
MISSING=""
for f in main.js manifest.json styles.css; do
	if [[ ! -f "$RELEASE_DIR/$f" ]]; then
		MISSING="$MISSING $f"
	fi
done
MISSING="${MISSING# }"

if [[ -n "$MISSING" ]]; then
	echo "Error: incomplete release source at $RELEASE_DIR — missing: $MISSING" >&2
	exit 1
fi

# --- Version info (grep/sed only — don't assume jq is installed) -----------
extract_version() {
	grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" | head -1 | sed -E 's/.*"([^"]*)"$/\1/'
}

NEW_VERSION="$(extract_version "$RELEASE_DIR/manifest.json")"

if [[ -f "$PLUGIN_DIR/manifest.json" ]]; then
	OLD_VERSION="$(extract_version "$PLUGIN_DIR/manifest.json")"
	echo "==> Replacing installed $PLUGIN_ID $OLD_VERSION -> $NEW_VERSION"
else
	echo "==> Installing $PLUGIN_ID $NEW_VERSION"
fi

# --- Closing Obsidian (if running) ------------------------------------------
# `osascript`/`open -a` are macOS-only; `pgrep`/`pkill` work on Linux too, so
# only the two macOS-specific calls are gated — a Linux run still closes a
# running Obsidian and still installs the files, it just can't auto-reopen.
echo "==> Closing Obsidian (if running)"
if [[ "$(uname)" == "Darwin" ]]; then
	osascript -e 'tell application "Obsidian" to if it is running then quit' >/dev/null 2>&1 || true
fi
for _ in $(seq 1 20); do
	pgrep -x Obsidian >/dev/null 2>&1 || break
	sleep 0.5
done
pkill -x Obsidian 2>/dev/null || true

# --- Copying plugin files ----------------------------------------------------
echo "==> Copying plugin files to $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp "$RELEASE_DIR/main.js" "$RELEASE_DIR/manifest.json" "$RELEASE_DIR/styles.css" "$PLUGIN_DIR/"

if [[ "$(uname)" == "Darwin" ]]; then
	echo "==> Opening Obsidian with vault: $VAULT_DIR"
	open -a Obsidian "$VAULT_DIR"
else
	echo "==> Files installed. Open Obsidian and load the vault manually (auto-reopen is macOS-only)."
fi

echo "==> Done"
