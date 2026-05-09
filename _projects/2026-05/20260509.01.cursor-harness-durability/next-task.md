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
**Current Task**: T01 COMPLETED — pick Task 5 next (proto/data model updates in stigmer-cloud)
**Status**: Task 1 complete. Ready for Task 5 (parallelizable with remaining cursor-runner tasks).
**Tasks**: 8 tasks total (T1 ✅, T2a, T2b, T3, T4, T5, T6, T7)

## Session Progress (2026-05-09)

### Completed: Task 1 — Stabilize Local Agent Store Lookup
- Implemented `resolvePlatformOptions(sessionId)` helper in `session-lifecycle.ts`
- Added `sessionId` to `CreateAgentOptions` and `ResumeAgentOptions`
- Wired `platform: { workspaceRef, stateRoot }` into both `Agent.create()` and `Agent.resume()`
- Added diagnostic logging (workspaceRef, stateRoot, process.cwd) on every create/resume
- Updated `execute-cursor.ts` to pass `sessionId` through to `resolveAgent()`
- Created 18 unit tests covering platform propagation
- Updated integration test for new interface
- TypeScript typecheck: clean. Full test suite: 220 passed, 0 failures.
- Committed: `feat(cursor-runner): stabilize local agent store lookup with explicit platform options`

### Key Design Decisions
- **DD: stateRoot in home directory, not workspace** — `~/.stigmer/cursor-sdk-state/{sessionId}` avoids git pollution
- **DD: Synthetic workspaceRef, not a filesystem path** — `stigmer-session:{sessionId}` decouples from workspace path changes

## Next Steps

1. **Task 5: Proto/Data Model Updates (stigmer-cloud)** — Add `SessionMemory`, `CursorMode`, HITL diagnostic fields to protos. This unblocks Tasks 2a, 6, and 7.
2. **Task 6: Session Memory Persistence (stigmer-service)** — Depends on Task 5
3. **Task 7: Workflow Integration (stigmer-service)** — Depends on Tasks 5+6
4. **Task 2a: Session Memory Extraction (cursor-runner)** — Depends on Task 5 TS stubs
5. **Task 2b: Continuation Prompt Builder (cursor-runner)** — Depends on Task 2a
6. **Task 3: Graceful Resume-or-Create (cursor-runner)** — Depends on Tasks 1+2a+2b
7. **Task 4: Cloud Agent Path (cursor-runner)** — Depends on Task 3+5, feature-flagged

## Quick Commands

After loading context:
- "Continue with Task 5" - Start proto/data model updates
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
