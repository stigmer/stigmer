# v3 Streaming Migration — Phase 0 Contract Freeze

**Date**: May 26, 2026

## Summary

Established the v2 regression baseline for the v3 streaming migration. This includes dependency safety assertions, 8 golden sequence tests for the StatusBuilder (the primary regression contract for V3StatusBuilder), a V2 event recorder for capturing raw streaming events, and 4 new offline integration tests covering plain chat, thinking blocks, structured output baseline, and subagent delegation. Two planned items (artifact publish E2E, writeback E2E) were deferred after discovering production-level blockers.

## Problem Statement

The v3 streaming migration (replacing LangGraph `streamEvents` v2 with v3) will rewrite the core streaming pipeline. Without a comprehensive regression baseline, behavioral regressions during the migration would be invisible until production.

### Pain Points

- No golden sequence tests existed to verify StatusBuilder produces correct `AgentExecutionStatus` for realistic multi-event conversations
- No mechanism to capture raw v2 `StreamEvent` data for reference when building the v3 protocol normalizer
- No dependency safety check for duplicate `@langchain/core` versions (which cause class identity failures)
- Missing offline test coverage for plain chat, thinking blocks, and subagent delegation scenarios
- No SSE support for Anthropic thinking blocks in the mock LLM proxy

## Solution

Built the regression baseline in three layers: unit-level golden sequences for StatusBuilder and streaming orchestration, a V2 event recorder for development reference, and offline integration tests for end-to-end validation with mock LLM.

## Implementation Details

### Dependency Safety

- `scripts/check-langchain-deps.sh` — runs `npm ls` and asserts single `@langchain/core` resolution via JSON tree walking
- Wired into `make check` via new `check-deps` target
- Confirmed: `@langchain/core@1.1.47` is the sole resolved version across `deepagents@1.10.2`, `@langchain/langgraph@1.3.2`, `langchain@1.4.1`

### StatusBuilder Golden Sequences (8 tests)

Realistic multi-event conversation sequences asserting on complete proto output:
- Plain chat (2-turn text-only), Anthropic thinking + text, single tool call (ReAct), tool error, multi-tool concurrent, HITL approval gate, 3-turn usage accumulation with cache tokens, namespace isolation (parent + subagent)

### Streaming Orchestration Tests (7 tests)

Coverage for previously untested InlinePublisher and WriteBackCoordinator integration paths:
- File path extraction from `path`, `file_path`, `filename`, `file` input fields
- Both publisher and coordinator triggered on same `on_tool_end`
- Graceful STOP preserving pending artifact promises

### V2 Event Recorder

- `event-recorder.ts` — env-var-gated (`V2_EVENT_RECORD_DIR`) module that records raw `StreamEvent` data
- Atomic flush on stream completion (not per-event I/O)
- 3-line integration in `streaming.ts`: create, record in loop, flush after loop

### Offline Integration Tests

- `plain_chat_offline_test.go` — single-turn text, thinking + text blocks
- `structured_output_offline_test.go` — v2 text-based extraction baseline (documents current behavior for Phase 3 comparison)
- `subagent_offline_test.go` — 3-entry mock: parent `task` tool → subagent text → parent synthesis

### Mock LLM Proxy

- `AnthropicThinkingTextResponse()` builder for responses with both thinking and text content blocks
- Added `thinking` block type to `writeAnthropicSSE()` (was silently dropped before)

## Discovered Blockers (Deferred Items)

### Artifact Publish E2E

Agent `write_file` calls go to deepagents' `StateBackend` (in-memory), but `InlinePublisher` reads from `LocalWorkspaceBackend` (disk). Files never reach disk. Needs `StateBackend` → `FilesystemBackend` production fix.

### Writeback E2E

TS provisioner always sets `gitCredentialsConfigured: false`, structurally disabling writeback. The Python runner had this wired; TS port is incomplete. Needs credential-store setup ported from Python.

Both are documented in `_projects/2026-05/20260525.01.v3-streaming-migration/wrong-assumptions/`.

## Benefits

- **113 new test assertions** across StatusBuilder (8), streaming (7), event recorder (9), and offline integration (4 test functions)
- **Lockfile safety** prevents silent `@langchain/core` duplication (class identity failures)
- **V2 event capture** ready for Phase 2 normalizer development
- **Thinking block SSE** unblocks any future Anthropic extended thinking tests

## Impact

- Runner unit test suite: 86 StatusBuilder tests (was 50), 18 streaming tests (was 11), 9 new event recorder tests
- Offline integration suite: 4 new test functions (plain chat, thinking, structured output baseline, subagent delegation)
- CI: `make check` now includes `check-deps` for dependency hygiene
- v3 migration: Phase 1 (v3 Event Recorder) is unblocked

## Related Work

- Project: `_projects/2026-05/20260525.01.v3-streaming-migration/`
- Checkpoint: `checkpoints/CP01_phase0_contract_freeze.md`
- Design decisions: `design-decisions/DD01_v3-migration-architecture.md`
- Deep research report: `research.v3-streaming-api-migration/04.report.gpt.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
