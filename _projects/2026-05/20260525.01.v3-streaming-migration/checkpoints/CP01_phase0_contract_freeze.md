# Checkpoint CP01: Phase 0 — Contract Freeze

**Date**: 2026-05-26
**Session**: 3
**Status**: COMPLETE (with 2 deferred items)

## What Was Done

### 1. Dependency Safety (lockfile assertion)

- **New script**: `backend/services/runner/scripts/check-langchain-deps.sh`
  - Runs `npm ls` to print resolved LangChain dependency tree
  - Asserts single `@langchain/core` resolution (prevents class identity failures)
  - Exits non-zero if duplicates detected
- **New npm script**: `check-deps` in `backend/services/runner/package.json`
- **New Make target**: `check-deps` wired into root `make check`
- **Verified**: `@langchain/core@1.1.47` is the sole resolved version

### 2. StatusBuilder Golden Sequences (8 scenarios)

**File**: `backend/services/runner/src/activities/execute-deep-agent/__tests__/status-builder.test.ts`

Added `describe("golden sequences")` — 8 realistic multi-event conversation sequences that serve as the regression contract for V3StatusBuilder:

| Sequence | Events | Assertions |
|----------|--------|------------|
| Plain chat (2-turn) | 6 stream/end events | 2 AI messages, usage across turns, no tool calls |
| Anthropic thinking + text | thinking + text blocks, 2 turns | THINKING + AI messages, cache tokens, turn boundaries |
| Single tool call (ReAct) | text → tool_start → tool_end → text | Tool COMPLETED with args/result, 2 LLM turns |
| Tool error | text → tool_start → tool_end(error) | Tool FAILED with error string |
| Multi-tool concurrent | 2 parallel tools, out-of-order completion | Independent completion tracking |
| HITL approval gate | approval policy + tool_start | Phase → WAITING_FOR_APPROVAL, approval fields |
| Usage accumulation (3-turn) | 3 turns with cache read/write | Cumulative totals, turn count, cache fields |
| Namespace isolation | parent + subagent events | Separate message trees, cross-namespace tool calls |

**Total**: 86 tests (50 existing + 8 new golden sequences)

### 3. streamExecution Artifact/Writeback Tests (7 new tests)

**File**: `backend/services/runner/src/activities/execute-deep-agent/__tests__/streaming.test.ts`

- Artifact publish on tool_end (3 tests: path extraction, field variants, non-file-modifying exclusion)
- Writeback on tool_end (2 tests: coordinator call, both publisher+coordinator)
- Graceful stop with pending artifacts (1 test)

**Total**: 18 tests (11 existing + 7 new)

### 4. V2 Event Recorder

- **New module**: `backend/services/runner/src/activities/execute-deep-agent/event-recorder.ts`
  - `createV2EventRecorder(executionId, dir)` — returns recorder or undefined
  - Env-var-gated via `V2_EVENT_RECORD_DIR`
  - Records `{ seq, timestamp, event, name, run_id, data, metadata }` per event
  - Atomic flush on stream completion (not per-event I/O)
  - Handles circular references gracefully
- **Integration**: 3 lines added to `streaming.ts` (create, record, flush)
- **Tests**: `backend/services/runner/src/activities/execute-deep-agent/__tests__/event-recorder.test.ts` (9 tests)

### 5. Offline Integration Tests — New Scenarios

**File**: `test/integration-offline/plain_chat_offline_test.go`
- `TestOffline_PlainChat_SingleTurn` — text-only, no tools, usage verification
- `TestOffline_AnthropicThinking_ThinkingAndText` — thinking + text blocks, message type assertions

**File**: `test/integration-offline/structured_output_offline_test.go` (extended)
- `TestOffline_StructuredOutput_NativePath_TextBasedExtraction` — documents v2 text-based extraction baseline

**File**: `test/integration-offline/subagent_offline_test.go` (new)
- `TestOffline_SubAgent_Delegation` — 3-entry mock (parent task → subagent text → parent synthesis)

### 6. Mock LLM Proxy Enhancements

**File**: `test/integration/harness/mock_llm_proxy.go`
- Added `AnthropicThinkingTextResponse()` builder for thinking + text blocks
- Added SSE `thinking` block support in `writeAnthropicSSE()` (was silently dropped)

## What Was Deferred (and Why)

### Artifact Publish E2E — Blocked by Production Gap

**Root cause**: Agent `write_file` calls go to deepagents' `StateBackend` (in-memory LangGraph state), but `InlinePublisher` reads from `LocalWorkspaceBackend` (disk). Files never reach disk, so publish silently no-ops.

**Secondary blocker**: Offline harness forces `ARTIFACT_STORAGE_TYPE=proxy` when `ProxyEndpoint` is set, but `MockLLMProxyServer` doesn't handle artifact presign endpoints.

**Fix required**: Switch `createDeepAgent` backend from `StateBackend` to `FilesystemBackend` pointed at `workspaceBackend.rootDir`. This is a production architecture change, not Phase 0 scope.

**Mitigation**: Unit-level coverage is solid — `inline-publisher.test.ts` (9 tests), `streaming.test.ts` artifact orchestration (3 tests), `status-builder.test.ts` addArtifact (3 tests).

### Writeback E2E — Blocked by Incomplete TS Port

**Root cause**: TS workspace provisioner always sets `gitCredentialsConfigured: false` in `provisionGit()`. The Python runner had credential-store setup wired; the TS port is incomplete.

**Secondary requirement**: End-to-end writeback needs GitHub remote + push credentials + PR API (or mocks).

**Fix required**: Port the Python credential configuration path into `workspace/sources/git.ts`.

**Mitigation**: Unit-level coverage is comprehensive — `writeback-coordinator.test.ts` (20 tests) covers eligibility, full cycle, multi-entry, errors, and phase tracking.

## Files Changed

### New Files
- `backend/services/runner/scripts/check-langchain-deps.sh`
- `backend/services/runner/src/activities/execute-deep-agent/event-recorder.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/event-recorder.test.ts`
- `test/integration-offline/plain_chat_offline_test.go`
- `test/integration-offline/subagent_offline_test.go`

### Modified Files
- `backend/services/runner/package.json` — added `check-deps` script
- `Makefile` — added `check-deps` target, wired into `check`
- `backend/services/runner/src/activities/execute-deep-agent/streaming.ts` — 4 lines (import + recorder integration)
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/status-builder.test.ts` — golden sequences
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/streaming.test.ts` — artifact/writeback tests
- `test/integration/harness/mock_llm_proxy.go` — thinking block builder + SSE support
- `test/integration-offline/structured_output_offline_test.go` — v2 baseline test

## Golden Run Corpus

To collect golden v2 event recordings, run:

```bash
V2_EVENT_RECORD_DIR=_projects/2026-05/20260525.01.v3-streaming-migration/golden-runs \
  make test-integration-offline
```

This requires the full offline harness (Java service JAR, Temporal, MongoDB, etc.).

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `status-builder.test.ts` | 86 | All pass |
| `streaming.test.ts` | 18 | All pass |
| `event-recorder.test.ts` | 9 | All pass |
| Offline Go integration | Compiles clean (`go vet -tags integration`) | Not runnable without harness infra |
