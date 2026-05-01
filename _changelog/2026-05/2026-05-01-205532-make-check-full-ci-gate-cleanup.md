# Fix All `make check` CI Gate Failures

**Date**: May 1, 2026

## Summary

Resolved all failures across the full `make check` CI gate — covering go mod tidy, TypeScript typechecks, Next.js builds (Turbopack and webpack), typedoc validation, Go tests, Python tests, and link checking. The suite now exits cleanly for the first time after the AgentRunner → Runner rename and several accumulated regressions.

## Problem Statement

`make check` was failing at multiple stages, with failures cascading and masking each other. Each fix revealed the next issue, totaling 10 distinct problems across the monorepo.

### Pain Points

- `go mod tidy` failed for `mcp-server` due to stale AgentRunner codegen artifacts that kept regenerating after deletion
- `cursor-runner` TypeScript typecheck rejected import attributes (`with { type: "json" }`)
- `site` typecheck failed because `@stigmer/react` was stale in `node_modules` (missing `RunnerPhase.STARTING`)
- `@stigmer/react` used a cross-package relative import to `model-registry.json` that broke when Yarn copied the package into `site/node_modules/`
- 6 typedoc warnings treated as errors in `sdk/react` blocked the `tsdoc-check` target
- Next.js Turbopack build for `client-apps/web` could not resolve `.js` → `.ts` imports in proto stubs
- Next.js webpack build for `site` had the same `.js` → `.ts` resolution issue
- A Go test in `cli/daemon` failed because it bypassed the constructor and didn't initialize `currentPhase`
- Python `agent-runner` tests failed because the Makefile used bare `pip` instead of the Poetry-managed virtualenv
- Link checker failed on `api.stigmer.ai` due to network connectivity from local environments

## Solution

Each issue was diagnosed individually by running `make check` iteratively and fixing the topmost failure before proceeding. The fixes range from deleting stale codegen artifacts to configuring bundler extension resolution to fixing test initialization.

## Implementation Details

| File | Change |
|------|--------|
| `tools/codegen/schemas/agentic/agentrunner/` | Deleted — stale schema that caused codegen to recreate deleted `gen/` code |
| `mcp-server/gen/agentic/agentrunner/` | Deleted — orphaned generated code referencing non-existent proto package |
| `backend/services/cursor-runner/tsconfig.json` | `module`/`moduleResolution` → `nodenext` to support import attributes |
| `sdk/react/data/model-registry.json` | New — local copy so the package is self-contained |
| `sdk/react/src/models/registry.ts` | Import now uses local `../../data/model-registry.json` |
| `sdk/react/package.json` | Added `data` to `files` array |
| `sdk/react/src/index.ts` | Export `UsePersistedModelOptions` and `ParsedModelKey` |
| `sdk/react/src/models/index.ts` | Re-export `ParsedModelKey` type |
| `sdk/react/typedoc.json` | Added `Harness` to `externalSymbolLinkMappings` |
| `client-apps/web/turbopack-js-to-ts-loader.js` | New — Turbopack loader that strips `.js` from relative imports |
| `client-apps/web/next.config.ts` | Added `@stigmer/protos` to `transpilePackages`, Turbopack loader rules |
| `site/next.config.ts` | Added `resolve.extensionAlias` for `.js` → `.ts` resolution |
| `client-apps/cli/internal/cli/daemon/runner_stream_commands_test.go` | Set `currentPhase: RUNNER_PHASE_READY` in test setup |
| `Makefile` | Changed `pip` → `poetry run pip` for agent-runner tests |
| `.lychee.toml` | Excluded `api.stigmer.ai` from link checks |

## Benefits

- `make check` passes end-to-end (exit 0) — the full CI gate is green
- Stale AgentRunner codegen loop permanently broken by removing the source schema
- `@stigmer/react` is now a self-contained package that works correctly as both a workspace dependency and a `file:` dependency
- Proto-generated TypeScript stubs resolve correctly in both Turbopack (web app) and webpack (site) builds
- Python agent-runner tests run reliably regardless of system `pip` availability

## Impact

- **All developers**: `make check` is usable again as a local CI gate before pushing
- **CI/CD**: Unblocks any pipeline that runs the full check suite
- **`sdk/react` consumers**: The package no longer breaks when installed outside the monorepo workspace
- **Docs site**: Builds successfully with proto stubs for the first time since the Runner rename

## Related Work

- AgentRunner → Runner rename (the root cause of issues #1, #3)
- Model registry unification (related to issue #4 — relative import to `model-registry.json`)
- `RunnerPhase.STARTING` enum addition (caused the stale `node_modules` issue #3)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
