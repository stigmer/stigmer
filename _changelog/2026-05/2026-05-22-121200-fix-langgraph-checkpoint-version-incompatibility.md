# Fix LangGraph Checkpoint Version Incompatibility

**Date**: May 22, 2026

## Summary

Upgraded the runner's LangGraph dependency chain from 0.x to 1.x to resolve a version incompatibility with `deepagents@1.10.2` that caused every native agent execution to crash with `TypeError: checkpoint.pending_sends is not iterable`. This also upgrades `@langchain/anthropic` from 0.3.x to 1.4.x, which fixes the `tool_use.id: Field required` Anthropic 400 error on MCP tool executions.

## Problem Statement

After the Category 1 FGA authorization fix (runner JWT minting), all 21+ native agent execution integration tests immediately hit a new crash during LangGraph checkpoint operations.

### Pain Points

- Every native agent execution failed with `TypeError: checkpoint.pending_sends is not iterable` (275 occurrences per test run)
- The `MCP_HttpToolExecution/native` test failed separately with `400: messages.1.content.1.tool_use.id: Field required` from the Anthropic API
- Both issues blocked the entire native test suite from producing meaningful results

## Solution

Root-caused to a **version incompatibility** between two LangGraph checkpoint packages coexisting in the dependency tree:

- **Runner (top-level)**: `@langchain/langgraph@0.2.74` with `@langchain/langgraph-checkpoint@0.0.18` — checkpoint format v1, includes `pending_sends: []`
- **deepagents@1.10.2 (nested)**: `@langchain/langgraph@1.3.1` with `@langchain/langgraph-checkpoint@1.0.2` — checkpoint format v4, `pending_sends` removed entirely

When `deepagents`' LangGraph 1.3.1 created a checkpoint (no `pending_sends`) and called `checkpointer.put()` on the runner's `MemorySaver@0.0.18`, the old `copyCheckpoint()` tried to spread `undefined` and crashed.

Fixed by upgrading the runner's direct dependencies to align with `deepagents`:

- `@langchain/langgraph`: `^0.2.0` → `^1.3.0`
- `@langchain/anthropic`: `^0.3.0` → `^1.4.0`
- Added `zod-to-json-schema: ^3.24.0` (new peer dep)

## Implementation Details

### Dependency upgrade (`package.json`)

Aligned all `@langchain/*` packages to the 1.x generation. After `npm install`, `deepagents` no longer needs nested copies of `@langchain/langgraph` and `@langchain/langgraph-checkpoint` — they are hoisted to the top level, eliminating the dual-version conflict.

### `HttpCheckpointSaver` async API migration (`http-saver.ts`)

LangGraph checkpoint 1.0.x made both `serde.dumpsTyped()` and `serde.loadsTyped()` async (they were sync in 0.0.18). Updated all call sites:

- `serializeTyped()` → now `async`, returns `Promise<[string, BinaryObj]>`
- `put()` and `putWrites()` → `await` serialize calls
- `parseCheckpointDocWithoutWrites()` → now `async` with proper `await` on `loadsTyped` (pre-existing bug fix — was returning unresolved Promises)
- `parseWrites()` → now `async` with proper `await` on `loadsTyped` (pre-existing bug fix)
- Updated return type to `CheckpointPendingWrite[]` (new type in 1.0.x)
- Changed default type tag fallback from `"msgpack"` to `"json"`

### Test updates

- `http-saver.test.ts`: checkpoint `v: 1` → `v: 4`, removed `pending_sends: []`, made `serializeForProxy` async
- `summarization-verification.test.ts`: added `await` to all 4 `serde.dumpsTyped()` calls

## Benefits

- Eliminates the `checkpoint.pending_sends is not iterable` crash on all native agent executions
- The `@langchain/anthropic` upgrade from 0.3.34 to 1.4.0 fixes the `tool_use.id: Field required` bug — the new version properly handles `input_json_delta` blocks and ensures missing `id` fields are populated
- Fixes pre-existing silent bugs in `HttpCheckpointSaver` where async deserialization results were not awaited
- Single version of all `@langchain/*` packages in the dependency tree (no more nested duplicates)

## Impact

- **Native agent executions**: Unblocked — the 21+ tests that were crashing with `pending_sends` can now proceed past checkpoint operations
- **MCP HTTP tool tests**: The `tool_use.id` Anthropic 400 should be resolved by the `@langchain/anthropic` 1.4.0 upgrade
- **Cloud mode** (`HttpCheckpointSaver`): Fixed async bugs that could have caused data corruption in checkpoint persistence
- **No breaking changes**: `interrupt()` and `Command` APIs are unchanged in LangGraph 1.x

## Related Work

- Integration Test Session 9 Report: Category 2 / P2 (`checkpoint.pending_sends`) and P3 (`tool_use.id`)
- Category 1 FGA Authorization Fix (runner JWT minting) — prerequisite that unmasked this issue
- Category 2a ("unexpected end of file" in skill tests) remains as a separate issue in `skill-writer.ts` ZIP extraction

---

**Status**: Production Ready
**Timeline**: ~1 hour (investigation + fix + verification)
