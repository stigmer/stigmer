# Approval Flow Demo: Cursor Overlay, ApprovalCard, and Message Ordering

**Date**: April 3, 2026

## Summary

The approval-flow-playback demo now renders the real `ApprovalCard` with Approve / Skip / Reject buttons, animates a cursor click on the Approve button, and displays the tool call result above the AI text summary. The document writer role has been updated to codify cursor overlays as a mandatory pattern for every playback demo that depicts a user action.

## Problem Statement

The approval-flow-playback demo claimed to show a tool approval flow but had three gaps:

### Pain Points

- `MessageThread` never rendered `ApprovalCard` because `ComposerView` did not pass `onApprovalSubmit`. The reader saw a "Waiting for Approval" phase badge but never the actual approval card with action buttons.
- No cursor overlay was mounted. Five other scenarios used the `Cursor` component for guided interaction, but the approval demo jumped from "waiting" to "completed" with no visual representation of the human decision.
- The final step showed the AI text summary above the `process_return` tool call result because both were packed into a single AI message. `MessageThread` renders text before tool groups within the same message, so the ordering was inverted.
- The cursor overlay pattern was not documented in the document writer role, requiring it to be re-requested for every new scenario.

## Solution

Four targeted changes across five files, plus a new rule in the document writer role.

## Implementation Details

### ComposerView: approval prop passthrough

Added an optional `onApprovalSubmit` prop to `ComposerViewProps` and passed it through to `MessageThread`. Existing callers that omit the prop are unaffected.

### ApprovalCard: cursor target attribute

Added `data-cursor-target="approve-button"` to the Approve button via a new optional `cursorTarget` prop on the internal `ActionButton` component. The attribute is inert unless a `Cursor` overlay targets it.

### Steps: expanded sequence and message split

Expanded from 4 to 5 steps with new `approval-card` and `cursor-approve` view types. Split the single `ai1` message (text + tool call) into `aiToolCallMsg` (empty text, carries `completedToolCall`) and `aiSummaryMsg` (summary text, no tool calls). The snapshot now uses `[user1, aiToolCallMsg, aiSummaryMsg]` so the thread renders tool result first, then the AI summary.

### Index: Cursor wiring

Mounted `Cursor` from `engine/Cursor.tsx`, added `containerRef`, `cursorTargetFor()`, and `onStepChange`. The `approval-card` and `cursor-approve` steps pass `onApprovalSubmit={noop}` to `ComposerView` so the card renders. The `conversation` step omits it so the card disappears after approval.

### Document writer role: cursor overlay rule

Added a "Cursor overlay for user actions" subsection to `_roles/002_document_writer.md` codifying: the rule (every user action step needs a cursor), the mechanism (`data-cursor-target` + `Cursor` component + `cursorTargetFor` + `onStepChange`), the three-step pattern (before → cursor click → after), and the self-check question.

## Benefits

- The demo now shows the complete approval lifecycle: card appears, human clicks Approve, agent resumes.
- Tool call result renders above the AI summary, matching real execution order.
- The cursor overlay rule is permanently codified so future scenarios include it by default.

## Impact

- **Docs pages affected**: `docs/concepts/approval-flows.mdx` and `docs/getting-started/connect-tools.mdx` — both embed `<DemoApprovalFlowPlayback />` and render the improved demo without changes.
- **SDK change**: `ApprovalCard` gains an inert `data-cursor-target` attribute on the Approve button. Zero visual or behavioral impact in production.
- **Document writer role**: all future demo authoring follows the cursor overlay standard.

## Related Work

- [Discover Capabilities Cursor and Credential Flow](2026-04-03-110746-discover-capabilities-cursor-and-credential-flow.md)
- [Generate Policies Cursor and Tools Context](2026-04-03-111148-generate-policies-cursor-and-tools-context.md)
- [Centralize Demo Styling Tokens](2026-04-02-181623-centralize-demo-styling-tokens.md)

---

**Status**: ✅ Production Ready
