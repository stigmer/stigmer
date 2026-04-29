#!/usr/bin/env bash
#
# Builds the stigmer CLI from source and sets up the sidecar binary for
# local Tauri development.
#
# Tauri expects binaries at src-tauri/binaries/<name>-<target-triple>.
# This script builds the CLI with embedded agent-runner source, installs
# it to GOPATH/bin, and creates a symlink at the expected path.
#
# The build always runs to ensure the sidecar reflects the latest source.
# The symlink is recreated if the target has changed.
#
# Usage: ./scripts/setup-sidecar-dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"
CLI_DIR="$REPO_ROOT/client-apps/cli"

TARGET_TRIPLE="$(rustc --print host-tuple)"
SIDECAR_PATH="$BINARIES_DIR/stigmer-cli-$TARGET_TRIPLE"

GOPATH_BIN="$(go env GOPATH 2>/dev/null)/bin/stigmer"

mkdir -p "$BINARIES_DIR"

echo "Syncing agent-runner source for embedding..."
(cd "$CLI_DIR/embedded/agentrunner" && bash sync.sh)

echo "Building stigmer CLI from source..."
(cd "$CLI_DIR" && CGO_ENABLED=0 go build -tags embed_agentrunner -ldflags="-s -w" -o "$GOPATH_BIN" .)
echo "Installed: $GOPATH_BIN"

# Recreate symlink if missing or pointing to a different target.
if [ -L "$SIDECAR_PATH" ]; then
  CURRENT_TARGET="$(readlink "$SIDECAR_PATH")"
  if [ "$CURRENT_TARGET" = "$GOPATH_BIN" ]; then
    echo "Sidecar symlink up to date: $SIDECAR_PATH -> $GOPATH_BIN"
    exit 0
  fi
  rm -f "$SIDECAR_PATH"
elif [ -e "$SIDECAR_PATH" ]; then
  rm -f "$SIDECAR_PATH"
fi

ln -s "$GOPATH_BIN" "$SIDECAR_PATH"
echo "Created symlink: $SIDECAR_PATH -> $GOPATH_BIN"
