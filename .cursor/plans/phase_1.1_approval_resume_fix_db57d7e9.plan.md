---
name: Phase 1.1 Approval Resume Fix
overview: Fix approval prompts not appearing on session resume by adding defense-in-depth approval detection on the stream path, plus diagnostic logging to confirm backend behavior.
todos:
  - id: new-struct
    content: Add `unpromptedApproval` struct and `findAllUnpromptedApprovals` function to `run_stream_approval.go`
    status: completed
  - id: stream-fallback
    content: Add defense-in-depth fallback block in `streamToEvents` (after Step 3) in `run_stream_events.go`
    status: completed
  - id: proto-check
    content: Verify `PendingApproval` proto has `FromSubAgent`/`SubAgentName` fields (or adjust synthetic construction)
    status: completed
  - id: unit-tests
    content: Add unit tests for `findAllUnpromptedApprovals` and enriched `buildPendingApprovalFromToolCall`
    status: completed
  - id: manual-test
    content: "Manual test: detach during approval, re-attach, verify prompt appears"
    status: pending
isProject: false
---

# Phase 1.1: Approval Not Surfaced on Resume -- Stream Path Defense-in-Depth

## Problem

When a user re-attaches to a `WAITING_FOR_APPROVAL` execution via `stigmer run ses-XXX`, the approval prompt may not appear. The user sees the execution is paused but cannot respond. Root cause: the backend's initial MongoDB snapshot may not include `pending_approvals` (write-ordering or replication lag), and the Redis stream uses `>` offset so old approval messages are not re-delivered.

## Architecture Decision

The fix targets the **stream path** (`run_stream_events.go`), not the snapshot path (`run_stream_snapshot.go`). The snapshot path only processes terminal executions and has no gRPC plumbing for interactive approval submission. See [architectural analysis in chat] for full rationale.

## Fix: Defense-in-Depth Approval Detection

**File:** [run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)

After the existing `pending_approvals` check (Step 3, ~line 133), add a fallback when:

- `pending_approvals` is empty
- Execution phase is `EXECUTION_WAITING_FOR_APPROVAL`
- There exist tool calls (top-level or sub-agent) in `TOOL_CALL_WAITING_APPROVAL` status that have not been prompted

For each unprompted tool call found:

- Construct a synthetic `PendingApproval` using the existing `buildPendingApprovalFromToolCall` function from [run_stream_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_approval.go)
- Emit `ApprovalNeededEvent` and block for user response -- same as the primary `pending_approvals` path
- The synthetic approval carries basic fields (tool name, args preview) but not the richer backend-provided message. This is acceptable for defense-in-depth; the prompt still shows tool name and args.

### New helper function: `findAllUnpromptedApprovals`

A new function that scans both top-level `ToolCalls` and `SubAgentExecution.ToolCalls` for unprompted `WAITING_APPROVAL` tools. Unlike the existing `findUnpromptedApproval` (which only returns one and only scans top-level), this returns all unprompted entries with sub-agent context.

Signature (in `run_stream_approval.go`):

```go
func findAllUnpromptedApprovals(
    toolCalls []*agentexecutionv1.ToolCall,
    subAgents []*agentexecutionv1.SubAgentExecution,
    promptedIDs map[string]bool,
) []unpromptedApproval
```

Where `unpromptedApproval` carries the `ToolCall`, the originating `subAgentName` (empty for top-level), and the `fromSubAgent` flag. This data enriches the synthetic `PendingApproval` so the TUI correctly shows sub-agent context in the approval block.

### Integration point in `streamToEvents`

After the existing Step 3 block (~line 155), add:

```go
// Defense-in-depth: when pending_approvals is empty but the execution
// is WAITING_FOR_APPROVAL, scan tool calls for WAITING_APPROVAL status.
if len(execution.Status.GetPendingApprovals()) == 0 &&
    execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
    unprompted := findAllUnpromptedApprovals(
        execution.Status.ToolCalls,
        execution.Status.GetSubAgentExecutions(),
        promptedIDs,
    )
    for _, u := range unprompted {
        pa := buildPendingApprovalFromToolCall(u.toolCall)
        if u.fromSubAgent {
            pa.FromSubAgent = true
            pa.SubAgentName = u.subAgentName
        }
        dedupKey := pa.ToolCallId
        log.Debug().
            Str("execution_id", cfg.executionID).
            Str("tool_call_id", pa.ToolCallId).
            Bool("from_sub_agent", u.fromSubAgent).
            Msg("[stream] defense-in-depth: constructing approval from tool call status")
        emitAndWaitApproval(ctx, cfg, u.toolCall, pa, promptedIDs, dedupKey)
    }
}
```

## Enhanced Diagnostic Logging

**File:** [run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)

The existing debug log (~line 74) already includes `pending_approvals` count. Add the execution phase to the first-message log for quicker diagnosis:

```go
Bool("is_first_update", !seenFirst).
```

This is a minor addition -- the existing logging is already comprehensive.

## Tests

**File:** [run_stream_events_test.go](client-apps/cli/cmd/stigmer/root/run_stream_events_test.go)

New test cases:

- `TestFindAllUnpromptedApprovals_TopLevel` -- finds top-level WAITING_APPROVAL tool
- `TestFindAllUnpromptedApprovals_SubAgent` -- finds sub-agent WAITING_APPROVAL tool with correct sub-agent metadata
- `TestFindAllUnpromptedApprovals_AlreadyPrompted` -- skips already-prompted tool calls
- `TestFindAllUnpromptedApprovals_Mixed` -- mixed statuses across top-level and sub-agents
- `TestBuildPendingApprovalFromToolCall_SubAgentFields` -- verify FromSubAgent/SubAgentName are set correctly when enriched

Note: The full integration test (emitting ApprovalNeededEvent, receiving response, submitting to backend) requires mocking the gRPC stream, which is more complex. The unit tests above validate the detection logic. Integration testing of the end-to-end flow is a manual test.

## Files Changed

- `run_stream_events.go` -- defense-in-depth fallback block after Step 3
- `run_stream_approval.go` -- new `findAllUnpromptedApprovals` function + `unpromptedApproval` struct
- `run_stream_events_test.go` -- new unit tests

## Files NOT Changed

- `run_stream_snapshot.go` -- no changes (snapshot path handles terminal executions only)
- `run_session.go` -- no changes (routing logic is correct)
- `pkg/executiontui/` -- no changes (TUI already handles ApprovalNeededEvent correctly)

## Out of Scope (tracked for follow-up)

- **Backend fix**: Ensure `pending_approvals` is populated in the initial Subscribe snapshot from MongoDB. This is the root cause; the CLI fix is defense-in-depth.
- **PendingApproval proto**: The `FromSubAgent` and `SubAgentName` fields on `PendingApproval` need to be verified as existing fields in the proto. If they don't exist, the synthetic approval will omit sub-agent context (acceptable degradation).

