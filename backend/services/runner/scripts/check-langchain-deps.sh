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

# --- 3. Check @anthropic-ai/sdk copies (known, contained dual) ---
#
# The tree deliberately carries TWO versions of @anthropic-ai/sdk:
#   - @langchain/anthropic -> ^0.95.x  (hoisted; serves the public-API path)
#   - @anthropic-ai/vertex-sdk AND @anthropic-ai/bedrock-sdk -> >=0.115
#     (nested, deduped onto one version; serve only the backend clients
#     constructed via ChatAnthropic's createClient factory)
# The versions never exchange class instances (LangChain consumes stream
# events structurally and classifies errors by HTTP status, not instanceof),
# and the vertex-seam/bedrock-seam characterization tests pin the
# cross-version combinations in CI.
#
# Collapse condition: when the LangChain stack bump lands (@langchain/core
# 1.2.x + @langchain/anthropic 1.5.x, which pins @anthropic-ai/sdk ^0.115),
# npm dedupes to a single copy — tighten this check to single-copy then.
# Any dependent other than these three, or a third distinct version, is
# drift and fails the check.

echo ""
ANTHROPIC_SDK_REPORT=$(npm ls @anthropic-ai/sdk --all --json 2>/dev/null \
  | node -e "
    const json = require('fs').readFileSync('/dev/stdin', 'utf8');
    const tree = JSON.parse(json);
    const ALLOWED_PARENTS = new Set(['@langchain/anthropic', '@anthropic-ai/vertex-sdk', '@anthropic-ai/bedrock-sdk']);
    const found = new Map(); // parent -> Set<version>
    function walk(node, parentName) {
      if (!node || !node.dependencies) return;
      for (const [name, dep] of Object.entries(node.dependencies)) {
        if (name === '@anthropic-ai/sdk' && dep.version) {
          if (!found.has(parentName)) found.set(parentName, new Set());
          found.get(parentName).add(dep.version);
        }
        walk(dep, name);
      }
    }
    walk(tree, tree.name ?? '(root)');
    const versions = new Set([...found.values()].flatMap((s) => [...s]));
    const badParents = [...found.keys()].filter((p) => !ALLOWED_PARENTS.has(p));
    for (const [parent, vs] of found) {
      console.log(\`  \${parent} -> \${[...vs].join(', ')}\`);
    }
    if (badParents.length > 0) {
      console.log(\`FAIL:unexpected dependents: \${badParents.join(', ')}\`);
      process.exit(0);
    }
    if (versions.size > 2) {
      console.log(\`FAIL:more than two distinct versions: \${[...versions].join(', ')}\`);
      process.exit(0);
    }
    console.log('PASS');
  " 2>/dev/null)

echo "@anthropic-ai/sdk copies:"
echo "$ANTHROPIC_SDK_REPORT" | grep -v '^PASS$' | grep -v '^FAIL:' || true

if echo "$ANTHROPIC_SDK_REPORT" | grep -q '^FAIL:'; then
  echo ""
  echo "FAIL: @anthropic-ai/sdk copy check: $(echo "$ANTHROPIC_SDK_REPORT" | grep '^FAIL:' | sed 's/^FAIL://')"
  echo "Only @langchain/anthropic (0.95.x), @anthropic-ai/vertex-sdk (>=0.115),"
  echo "and @anthropic-ai/bedrock-sdk (>=0.115) may pull @anthropic-ai/sdk. See"
  echo "the comment above this check for the rationale and collapse condition."
  exit 1
fi

if echo "$ANTHROPIC_SDK_REPORT" | grep -q '^PASS$'; then
  echo "OK: @anthropic-ai/sdk copies match the known langchain + vertex/bedrock-sdk set"
else
  echo "WARN: Could not determine @anthropic-ai/sdk copies (is npm ci done?)"
fi

echo ""
echo "=== Dependency check passed ==="
