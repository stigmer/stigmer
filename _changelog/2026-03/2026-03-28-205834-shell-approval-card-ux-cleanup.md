# Shell Approval Card UX Cleanup & Sub-Agent Subject Threading

**Date**: March 28, 2026

## Summary

Cleaned up the shell tool approval card to remove redundant command text and verbose sub-agent attribution, replacing them with a compact header badge. Extended the `PendingApproval` proto with `sub_agent_subject` so the badge displays the sub-agent's task description instead of the generic agent type name.

## Problem Statement

The `ApprovalCard` for shell-category tools displayed the same command three times: truncated in the header, as raw text in `pendingApproval.message`, and in the terminal block via `ShellArgsView`. Additionally, a verbose "Sub-agent general-purpose wants to execute this tool" paragraph consumed space between the header and the terminal block without adding proportional value.

### Pain Points

- Shell approval cards showed the command three times (header summary, message text, terminal block)
- The "Sub-agent X wants to execute this tool" paragraph was a full body element for metadata that belongs in the header
- The sub-agent attribution used the agent type name ("general-purpose") rather than the task subject ("Explore CLI rendering code"), making it uninformative

## Solution

Two-phase approach: first clean up the UI rendering, then thread the sub-agent subject through the data model.

## Implementation Details

### Phase 1: ApprovalCard UI Cleanup (`sdk/react/src/execution/ApprovalCard.tsx`)

- Moved sub-agent attribution from a body paragraph to a compact `via {name}` badge in the header row, positioned before the waiting duration
- Suppressed `pendingApproval.message` rendering for shell-category tools (it duplicated the terminal block). Non-shell tools retain their message display.

### Phase 2: Sub-Agent Subject in PendingApproval (proto + server + UI)

- **Proto**: Added `sub_agent_subject` (field 9) to `PendingApproval` in `approval.proto`
- **Codegen**: Ran `make protos` in both `stigmer` and `stigmer-cloud` to regenerate TS, Go, Python, Java, and Dart stubs
- **Server**: Updated `PendingApprovalComputer.projectToolCall` in `stigmer-cloud` to read `SubAgentExecution.getSubject()` and set it on the projection
- **Tests**: Updated all sub-agent test fixtures in `PendingApprovalComputerTest` to set `.setSubject(...)` and assert `getSubAgentSubject()`
- **UI**: Updated the badge to prefer `subAgentSubject` over `subAgentName` with graceful fallback

## Benefits

- Shell approval cards show only the terminal block (the one useful representation) plus action buttons
- Sub-agent attribution uses ~80% less vertical space as a header badge vs. a body paragraph
- The badge now shows the task description (e.g., "via Explore CLI rendering code") instead of the generic type ("via general-purpose"), giving users immediate context about what the sub-agent is doing
- Backward-compatible: empty `sub_agent_subject` falls back to `sub_agent_name`

## Impact

- **Direct users**: Cleaner, denser approval cards for shell tools during execution monitoring
- **Platform builders**: `ApprovalCard` component in `@stigmer/react` renders a better default experience with no prop changes needed
- **Data model**: `PendingApproval` proto gains a new optional field; no breaking changes

## Related Work

- `2026-03-28-191432-fix-sub-agent-ui-visibility.md` — Prior fix for sub-agent visibility in the execution thread
- `2026-03-28-182909-sub-agent-approval-resume-fix.md` — Prior fix for sub-agent approval resume flow

---

**Status**: Production Ready
**Timeline**: Single session
