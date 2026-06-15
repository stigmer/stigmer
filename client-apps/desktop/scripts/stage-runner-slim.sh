#!/usr/bin/env bash
#
# Stages the SLIM runner artifact into the Tauri resources for packaged
# desktop builds.
#
# Packaged apps must not bundle the full runner directory: the dev symlink
# (setup-runner-dev.sh) dereferences to backend/services/runner including its
# ~485 MB node_modules — and in CI, to a tree with no dist/node_modules at
# all, i.e. a broken embedded runner. The slim artifact (~85 MB, see
# stigmer/stigmer#170) is the only thing a shipped app should carry.
#
# Layout mirrors the dev tree so the frontend's runnerEntry
# ("resources/runner/dist/main.js", useEmbeddedRunner.ts) works identically
# in both modes:
#
#   src-tauri/resources/runner/
#     dist/            ← dist-slim bundle files (main.js entry)
#     node_modules/    ← dist-slim staged native/runtime packages
#
# Build dist-slim first: `make build-runner-slim` (or `npm run build:slim`
# in backend/services/runner).
#
# Usage: ./scripts/stage-runner-slim.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

DIST_SLIM="$REPO_ROOT/backend/services/runner/dist-slim"
RESOURCES_DIR="$DESKTOP_DIR/src-tauri/resources"
RUNNER_DIR="$RESOURCES_DIR/runner"

if [ ! -f "$DIST_SLIM/main.js" ]; then
  echo "error: $DIST_SLIM/main.js not found — run 'make build-runner-slim' first" >&2
  exit 1
fi

# Replace whatever is there: the dev symlink, or a previous staging.
rm -rf "$RUNNER_DIR"
mkdir -p "$RUNNER_DIR/dist"

for entry in "$DIST_SLIM"/*; do
  name="$(basename "$entry")"
  case "$name" in
    node_modules) cp -R "$entry" "$RUNNER_DIR/node_modules" ;;
    meta.json) ;; # esbuild metafile — build diagnostics, not runtime
    *) cp -R "$entry" "$RUNNER_DIR/dist/$name" ;;
  esac
done

SIZE="$(du -sh "$RUNNER_DIR" | cut -f1)"
echo "Staged slim runner: $RUNNER_DIR ($SIZE)"
