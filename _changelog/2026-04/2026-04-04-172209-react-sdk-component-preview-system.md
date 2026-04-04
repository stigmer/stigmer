# React SDK Component Preview System

**Date**: April 4, 2026

## Summary

Added live, interactive component previews to the auto-generated React SDK reference documentation. Each preview renders the actual SDK component using mock data from the `@stigmer/react/demo` pipeline, giving documentation readers an immediate visual of how components look in production — without leaving the docs page.

## Problem Statement

The auto-generated React SDK reference pages were text-heavy: prop tables, hook signatures, and descriptions, but no visual representation of what the components actually look like when rendered. Readers had to mentally assemble the UI from prose, or spin up a separate app to see the component in action.

### Pain Points

- Documentation pages for visual components lacked any visual context
- Readers couldn't quickly assess a component's appearance without running code
- No way to see how prop-driven features (e.g. toolbar items) manifest visually

## Solution

A data-driven component preview system integrated into the MDX documentation pipeline. Each preview is declared as a configuration entry — component reference, fixture specs for mock data, and props — in a single registry file. A generic `<ComponentPreview>` MDX component reads this registry, creates a demo client from the fixtures, and renders the component inside a styled shell.

Previews use a **click-to-reveal** UX: a compact "Preview" toggle bar is shown collapsed by default, deferring all component mounting, client creation, and rendering until the user opts in. This keeps page load fast and avoids visual noise for readers focused on the API surface.

## Implementation Details

### New Files

- **`site/src/components/docs/previews/preview-configs.ts`** — Single source of truth for all preview definitions. Defines the `PreviewConfig` interface (`component`, `fixtures`, `props`, `previewClassName`) and the `PREVIEW_CONFIGS` registry with 5 initial entries.
- **`site/src/components/docs/previews/ComponentPreview.tsx`** — Generic MDX component with click-to-reveal toggle (Eye + Chevron icons), error boundary, and deferred rendering via `PreviewRenderer`.
- **`site/src/components/docs/previews/PreviewShell.tsx`** — Shared layout wrapper that sets up `StigmerProvider` with a demo client and applies standard demo styling tokens.

### Modified Files

- **`site/scripts/generate-react-sdk-docs/renderer.ts`** — Added `PREVIEW_COMPONENTS` set and automatic `<ComponentPreview>` tag emission for registered components.
- **`site/src/components/docs/index.ts`** — Barrel export for `ComponentPreview`.
- **`site/src/components/mdx.tsx`** — Registered `ComponentPreview` in the MDX component map.
- **`docs/sdk/react/{agent,api-key,composer,error,models}.mdx`** — Each received a `<ComponentPreview>` tag for its primary component.

### Key Design Decisions

- **Data-driven over per-component files**: All preview definitions live in one `preview-configs.ts` file rather than separate React files per component. Adding a new preview is one object entry + one set addition.
- **Click-to-reveal over always-visible**: Previews are collapsed by default with a toggle bar. This avoids jarring always-visible blocks, defers expensive rendering, and lets readers opt in.
- **Per-preview width control**: `previewClassName` allows each config to set width constraints (e.g. `max-w-2xl` for `SessionComposer`) so previews match realistic in-app dimensions.
- **Full toolbar activation**: `SessionComposer` preview supplies `org`, `onAgentRefChange`, `onMcpServerUsagesChange`, and `onSkillRefsChange` props with an `environment.list` fixture, activating the full two-tier toolbar (Attach, Configure menu with Agent/MCP/Skills, Model Selector).

### Initial Component Coverage

| Component | Fixtures | Notable |
|-----------|----------|---------|
| SessionComposer | environment.list (empty) | Full toolbar, max-w-2xl width |
| ModelSelector | none | Renders model dropdown |
| AgentDetailView | agent.getByReference | Mock agent with description |
| ErrorMessage | none | Static error prop |
| ApiKeyListPanel | apiKey.findAll | Mock API key list |

## Benefits

- **Immediate visual context**: Readers see the rendered component alongside its props table
- **Zero setup**: No separate app needed — previews use the existing demo client infrastructure
- **Performance-safe**: Click-to-reveal defers all rendering until user intent
- **Maintainable**: Adding a new preview requires one config entry and one set addition — no new files
- **Realistic**: Components render with actual SDK hooks and demo transport, not static screenshots

## Impact

- 5 React SDK reference pages now have interactive component previews
- Documentation pipeline automatically emits preview tags for registered components
- Foundation established for expanding coverage to remaining components

## Related Work

- [React SDK MDX Generator](2026-04-04-162212-react-sdk-mdx-generator.md) — The auto-generation pipeline these previews integrate into
- [React SDK Overview Page Links](2026-04-04-163024-react-sdk-overview-page-links.md) — Linking overview to generated domain pages

---

**Status**: ✅ Production Ready
**Timeline**: Single session
