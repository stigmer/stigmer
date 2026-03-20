# Enhanced MCP Chips in SessionComposer

**Date**: March 20, 2026

## Summary

MCP server chips in the SessionComposer now show per-server setup status with visual indicators, tool count fractions for custom tool selections, and click-to-configure behavior for unconfigured servers. This completes the chip-level UX for the MCP server setup flow, giving users immediate at-a-glance visibility into each server's configuration state.

## Problem Statement

After wiring `useMcpServerSetup` into SessionComposer (T03.1) and adding submission blocking (T03.2), MCP chips rendered identically regardless of server status — a loading server, a server needing credentials, and a fully configured server all looked the same. Users had no visual signal on the chip itself to distinguish configured from unconfigured servers, and no indication of tool selection state.

### Pain Points

- All MCP chips showed `MCP servername ×` with no status differentiation
- No visibility into whether a server's tools had been customized (e.g., 4 of 12 tools enabled)
- No affordance for clicking a chip to navigate to configuration — users had to find the MCP popover trigger
- Loading/submitting states were invisible at the chip level

## Solution

Extended the internal `ContextChip` component and `ChipItem` type with three optional fields (`status`, `detail`, `onClick`) populated only for MCP chips. The component renders four visual variants based on entry status, with accessible clickable behavior for unconfigured servers.

## Implementation Details

**Single file modified**: `sdk/react/src/composer/SessionComposer.tsx` (+95/-2)

### ChipItem type extension (internal, non-exported)

Three optional fields added:
- `status` — drives visual variant (amber for needsSetup, muted+spinner for loading/submitting)
- `detail` — secondary text like "4/12" for custom tool selections
- `onClick` — makes label area clickable (wraps in `<button>` with proper ARIA)

### Visual variants

| Status | Indicator | Background | Opacity | Behavior |
|--------|-----------|------------|---------|----------|
| `loading` | ChipSpinner (10x10 SVG) | `bg-muted/50` | 70% | Remove only |
| `needsSetup` | Amber dot (1.5x1.5) | `bg-warning/10 border-warning/30` | 100% | Click opens MCP popover |
| `submitting` | ChipSpinner | `bg-muted/50` | 70% | Remove only |
| `ready` (all tools) | None | `bg-muted/50` | 100% | Remove only |
| `ready` (custom) | None + fraction badge | `bg-muted/50` | 100% | Remove only |

### Accessibility

- Clickable needsSetup chips: `aria-label="Configure {name}"`
- ChipSpinner and amber dot: `aria-hidden="true"` (warning banner is primary announcement)
- Remove button: `aria-label="Remove {label}"` unchanged

## Benefits

- **Immediate status visibility**: Users see at a glance which MCP servers are configured, loading, or need attention
- **Tool selection transparency**: The fraction badge (e.g., "4/12") communicates that tool customization happened and shows the ratio
- **One-click configuration**: Clicking an amber needsSetup chip opens the MCP popover directly — reduces navigation friction
- **Consistent two-signal UX**: Loading/submitting states are visually muted but not alarming (consistent with DD-T03.4 submission blocking philosophy)

## Impact

- **End users**: Better at-a-glance understanding of MCP server state in the composer, faster path to configuration
- **Platform builders**: No impact — no exported API changes, no prop contract changes on `SessionComposerProps`
- **Codebase**: `ContextChip` gains generic extension points (`status`, `detail`, `onClick`) that could serve other chip types in future if needed

## Related Work

- T03.1: Wire `useMcpServerSetup` into SessionComposer (prerequisite — chips derive from `mcpSetup.entries`)
- T03.2: Submission blocking for unconfigured MCP servers (complementary — warning banner + chip indicators)
- T03.4: RuntimeEnv aggregation (next task)

---

**Status**: ✅ Production Ready
