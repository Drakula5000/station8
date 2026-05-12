#!/bin/bash
# Re-applies custom Finder icons to all .command files.
# Run this after any agent creates or overwrites a .command file,
# since file recreation strips the macOS resource fork where icons live.
# Also handles iCloud-evicted files — Desktop is in iCloud Drive on this
# machine, so unused .command files get marked "dataless" and macOS won't
# write a resource fork to a stub. Read each file once to materialize first.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$REPO/ops/icons"

materialize_and_set() {
  local target=$1 icon=$2
  cat "$target" > /dev/null
  fileicon rm "$target" 2>/dev/null >/dev/null || true
  fileicon set "$target" "$icon"
}

materialize_and_set "$REPO/dev.command"             "$ICONS/dev.icns"
materialize_and_set "$REPO/deploy.command"          "$ICONS/deploy.icns"
materialize_and_set "$REPO/deploy-backend.command"  "$ICONS/deploy-backend.icns"

echo "✓ Icons restored"
