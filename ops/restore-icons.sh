#!/bin/bash
# Re-applies custom Finder icons to all .command files.
# Run this after any agent creates or overwrites a .command file,
# since file recreation strips the macOS resource fork where icons live.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$REPO/ops/icons"

fileicon set "$REPO/dev.command"             "$ICONS/dev.icns"
fileicon set "$REPO/deploy.command"          "$ICONS/deploy.icns"
fileicon set "$REPO/deploy-backend.command"  "$ICONS/deploy-backend.icns"

echo "✓ Icons restored"
