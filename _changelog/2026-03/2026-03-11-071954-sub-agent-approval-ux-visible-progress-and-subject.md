# Sub-Agent Approval UX: Visible Progress and Subject in Prompt

**Date**: March 11, 2026

## Summary

Fixed two sub-agent approval UX issues in the CLI TUI: (1) running sub-agents now remain visible in the live view while an approval prompt is active, and (2) the approval question shows the sub-agent's subject (what it's doing) instead of the generic type name like "general-purpose".

## Problem Statement

When the parent agent spawned multiple sub-agents in parallel and one of them needed approval, two UX problems surfaced that degraded the user's ability to understand and control execution.

### Pain Points

- All running sub-agent progress lines vanished when an approval prompt appeared, even though the other sub-agents were still executing. The user lost all visual context about what was running while deciding on the approval.
- The approval prompt showed "Sub-agent 'general-purpose': Do you want to execute...?" — the type name "general-purpose" adds zero useful context when all sub-agents are the same type doing different things. The subject (e.g., "Scan auth0-webhook dependencies") was already available but not used.

## Solution

Two targeted changes in the CLI rendering layer: compose the sub-agent stacked view with the approval panel instead of treating them as mutually exclusive, and look up the sub-agent's subject from the active block state for the approval question prefix.

## Implementation Details

### Compose sub-agent lines with approval in View()

The Bubbletea `renderTransientContent()` used a mutually exclusive priority switch — when `approvalActive` was true, the approval content was returned immediately and the sub-agent entries case was never reached. Changed the approval case to prepend the sub-agent stacked view (when entries exist) above the approval panel, separated by a blank line. The same change was applied to the legacy `View()` flat switch for consistency.

The resulting layout during a sub-agent approval:

```
● Sub-agent: Scan auth0-webhooks (12 tools)
  ⠋ Grep… (3s)
● Sub-agent: Scan agent-runner (8 tools)
  ⠋ Thinking… (5s)

Sub-agent 'Scan auth0-webhooks': Do you want to execute grep -r ...?
  › Approve
    Reject
```

Key correctness properties that required no new work: the sub-agent tick chain keeps running during approval (entries are not cleared by `handleApprovalStart`), sub-agents completing during approval naturally shrink the view via `handleSubAgentHide`, and the cached `elapsedStr` per entry keeps View() stable between ticks.

### Use subject instead of type name in approval prompt

Added `prefixSubAgentQuestion()` method that looks up the sub-agent block from `r.activeSubAgents[subAgentID]` and uses `block.subject` (populated from `SubAgentStartedEvent.Description`) instead of `e.SubAgentName` (the type name from the proto). When the block is not found or the subject is empty, the question renders without any prefix — showing nothing is better than a meaningless type name.

No proto changes were required. The subject was already available in the CLI renderer from the existing `SubAgentStartedEvent` event pipeline. The `SubAgentName` field remains on `ApprovalNeededEvent` for the JSON renderer which passes it through uninterpreted.

## Benefits

- Users retain full visibility of all parallel sub-agent activity while deciding on an approval
- The approval question provides meaningful context ("Scan auth0-webhook dependencies") instead of a generic label ("general-purpose")
- Graceful fallback: missing subject produces a clean question with no prefix rather than a noisy one

## Impact

- **CLI users**: Significantly improved situational awareness during sub-agent approval flows — no more blind spots about what's running
- **UX quality**: The approval prompt now answers "which sub-agent needs this?" at a glance
- **Correctness**: No behavioral changes to event processing, history tracking, or approval lifecycle

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5)
- Changelog: `2026-03-11-062209-fix-sub-agent-display-flickering`
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display`
- Changelog: `2026-03-10-084417-cli-sub-agent-rendering-improvements`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
