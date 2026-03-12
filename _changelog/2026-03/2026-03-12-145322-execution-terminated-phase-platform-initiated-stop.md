# EXECUTION_TERMINATED Phase: Platform-Initiated Stop Semantics

**Date**: March 12, 2026

## Summary

Broadened `EXECUTION_TERMINATED` from a narrow "force-kill only" phase to the canonical phase for all platform-initiated stops — covering both automated safety mechanisms (stall timeout, tool-call budget) and user-initiated force-kill (Terminate RPC). This creates a clean three-way terminal state taxonomy: FAILED (something broke), TERMINATED (platform stopped it), CANCELLED (user gracefully stopped it).

## Problem Statement

When an agent stalled or exhausted its tool-call budget, the execution was marked `EXECUTION_FAILED` — the same phase used for genuine software errors (exceptions, crashes, silent graph termination). This made it impossible for the CLI to distinguish "the platform intentionally stopped this agent" from "something broke unexpectedly."

### Pain Points

- Users saw a red "EXECUTION FAILED" error for stall timeouts and recursion limits, even though these are controlled stops, not crashes
- The CLI session exit line showed bare `"Terminated"` with no reason when the Terminate RPC was used
- The inline TUI `renderPhaseChange` silently ignored the `"terminated"` phase — no scrollback entry was rendered
- The non-TUI `displayAgentPhaseChange` had no handler for `EXECUTION_TERMINATED`
- Terminated executions were not follow-up eligible, even though stall/recursion leave valid LangGraph checkpoints and the user can continue

## Solution

Adopted Option A from the architectural analysis: broaden `EXECUTION_TERMINATED` semantics at the phase level rather than adding an error classification enum (Option B). The phase-level distinction gives immediate UX value (yellow vs red in CLI) with minimal API surface changes.

## Implementation Details

### Proto (enum.proto)

- Added `EXECUTION_TERMINATED` to the `ExecutionPhase` phase transitions diagram and terminal states list in the header comment
- Rewrote the `EXECUTION_TERMINATED` inline comment to document both trigger paths:
  - **Internal** (activity-level): stall timeout, tool-call budget exhausted. Checkpoint is valid; user can continue.
  - **External** (Terminate RPC): force-kill via Temporal. Checkpoint may be incomplete.
- Documented the three-way distinction: Terminated (platform stopped it) vs Cancelled (user stopped it) vs Failed (something broke)

### Python Activity (execute_graphton.py)

- **Stall timeout**: `EXECUTION_FAILED` → `EXECUTION_TERMINATED`, sub-agents from `SUB_AGENT_FAILED` → `SUB_AGENT_CANCELLED` (the sub-agent didn't fail — the parent was stopped)
- **Recursion limit**: `EXECUTION_FAILED` → `EXECUTION_TERMINATED`
- **Unchanged**: Orphaned sub-agents at stream end remain `EXECUTION_FAILED` (silent graph crash is "something broke"). Generic and top-level exception handlers remain `EXECUTION_FAILED`.

### CLI (4 Go files)

- `renderPhaseChange`: Added `"terminated"` → `"Execution stopped"` case
- `displayAgentPhaseChange`: Added `EXECUTION_TERMINATED` → `climsg.Warning("Execution stopped")`
- `displaySessionExitLine`: Enhanced from bare `"Terminated"` to `"Stopped: <reason>"` showing the stall/recursion reason
- `isFollowUpEligible`: Added `"terminated"` as eligible phase (checkpoint valid, user can continue)

### Tests

- Added `TestIsFollowUpEligible_Terminated` asserting follow-up eligibility
- Updated `TestIsFollowUpEligible_OtherPhases` to remove `"terminated"` from ineligible list

## Benefits

- **Clearer UX**: Users see yellow "Execution stopped" (warning) vs red "Execution failed" (error) — matching the actual severity
- **Actionable context**: Session exit line shows the specific reason ("Agent stream stalled: no events for 120s" or "Agent reached the tool-call limit")
- **Continuity**: Terminated executions are follow-up eligible — users can send another message to continue, matching the recursion limit handler's existing "Send another message to continue" guidance
- **Accurate proto docs**: Removed inaccurate "no checkpoint, CANNOT be recovered" claims that were wrong even for the external Terminate RPC path

## Impact

- **End users**: See more appropriate visual treatment for platform-initiated stops (yellow warning vs red error)
- **CLI**: All rendering paths now handle TERMINATED consistently (was silently ignored in 2 of 4 paths)
- **Backend**: Stall timeout and recursion limit now set the semantically correct phase
- **API consumers**: Proto documentation accurately reflects the phase's scope and checkpoint behavior

## Related Work

- D1+D2 (Session 6): Execution budget middleware and max_tool_rounds configurability
- D3+D4 (Session 7): User-visible compaction notifications
- PR5 (Session 4): Premature completion fix — orphaned sub-agents detection (remains EXECUTION_FAILED)
- PR3 (Session 1): Recursion limit fix — removed 10x inflation

---

**Status**: ✅ Production Ready
**Timeline**: Session 8 (D5 deferred follow-up)
