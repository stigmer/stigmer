#!/usr/bin/env bash
#
# Wires the desktop dev build to load the live in-repo runner.
#
# The desktop app spawns `node <runnerEntry>` as a local Temporal worker.
# In a packaged build `runnerEntry` resolves via Tauri's resource dir
# (`resolveResource`). In dev that path is a problem: Tauri stages declared
# resources by COPYING them into `target/<profile>/resources/` — for the runner
# that is a full ~485MB tree (incl. node_modules). tauri-build refreshes changed
# files but never prunes deleted ones, so after a refactor the staged copy ends
# up with a fresh `dist/` fingerprint sitting on top of stale `src/`, which trips
# the runner's build-freshness guard and makes it refuse to start
# (stigmer/stigmer#181).
#
# To avoid that drift entirely this script:
#
#   1. Maintains the canonical resource symlink for packaging parity:
#        src-tauri/resources/runner  →  ../../../../backend/services/runner
#   2. Writes the in-repo runner's ABSOLUTE entry to `.env.development.local` as
#      VITE_STIGMER_RUNNER_ENTRY. `getRunnerConfig` reads this in dev and bypasses
#      the staged copy, so the app always runs the live `dist/main.js` and
#      `make build-runner` is picked up without restaging.
#   3. De-fangs any stale staged snapshot under target/<profile>/resources/runner.
#      A previous version of this script symlinked that path, which is unsafe —
#      tauri-build would copy the 485MB source tree onto itself. We never want a
#      symlink there; a normal (now unread) copy is fine.
#
# Usage: ./scripts/setup-runner-dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$DESKTOP_DIR/src-tauri/resources"
RUNNER_LINK="$RESOURCES_DIR/runner"
RUNNER_TARGET="../../../../backend/services/runner"

REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
RUNNER_ABSOLUTE="$REPO_ROOT/backend/services/runner"

if [ ! -d "$RUNNER_ABSOLUTE" ]; then
  echo "error: runner package not found at $RUNNER_ABSOLUTE" >&2
  exit 1
fi

# ── 1. Canonical resource symlink (kept for packaging parity) ────────────────
mkdir -p "$RESOURCES_DIR"

if [ -L "$RUNNER_LINK" ]; then
  CURRENT_TARGET="$(readlink "$RUNNER_LINK")"
  if [ "$CURRENT_TARGET" != "$RUNNER_TARGET" ]; then
    rm -f "$RUNNER_LINK"
    ln -s "$RUNNER_TARGET" "$RUNNER_LINK"
    echo "Updated symlink: $RUNNER_LINK -> $RUNNER_TARGET"
  else
    echo "Runner symlink up to date: $RUNNER_LINK -> $RUNNER_TARGET"
  fi
elif [ -e "$RUNNER_LINK" ]; then
  echo "warning: $RUNNER_LINK exists but is not a symlink — removing"
  rm -rf "$RUNNER_LINK"
  ln -s "$RUNNER_TARGET" "$RUNNER_LINK"
  echo "Created symlink: $RUNNER_LINK -> $RUNNER_TARGET"
else
  ln -s "$RUNNER_TARGET" "$RUNNER_LINK"
  echo "Created symlink: $RUNNER_LINK -> $RUNNER_TARGET"
fi

# ── 2. Dev override: read the live runner, never the staged copy ──────────────
ENV_LOCAL="$DESKTOP_DIR/.env.development.local"
RUNNER_ENTRY_ABS="$RUNNER_ABSOLUTE/dist/main.js"
ENV_LINE="VITE_STIGMER_RUNNER_ENTRY=$RUNNER_ENTRY_ABS"

if [ -f "$ENV_LOCAL" ] && grep -q '^VITE_STIGMER_RUNNER_ENTRY=' "$ENV_LOCAL"; then
  # Rewrite the line in place (path may change across machines/checkouts).
  tmp="$(mktemp)"
  grep -v '^VITE_STIGMER_RUNNER_ENTRY=' "$ENV_LOCAL" > "$tmp" || true
  printf '%s\n' "$ENV_LINE" >> "$tmp"
  mv "$tmp" "$ENV_LOCAL"
else
  printf '%s\n' "$ENV_LINE" >> "$ENV_LOCAL"
fi
echo "Wrote dev runner entry: $ENV_LOCAL ($ENV_LINE)"

# ── 3. De-fang any stale/unsafe staged snapshot ──────────────────────────────
# A symlink here is dangerous (tauri-build would copy the source tree onto
# itself); a stale real copy is now simply unread. Remove either so the next
# `tauri dev` re-stages a clean copy that nothing depends on.
for PROFILE in debug release; do
  STAGED="$DESKTOP_DIR/src-tauri/target/$PROFILE/resources/runner"
  if [ -L "$STAGED" ]; then
    rm -f "$STAGED"
    echo "Removed unsafe staged runner symlink: $STAGED"
  fi
done
