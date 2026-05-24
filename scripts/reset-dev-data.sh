#!/usr/bin/env bash
# Wipe Recourse local case data so you can test from a clean slate.
# Safe to run while the app is closed (recommended). If the app is open, use
# the "Reset" button in the top bar (dev mode) instead.
#
# Usage:
#   ./scripts/reset-dev-data.sh
#   npm run reset

set -euo pipefail

if [[ "$(uname -s)" == "Darwin" ]]; then
  DATA_DIR="${RECOURSE_USER_DATA:-$HOME/Library/Application Support/recourse}"
elif [[ "$(uname -s)" == "Linux" ]]; then
  DATA_DIR="${RECOURSE_USER_DATA:-$HOME/.config/recourse}"
else
  echo "Unsupported OS — set RECOURSE_USER_DATA to your Electron userData path."
  exit 1
fi

CASES_FILE="$DATA_DIR/cases.json"
WORKSPACES_DIR="$DATA_DIR/workspaces"

printf 'Resetting Recourse data in:\n  %s\n' "$DATA_DIR"

if [[ -d "$WORKSPACES_DIR" ]]; then
  rm -rf "$WORKSPACES_DIR"
  mkdir -p "$WORKSPACES_DIR"
  echo "✓ Cleared workspaces/"
else
  mkdir -p "$WORKSPACES_DIR"
  echo "✓ Created workspaces/"
fi

printf '%s\n' '{"version":1,"cases":[]}' > "$CASES_FILE"
echo "✓ Reset cases.json"

echo "Done. Restart npm run dev and send a new message to start fresh."
