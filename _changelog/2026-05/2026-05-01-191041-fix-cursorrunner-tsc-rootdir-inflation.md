# Fix cursor-runner: TypeScript rootDir Inflation Breaks Runtime Startup

**Date**: May 1, 2026

## Summary

Fixed a `MODULE_NOT_FOUND` crash on cursor-runner startup caused by TypeScript computing an inflated `rootDir` during the embedded sync build. The compiled `main.js` ended up at `dist/cursorrunner/source/src/main.js` instead of the expected `dist/main.js`, which the `node dist/main.js` start script could not find.

## Problem Statement

After the previous fix placed `model-registry.json` at `client-apps/cli/embedded/libs/` to resolve path issues during sync, the cursor-runner started crashing at runtime with:

```
Error: Cannot find module '.../app/dist/main.js'
```

### Pain Points

- The `model-pricing-data.ts` import `../../../../libs/model-registry.json` resolved to `embedded/libs/model-registry.json` — a path **outside** the `source/` compilation directory
- TypeScript computes `rootDir` as the longest common ancestor of all input files. With one input outside `source/`, it inflated `rootDir` to `embedded/`, producing output at `dist/cursorrunner/source/src/main.js`
- The `package.json` start script (`node dist/main.js`) expected a flat `dist/` layout and failed

## Solution

Move `model-registry.json` inside `source/src/` (within the `src/` tree that TypeScript's `include` glob covers) and rewrite the import path in the synced source to `../model-registry.json`. This keeps all compiled inputs under `src/`, so TypeScript computes `rootDir = src/` and produces the flat `dist/main.js` layout.

## Implementation Details

### sync.sh — Step 1b rewrite

- **Before**: `cp "$MODEL_REGISTRY" "$SCRIPT_DIR/../libs/"` (outside `source/`)
- **After**: `cp "$MODEL_REGISTRY" "$SOURCE_DIR/src/"` (inside `source/src/`)
- Added `sed` to rewrite the import from `../../../../libs/model-registry.json` to `../model-registry.json` in the synced copy of `model-pricing-data.ts`
- Removed the now-unused `embedded/libs/` directory

### Verified output structure

After the fix, `dist/` is flat as expected:
```
dist/main.js          ← entry point (found by start script)
dist/worker.js
dist/config.js
dist/adapter/...
dist/activity/...
dist/model-registry.json
```

## Benefits

- Cursor-runner starts successfully — `node dist/main.js` finds the entry point
- The `dist/` layout is clean and flat, matching `package.json` expectations
- No changes to the original `backend/services/cursor-runner/` source tree

## Impact

- **Runtime**: cursor-runner was completely broken (MODULE_NOT_FOUND on every start); now works
- **Build**: sync.sh produces correct output structure
- **No upstream changes**: the fix is entirely within the embedded sync pipeline

## Related Work

- [Fix Embedded Sync: Model Registry Path Resolution](2026-05-01-185359-fix-embedded-sync-model-registry-path-resolution.md) — the previous fix that introduced this regression by placing the JSON outside the compilation boundary

---

**Status**: ✅ Production Ready
