# React SDK Overview Page Linked to Generated Domain Pages

**Date**: April 4, 2026

## Summary

The React SDK overview page (`docs/sdk/react/index.mdx`) now links directly to all 17 auto-generated domain reference pages. The domain table serves as a navigation hub, and the "What's next" cards guide readers into the three highest-traffic domains: Session, Execution, and Agent.

## Problem Statement

The React SDK documentation generator (T03) produced 17 domain reference pages with full hook signatures, component props, and type definitions. However, the hand-written overview page still contained placeholder text saying these pages were "planned" and its "What's next" cards pointed to base SDK resource pages rather than React SDK domain pages.

### Pain Points

- Readers had no way to navigate from the overview page to the generated domain pages
- The "planned" paragraph was stale and misleading
- The "What's next" cards led readers away from the React SDK section into the base SDK
- The inline core exports (StigmerProvider, deployment mode hooks) had no link to their full auto-generated reference in `core.mdx`

## Solution

Four targeted edits to the overview page that turn it from a dead-end summary into a navigation hub for the full React SDK reference.

## Implementation Details

1. **Domain table links**: All 16 domain names in the "Hooks and components" table are now markdown links (e.g., `[Session](/docs/sdk/react/session)`, `[MCP Server](/docs/sdk/react/mcp-server)`)
2. **Bridge text**: Replaced the stale "planned" paragraph with a concise sentence: "Each domain page documents every public hook signature, component props table, and type definition for that domain."
3. **Core cross-reference**: Added a link from the inline core exports note to `core.mdx` for full type signatures and props
4. **"What's next" cards**: Replaced streaming/agent-execution/session base SDK cards with Session, Execution, and Agent React SDK domain pages

## Benefits

- Readers can navigate from the overview page to any of the 17 domain reference pages in one click
- The overview page accurately reflects the current state of documentation (no stale "planned" text)
- Natural reading flow: set up the provider on the overview page, then explore domain hooks and components via the cards

## Impact

- **Docs readers**: Complete navigation path from React SDK overview to per-domain reference
- **Documentation maintainers**: Overview page is now self-consistent with the generated pages

## Related Work

- T03 (session 3): Built the TypeDoc-to-MDX generator that produces the 17 domain pages
- Parent T06: Created the hand-written overview page at `docs/sdk/react/index.mdx`

---

**Status**: Production Ready
