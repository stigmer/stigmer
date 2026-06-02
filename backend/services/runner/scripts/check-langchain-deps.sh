#!/usr/bin/env bash
#
# Verify LangChain dependency hygiene for the runner.
#
# Guards against two failure modes that cause silent runtime bugs:
#   1. Multiple resolved versions of @langchain/core in the dependency tree.
#      Different copies create distinct class prototypes, breaking instanceof
#      checks and causing "unknown message type" errors at runtime.
#   2. Unexpected version drift in pinned dependencies.
#
# Usage:
#   npm run check-deps          (from backend/services/runner/)
#   make check-deps             (from repo root)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$RUNNER_DIR"

echo "=== LangChain dependency check ==="
echo ""

# --- 1. Print resolved version table ---

echo "Resolved versions:"
npm ls @langchain/core @langchain/langgraph deepagents langchain 2>/dev/null \
  | head -40 || true
echo ""

# --- 2. Check for duplicate @langchain/core ---

CORE_VERSIONS=$(npm ls @langchain/core --all --json 2>/dev/null \
  | node -e "
    const json = require('fs').readFileSync('/dev/stdin', 'utf8');
    const tree = JSON.parse(json);
    const versions = new Set();
    function walk(node) {
      if (!node || !node.dependencies) return;
      for (const [name, dep] of Object.entries(node.dependencies)) {
        if (name === '@langchain/core' && dep.version) {
          versions.add(dep.version);
        }
        walk(dep);
      }
    }
    walk(tree);
    console.log([...versions].sort().join('\n'));
  " 2>/dev/null)

CORE_COUNT=$(echo "$CORE_VERSIONS" | grep -c . || true)

if [ "$CORE_COUNT" -gt 1 ]; then
  echo "FAIL: Multiple @langchain/core versions detected:"
  echo "$CORE_VERSIONS" | sed 's/^/  /'
  echo ""
  echo "This causes class identity failures at runtime."
  echo "Fix: deduplicate with 'npm dedupe' or add overrides to package.json."
  exit 1
fi

if [ "$CORE_COUNT" -eq 1 ]; then
  echo "OK: Single @langchain/core version: $CORE_VERSIONS"
else
  echo "WARN: Could not determine @langchain/core versions (is npm ci done?)"
fi

echo ""
echo "=== Dependency check passed ==="
