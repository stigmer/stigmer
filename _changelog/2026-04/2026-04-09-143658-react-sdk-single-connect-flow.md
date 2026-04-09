# React SDK: Single Connect Flow for MCP Servers

**Date**: April 9, 2026

## Summary

Replaced the two-button (Discover + Generate Policies) UX in the React SDK with a single Connect flow. The `McpServerDetailView` component now has a unified ConnectBar above the capabilities tabs, the Policies tab shows both pinned and auto-classified approval policies, and all deep-agent policy generation code has been deleted.

## Problem Statement

The MCP server setup in the React SDK required two separate user actions — "Discover" to enumerate tools and "Generate" to classify approval policies via a deep agent session. This created friction, confusion about ordering, and unnecessary latency from spinning up a full agent execution just to classify tool risk.

### Pain Points

- Two-step flow was non-obvious — users had to discover tools first, then switch tabs to generate policies
- The "Generate Policies" action started a full agent session (~30-60s) for what is fundamentally a lightweight classification task
- The `useTriggerApprovalPolicySession` hook and `ApprovalPolicyGeneratorPanel` added 430 lines of complex orchestration code (agent lookup, instance creation, YAML attachment, execution streaming) for a feature now handled server-side in a single RPC
- Approval policies were displayed from a single source (`spec.pinnedToolApprovals`), missing the new auto-classified policies in `status.toolApprovals`

## Solution

Unified MCP server connection into a single `useMcpServerConnect` hook backed by the `connect` RPC. The backend now handles both tool discovery and policy classification in one Temporal workflow. The React SDK simply calls `connect()` and renders the results.

## Implementation Details

### New: `useMcpServerConnect` hook

Clean, domain-aligned API replacing `useDiscoverCapabilities`:

- `connect(mcpServerId, runtimeEnv?)` — single action, blocks until complete
- `isConnecting` / `error` / `clearError` — standard async state
- Calls `stigmer.mcpServer.connect(input)` which triggers the backend's discover + classify workflow

### Rewritten: `McpServerDetailView` (1126 → 817 lines)

- **ConnectBar** above tabs — single Connect/Reconnect button with credential gating
- **ToolsTabContent** — pure read-only tool list (no action bar)
- **PoliciesTabContent** — two visual groups: Pinned (pin icon) + Auto-classified (sparkle icon)
- Policies tab badge shows combined count from `spec.pinnedToolApprovals` + `status.toolApprovals`
- Removed `onPolicySessionCreated` prop (breaking change — Console consumer updated)

### Deleted: 551 lines of deprecated code

- `useDiscoverCapabilities.ts` (120 lines) — replaced by `useMcpServerConnect`
- `useTriggerApprovalPolicySession.ts` (265 lines) — deep-agent policy generation eliminated
- `ApprovalPolicyGeneratorPanel.tsx` (166 lines) — inline streaming panel no longer needed

### Updated: Package exports and Console consumer

- `sdk/react/src/mcp-server/index.ts` and `sdk/react/src/index.ts` — barrel exports updated
- `sdk/react/src/demo/fixtures.ts` — `discoverCapabilities` fixture renamed to `connect`
- `client-apps/web/.../McpServerDetailPage.tsx` — removed `onPolicySessionCreated` and `useSessionNavigation`

## Benefits

- **Simpler UX**: One button instead of two. Connect does everything.
- **Faster**: Backend LLM classifier (~5-15s) replaces full agent session (~30-60s)
- **Less code**: Net reduction of 633 lines (281 added, 914 removed)
- **Better data display**: Policies tab now shows both pinned (manual) and auto-classified (LLM) policies with clear visual grouping
- **Cleaner SDK surface**: 3 exports removed (`useDiscoverCapabilities`, `useTriggerApprovalPolicySession`, `ApprovalPolicyGeneratorPanel`), 1 added (`useMcpServerConnect`)

## Impact

- **Platform builders**: Simpler integration — `useMcpServerConnect()` is a straightforward action hook
- **Console users**: Fewer clicks, faster feedback, clearer policy display
- **SDK API surface**: Breaking change — `onPolicySessionCreated` prop removed from `McpServerDetailViewProps`

## Related Work

- T01: Proto Model + FGA + Codegen (APIs, connect RPC definition)
- T02: Python Classifier + Connect Workflow (backend implementation)
- T03: Java Handlers + Auth Wiring + FGA Deploy (stigmer-cloud)
- Part of project: `20260408.02.mcp-connect-flow` — this is T04, the final phase

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
