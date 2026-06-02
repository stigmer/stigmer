# Fix Runner Execution Pipeline Errors

**Date**: May 24, 2026

## Summary

Fixed three bugs in the ExecuteCursor pipeline that compounded to kill workflow executions. The root cause was a phase ordering bug where model pricing validation ran against an empty registry, causing `claude-sonnet-4` to fall back to `"default"` — a sentinel the Cursor SDK cannot resolve. Two additional bugs (proto serialization in MCP connect-backfill, session slug re-validation on update) were fixed in the same pass.

## Problem Statement

The `daily-notification-plan` workflow for the Tiny Tactics engagement was failing with `EXECUTION_FAILED`. The runner log showed a cascade of four non-fatal setup errors that degraded the execution before it started, culminating in a terminal `status: ERROR` from the Cursor SDK.

### Pain Points

- Workflow executions always failed — no daily notification plans could be generated
- Model pricing registry was loaded at Phase 10b but consumed at Phase 6, causing every model to fall back to `"default"`
- MCP connect-backfill crashed with a proto serialization error (`{ value } as any` instead of `create(ExecutionValueSchema, ...)`)
- Session `harness_state_id` persistence failed due to slug re-validation on full session update
- A skill reference in the Tiny Tactics agent YAML was missing the cross-org qualifier

## Solution

Three targeted runner fixes plus one project config correction:

1. **Model pricing phase ordering**: Move `await ensurePricingLoaded()` from Phase 10b to Phase 5c (before model validation at Phase 6)
2. **Connect-backfill proto serialization**: Replace `{ value } as any` with `create(ExecutionValueSchema, { value, isSecret })` and thread `isSecret` through the full backfill chain
3. **Session slug clearing**: Clear `metadata.slug` before `updateSession()` to avoid re-validation of potentially invalid server-generated slugs
4. **Skill reference**: Add `org: stigmer` to the `data-analyst` skill ref in the Tiny Tactics `notification-analyst.yaml`

## Implementation Details

### Fix 1: Model pricing phase ordering (root cause)

The `resolveModelId()` function is synchronous and checks the in-memory pricing map. It was called at Phase 6 (line 236) but `ensurePricingLoaded()` — which populates that map from the API — ran at Phase 10b (line 351). With an empty map, every model fell back to `"default"`.

Added `await ensurePricingLoaded()` as Phase 5c, immediately before Phase 6. The existing call at Phase 10b is kept (the `initPromise` dedup makes it a no-op) to preserve the code's mental model.

Startup-time loading in `main.ts` was considered and rejected: in desktop embedded mode, the runner and proxy start concurrently, and a premature fetch failure locks the 1-hour cache with only model `"unknown"`.

### Fix 2: Connect-backfill proto serialization + isSecret threading

`connectMcpServer()` in `stigmer-client.ts` assigned plain JS objects into a protobuf map (`{ value } as any`), which `@bufbuild/protobuf` rejected at serialization time. The correct pattern already existed in `call-agent.ts`.

Fixed by:
- Changing `connectMcpServer` signature to accept `Record<string, { value: string; isSecret: boolean }>`
- Importing `ExecutionValueSchema` and using `create(ExecutionValueSchema, ...)` for each entry
- Threading `isSecret` through `extractRuntimeEnvForServer()` → `backfillMcpServersIfNeeded()` → `connectMcpServer()`
- Source priority for isSecret: MCP server env declaration > execution-level `secretKeys` > false
- Wiring `secretKeys` from both ExecuteCursor and ExecuteDeepAgent callers

### Fix 3: Session slug clearing

Phase 9 round-trips the full session object from `getSession()` with only spec changes. If the stored `metadata.slug` is invalid (e.g., underscores from workflow-generated names), the server's `ValidateProtoStep` rejects it before `ResolveSlugStep` can normalize it.

Clearing `metadata.slug` to `""` before the update is safe because:
- The proto has `IGNORE_IF_ZERO_VALUE` for slug — empty passes validation
- The server's `BuildUpdateStateStep` always preserves the existing slug from the database record
- `metadata.name` remains populated, preventing `ResolveSlugStep` from erroring

### Fix 4: Skill reference

The `notification-analyst` agent referenced `data-analyst` without `org`, causing it to resolve as `tt-demo/data-analyst` (not found) instead of `stigmer/data-analyst` (seedpack skill). Added `org: stigmer` to match the same cross-org pattern used for the Postgres MCP server ref.

## Benefits

- Workflow executions use the correct model (`claude-sonnet-4` instead of `"default"`)
- MCP server tool discovery and approval classification now works for servers with env vars
- Session `harness_state_id` persistence succeeds, enabling multi-turn agent resume
- Secret classification is properly propagated to the connect workflow's ephemeral ExecutionContext
- The analyst agent receives the seedpack `data-analyst` skill's analytical methodology

## Impact

- **Workflow executions**: Unblocks all Cursor-harness workflow executions that specify a model name
- **MCP connect-backfill**: Fixes both ExecuteCursor and ExecuteDeepAgent (shared code path)
- **Session updates**: Any session with an invalid server-generated slug can now persist `harness_state_id`
- **Tiny Tactics demo**: Daily notification plan workflow can now execute end-to-end

## Related Work

- `dd73b3bc8` (May 24): CURSOR_BACKEND_URL removal and fetch interceptor routing
- `_changelog/2026-05-24-153338`: Cursor SDK proxy routing fix (noted slug validation as separate fix needed)
- `_changelog/2026-03-18-091733`: Previous proto serialization fix (same class of bug in Timestamp fields)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (deep analysis + targeted fixes + regression tests)
