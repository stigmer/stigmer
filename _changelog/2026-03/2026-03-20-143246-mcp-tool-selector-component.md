# McpToolSelector Component — MCP Tool Selection UI

**Date**: March 20, 2026

## Summary

Added `McpToolSelector` to `@stigmer/react` — a standalone, SDK-first component that renders a checklist of discovered MCP server tools with approval policy badges. This is the first UI component in Phase 2 of the MCP Server Setup Flow, building on the data layer (reducer + hook) completed in Phase 1.

## Problem Statement

MCP servers expose tools (`status.discovered_capabilities.tools`) and approval policies (`spec.default_tool_approvals`), and `McpServerUsageInput` supports `enabledTools` for per-tool filtering, but the UI provides no visibility or control. Users add MCP servers as black boxes with no way to see which tools they're enabling or which require HITL approval.

### Pain Points

- No per-tool selection when adding MCP servers to a session
- No visibility into which tools require human-in-the-loop approval
- All tools enabled by default with no option to customize
- No UI building block available for platform builders who want custom MCP configuration flows

## Solution

A pure presentational React component that renders a multi-select tool checklist with approval badges. Fully controlled via props (`enabledTools` + `onChange`), with zero knowledge of the setup hook, personal environments, or session creation.

## Implementation Details

### New File

- `sdk/react/src/mcp-server/McpToolSelector.tsx` — 243 lines

### Component API

```typescript
interface McpToolSelectorProps {
  tools: DiscoveredTool[];
  toolApprovals: ToolApprovalPolicy[];
  enabledTools: string[];
  onChange: (enabledTools: string[]) => void;
  disabled?: boolean;
  className?: string;
}
```

### Key Design Decisions

- **Native checkboxes** — `<input type="checkbox">` with `accent-primary size-3`, following the `EnvironmentVariableEditor` pattern. Inherently keyboard-accessible (Tab/Space) and screen-reader compatible. No custom ARIA machinery needed.
- **No hardcoded width** — Component fills its container. Parent controls width via layout or `className`.
- **Approval lookup via `useMemo` Map** — `Map<string, string>` from `toolApprovals`, keyed by `tool_name`. O(1) per-row lookups instead of O(n) array scans.
- **Bulk selection** — "All" / "None" compact text buttons always visible in header.
- **Scrollable list** — `useScrollShadows` + `ScrollFade` with `max-h-52` (established SDK pattern).
- **`useId()` for SSR-safe IDs** — Prevents collisions when multiple selectors coexist.
- **Clean empty state** — "Tools have not been discovered yet. All tools will be enabled by default." No CLI hint — SDK-appropriate for platform builders embedding in their own products.
- **Approval badge** — `bg-warning/15 text-warning` with shield icon, `title` attribute showing the approval message template (follows `FilePathLink` tooltip pattern).

### Modified Files

- `sdk/react/src/mcp-server/index.ts` — Added `McpToolSelector` + `McpToolSelectorProps` exports
- `sdk/react/src/index.ts` — Added re-exports in MCP Server section

## Benefits

- **Platform builder value**: Standalone component that works identically in the Stigmer Console and third-party dashboards
- **Clean separation**: Pure presentational, controlled via props — no orchestration coupling
- **Accessibility**: Native form controls, keyboard-navigable, screen-reader compatible
- **Performance**: O(1) approval lookups, memoized derived state
- **Themeable**: All visual properties via `--stgm-*` tokens

## Impact

- **SDK surface**: New public export in `@stigmer/react` — `McpToolSelector` component and `McpToolSelectorProps` type
- **Phase 2 progress**: First of three UI components completed. `McpServerConfigPanel` (T02.2) will compose this component with `EnvVarForm` for the per-server drill-in configuration panel.
- **Zero breaking changes**: Additive exports only

## Related Work

- [MCP Server Setup Orchestration Hook](2026-03-20-141555-mcp-server-setup-orchestration-hook.md) — Phase 1 data layer this component consumes
- Project: `_projects/2026-03/20260320.02.mcp-server-setup-flow/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
