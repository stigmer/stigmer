# Fix Sub-Agent Stuck in "Working..." Due to Pending Approvals Clobbering

**Date**: March 11, 2026

## Summary

Fixed a critical bug where sub-agent execution would get permanently stuck in a "Working..." state instead of showing the approval prompt. The root cause was the post-stream interrupt capture destructively replacing valid Phase 1 `pending_approvals` with entries that could have empty `tool_call_id`, poisoning both the CLI's approval detection and the Temporal merge logic that persists approvals to the database.

## Problem Statement

After the two-phase `pending_approvals` design was introduced (Phase 1 during streaming, Phase 2 post-stream interrupt capture), sub-agent tool calls requiring approval would intermittently get stuck. The CLI displayed "Working..." indefinitely, never showing the approval prompt, even though the parent execution correctly transitioned to `EXECUTION_WAITING_FOR_APPROVAL`.

### Pain Points

- Sub-agent `execute` tool calls stuck in "Working..." with no user-actionable prompt
- The `pending_approvals` field was completely absent from the execution status despite the correct phase
- The root cause was subtle: it involved the interaction of three separate systems (Python activity, Temporal merge logic, CLI rendering) across two languages

## Solution

Replaced the destructive `del[:]+extend()` pattern in the post-stream interrupt capture with a **non-destructive merge/enrich** strategy. Phase 1 entries are now treated as authoritative for `tool_call_id`; Phase 2 only grafts the `interrupt_id` onto them. Added a CLI defense-in-depth fallback that detects degraded `PendingApproval` entries and falls back to the tool-call status scan.

## Implementation Details

### Change 1: Non-destructive interrupt capture (Primary Fix)

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

The previous code collected new `PendingApproval` entries from graph state interrupts, then unconditionally wiped and replaced all existing entries:

```python
del status_builder.current_status.pending_approvals[:]
status_builder.current_status.pending_approvals.extend(pending_approvals)
```

When interrupt-to-tool-call matching failed for sub-agents (common because `run_id` aliases and scoped name searches can miss sub-agent tool calls), the replacement list contained entries with `tool_call_id=""`. This triggered a cascade:

1. The Temporal/controller merge logic treats `tool_call_id=""` on the first entry as a "clear" signal, wiping the DB
2. The CLI's Step 3 skips entries with no usable dedup key, Step 3b doesn't trigger because `len > 0`
3. No approval prompt appears; the sub-agent is stuck forever

The fix:

- **Indexes Phase 1 entries** by `tool_call_id` before iterating interrupts
- **Enriches existing entries** when the interrupt's `matched_tool_call_id` matches a Phase 1 entry (adds `interrupt_id`)
- **Appends genuinely new entries** only when they have a valid `tool_call_id` and weren't in Phase 1
- **Falls back** via `_try_enrich_phase1_entry` (new helper) when matching fails entirely — searches by `tool_name` + `from_sub_agent` for an un-enriched Phase 1 entry
- **Skips with warning** when no match is possible, preserving all Phase 1 entries intact
- **Never creates** a `PendingApproval` with empty `tool_call_id`

### Change 2: CLI defense-in-depth (Secondary Fix)

**File**: `client-apps/cli/cmd/stigmer/root/run_stream_events.go`

The Step 3b fallback previously only triggered when `len(pending_approvals) == 0`. Added `hasUsableApproval()` that checks whether any entry has a non-empty dedup key (`tool_call_id` or `interrupt_id`) that hasn't already been prompted. Step 3b now fires when all entries are degraded, ensuring the tool-call status scan catches approvals that the primary path missed.

### Change 3: Diagnostic logging

The interrupt capture now logs structured counters after every merge:

```
[INTERRUPT_CAPTURE] execution=... phase1=1 enriched=1 added=0 skipped=0 final=1: tool=execute tc_id=early-toolu_abc interrupt_id=intr-001
```

This makes future debugging of approval flow issues fast and non-invasive.

### Testing

- 6 Python unit tests for `_try_enrich_phase1_entry`: successful enrichment, skip when `interrupt_id` exists, no match, `from_sub_agent` flag mismatch, `tool_call_id` preservation, empty list
- 7 Go unit tests for `hasUsableApproval`: nil/empty, degraded entries, valid `tool_call_id`, valid `interrupt_id`, already prompted, mixed degraded+valid, mixed prompted+unprompted

## Benefits

- Sub-agent approval prompts now appear reliably regardless of interrupt matching success
- Phase 1 entries (with valid `tool_call_id`) are never destroyed by Phase 2
- The "clear" sentinel in the Temporal merge logic is never triggered accidentally
- Structured diagnostic logging enables rapid triage of future approval flow issues
- CLI defense-in-depth catches any remaining edge cases at the presentation layer

## Impact

- **Agent execution reliability**: Eliminates a class of stuck executions that required manual intervention
- **CLI users**: Approval prompts appear correctly for sub-agent tool calls
- **Backend operators**: New diagnostic logging aids production debugging
- **No breaking changes**: The Temporal merge logic, Phase 1 population, and the relaxation fix are all preserved

## Related Work

- `2026-03-11-054853-fix-sub-agent-approval-race-no-pending-approvals.md` — introduced Phase 1 immediate population
- `2026-03-11-081756-fix-approval-validation-tool-call-id-mismatch.md` — introduced Phase 2 interrupt capture and `interrupt_id`
- `2026-03-11-091713-fix-approval-validation-relax-pending-approvals-gate.md` — relaxed `SubmitApproval` validation (preserved as safety net)

---

**Status**: ✅ Production Ready
