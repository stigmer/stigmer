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
**Current Task**: Task 5 COMPLETED — pick Task 6 or Task 2a next
**Status**: Tasks 1 and 5 complete. Proto foundation landed. Ready for service-side persistence (Task 6) or runner-side memory extraction (Task 2a).
**Tasks**: 8 tasks total (T1 ✅, T2a, T2b, T3, T4, T5 ✅, T6, T7)

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
2. **Task 2a: Session Memory Extraction (cursor-runner, TS)** — Build `buildSessionMemory()` and `persistSessionMemory()` using the new TS stubs from Task 5.

**Then sequential:**
3. **Task 7: Workflow Integration (Java)** — Depends on Task 6. Pass memory + mode to `ExecuteCursor` activity.
4. **Task 2b: Continuation Prompt Builder (TS)** — Depends on Task 2a.
5. **Task 3: Graceful Resume-or-Create (TS)** — Depends on Tasks 1 + 2a + 2b.
6. **Task 4: Cloud Agent Path (TS)** — Depends on Task 3 + 5, feature-flagged.

## Context for Resume
- stigmer-cloud has regenerated stubs but **no Java service code changes yet** — that's Task 6
- The `PendingApprovalComputer` in Java server-side **recomputes** pending approvals from tool calls on every status write. The HITL diagnostic fields (agent_rationale, branch/sha at deny) will need to survive this recomputation — addressed in Task 6/7 implementation.
- Existing `ExecuteCursorActivity` Java interface has 3 params (executionId, threadId, invokerIdentityAccountId) but TS runner only declares 2. Task 7 will extend both.

## Quick Commands

After loading context:
- "Continue with Task 6" - Start session memory persistence in Java
- "Continue with Task 2a" - Start session memory extraction in TS
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
