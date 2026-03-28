# Sub-Agent Collapsible Progressive Disclosure

**Date**: March 28, 2026

## Summary

Sub-agent executions in the message thread now render as collapsible cards with expand/collapse behavior, matching the existing `ToolCallGroup` progressive disclosure pattern. Previously, sub-agents rendered as flat, always-visible content with no toggle — dumping all nested messages and tool calls into the thread regardless of status.

## Problem Statement

When an agent delegates work to sub-agents (via `task` tool calls), the execution viewer displayed each sub-agent's full nested content inline — every message, every tool call group, every error. For executions with multiple sub-agents (common in research tasks), this created a wall of content that obscured the parent agent's own messages and made it difficult to scan execution progress at a glance.

### Pain Points

- Sub-agents had no expand/collapse toggle — their content was always visible
- Regular tool calls got the collapsible `ToolCallGroup` treatment, but sub-agents did not — inconsistent progressive disclosure
- Completed sub-agents cluttered the thread with content the user had already observed
- No visual summary of sub-agent status without scrolling through all nested content
- Running sub-agents were visually indistinguishable from completed ones at a distance

## Solution

Added a `collapsible` prop (default `true`) to `SubAgentSection` that renders the component as a bordered card with a clickable summary row — the same visual language as `ToolCallGroup`. The summary row shows status icon, subject label, status badge, duration, and an animated chevron. The nested content (messages, tool groups, error footer) renders inside a CSS grid-rows animated panel.

## Implementation Details

### `SubAgentSection.tsx` — Primary change

Split the component into two rendering modes controlled by the `collapsible` prop:

- **`CollapsibleCard`** (default) — Bordered card matching `ToolCallGroup`'s visual treatment. Uses `useState` + `useRef(userToggledRef)` + `useEffect` for auto-expand/collapse based on `SubAgentStatus`. Running/pending sub-agents auto-expand; terminal statuses auto-collapse. User clicks override the automatic behavior. CSS `grid-template-rows` transition provides smooth animation.

- **`FlatContent`** — Preserves the original flat layout (left-border, no toggle) for use inside `ToolCallItem`'s detail panel, where the parent already provides expand/collapse.

Extracted **`SubAgentThreadContent`** as a shared renderer for the nested messages + tool groups + error footer, eliminating duplication between both modes.

Added `badgeClass` to `SubAgentStatusInfo` for contextual status badges in the summary row (green for completed, red for failed, muted for pending/cancelled).

Bumped icon sizes from 10px to 12px to match `ToolCallGroup`'s icon scale.

### `ToolCallItem.tsx` — One-line change

Passed `collapsible={false}` to `SubAgentSection` when rendered inside the tool call detail panel, preventing redundant nested collapse UI.

## Benefits

- **Progressive disclosure**: Completed sub-agents collapse to a single summary row, dramatically reducing thread noise for multi-sub-agent executions
- **Status at a glance**: Status icon + badge + duration visible without expanding — users can scan execution progress instantly
- **Consistent UX**: Sub-agents now follow the same visual pattern as tool call groups — no more inconsistency in how delegated work is displayed
- **Auto-expand running**: Active sub-agents expand automatically so users can watch progress in real-time without manual interaction
- **Backward-compatible**: The `collapsible` prop defaults to `true`, so existing consumers get the improved behavior. `ToolCallItem` explicitly opts out to avoid double-nesting

## Impact

- **SDK component** (`@stigmer/react`): The change is entirely within the SDK — works identically in the Stigmer Console and in third-party embeds
- **Theme compliance**: All visual properties flow through existing `--stgm-*` tokens — no hardcoded values
- **Accessibility**: `button` trigger with `aria-expanded`, keyboard navigable, matching the established pattern
- **No breaking changes**: Existing consumers that don't pass `collapsible` get the new behavior as a default improvement

## Related Work

- `2026-03-28-191432-fix-sub-agent-ui-visibility.md` — Fixed sub-agent rendering to promote task tools to standalone thread items (prerequisite for this work)
- `2026-03-28-182909-sub-agent-approval-resume-fix.md` — Fixed sub-agent approval attribution

---

**Status**: ✅ Production Ready
**Timeline**: Single session
