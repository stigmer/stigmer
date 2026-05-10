# Session Memory Extraction Layer

**Date**: May 9, 2026

## Summary

Built the Stigmer-owned durable memory extraction layer in cursor-runner. New `session-memory.ts` module extracts structured memory from completed execution turns and persists it to session status, enabling conversation continuity across Cursor agent evictions, process restarts, and SDK "agent not found" failures.

## Problem Statement

When a Cursor agent is evicted (due to inactivity, process restart, or SDK state loss), all conversation context is lost. The next agent starts fresh with no knowledge of what was accomplished, what files were changed, what failed, or what decisions were made. This makes multi-turn conversations fragile and forces users to manually re-explain context.

### Pain Points

- Agent eviction loses all conversation history
- Failed attempts are repeated because the next agent doesn't know what was tried
- Architecture decisions made in earlier turns are forgotten
- Changed files and tool observations are not carried forward
- No structured way to build a continuation prompt for fresh agents

## Solution

A structured extraction layer that runs after each completed execution turn, parsing the finalized `AgentMessage` array (produced by `MessageAccumulator`) into a `SessionMemory` proto. This memory is persisted to the session status via read-modify-write and used by the continuation prompt builder (Task 2b) to give fresh agents full context.

## Implementation Details

### New Module: `session-memory.ts` (475 lines)

Eight extraction functions, each independently testable:

- **`extractChangedFiles`** — Scans completed Write/Edit/StrReplace/Delete/EditNotebook tool calls, parses `argsPreview` for paths, deduplicates and sorts
- **`extractToolObservations`** — Captures completed/failed Shell commands with command, cwd, exit code, and summary. FIFO-pruned to 10 entries within 1k token budget
- **`extractRecentTurns`** — Merges previous turns with current user+assistant turn. FIFO to 6, per-turn truncation at 1k tokens, total at 4k tokens
- **`extractDecisions`** — Captures `Decision:` / `Design choice:` line-start markers from AI messages. Deduplicates, caps at 20
- **`extractFailedAttempts`** — Captures `TOOL_CALL_FAILED` entries as `"ToolName: error"`. Deduplicates, caps at 20
- **`extractOpenTasks`** — Filters TodoTracker for PENDING/IN_PROGRESS items
- **`buildDurableSummary`** — Uses last AI message content, truncated to 2k tokens
- **`buildSessionMemory`** — Orchestrator calling all extractors, merges with previous memory

Token budgets enforced via character-based approximation (~4 chars/token), avoiding a 3MB+ tokenizer dependency.

### Wiring: `execute-cursor.ts` (+49 lines)

- `maybePeristSessionMemory` helper with guards for undefined inputs and WAITING_FOR_APPROVAL
- Memory persisted in 3 terminal paths: normal completion (Phase 14), platform stop (Phase 11b), unexpected error (catch block)
- NOT persisted on WAITING_FOR_APPROVAL (that's a pause, not a completion)
- Variables hoisted above try block for catch-block accessibility

### Tests: `session-memory.test.ts` (60 tests, 851 lines)

Comprehensive coverage: each extraction function, token budget enforcement, orchestrator, and persistence with mocked StigmerClient. All 280 cursor-runner tests pass.

## Benefits

- **Conversation durability**: Agent eviction no longer means context loss
- **Mistake avoidance**: `failed_attempts` field prevents repeating failed approaches
- **Decision preservation**: Explicit decision markers survive across agent lifetimes
- **Structured, not LLM**: No additional LLM calls, no latency or cost overhead
- **Token-budgeted**: Memory fits within prompt context limits via enforced budgets

## Impact

- **cursor-runner**: 3 files changed (1 new module, 1 new test file, 1 modified activity)
- **Unblocks**: Task 2b (continuation prompt builder) and Task 3 (graceful resume-or-create)
- **Foundation**: This is the data layer that all continuation/durability features build upon

## Related Work

- Task 1: Stabilize Local Agent Store Lookup (prerequisite, completed)
- Task 5: Proto/Data Model Updates — SessionMemory, ToolObservation, ConversationTurn protos (prerequisite, completed)
- Task 2b: Continuation Prompt Builder — will consume the SessionMemory produced here (next)
- Task 6: Session Memory Persistence — Java-side merge logic (parallelizable)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
