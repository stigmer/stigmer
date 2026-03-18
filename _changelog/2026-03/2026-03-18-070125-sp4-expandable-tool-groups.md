# SP4: Expandable Tool Groups with Sub-Agent Sections

**Date**: March 18, 2026

## Summary

Added two-level progressive disclosure to tool call groups in the conversation thread. Users can now click a collapsed tool call summary to see individual tool calls, then click any tool call to inspect its arguments, result, error, and timing. Sub-agent delegations render as nested mini-threads with their own messages and tool groups.

## Problem Statement

Tool call groups in the session view rendered as static, non-expandable summary lines. Users could see that tools ran (e.g., "3 tool calls") but had no way to inspect what happened — no arguments, no results, no errors, no timing. For debugging agent behavior, this made the web console significantly less useful than the CLI, which streams tool call details inline.

### Pain Points

- No visibility into tool call arguments or results from the UI
- Failed tool calls showed a red icon but no error message
- Sub-agent delegations were invisible — no way to see what a sub-agent did
- Platform builders embedding the execution viewer had no tool call inspection capability

## Solution

Two-level progressive disclosure pattern applied to `ToolCallGroup`:

1. **Level 0** (existing): Collapsed summary — aggregate status icon + tool name/count label
2. **Level 1** (new): Expanded tool call list — each tool call as a clickable row with status icon, name, MCP server badge, and duration
3. **Level 2** (new): Individual detail — either a `ToolCallDetail` panel (args JSON, result, error, timing) or a `SubAgentSection` (nested message thread for sub-agent delegations)

## Implementation Details

### New Components (3 files, ~650 lines)

- **`ToolCallDetail`** — Presentational component for a single tool call's detail view. Renders arguments as formatted JSON, auto-detects JSON in results, shows errors with destructive styling. Includes `CollapsibleCode` for truncating large payloads (>10 lines) with "Show all N lines" toggle. Exports `formatDuration()` utility.

- **`ToolCallItem`** — Clickable row for Level 2 disclosure. Shows status icon, tool name (or sub-agent subject), MCP server badge, duration, and chevron. When expanded, renders `ToolCallDetail` for regular tools or `SubAgentSection` for sub-agent delegations. Uses internal `useState` with `defaultExpanded` prop.

- **`SubAgentSection`** — Nested mini-thread for sub-agent executions. Composes `MessageEntry` and `ToolCallGroup` — the same building blocks as the top-level `MessageThread`. Visually distinguished via `border-l-2 border-primary/20` left border. Shows header with name, subject, status, duration, plus error footer on failure.

### Modified Components (4 files, ~130 lines changed)

- **`ToolCallGroup`** — Summary `<div>` replaced with `<button>` with `aria-expanded`. Chevron icon added. When expanded, renders `ToolCallItem` per tool call. New `subAgentExecutions` prop enables sub-agent matching via `Map<string, SubAgentExecution>` keyed by ID. CSS `grid-template-rows` animation for smooth expand/collapse. Fully backward compatible.

- **`MessageThread`** — `ThreadItem` union gains `subAgentExecutions` on the `tool-group` variant. `buildThreadItems` extracts `exec.status?.subAgentExecutions` per execution. No new props on `MessageThreadProps`.

- **Barrel exports** — `ToolCallDetail`, `ToolCallItem`, `SubAgentSection`, `formatDuration` added to both `execution/index.ts` and top-level `src/index.ts`.

### Key Design Decisions

1. **Two-level disclosure, not flat expansion** — Matches progressive disclosure principle (Hick's Law). Single-level expansion (summary to all details at once) would overwhelm for executions with 10+ tool calls.
2. **SubAgentExecution passed via prop, not context** — Keeps components self-contained and embeddable. No React Context, no global state.
3. **ToolCall.result over MESSAGE_TOOL messages** — Consistent with SP1's design where MESSAGE_TOOL is skipped in the thread.
4. **Internal state for expansion** — `useState` with `defaultExpanded` prop. No controlled mode in v1. Platform builders who need full control compose `ToolCallDetail` and `ToolCallItem` directly.
5. **Sub-agent ID matching** — `SubAgentExecution.id` matches `ToolCall.id` from the parent's "task" tool invocation. O(1) lookup via Map built in `ToolCallGroup`.

## Benefits

- Users can debug agent behavior directly from the web console without switching to CLI
- Platform builders get tool call inspection for free via the SDK styled components
- Sub-agent delegations are visible as nested threads with full message/tool detail
- All components independently importable — platform builders can compose custom UIs using just the hooks and detail components

## Impact

- **SDK surface**: 3 new exports (`ToolCallDetail`, `ToolCallItem`, `SubAgentSection`) + 3 types + 1 utility (`formatDuration`)
- **Console**: Zero changes required — expansion behavior is self-contained in SDK components
- **Backward compatibility**: Existing consumers of `ToolCallGroup` see the same summary with added clickability. New `subAgentExecutions` prop defaults to `undefined`.

## Related Work

- SP1 (Core Thread + Streaming) — Provided the collapsed `ToolCallGroup` that this SP enhances
- SP2 (Follow-Up Conversation Loop) — Uses `MessageThread` which now passes sub-agent data through
- SP5 (HITL Approvals) — Depends on SP4 for the expandable tool call infrastructure

---

**Status**: Production Ready
**Commit**: `7587e2f0`
**Branch**: `feat/session-first-web-ux`
