# Graceful Resume-or-Create Flow for Cursor Agent Durability

**Date**: May 9, 2026

## Summary

Transformed the cursor-runner's agent resolution from a hard-fail-on-resume pattern into a graceful fallback that creates a fresh agent with a continuation prompt when resume fails. This is the integration layer that makes Cursor harness conversations durable across agent evictions — wiring the session memory extraction (Task 2a) and continuation prompt builder (Task 2b) into the live execution path.

## Problem Statement

When a Cursor local SDK agent expires or gets evicted (common in Daytona sandboxes and after long HITL waits), `Agent.resume()` fails. Previously, this propagated as an unrecoverable error — the user saw "Please start a new session to continue" and lost their entire conversation context.

### Pain Points

- Agent evictions are common and expected in sandboxed environments
- HITL approval waits can take hours/days — agents expire during this time
- Users lost all conversation context on eviction, forcing session restarts
- The continuation prompt system (Task 2b) existed but was never wired into the execution path
- Session memory was being persisted (Task 2a) but never consumed for prompt injection

## Solution

Introduced a three-pronged change:

1. **`resolveAgent()` now catches resume failures gracefully** — logs a warning, creates a fresh agent, and returns a discriminated `AgentResolution` type with a `reason` field that tells the caller exactly what happened.

2. **`execute-cursor.ts` uses the resolution reason to select the appropriate prompt** — a new `buildPrompt()` function routes between `buildEnhancedPrompt` (first turn), `buildContinuationPrompt` (subsequent turns with memory), `buildHitlContinuationPrompt` (HITL reinvocation with memory), and `buildReinvocationPrompt` (legacy HITL without memory).

3. **The `AgentResolution` type is designed for extensibility** — includes `mode: "local"` ready for Task 4's `| "cloud"` union, and the `AgentResolutionReason` type is open for future discriminants.

## Implementation Details

### New Types (`session-lifecycle.ts`)

- `AgentResolution` interface: `agent`, `agentId`, `isNew`, `resumed`, `mode`, `reason`, `resumeFailureDetail?`
- `AgentResolutionReason` union: `"created_first_execution" | "resumed_successfully" | "created_after_resume_failure"`

### Prompt Selection Decision Matrix (`execute-cursor.ts`)

| Scenario | Prompt Builder |
|----------|---------------|
| First execution (no memory) | `buildEnhancedPrompt` |
| Subsequent turn + memory (resumed or fallback) | `buildContinuationPrompt` |
| HITL reinvocation + memory | `buildHitlContinuationPrompt` |
| HITL reinvocation + no memory (legacy) | `buildReinvocationPrompt` |

### Key Design Decisions

- **All resume errors are recoverable**: Network errors, auth failures, "Agent not found" — all trigger the graceful fallback. If we can't create a new agent either, that's the infrastructure error that propagates.
- **HITL + fallback intersection**: A fresh agent created after the old one died during HITL still receives `buildHitlContinuationPrompt` with the full approval context and session memory.
- **Session memory as gate**: The continuation prompt is only used when `session?.status?.sessionMemory` exists. Missing memory (edge case) gracefully falls back to `buildEnhancedPrompt`.

## Benefits

- Conversations survive agent evictions without user intervention
- HITL delayed approvals work even after agent death — fresh agent confirm/revise/refuse
- Session memory investment (Tasks 2a + 2b) is now actively consumed in production
- Diagnostic logging at fallback point aids debugging
- Extensible type system ready for cloud mode (Task 4)

## Impact

- **cursor-runner**: 3 files changed, 415 insertions, 78 deletions
- **Test coverage**: 41 new tests (28 session-lifecycle + 13 prompt-selection), 353 total passing
- **TypeScript**: Clean typecheck, no regressions
- **Backward compatible**: First execution behavior unchanged, existing HITL flow preserved

## Related Work

- **Task 2a** (Session Memory Extraction Layer): Provides the `SessionMemory` data consumed by continuation prompts
- **Task 2b** (Continuation Prompt Builder): Provides `buildContinuationPrompt` and `buildHitlContinuationPrompt`
- **Task 1** (Stabilize Local Agent Store Lookup): Provides `resolvePlatformOptions` used in both resume and create
- **Task 4** (Cloud Agent Path): Will extend `AgentResolution.mode` to `"local" | "cloud"`
- **Task 6** (Session Memory Persistence): Server-side merge logic for the memory this task consumes

---

**Status**: Production Ready
**Timeline**: Session 5, ~45 minutes implementation + testing
