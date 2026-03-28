# Sub-agent Approval Resume Fix

**Date**: March 28, 2026

## Summary

Fixed a structural mismatch between `InterruptProxyRunnable._build_proxy_payload()` and the resume logic in `execute_graphton.py` that silently dropped every sub-agent approval decision, causing the sub-agent to never resume after the user clicked Approve. Also hardened the React SDK's `dismissedApprovalIds` with timed reconciliation so failed approvals can never be permanently hidden from the user.

## Problem Statement

When a sub-agent requests tool approval (e.g., `execute git clone`), the approval card appears correctly at the bottom of the thread. The user clicks Approve, the card disappears (optimistic dismiss), but the sub-agent never resumes. The execution either restarts from scratch or stalls, and the `SubAgentSection` stays empty because the work never happened.

### Pain Points

- Sub-agent approvals are silently dropped — the user has no feedback that anything went wrong
- The `dismissedApprovalIds` Set permanently hides the card even when the backend fails to process the approval
- The execution logs a warning (`no matching interrupts found in checkpoint`) but proceeds with a fresh execution, losing all sub-agent context

## Solution

Two fixes targeting the root cause and a defense-in-depth frontend improvement:

1. **Backend**: Teach the resume matching loop to detect and unpack proxy interrupt payloads (nested `{sub_intr_id: {tool_call_id, ...}}` structure), building the correct nested `Command(resume=...)` dict that `InterruptProxyRunnable` passes through to the sub-agent graph.

2. **Frontend**: Replace the `Set<string>` dismiss mechanism with a `Map<string, number>` (toolCallId → dismissTimestamp) that reconciles against server state on each stream snapshot. Entries confirmed by the server are cleaned up; entries still pending after an 8-second grace window are evicted so the card reappears.

3. **Contract tests**: 8 tests pinning the contract between `_build_proxy_payload()` and the resume matching logic — direct interrupts, proxy interrupts, partial decisions, mixed scenarios, and edge cases.

## Implementation Details

### Backend (`execute_graphton.py`)

- Extracted `_build_decision_value()` to eliminate duplication between direct and proxy paths
- Extracted `_summarize_resume_entry()` for unified logging that handles both direct decisions (`action=approve`) and proxy payloads (`proxy(2 sub-decision(s): approve, skip)`)
- The matching loop now has two clear branches:
  - **Direct**: `tool_call_id` at top level → match as before
  - **Proxy**: no top-level `tool_call_id`, values contain `_proxy_interrupt_id` → iterate sub-values, match each `tool_call_id`, build nested resume dict
- Detection is unambiguous: direct interrupts always have `tool_call_id` (set by `tool_wrappers.py`), proxy payloads never do (they have sub-interrupt IDs as keys)

### Frontend (`useSessionConversation.ts`)

- `DISMISS_GRACE_MS` constant (8 seconds) documented at module level
- `useEffect` reconciliation runs on each `activeStreamExecution` change
- External API (`dismissedApprovalIds: ReadonlySet<string>`) remains unchanged — derived from map keys via `useMemo`

### Tests (`test_hitl_contracts.py`)

- `TestProxyInterruptResume` class with 8 tests covering the full round-trip contract
- Uses `InterruptProxyRunnable._build_proxy_payload()` directly to construct realistic proxy payloads
- Tests `_build_decision_value` and `_summarize_resume_entry` helpers

## Benefits

- Sub-agent approvals actually work — the sub-agent resumes, its `SubAgentSection` populates with tool results and subsequent work
- Failed approvals can never be permanently hidden — the card reappears after the grace window
- The proxy payload contract is pinned by tests so it cannot regress silently
- Cleaner logging — both direct and proxy resumes use the same structured format

## Impact

- **Users**: Sub-agent tool approvals now work end-to-end. After clicking Approve, the sub-agent section fills with the resumed work.
- **Platform builders**: The `useSessionConversation` hook's external API is unchanged. The `dismissedApprovalIds` type and behavior are backward-compatible.
- **Developers**: The proxy interrupt contract is explicitly documented in code comments and validated by tests.

## Related Work

- HITL Approval Cleanup project (20260327.01) — the simplification work that made `pending_approvals` server-computed and `tool_call_id` the direct matching key. This fix completes that work for the sub-agent proxy path.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
