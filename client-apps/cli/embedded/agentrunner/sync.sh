#!/usr/bin/env bash
# sync.sh — Copy agent-runner Python source into the embed directory.
#
# Run before `go build -tags embed_agentrunner` to produce a CLI binary
# with the Python source embedded. Without this step, the CLI falls back
# to locating source from the repository tree at runtime (dev mode).
#
# Usage:
#   cd client-apps/cli/embedded/agentrunner
#   ./sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
AGENT_RUNNER="$REPO_ROOT/backend/services/agent-runner"
GRAPHTON="$REPO_ROOT/backend/libs/python/graphton"
STUBS="$REPO_ROOT/apis/stubs/python/stigmer"

rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"

echo "Syncing agent-runner source..."
cp "$AGENT_RUNNER/main.py" "$SOURCE_DIR/"
cp "$AGENT_RUNNER/requirements.txt" "$SOURCE_DIR/"
mkdir -p "$SOURCE_DIR/src/stigmer_runner"
cp "$AGENT_RUNNER/src/stigmer_runner/__init__.py" "$SOURCE_DIR/src/stigmer_runner/"
cp "$AGENT_RUNNER/src/stigmer_runner/__main__.py" "$SOURCE_DIR/src/stigmer_runner/"
cp -r "$AGENT_RUNNER/src/stigmer_runner/worker" "$SOURCE_DIR/src/stigmer_runner/worker"
cp -r "$AGENT_RUNNER/src/stigmer_runner/grpc_client" "$SOURCE_DIR/src/stigmer_runner/grpc_client"

# model-registry.json is bundled inside graphton's package data
# (graphton/data/model-registry.json) and loaded via importlib.resources.
# No separate copy needed — it travels with the graphton directory below.

if [ -d "$GRAPHTON" ]; then
    echo "Syncing graphton lib..."
    mkdir -p "$SOURCE_DIR/libs/graphton/src"
    cp -r "$GRAPHTON/src/graphton" "$SOURCE_DIR/libs/graphton/src/"
    cp "$GRAPHTON/pyproject.toml" "$SOURCE_DIR/libs/graphton/"
    cp "$GRAPHTON/README.md" "$SOURCE_DIR/libs/graphton/" 2>/dev/null || true
fi

if [ -d "$STUBS" ]; then
    echo "Syncing stigmer-protos..."
    mkdir -p "$SOURCE_DIR/libs/stigmer-protos"
    cp -r "$STUBS"/* "$SOURCE_DIR/libs/stigmer-protos/" 2>/dev/null || true
fi

# Remove __pycache__ and .pyc files
find "$SOURCE_DIR" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find "$SOURCE_DIR" -name '*.pyc' -delete 2>/dev/null || true

echo "Sync complete: $SOURCE_DIR"
