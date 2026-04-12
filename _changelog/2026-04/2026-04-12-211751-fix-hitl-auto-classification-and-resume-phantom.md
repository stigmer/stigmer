# Fix HITL Auto-Classification Persistence and Resume Phantom Tool Call

**Date**: April 12, 2026

## Summary

Two independent production bugs in the HITL approval flow were diagnosed using MongoDB data and LangGraph checkpoint analysis, and fixed with targeted changes across two repos. Bug 1: the LLM tool classifier correctly identified read-only tools as safe, but the persistence layer stored all 31 tools as approval-required (ignoring the `requires_approval: false` boolean). Bug 2: during approval resume, LangGraph's dual `on_tool_start` event emission created a phantom tool call that caused the graph to restart from scratch with the original user message, producing an infinite approve-execute-approve loop.

## Problem Statement

Users experienced two related symptoms when using MCP-connected agents with HITL approval policies:

1. **Every tool marked as "approval required"**: The MCP server detail page showed all tools under "Auto-classified" with approval shields -- including read-only operations like `list_issues`, `get_issue`, `list_comments`.

2. **Infinite approval loop**: After approving a tool call, the agent would call the same tool again with identical arguments, requiring another approval. The model's own thinking block said "The user is asking the same question again" -- it was receiving the original user message twice.

### Pain Points

- Read-only tools like `list_issues` required approval on every invocation
- Users had to approve the same operation 3-4+ times in rapid succession
- The execution never completed -- each approval cycle spawned another
- Checkpoint message count diverged across cycles (diff=2 -> 2 -> 3)
- `[RESUME_UNMATCHED]` errors polluted agent runner logs

## Solution

### Bug 1: Missing filter at the persistence boundary

The Python LLM classifier (`ClassifyToolApprovals` activity) returns every tool with a `requires_approval` boolean. The Java `StoreConnectResults.convertToToolApprovals()` and the Python activity return path both ignored this boolean, storing all tools as `ToolApprovalPolicy` entries. Since the proto model encodes "requires approval" by presence in the list (no boolean field), every tool ended up requiring approval.

**Fix**: Filter at two layers (defense in depth):
- Python activity: return only tools where `requires_approval is True`
- Java handler: skip entries where `requires_approval` is explicitly `false`

### Bug 2: Phantom tool call from duplicate `on_tool_start` during resume

During `Command(resume=...)`, LangGraph emits two `on_tool_start` v2 stream events with different `run_id`s for the same tool execution. The `ToolCallIdCapture` callback maps the first `run_id` to the model's `tool_call_id`, enabling identity-based dedup. The second `run_id` has no mapping, so the dedup fails and a phantom tool call is created with status `WAITING_APPROVAL`.

This phantom sets the execution phase to `EXECUTION_WAITING_FOR_APPROVAL`. The Java Temporal workflow sees `pendingCount=0` but `phase=WAITING_FOR_APPROVAL`, hits the fast re-invoke path, and the next Python activity finds no interrupts in the checkpoint (the real tool completed normally), falling back to the original user message. The graph restarts via `__start__`, and the model receives the user message again.

**Fix**: Resume-aware identity dedup guard in `handle_tool_start`. When a `run_id` has no `ToolCallIdCapture` mapping, the guard checks for an existing tool call with the same name that was recently reconciled from `WAITING_APPROVAL` to `RUNNING` (has `approval_action` set). If found, the `run_id` is aliased to the existing tool call instead of creating a phantom.

## Implementation Details

### Files Changed

**stigmer repo** (3 files, +171/-1 lines):
- `backend/services/agent-runner/worker/activities/classify_tool_approvals.py` -- Filter `requires_approval: false` entries before returning from the Temporal activity
- `backend/services/agent-runner/worker/activities/graphton/handlers/tool_event.py` -- Add resume-aware phantom guard after the existing `ToolCallIdCapture` dedup check, using `ApprovalAction` and `ToolCallStatus` to precisely identify resume-path phantoms
- `backend/services/agent-runner/tests/test_status_builder.py` -- `TestResumePhantomGuard` class with 3 tests: phantom dedup during resume, no false positive on normal calls, guard skips completed tool calls

**stigmer-cloud repo** (1 file, +18/-1 lines):
- `McpServerConnectHandler.java` -- Defensive filter in `convertToToolApprovals()` checking the `requires_approval` boolean

### Regression Origin

Bug 2 was introduced in commit `8134ee2e1` (T04, March 29, 2026) which replaced the SHA256 fingerprint-based dedup with identity-based lookup via `ToolCallIdCapture`. The old fingerprint dedup was content-based (hashed `tool_name + tool_args`) and caught the phantom because it matched regardless of `run_id`. The new identity-based dedup is more precise but only works when the `ToolCallIdCapture` callback provides a mapping -- the second `on_tool_start` event during resume has no such mapping.

## Benefits

- Read-only tools (21 of 31 for `mcp-server-linear`) no longer require approval
- Approval-required tools complete in a single approve-execute cycle without looping
- Checkpoint message count no longer diverges across approval cycles
- `[RESUME_UNMATCHED]` errors eliminated for normal approval flows

## Impact

- **All MCP servers**: Existing servers need a re-connect to re-classify with the filter applied (no data migration)
- **All HITL approval flows**: The phantom guard prevents infinite loops for any approval-required tool, not just misclassified ones
- **Test coverage**: 3 new tests serve as guardrails against future dedup regressions; all 314 `test_status_builder.py` tests pass

## Related Work

- T04 (`8134ee2e1`): Replace fingerprint dedup with identity-based lookup -- introduced the gap
- T08 (`602b2309b`): Handler extraction -- moved the dedup logic to `tool_event.py`
- The `005_ai_engineer.md` role's mandate on Single Source of Truth and Direct Identity principles guided the fix design

---

**Status**: Production Ready
**Timeline**: ~3 hours (investigation, production data analysis, implementation, testing)
