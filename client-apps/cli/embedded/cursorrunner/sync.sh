#!/usr/bin/env bash
# sync.sh — Compile cursor-runner TypeScript source and prepare the embed directory.
#
# Run before `go build -tags embed_cursorrunner` to produce a CLI binary
# with the cursor-runner compiled JS embedded. Without this step, the CLI
# falls back to locating source from the repository tree at runtime (dev mode).
#
# What it does:
#   1. Copies cursor-runner TypeScript source into source/
#   2. Copies @stigmer/protos TS stubs as a local lib (resolves file: dependency)
#   2b. Compiles proto stubs to JS and rewrites exports for Node.js runtime
#   3. Rewrites package.json to use the local protos path
#   4. Runs npm install (needed for tsc to compile)
#   5. Compiles TypeScript to JavaScript via tsc
#   6. Cleans up node_modules and devDependencies (will be reinstalled on target)
#
# Usage:
#   cd client-apps/cli/embedded/cursorrunner
#   ./sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
CURSOR_RUNNER="$REPO_ROOT/backend/services/cursor-runner"
TS_STUBS="$REPO_ROOT/apis/stubs/ts"

rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"

# --------------------------------------------------------------------------
# Step 1: Copy cursor-runner source
# --------------------------------------------------------------------------
echo "Syncing cursor-runner source..."
cp -r "$CURSOR_RUNNER/src" "$SOURCE_DIR/src"
cp "$CURSOR_RUNNER/tsconfig.json" "$SOURCE_DIR/"
cp "$CURSOR_RUNNER/tsconfig.build.json" "$SOURCE_DIR/"

# Copy the lock file so npm install in Step 4 resolves the exact same
# dependency versions that were tested upstream. Without this, npm install
# generates a fresh lock file and may pick up newer (potentially breaking)
# versions of native SDKs like @cursor/sdk.
if [ -f "$CURSOR_RUNNER/package-lock.json" ]; then
    cp "$CURSOR_RUNNER/package-lock.json" "$SOURCE_DIR/"
fi

# model-registry.json is bundled inside cursor-runner's data/ directory
# (data/model-registry.json, imported as ../../data/model-registry.json).
# It travels with the cursor-runner source copy above — no separate step needed.

# --------------------------------------------------------------------------
# Step 1b: Copy data/ directory (contains model-registry.json)
# --------------------------------------------------------------------------
if [ -d "$CURSOR_RUNNER/data" ]; then
    echo "Syncing cursor-runner data..."
    cp -r "$CURSOR_RUNNER/data" "$SOURCE_DIR/data"
fi

# --------------------------------------------------------------------------
# Step 2: Copy @stigmer/protos TS stubs as a local lib
# --------------------------------------------------------------------------
if [ -d "$TS_STUBS" ]; then
    echo "Syncing stigmer-protos (TypeScript stubs)..."
    mkdir -p "$SOURCE_DIR/libs/stigmer-protos"
    cp -r "$TS_STUBS"/* "$SOURCE_DIR/libs/stigmer-protos/" 2>/dev/null || true
fi

# --------------------------------------------------------------------------
# Step 2b: Compile proto stubs to JS for Node.js runtime compatibility
#
# Node.js 22 has built-in TypeScript support in "strip-only" mode which
# removes type annotations but cannot transform runtime syntax like `enum`.
# The proto stubs use `export enum` extensively (21 files), so plain
# `node dist/main.js` crashes with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
#
# Fix: compile the stubs to JS here, then rewrite the package exports so
# the `import` condition resolves to compiled dist/*.js at runtime while
# the `types` condition still points at raw .ts for tsc type-checking.
# --------------------------------------------------------------------------
PROTOS_DIR="$SOURCE_DIR/libs/stigmer-protos"
if [ -d "$PROTOS_DIR" ] && [ -f "$PROTOS_DIR/tsconfig.build.json" ]; then
    echo "Compiling proto stubs to JavaScript..."
    cd "$PROTOS_DIR"
    npm install --ignore-scripts 2>&1 | tail -1
    npx tsc -p tsconfig.build.json

    node -e "
const pkg = require('./package.json');
pkg.exports = { './*': { types: './*.ts', 'import': './dist/*.js' } };
process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
" > package.json.tmp && mv package.json.tmp package.json

    rm -rf node_modules
    cd "$SOURCE_DIR"
fi

# --------------------------------------------------------------------------
# Step 3: Create the package.json with rewritten protos path
# --------------------------------------------------------------------------
echo "Creating package.json with local protos path..."
node -e "
const pkg = require('$CURSOR_RUNNER/package.json');

// Rewrite @stigmer/protos to point at the local copy
pkg.dependencies['@stigmer/protos'] = 'file:./libs/stigmer-protos';

// Keep only typescript (needed for tsc in Step 5); drop tsx, vitest, etc.
pkg.devDependencies = { typescript: pkg.devDependencies?.typescript || '^5.7.0' };

// Override the start script to use compiled JS
pkg.scripts.start = 'node dist/main.js';

process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
" > "$SOURCE_DIR/package.json.tmp" && mv "$SOURCE_DIR/package.json.tmp" "$SOURCE_DIR/package.json"

# --------------------------------------------------------------------------
# Step 4: Install dependencies (needed for tsc to resolve types)
# --------------------------------------------------------------------------
echo "Installing dependencies for compilation..."
cd "$SOURCE_DIR"
npm install --ignore-scripts 2>&1 | tail -1

# --------------------------------------------------------------------------
# Step 5: Compile TypeScript to JavaScript
# --------------------------------------------------------------------------
echo "Compiling TypeScript..."
npx tsc --project tsconfig.build.json

# --------------------------------------------------------------------------
# Step 6: Clean up for embedding
# --------------------------------------------------------------------------
echo "Cleaning up for embedding..."

# Remove node_modules — will be reinstalled on the target platform
# (native modules like @temporalio/core-bridge are platform-specific)
rm -rf "$SOURCE_DIR/node_modules"

# Remove TypeScript source (compiled JS is in dist/)
rm -rf "$SOURCE_DIR/src"

# Remove tsconfig files (not needed at runtime)
rm -f "$SOURCE_DIR/tsconfig.json" "$SOURCE_DIR/tsconfig.build.json"

echo "Sync complete: $SOURCE_DIR"
echo "Contents:"
find "$SOURCE_DIR" -type f | head -20 || true
