# Next Task: 20260509.01.cursor-harness-durability

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260509.01.cursor-harness-durability

**Description**: Build a durable conversation layer for the Cursor harness: replay/continuation for local agents, cloud agent path for git-backed workspaces, and Stigmer-owned session memory that survives agent eviction.
**Goal**: Make Cursor-harness multi-turn conversations durable across hours/days, regardless of whether the underlying Cursor local agent is still resumable. Add a cloud-agent code path for git-backed sessions with native Cursor durability.
**Tech Stack**: TypeScript (cursor-runner), Java (stigmer-service/workflows), Protobuf (session/execution protos), MongoDB
**Components**: cursor-runner (TypeScript), stigmer-service workflow/dispatch (Java), session proto (workspace/spec), agent-sandbox Docker image

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.01.cursor-harness-durability/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-09 18:15
**Current Task**: Task 3 COMPLETED — pick Task 6 or Task 4 next
**Status**: Tasks 1, 5, 2a, 2b, and 3 complete. Full client-side durability story landed: local agent store → session memory extraction → continuation prompt builder → graceful resume-or-create. Ready for server-side persistence (Task 6) or cloud agent path (Task 4).
**Tasks**: 8 tasks total (T1 ✅, T2a ✅, T2b ✅, T3 ✅, T4, T5 ✅, T6, T7)

## Session Progress (2026-05-09, Session 5)

### Completed: Task 3 — Graceful Resume-or-Create Flow
- **Rewritten `session-lifecycle.ts`** — `resolveAgent()` returns `AgentResolution` type; catches resume failures and gracefully falls back to fresh agent creation
  - New `AgentResolution` interface: `agent`, `agentId`, `isNew`, `resumed`, `mode`, `reason`, `resumeFailureDetail?`
  - New `AgentResolutionReason` union: `"created_first_execution" | "resumed_successfully" | "created_after_resume_failure"`
  - Diagnostic logging on fallback: old agent ID, new agent ID, session ID, cwd, error message
- **Modified `execute-cursor.ts`** — Phase 7/9/10 updated for new resolution type:
  - Phase 7: Destructures `AgentResolution`, logs diagnostic context (mode, reason, resumed, agentId)
  - Phase 9: Uses `resolution.isNew` / `resolution.agentId` for thread_id persistence
  - Phase 10: New `buildPrompt()` helper selects between `buildEnhancedPrompt`, `buildContinuationPrompt`, `buildHitlContinuationPrompt`, `buildReinvocationPrompt`
- **Rewritten `session-lifecycle.test.ts`** — 28 tests covering all resolution paths, graceful fallback scenarios, and diagnostic logging verification
- **New `prompt-selection.test.ts`** — 13 tests covering all prompt routing scenarios with mocked prompt builders
- All 353 cursor-runner tests pass
- 3 files changed, 415 insertions, 78 deletions

### Key Design Decisions (Task 3)
- **DD: All resume errors are recoverable** — Network errors, auth failures, "Agent not found" all trigger graceful fallback. Only `createAgent` failures propagate as infrastructure errors.
- **DD: Mode field starts as `"local"` only** — Ready for `| "cloud"` in Task 4. No dead code paths.
- **DD: Continuation prompt on ALL subsequent turns with memory** — Even successful resumes benefit from memory context (agent may have been evicted from in-memory cache but still resumable from disk).
- **DD: HITL takes precedence over continuation in prompt selection** — HITL reinvocation after agent death still routes to `buildHitlContinuationPrompt`, not generic continuation.

## Session Progress (2026-05-09, Session 4)

### Completed: Task 2b — Continuation Prompt Builder
- **New `continuation-prompt.ts`** (538 lines) — Two prompt builders + deny-time utilities:
  - `buildContinuationPrompt` — complete prompt for fresh/unreliable agents: continuation contract + agent identity (instructions, skills, workspace) + session memory (summary, decisions, failures, files, turns, observations) + user message
  - `buildHitlContinuationPrompt` — HITL reinvocation prompt: approval details with tool/args/rationale/decision + deny-time git diagnostics + agent identity + memory subset + confirm/revise/refuse protocol
  - `extractAgentRationale` — heuristic extraction of last AI message content (500 char cap)
  - `getGitBranch` / `getGitHeadSha` — best-effort git state capture, never throws
  - Progressive token budget enforcement: 8k ceiling, truncation priority (turns → observations → summary)
- **Modified `prompt-builder.ts`** — Exported 7 internal formatting helpers for reuse without duplication
- **Modified `execute-cursor.ts`** (Phase 12) — Added HITL diagnostic capture at tool-deny time: `agentRationale`, `branchAtDeny`, `headShaAtDeny` on every PendingApproval
- **New `continuation-prompt.test.ts`** (564 lines, 50 tests) — Comprehensive coverage for both prompt builders, token budget enforcement, rationale extraction, and git utilities
- All 330 cursor-runner tests pass (50 new + 280 existing)
- Committed: `9263587ca` — `feat(cursor-runner): add continuation prompt builder for durable agent context`

### Key Design Decisions (Task 2b)
- **DD: New file, not extension of prompt-builder.ts** — `prompt-builder.ts` handles "what the agent IS" (blueprint identity). `continuation-prompt.ts` handles "what the agent HAS DONE" (durable memory). Orthogonal concerns with shared helpers.
- **DD: Task 2b delivers pure functions only; Task 3 wires the prompt selection** — The mode/resumed/isCloudAgentExpired signals come from Task 3's changes to resolveAgent(). Task 2b stays independently testable.
- **DD: Agent rationale = last AI message, truncated to 500 chars** — Heuristic extraction, no LLM. The last AI message typically contains the agent's explanation of its intent. Good enough for v1.
- **DD: Continuation prompt is a COMPLETE prompt** — Fresh agents know nothing. Includes full agent identity sections (reuses exported helpers) + memory + user message. Not a supplement to buildEnhancedPrompt.
- **DD: HITL subset excludes changed_files/open_tasks/tool_observations** — HITL reinvocation only needs the approval context + enough memory to orient. Full memory would bloat the prompt for a narrowly-scoped task (confirm/revise/refuse one tool call).

## Session Progress (2026-05-09, Session 3)

### Completed: Task 2a — Session Memory Extraction Layer
- **New `session-memory.ts`** (475 lines) — Extraction module with 8 exported functions and 2 token budget utilities:
  - `extractChangedFiles` — scans completed Write/Edit/StrReplace/Delete/EditNotebook tool calls, deduplicates and sorts
  - `extractToolObservations` — captures completed/failed Shell commands with FIFO pruning to 10, 1k token budget
  - `extractRecentTurns` — merges previous turns with current, FIFO to 6, per-turn 1k and total 4k token budgets
  - `extractDecisions` — captures `Decision:` / `Design choice:` markers, deduplicates, caps at 20
  - `extractFailedAttempts` — captures `TOOL_CALL_FAILED` entries, deduplicates, caps at 20
  - `extractOpenTasks` — filters TodoTracker for PENDING/IN_PROGRESS items
  - `buildDurableSummary` — uses last AI message, truncated to 2k tokens
  - `buildSessionMemory` — orchestrator calling all extractors, merges with previous memory
  - `persistSessionMemory` — read-modify-write via getSession + updateSession, best-effort
  - `estimateTokens` / `truncateToTokenBudget` — character-based approximation (~4 chars/token)
- **Modified `execute-cursor.ts`** (+49 lines) — Added Phase 14 session memory wiring:
  - Hoisted `sessionId`, `session`, `userMessage` above try block for catch-block accessibility
  - Added `maybePeristSessionMemory` helper with guards for undefined inputs and WAITING_FOR_APPROVAL
  - Memory persisted in 3 paths: normal completion, platform stop, unexpected error catch block
  - NOT persisted on WAITING_FOR_APPROVAL (that's a pause, not a completion)
- **New `session-memory.test.ts`** (851 lines, 60 tests) — Comprehensive unit tests for all extraction functions, token budgets, orchestrator, and persistence (mocked client). All 280 tests pass (60 new + 220 existing).

### Key Design Decisions (Task 2a)
- **DD: Extract from finalized messages, not raw stream events** — MessageAccumulator already merges token-level events into coherent messages. Extracting from `status.messages` after `finalize()` gives clean, complete data.
- **DD: Single extraction point, not inline** — Memory built once after execution completes, not incrementally during streaming. Keeps hot streaming loop unchanged.
- **DD: Character-based token approximation** — ~4 chars/token avoids a tokenizer dependency (tiktoken is 3MB+). Sufficient for v1 structured extraction.
- **DD: Explicit decision markers only** — Only `Decision:` / `Design choice:` line-start patterns. No broad NLP heuristics. Forward-compatible with Task 2b prompt engineering.
- **DD: Memory persisted even on failure** — Failed executions produce valuable `failed_attempts` data. Next agent benefits from knowing what broke.

## Session Progress (2026-05-09, Session 2)

### Completed: Task 5 — Proto / Data Model Updates
- **New `SessionStatus` message** — replaces `ApiResourceAuditStatus` on `Session.status`. Carries `session_memory` (field 1) + `audit` (field 99). Wire-format backward-compatible with existing MongoDB data.
- **New `memory.proto`** — `SessionMemory`, `ToolObservation`, `ConversationTurn` messages with structured extraction fields and documented token budgets (2k summary, 4k turns, 1k observations, 8k ceiling).
- **New `CursorMode` enum** — `UNSPECIFIED`, `LOCAL`, `CLOUD` in `session/v1/enum.proto`. Added `cursor_mode` field 11 to `SessionSpec`. Immutable per session, feature-flagged for cloud.
- **HITL diagnostic fields** — `agent_rationale` (10), `branch_at_deny` (11), `head_sha_at_deny` (12) added to `PendingApproval` in `approval.proto`.
- **Stubs regenerated** — Go, Java, Python, TypeScript, Dart in both stigmer OSS and stigmer-cloud repos.
- **Downstream fix** — Updated `sdk/react` test to use `SessionStatusSchema` instead of `ApiResourceAuditStatusSchema`.
- Committed: `c677fa978` — `feat(apis): add SessionStatus, SessionMemory, CursorMode, and HITL diagnostic fields`

### Completed: Task 1 — Stabilize Local Agent Store Lookup (Session 1)
- Implemented `resolvePlatformOptions(sessionId)` helper in `session-lifecycle.ts`
- Wired `platform: { workspaceRef, stateRoot }` into both `Agent.create()` and `Agent.resume()`
- 18 unit tests, full suite passing
- Committed: `feat(cursor-runner): stabilize local agent store lookup with explicit platform options`

### Key Architectural Discoveries (Task 5)
- **Session had no SessionStatus** — `Session.status` was `ApiResourceAuditStatus` (audit-only wrapper). Introduced proper `SessionStatus` following the `AgentExecutionStatus` pattern. Wire-compatible at field 99.
- **Proto source is in stigmer OSS, not stigmer-cloud** — stigmer-cloud generates stubs from the OSS proto via `buf generate` with a sibling directory input. The plan originally said "stigmer-cloud" for proto edits.
- **Timestamp convention is ISO 8601 strings** — not `google.protobuf.Timestamp` for operational timestamps. Followed existing convention for `ConversationTurn.timestamp`.

### Key Design Decisions
- **DD: SessionStatus replaces ApiResourceAuditStatus** — Session now has domain-specific runtime status. `audit` at field 99 ensures wire compatibility.
- **DD: Structured extraction, not LLM summarization** — `SessionMemory` fields are populated by cursor-runner parsing stream events. No LLM call for memory in v1.
- **DD: CursorMode is immutable per session** — Set once at creation based on workspace entries. Prevents context loss from mid-session mode switching.

## Next Steps

**Now unblocked (parallelizable):**
1. **Task 6: Session Memory Persistence (stigmer-service, Java)** — Extend `readSessionThreadId` to also return `session_memory` and `cursor_mode`. Add merge logic in `UpdateExecutionStatusActivity`.
2. **Task 4: Cloud Agent Path (cursor-runner, TS)** — Depends on Task 3 ✅ + 5 ✅. Add `"cloud"` to `AgentResolution.mode`, feature-flagged cloud agent creation.

**Then sequential:**
3. **Task 7: Workflow Integration (Java)** — Depends on Task 6. Pass memory + mode to `ExecuteCursor` activity.

## Context for Resume
- stigmer-cloud has regenerated stubs but **no Java service code changes yet** — that's Task 6
- The `PendingApprovalComputer` in Java server-side **recomputes** pending approvals from tool calls on every status write. The HITL diagnostic fields (agent_rationale, branch/sha at deny) will need to survive this recomputation — addressed in Task 6/7 implementation.
- Existing `ExecuteCursorActivity` Java interface has 3 params (executionId, threadId, invokerIdentityAccountId) but TS runner only declares 2. Task 7 will extend both.
- **Full client-side durability story is done** — session memory extraction (2a) → prompt builder (2b) → graceful fallback (3). The wire-up is complete: resolveAgent() catches failures, creates fresh agent, execute-cursor.ts selects the right prompt.
- **`buildPrompt()` exported from execute-cursor.ts** — enables isolated testing. Decision matrix: HITL+memory → hitlContinuation; HITL → reinvocation; subsequent+memory → continuation; first → enhanced.
- **Token budgets are enforced with char approximation** (~4 chars/token). If v2 adds LLM summarization, proper tokenization should be added then.
- **`AgentResolution.mode` is "local" only** — Task 4 extends to `| "cloud"`. No dead code paths committed.

## Quick Commands

After loading context:
- "Continue with Task 6" - Start session memory persistence in Java
- "Continue with Task 4" - Start cloud agent path in TS
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
