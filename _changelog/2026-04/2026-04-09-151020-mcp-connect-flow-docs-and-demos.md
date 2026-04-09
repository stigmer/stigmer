# MCP Connect Flow: Documentation and Demo Update

**Date**: April 9, 2026

## Summary

Updated all documentation, site demos, and concept pages to reflect the new
single-step Connect flow, replacing the old two-step Discover + Generate
Policies UX. Fixed compilation-breaking stale imports, created a unified Connect
demo, rewrote the Getting Started tutorial, and updated concept pages for the
new two-tier approval policy model.

## Problem Statement

The MCP Connect Flow project (T01–T04) replaced the two-step Discover +
Generate Policies UX with a single Connect button. The proto model changed
significantly: `default_tool_approvals` was renamed to `pinned_tool_approvals`,
`DiscoverySource` enum was removed, and a new `status.tool_approvals` field was
added for system-generated policies. These changes left the documentation, site
demos, and concept pages stale and the site unable to compile.

### Pain Points

- Site could not compile — 5 demo/fixture files imported `DiscoverySource` and
  used `defaultToolApprovals`, both of which no longer exist in generated stubs
- Getting Started tutorial described a two-step flow (Discover then Generate)
  that no longer exists in the UI
- Concept pages referenced `default_tool_approvals` without explaining the new
  two-tier model
- Auto-generated SDK docs carried stale JSDoc references from their source files
- Two separate demo scenarios (discover-capabilities-playback and
  generate-policies-playback) no longer reflected the unified Connect UX

## Solution

Executed a 5-phase plan to systematically update all stale content:

1. Full codegen regeneration (`make codegen`) for auto-generated artifacts
2. Fix site demo compilation — fixture data, demo scenarios, tour beats, wiring
3. Rewrite the Getting Started tutorial
4. Update concept pages and vocabulary
5. Verify cross-references and final compilation

## Implementation Details

### Phase 1: Codegen Regeneration
- Ran `make codegen` — full pipeline from protos through stubs, all SDK
  generations, and SDK docs
- Auto-generated `docs/sdk/react/mcp-server.mdx` and
  `docs/sdk/resources/mcp-server.mdx` regenerated correctly (old hooks like
  `useDiscoverCapabilities` removed from exports, `useMcpServerConnect` present)

### Phase 2: Site Demo Fixes
- **Fixture data**: Removed `DiscoverySource` import and `discoveredBy` field
  from `mcp-server-detail/index.tsx`. Changed `defaultToolApprovals` to
  `pinnedToolApprovals` in `preview-configs.ts`. Moved approval policies from
  spec to `status.toolApprovals` where appropriate.
- **New demo**: Created `connect-playback/` — 6-step scenario showing: server
  detail → click Connect → credential form → fill + save → tools + policies
  discovered → policies tab
- **Deleted demos**: Removed `discover-capabilities-playback/` and
  `generate-policies-playback/` (4 source files + 6 narration assets)
- **Tour update**: Merged first two beats of `connect-tools-tour` into single
  "connected" beat (6 beats → 5 beats)
- **Wiring**: Updated `index.ts` exports, `mdx.tsx` component map, `registry.ts`
  scenario map

### Phase 3: Tutorial Rewrite
- Merged "Discover capabilities" and "Generate approval policies" steps into
  single "Connect" step in `docs/getting-started/connect-tools.mdx`
- Updated "What you'll build" intro and "What just happened" summary
- Replaced `DemoDiscoverCapabilities` + `DemoGeneratePolicies` with
  `DemoConnectPlayback`
- Kept policies callout minimal — says Connect classifies automatically, defers
  two-tier detail to concepts page

### Phase 4: Concepts and Vocabulary
- `docs/concepts/tools.mdx`: Updated YAML example to `pinned_tool_approvals`
- `docs/concepts/approval-flows.mdx`: Updated Mermaid diagram, added two-tier
  YAML examples (`status.tool_approvals` + `spec.pinned_tool_approvals`)
- `docs/vocabulary.md`: Updated MCP Server YAML fields section

### Phase 5: Source Fixes and Regeneration
- Fixed JSDoc in `McpToolSelector.tsx` and `McpServerConfigPanel.tsx` (referenced
  old `spec.default_tool_approvals`)
- Fixed `apis/.../mcpserver/docs/overview.md` YAML example
- Ran `make gen-sdk-docs` to regenerate with corrected sources
- Verified zero stale references across all `site/src/` and `docs/` directories

## Benefits

- Site compiles again — production builds pass cleanly
- Documentation accurately reflects the actual product UX
- Single Connect demo tells a coherent story instead of two disconnected steps
- Concept pages explain the two-tier approval policy model for advanced users
- All auto-generated docs regenerated from corrected sources

## Impact

- **Users**: Getting Started tutorial and concept pages now match the actual UI
- **Developers**: Site builds again; no stale imports blocking development
- **Demo recordings**: New `connect-playback` scenario ready for narration
  generation
- **55 files** changed: +147 lines, −1,591 lines (net cleanup)

## Related Work

- [Visual-first Getting Started tours](2026-04-07-152815-visual-first-getting-started-tours.md)
- [Connect your tools Getting Started page](2026-04-02-195258-connect-your-tools-getting-started-page.md)
- Project: `_projects/2026-04/20260408.02.mcp-connect-flow/`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
