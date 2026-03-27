# Next Task: 20260327.01.hitl-approval-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260327.01.hitl-approval-cleanup

**Description**: Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.
**Goal**: Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.
**Tech Stack**: Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React
**Components**: Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalMerger, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/merge), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Task Map

| Task | Title | Status | Depends on |
|------|-------|--------|------------|
| **T01** | Research: tool_call_id availability at interrupt time | **COMPLETE** | — |
| **T02** | Proto changes (remove tool_calls, simplify PendingApproval) | **COMPLETE** | — |
| **T03** | Python: single writer to messages, simplify HITL | **COMPLETE** | T01, T02 |
| **T04** | Add tool_call_id to interrupt payload | **COMPLETE** | T01 |
| T05 | Java/Go: compute pending_approvals on write, simplify SubmitApproval | Not started | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | Not started | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01 + T02 + T03 + T04 COMPLETE. Next: T05 (unblocked, Java/Go server-side).
**Status**: T03 Complete — Python agent-runner fully refactored. `messages[].tool_calls` is now the single source of truth, backed by an in-memory `_tool_call_index` for O(1) lookups. Three HITL classes deleted (`ApprovalStateManager`, `InterruptCapture`, `CheckpointFallback`). Resume path simplified from ~140 to ~40 lines. Net -2,110 lines across 7 files. 276 tests passing.

## Session Progress (2026-03-27, Session 4)

### Accomplished
- Completed T03: Python single writer to messages, HITL simplification — all 6 phases
- Phase 1: StatusBuilder refactored — `_tool_call_index` added, 6 write sites and ~10 read sites migrated, 3 pending-approval methods deleted, fingerprints scan messages
- Phase 2: hitl.py rewritten — 3 classes deleted, `ResumeReconciler` simplified to ~120 lines
- Phase 3: execute_graphton.py resume path simplified — ~40 lines replacing ~140
- Phase 4: post_stream.py — `InterruptCapture` block removed, signature simplified
- Phase 5: streaming.py — flat list counts/scans replaced with helpers
- Phase 6: Tests — `test_hitl_contracts.py` completely rewritten (10 tests), `test_status_builder.py` comprehensively updated (266 tests)
- Net: 562 insertions, 2,672 deletions = -2,110 lines

### Key Decisions
- In-memory index uses protobuf reference semantics for zero-cost propagation
- Fingerprinting retained for LangGraph replay deduplication (not deleted as master plan suggested)
- `args_preview` populated at ToolCall creation time
- `TestTryEnrichPhase1Entry` entirely deleted (InterruptCapture gone)

## Next Steps
1. **T05** (Java/Go): Compute `pending_approvals` on write path in stigmer-service/stigmer-server. Simplify `SubmitApprovalHandler` to use `tool_call_id` from interrupt payload directly. This is the server-side counterpart to T03.
2. **T06** (React SDK): Remove polling/staleness workarounds — becomes possible once T05 ensures server-computed `pending_approvals` are reliable.
3. **T07** (Tests): Python tests done in T03/T04. Java/Go tests needed after T05.

## Context for Resume
- All Python changes are on the `hitl-flow-simplification` branch
- The in-memory `_tool_call_index` pattern is documented in checkpoint session-4 and the changelog
- `pending_approvals` is still on the proto — it's now intended as a server-side computed projection, not managed by Python
- The `_run_id_aliases` and fingerprinting mechanisms were retained for event deduplication on resume (this was a key discovery — the master plan suggested removing them)

## Quick Commands

After loading context:
- "Pick next task" — T05 is the recommended next
- "Show project status" — Get overview of progress
- "Review design decisions" — Check DD-001 and DD-002

---

*This file provides direct paths to all project resources for quick context loading.*
