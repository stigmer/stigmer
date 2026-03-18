# SP3: Session Context Panel

**Date**: March 18, 2026

## Summary

Added a live execution metadata panel to the session view, populating the previously empty right context panel with real-time status, model, token usage, cost, context window utilization, resolved context (MCP servers, skills, env keys), and workspace entries. Built as an SDK component (`ExecutionDetails`) for platform builder embeddability, with a Console-level slot mechanism to bridge page content into the layout-level panel.

## Problem Statement

The right context panel was delivered as an empty shell in T01.4 with the explicit note: "Context panel toggle hidden in T01.4 -- No content until T01.6." Users viewing a session had no way to inspect execution metadata (what model is running, how many tokens consumed, what the cost is, which MCP servers are connected) without looking at raw API responses.

### Pain Points

- No execution observability in the session view -- users are blind to cost, tokens, and context window utilization during live execution
- No way to open/close the context panel -- no toggle UI existed
- The `ContextPanel` component accepted `children` but `AppShell` passed nothing -- dead code path
- Pages had no mechanism to inject content into the layout-level panel (Next.js App Router limitation)

## Solution

Two-layer implementation following the platform-for-platforms architecture: SDK component for the metadata display, Console infrastructure for the panel slot.

## Implementation Details

### Console: Context Panel Slot Mechanism (3 files)

- **`use-layout-state.ts` -> `.tsx`**: Renamed to support JSX. Added `ContextPanelSlotProvider` (React Context holding `{ content: ReactNode | null; setContent }`), `useContextPanelSlot(content)` (effect-based hook with unmount cleanup), `useContextPanelSlotContent()` (reader hook).
- **`AppShell.tsx`**: Wraps children with `ContextPanelSlotProvider`.
- **`ContextPanel.tsx`**: Reads slot content via `useContextPanelSlotContent()` instead of accepting a `children` prop.

Design: React Context for slot content (ReactNode is not serializable), existing `useSyncExternalStore` for open/close visibility (primitive boolean). Each mechanism uses the appropriate primitive for its data type.

### SDK: `ExecutionDetails` Component (1 new file)

`sdk/react/src/execution/ExecutionDetails.tsx` -- self-contained, themed, embeddable component with seven conditional sections:

| Section | Data Source | Notes |
|---------|------------|-------|
| Status | `status.phase`, `status.startedAt` | Reuses `ExecutionPhaseBadge`. Live elapsed timer via `useElapsedMs` (1s interval for in-progress, stops on terminal). |
| Model | `usage.primaryProvider`, `usage.primaryModel` | Provider in muted text, model in monospace. |
| Tokens | `usage.promptTokens`, `completionTokens`, `totalTokens`, cache fields, `llmCallCount` | Tabular grid with `tabular-nums`. Cache fields only when non-zero. |
| Cost | `usage.estimatedCostUsd` | `$0.0234` for small values, `$1.52` for larger. |
| Context Window | `contextInfo.utilizationPercent`, `currentTokenCount`, `contextWindowLimit` | Progress bar: green < 70% < yellow < 90% < red. `role="meter"`. Compact token counts (e.g., "144K / 200K"). |
| Resolved Context | `resolvedContext.mcpServers`, `skillNames`, `environmentKeys` | MCP servers with dot + slug + tool count. Skills as monospace chips. Env keys as count with key icon. |
| Workspace | `workspaceEntries` (optional prop, session-level) | Folder icon + entry name + source (shortened git URL or local path). |

All sections render conditionally -- no empty sections. Inline SVG icons (no lucide-react in SDK). All `--stgm-*` token styling.

### Console: SessionPage Integration

- Derives `activeExecution` from streaming execution or most recent completed
- Calls `useContextPanelSlot` with `<ExecutionDetails>` -- updates live during streaming
- Auto-opens panel on first execution data via `useRef` guard (won't re-open after user closes)
- `PanelRight` toggle button positioned absolute top-right (hidden below `lg` breakpoint)

## Benefits

- **Execution observability**: Users see model, tokens, cost, and status at a glance during live execution
- **Context window visibility**: Color-coded progress bar warns when approaching model limits
- **Platform builder embeddability**: `ExecutionDetails` works identically embedded in a third-party dashboard as in the Console
- **Clean SDK API**: Single `execution: AgentExecution | null` prop -- zero transformation from hooks
- **Real-time updates**: During streaming, the panel updates automatically as new snapshots arrive

## Impact

- **End users**: Can now monitor execution cost and status in real-time alongside the conversation thread
- **Platform builders**: New `ExecutionDetails` component available from `@stigmer/react` for embedding execution metadata in any layout
- **Console UX**: Context panel is now functional -- the three-panel layout delivers on its original intent

## Related Work

- SP1 (Core Thread + Streaming) -- provides the streaming execution data that feeds this panel
- SP4 (Expandable Tool Groups) -- delivers the tool call detail view in the main thread; this panel shows execution-level aggregates
- T01.4 (Web App Shell) -- created the empty context panel shell that this SP populates

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
