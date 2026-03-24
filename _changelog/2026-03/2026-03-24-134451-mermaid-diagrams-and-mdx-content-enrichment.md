# Mermaid Diagram Rendering and MDX Content Enrichment

**Date**: March 24, 2026

## Summary

Added client-side Mermaid diagram rendering to the documentation site and
enriched two key content pages (Installation, Agents) with the full suite of MDX
components: Tabs, Steps, Callout, Term tooltips, and Mermaid diagrams. This
completes T16 (Custom MDX Components) of the documentation infrastructure
project.

## Problem Statement

The documentation site had a complete MDX component system wired up (Tabs,
Steps, Callout, Term, SDKTabs, TypeTable, Accordion, Files, ImageZoom) but two
critical gaps remained:

### Pain Points

- STYLE.md encouraged Mermaid diagrams for architecture and data flows, but
  fenced ` ```mermaid ` blocks rendered as raw text with no diagram output
- Zero content pages used any MDX components beyond basic `<Cards>` on the home
  page, meaning the component infrastructure was untested in real content
- STYLE.md was missing documentation for `Cards`/`Card` and the `success`
  Callout type, despite these being available
- Vale's `Google.Quotes` and `Microsoft.Quotes` rules produced systematic false
  positives on JSX string attributes in MDX files (e.g., `items={["A", "B"]}`)

## Solution

Three-pronged approach: add the missing Mermaid capability, enrich real content
to validate the system, and update style documentation.

## Implementation Details

### Mermaid rendering pipeline

Created a two-part system:

1. **Remark plugin** (`site/src/lib/remark-mermaid.ts`): Runs at the MDAST
   (markdown AST) phase, before Shiki syntax highlighting. Uses
   `unist-util-visit` to find `code` nodes with `lang: "mermaid"` and replaces
   them with `mdxJsxFlowElement` nodes for `<Mermaid chart="..." />`. This
   ensures mermaid blocks never reach Shiki and are never syntax-highlighted as
   code.

2. **React component** (`site/src/components/docs/mermaid.tsx`): A `"use
   client"` component that lazy-loads the Mermaid.js library via dynamic import,
   renders SVG diagrams, and automatically re-renders on theme changes. Uses
   `MutationObserver` on `<html>` class to detect light/dark mode switches.
   Includes loading spinner and structured error state with source reveal.

The plugin is wired into fumadocs-mdx via `source.config.ts` using the function
form of `remarkPlugins` to prepend it before all default plugins:

```typescript
remarkPlugins: (plugins) => [remarkMermaid, ...plugins],
```

### Content enrichment

**Installation page** (`docs/getting-started/installation.mdx`):
- `<Steps>` wrapping the entire install-verify-configure-start flow
- `<Tabs>` for install methods (Homebrew / Shell script / Build from source)
- `<Tabs>` for model provider configuration (Anthropic / OpenAI / Ollama)
- `<Callout type="info">` for the "no Docker required" differentiator
- `<Term>` tooltips on Agent and Workflow terms

**Agents page** (`docs/concepts/agents.mdx`):
- `<Term>` tooltips on all domain terms throughout the page
- `<Callout type="warn">` for the blueprint/runtime separation invariant
- Mermaid `flowchart LR` replacing plain-text execution stack diagram
- Mermaid `stateDiagram-v2` for Agent Execution lifecycle operations

### Vale configuration

Disabled `Google.Quotes` and `Microsoft.Quotes` rules in `.vale.ini`. These
enforce American English quotation punctuation conventions that produce false
positives on every MDX component using string array props. The comment explains
the rationale for future maintainers.

## Benefits

- Authors can now use standard ` ```mermaid ` fenced code blocks in any doc page
  and see interactive diagrams that switch between light and dark themes
- Two high-traffic pages (Installation, Agents) demonstrate real-world usage
  patterns for every major component type
- STYLE.md is accurate and complete for all available components
- Vale no longer blocks commits due to JSX attribute false positives

## Impact

- **Doc authors**: Can now write Mermaid diagrams and follow established patterns
  for Tabs, Steps, Callout, and Term usage
- **Readers**: Installation page is scannable (tabbed install methods, numbered
  steps) and Agents page has visual diagrams for the execution stack and
  lifecycle
- **CI**: Builds remain clean (64 pages, zero errors, typecheck passes)
- **T16 milestone**: Phase 5 (Advanced Features) is now partially complete

## Related Work

- Part of the documentation infrastructure project
  (`20260322.01.documentation-infrastructure`)
- Builds on T06 (Fumadocs Integration, Session 3) which wired the component map
- Builds on SDKTabs and Term components created during earlier sessions
- T12 (CLI Reference Generation) auto-generates CLI docs that could use Mermaid
  in the future

---

**Status**: Production Ready
**Timeline**: Session 12 (~1 hour)
