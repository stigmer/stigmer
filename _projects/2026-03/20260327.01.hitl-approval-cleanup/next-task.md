# Next Task: 20260327.01.hitl-approval-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260327.01.hitl-approval-cleanup

**Description**: Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.
**Goal**: Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.
**Tech Stack**: Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React
**Components**: Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalComputer, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/compute), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

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
| **T05** | Java/Go: compute pending_approvals on write, simplify SubmitApproval | **COMPLETE** | T02, T03 |
| **T06** | React SDK: remove polling/staleness workarounds | **COMPLETE** | T05 |
| **T07** | Tests: rewrite for new architecture | **COMPLETE** | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01–T07 ALL COMPLETE. Ready to create PRs.
**Status**: T07 Complete — Comprehensive HITL test rewrite across Go, Java, and Python. `make check` passes on both stigmer and stigmer-cloud repos (1304 Python tests, 9 Go contract tests, 6 Java tests including new PendingApprovalComputerTest, all lint and compilation clean).

## Session Progress (2026-03-27, Session 7)

### Accomplished
- Completed T07: Comprehensive HITL Test Rewrite across all layers
- **Go**: Rewrote `submit_approval_contract_test.go` — replaced 4 tests referencing deleted types (`ApprovalLifecycleState`, `InterruptId`, merge-based PAs) with 9 tests for current architecture (`findToolCallInExecution` traversal, approval decision recording on messages, `ComputePendingApprovals` recomputation, timestamp validation, sub-agent approval isolation)
- **Java**: Created `PendingApprovalComputerTest.java` — 15 tests across 5 nested O classes mirroring Go `compute_test.go` coverage (empty inputs, inclusion/exclusion criteria, sub-agent attribution, mixed scenarios, field projection). Added Bazel target to `BUILD.bazel`.
- **Python lint**: Fixed unsorted imports in `execute_graphton.py`, `status_builder.py`, `test_approval_resume.py`, `test_hitl_contracts.py`. Removed unused `AgentMessage` import. Fixed uppercase variable `_POST_APPROVAL_STATUSES` -> `post_approval_statuses`.
- **Python mypy**: Fixed `SubAgentExecution.tool_calls` attribute error (field removed, now iterate `messages[].tool_calls`). Fixed `Struct` return type mismatch with `str()` cast.
- **Python tests**: Deleted obsolete `test_approval_resume.py` (tested removed `ApprovalStateManager` and `InterruptCapture` classes). Fixed `test_inline_publish.py` mock to wire `sb.get_tool_call()` lookup.
- Net: 286 insertions, 339 deletions across 31 files (stigmer), 7 insertions + 1 new file (stigmer-cloud)

### Key Findings
- Phase 1 `make check` initially failed only on the Go vet error (`InterruptId` field), but as each layer was fixed, subsequent lint/mypy/test failures from T01-T06 surfaced progressively — import sorting, unused imports, deleted class references, missing mock wiring
- The `test_approval_resume.py` file tested `ApprovalStateManager` and `InterruptCapture` classes that were both removed in T03 — entire file was correctly deleted
- `test_inline_publish.py` had a pre-existing mock gap: `sb.get_tool_call()` was never wired to return the prepared tool call fixtures (it returned MagicMock auto-stubs instead)

## Next Steps
1. **Create PRs** for both repos on `hitl-flow-simplification` branch
2. All T01-T07 tasks are complete — `make check` green on both repos

## Context for Resume
- All changes are on the `hitl-flow-simplification` branch in both repos
- Both repos pass `make check` clean (exit code 0)
- stigmer: 1304 Python tests pass, all Go tests pass, all lint/mypy clean
- stigmer-cloud: 6/6 Java tests pass (including new `pending_approval_computer_test`), build clean

## Quick Commands

After loading context:
- "Create PRs" — Ready for review on hitl-flow-simplification branch
- "Show project status" — Get overview of progress
- "Review design decisions" — Check DD-001 and DD-002

---

*This file provides direct paths to all project resources for quick context loading.*
