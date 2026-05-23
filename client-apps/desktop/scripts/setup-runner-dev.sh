#!/usr/bin/env bash
#
# Ensures the embedded runner symlink points to the canonical runner
# package so Tauri dev mode loads the latest build artifacts.
#
# The desktop app spawns `node resources/runner/dist/main.js` as a
# local Temporal worker. This script creates/verifies the symlink:
#
#   src-tauri/resources/runner  →  ../../../../backend/services/runner
#
# After running this script, `make build-runner` compiles into
# backend/services/runner/dist/ and the Tauri app picks it up
# immediately through the symlink.
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

mkdir -p "$RESOURCES_DIR"

if [ -L "$RUNNER_LINK" ]; then
  CURRENT_TARGET="$(readlink "$RUNNER_LINK")"
  if [ "$CURRENT_TARGET" = "$RUNNER_TARGET" ]; then
    echo "Runner symlink up to date: $RUNNER_LINK -> $RUNNER_TARGET"
    exit 0
  fi
  rm -f "$RUNNER_LINK"
elif [ -e "$RUNNER_LINK" ]; then
  echo "warning: $RUNNER_LINK exists but is not a symlink — removing"
  rm -rf "$RUNNER_LINK"
fi

ln -s "$RUNNER_TARGET" "$RUNNER_LINK"
echo "Created symlink: $RUNNER_LINK -> $RUNNER_TARGET"
