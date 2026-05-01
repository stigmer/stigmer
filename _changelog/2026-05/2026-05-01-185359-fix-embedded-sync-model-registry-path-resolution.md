# Fix Embedded Sync: Model Registry Path Resolution

**Date**: May 1, 2026

## Summary

Fixed `make desktop-dev` build failure caused by the embedded cursor-runner and agent-runner being unable to locate `model-registry.json` after source files are synced to a different directory tree. Also fixed a missing `with { type: "json" }` import attribute required by NodeNext module resolution.

## Problem Statement

After the model registry was unified into a single JSON source of truth (`backend/libs/model-registry.json`), both runners import it via relative paths. Those paths resolve correctly from their original locations but break when `sync.sh` copies the source into `client-apps/cli/embedded/*/source/` for embedding into the CLI binary.

### Pain Points

- **cursor-runner**: `model-pricing-data.ts` imports `../../../../libs/model-registry.json`. From the original location (`backend/services/cursor-runner/src/adapter/`), this resolves to `backend/libs/`. From the embedded location (`source/src/adapter/`), it resolves to `client-apps/cli/embedded/libs/` — which doesn't exist.
- **agent-runner**: `model_registry.py` uses `Path(__file__).resolve().parents[5] / "model-registry.json"`. From the original Graphton location, `parents[5]` is `backend/libs/`. From the embedded location, `parents[5]` is `source/` — also missing the file. Python silently loaded an empty registry instead of crashing.
- **NodeNext import attribute**: `tsconfig.build.json` uses `module: "NodeNext"`, which requires `with { type: "json" }` on JSON imports. This was a latent issue that surfaced once the file was actually found.

## Solution

Each sync script now copies `model-registry.json` to the location where the relative path resolves from the embedded tree, so no import paths need to change.

## Implementation Details

### cursor-runner sync (`client-apps/cli/embedded/cursorrunner/sync.sh`)

Added Step 1b after copying source files: copies `backend/libs/model-registry.json` to `embedded/libs/model-registry.json`, which is where `../../../../libs/model-registry.json` resolves from `source/src/adapter/`.

### agent-runner sync (`client-apps/cli/embedded/agentrunner/sync.sh`)

Added a block before the Graphton copy: copies `backend/libs/model-registry.json` to `source/model-registry.json`, which is where `Path(__file__).parents[5] / "model-registry.json"` resolves from the embedded Graphton tree.

### TypeScript import attribute (`model-pricing-data.ts`)

Added `with { type: "json" }` to the JSON import, required by NodeNext module resolution in `tsconfig.build.json`.

## Benefits

- `make desktop-dev` builds cleanly again
- Embedded agent-runner now loads model pricing/metadata from the registry instead of silently operating with an empty model set
- Both sync scripts are self-contained — no manual file copying needed

## Impact

- **Desktop development**: unblocked (`make desktop-dev` was broken)
- **Embedded agent-runner**: model registry now populated correctly in CLI-embedded mode (was silently degraded)
- **No runtime changes**: original development paths (`backend/services/*`) are unaffected

## Related Work

- [Unified Model Registry](_changelog/2026-05/2026-05-01-183214-unified-model-registry.md) — introduced the shared JSON registry that triggered this issue

---

**Status**: ✅ Production Ready
