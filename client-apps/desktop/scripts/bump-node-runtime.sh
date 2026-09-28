#!/usr/bin/env bash
#
# Rewrites node-runtime.json for a Node version, from nodejs.org's own digests.
#
# node-runtime.json pins the Node runtime every desktop installer carries (see
# stage-node-runtime.sh): its version, which must equal the repository's
# .nvmrc, and one SHA-256 per shipped platform asset. The digests are committed
# rather than fetched at build time so an upstream byte change fails the build
# instead of shipping under our signature, and so a bump is a reviewable diff.
# This script is how the digests change: it reads the release's
# SHASUMS256.txt and writes the file, so nobody copies a digest by hand.
#
# A bump is: set .nvmrc to the new version, run this script with it, commit
# both. Staging refuses a pin whose version differs from .nvmrc, so the two
# cannot drift apart silently.
#
# The platform keys are the release legs release.desktop.yaml builds; the asset
# each one names is in asset_for (stage-node-runtime.sh has the same mapping).
# Adding a leg (the Intel macOS row, say) is a key here and a row there.
#
# Usage: ./scripts/bump-node-runtime.sh <version>    e.g. 22.22.1 or v22.22.1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN="$(dirname "$SCRIPT_DIR")/node-runtime.json"

PLATFORMS=(darwin-arm64 linux-x64 win-x64)

asset_for() {
  local version="$1" platform="$2"
  case "$platform" in
    win-x64) echo "win-x64/node.exe" ;;
    *) echo "node-v$version-$platform.tar.gz" ;;
  esac
}

[ $# -eq 1 ] || { echo "usage: bump-node-runtime.sh <version>" >&2; exit 2; }
VERSION="${1#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: not a Node version: $1" >&2; exit 2; }

SHASUMS_URL="https://nodejs.org/dist/v$VERSION/SHASUMS256.txt"
shasums="$(curl -fsSL --retry 3 "$SHASUMS_URL")" || { echo "error: could not fetch $SHASUMS_URL" >&2; exit 1; }

trap 'rm -f "$PIN.tmp"' EXIT
{
  printf '{\n  "version": "%s",\n  "sha256": {\n' "$VERSION"
  for i in "${!PLATFORMS[@]}"; do
    platform="${PLATFORMS[$i]}"
    asset="$(asset_for "$VERSION" "$platform")"
    # SHASUMS256.txt lines are "<hex>  <asset>"; match the asset name exactly.
    digest="$(awk -v a="$asset" '$2 == a { print $1 }' <<<"$shasums")"
    [ -n "$digest" ] || { echo "error: $SHASUMS_URL lists no $asset" >&2; exit 1; }
    sep=","
    [ "$i" -eq $((${#PLATFORMS[@]} - 1)) ] && sep=""
    printf '    "%s": "%s"%s\n' "$platform" "$digest" "$sep"
  done
  printf '  }\n}\n'
} > "$PIN.tmp"
mv "$PIN.tmp" "$PIN"
echo "node-runtime.json pinned to v$VERSION"
