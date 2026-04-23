#!/usr/bin/env bash
#
# Sets up the stigmer CLI sidecar binary for local Tauri development.
#
# Tauri expects binaries at src-tauri/binaries/<name>-<target-triple>.
# This script creates a symlink from the locally-installed or Bazel-built
# CLI binary to the expected path.
#
# Usage: ./scripts/setup-sidecar-dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"

TARGET_TRIPLE="$(rustc --print host-tuple)"
SIDECAR_PATH="$BINARIES_DIR/stigmer-$TARGET_TRIPLE"

BAZEL_BIN="$DESKTOP_DIR/../../bazel-bin/client-apps/cli/stigmer_/stigmer"
GOPATH_BIN="$(go env GOPATH 2>/dev/null)/bin/stigmer"
SYSTEM_BIN="$(which stigmer 2>/dev/null || true)"

mkdir -p "$BINARIES_DIR"

if [ -L "$SIDECAR_PATH" ] || [ -e "$SIDECAR_PATH" ]; then
  echo "Sidecar already exists at $SIDECAR_PATH"
  ls -la "$SIDECAR_PATH"
  echo ""
  echo "To re-create, remove it first: rm $SIDECAR_PATH"
  exit 0
fi

SOURCE=""

if [ -x "$BAZEL_BIN" ]; then
  SOURCE="$BAZEL_BIN"
  echo "Using Bazel-built CLI: $SOURCE"
elif [ -x "$GOPATH_BIN" ]; then
  SOURCE="$GOPATH_BIN"
  echo "Using GOPATH CLI: $SOURCE"
elif [ -n "$SYSTEM_BIN" ] && [ -x "$SYSTEM_BIN" ]; then
  SOURCE="$SYSTEM_BIN"
  echo "Using system CLI: $SOURCE"
else
  echo "Error: stigmer CLI binary not found."
  echo ""
  echo "Build it with one of:"
  echo "  cd client-apps/cli && make install"
  echo "  cd client-apps/cli && make build"
  echo ""
  echo "Or install it to your PATH."
  exit 1
fi

ln -s "$SOURCE" "$SIDECAR_PATH"
echo "Created symlink: $SIDECAR_PATH -> $SOURCE"
