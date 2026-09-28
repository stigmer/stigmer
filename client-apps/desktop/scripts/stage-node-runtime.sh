#!/usr/bin/env bash
#
# Stages the Node runtime the desktop app ships and starts its runner with.
#
# The embedded runner is JavaScript, and a packaged app launched from Finder,
# the Dock, the Start menu or a desktop launcher cannot rely on the user having
# Node, let alone on finding it: a GUI launch inherits the session's minimal
# PATH, not the shell's (stigmer/stigmer#1068). So every installer carries its
# own Node, pinned, verified and signed with the app, and the app spawns the
# runner from that file and no other (bundled_node_path in src-tauri/src/runner.rs).
#
# The pin is node-runtime.json: a version, which must equal the repository's
# .nvmrc so the Node users run is the Node the platform is built and tested on,
# and one committed SHA-256 per platform asset. scripts/bump-node-runtime.sh
# rewrites it.
#
# What this does, for the platform it runs on (the release lane builds each
# platform on its own host, the same assumption stage-runner-slim.sh makes for
# the runner's natives):
#
#   1. refuses a pin whose version differs from .nvmrc;
#   2. downloads the official nodejs.org asset into a per-version cache
#      (${XDG_CACHE_HOME:-~/.cache}/stigmer/node-runtime/v<version>) unless a
#      cached copy already matches, so dev and repeat builds download once;
#   3. refuses any file whose SHA-256 differs from the pin;
#   4. installs only the engine, bin/node from the tarball or the bare
#      node.exe, as src-tauri/resources/runtime/node (node.exe on Windows);
#   5. on macOS with APPLE_SIGNING_IDENTITY set, re-signs it with the engine's
#      entitlements (macos-entitlements/node-runtime.plist). The upstream
#      signature cannot ship: its entitlements include get-task-allow, which
#      Apple's notary refuses, and a plain re-sign would drop allow-jit, without
#      which V8 cannot start under the hardened runtime.
#
# Usage: ./scripts/stage-node-runtime.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

PIN="$DESKTOP_DIR/node-runtime.json"
RUNTIME_DIR="$DESKTOP_DIR/src-tauri/resources/runtime"

fail() {
  echo "stage-node-runtime: $*" >&2
  exit 1
}

# nodejs.org's platform names, for the legs release.desktop.yaml builds.
host_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os/$arch" in
    Darwin/arm64) echo darwin-arm64 ;;
    Linux/x86_64) echo linux-x64 ;;
    MINGW*/x86_64 | MSYS*/x86_64 | CYGWIN*/x86_64) echo win-x64 ;;
    *) fail "no pinned Node runtime for $os/$arch; node-runtime.json covers darwin-arm64, linux-x64 and win-x64" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

PLATFORM="$(host_platform)"

# The pin is JSON; the build's own Node reads it (the release lane and a dev
# machine both have one, the build itself runs on it).
read -r VERSION DIGEST < <(node -e '
  const pin = require(process.argv[1]);
  const digest = pin.sha256 && pin.sha256[process.argv[2]];
  if (!pin.version || !digest) process.exit(1);
  console.log(pin.version, digest);
' "$PIN" "$PLATFORM") || fail "$PIN has no version or no sha256 for $PLATFORM"

NVMRC="$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc")"
NVMRC="${NVMRC#v}"
[ "$VERSION" = "$NVMRC" ] || fail "node-runtime.json pins v$VERSION but .nvmrc is v$NVMRC; run scripts/bump-node-runtime.sh $NVMRC"

case "$PLATFORM" in
  win-x64)
    ASSET="win-x64/node.exe"
    CACHED_NAME="node-v$VERSION-win-x64.exe"
    ENGINE="node.exe"
    ;;
  *)
    ASSET="node-v$VERSION-$PLATFORM.tar.gz"
    CACHED_NAME="$ASSET"
    ENGINE="node"
    ;;
esac

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/stigmer/node-runtime/v$VERSION"
CACHED="$CACHE_DIR/$CACHED_NAME"
mkdir -p "$CACHE_DIR"

if [ ! -f "$CACHED" ] || [ "$(sha256_of "$CACHED")" != "$DIGEST" ]; then
  url="https://nodejs.org/dist/v$VERSION/$ASSET"
  echo "Downloading $url"
  curl -fsSL --retry 3 -o "$CACHED.part" "$url" || fail "download failed: $url"
  actual="$(sha256_of "$CACHED.part")"
  if [ "$actual" != "$DIGEST" ]; then
    rm -f "$CACHED.part"
    fail "$ASSET has SHA-256 $actual, node-runtime.json pins $DIGEST; refusing to stage it"
  fi
  mv "$CACHED.part" "$CACHED"
fi

rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"

if [ "$PLATFORM" = win-x64 ]; then
  cp "$CACHED" "$RUNTIME_DIR/$ENGINE"
else
  extract_dir="$(mktemp -d)"
  trap 'rm -rf "$extract_dir"' EXIT
  tar -xzf "$CACHED" -C "$extract_dir" "node-v$VERSION-$PLATFORM/bin/node"
  mv "$extract_dir/node-v$VERSION-$PLATFORM/bin/node" "$RUNTIME_DIR/$ENGINE"
fi
chmod 755 "$RUNTIME_DIR/$ENGINE"

echo "Staged Node v$VERSION ($PLATFORM): $RUNTIME_DIR/$ENGINE"

if [ "$(uname -s)" = Darwin ] && [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  "$SCRIPT_DIR/macos-codesign-tree.sh" sign \
    --entitlements "$SCRIPT_DIR/macos-entitlements/node-runtime.plist" "$RUNTIME_DIR"
fi
