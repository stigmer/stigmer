# T01: Tools concept expansion and integrations navigation

**Date**: April 13, 2026

## Summary

Expanded the `docs/concepts/tools.mdx` page to cover the full MCP integration
ecosystem — marketplace library, Connect flow, OAuth authentication patterns,
sandbox isolation, and environment declarations — and wired the
`docs/guides/integrations/` navigation structure for upcoming guide pages.

## Problem Statement

The tools concept page was written before the marketplace, Connect flow, OAuth,
and BYOA features existed. It covered MCP protocol basics and the YAML resource
shape but said nothing about how tools are discovered in the library, how the
one-click Connect model works, how authentication is handled, or how Daytona
sandbox isolation protects the runtime.

### Pain Points

- Platform builders had no documentation on the curated tool library (~53 MCP
  servers)
- The Connect model (auto-discovery + auto-classification of approval policies)
  was undocumented
- Three authentication patterns (env vars, auto-discovered OAuth/DCR, vendor
  OAuth) had no concept-level explanation
- Environment declarations lacked coverage of required vs optional variables
  and the three-layer credential priority system
- No navigation existed for the upcoming integration guides section

## Solution

Expanded the existing concept page with 3 new sections and 2 updated sections,
woven into the existing narrative flow rather than appended. Created the
`docs/guides/integrations/` section with a hub page and navigation for 5 guide
pages (4 to be written in T02-T05).

## Implementation Details

### tools.mdx expansion (163 -> 257 lines)

- **The tool library** (new) — curated library, both transports, custom server
  support
- **Environment declarations** (updated from "Environment variables") — added
  `optional` field, three-layer credential priority table
- **Connecting a tool** (new) — Connect model, auto-classification, pinned vs
  auto-classified approval tiers
- **Authentication for tools** (new) — three patterns table, BYOA overview,
  forward link to guides
- **Sandbox isolation** (updated from "Tool isolation") — Daytona container
  isolation for stdio, network isolation for HTTP

### Navigation structure

- `docs/guides/integrations/meta.json` — page ordering for 5 guide pages
- `docs/guides/integrations/overview.mdx` — hub page with Cards linking to
  guide topics
- `docs/guides/meta.json` — integrations before federation

### IA document

- Marked the March 31 information architecture document as superseded by live
  `meta.json` files

## Benefits

- Tools concept page now covers the complete integration ecosystem in one place
- Platform builders can understand all three authentication patterns before
  diving into guides
- The integrations navigation is ready for T02-T05 guide pages to drop in
- The credential priority table (OAuth managed > personal > Agent Instance)
  clarifies a complex layering system

## Impact

- **docs/concepts/tools.mdx** — expanded from 163 to 257 lines
- **docs/guides/integrations/** — new section with hub page
- **docs/guides/meta.json** — updated ordering
- Build verified: `yarn build` passes, all pages render correctly

## Related Work

- Project: `20260413.02.mcp-integration-docs` (T01 of 7 tasks)
- Predecessor projects: marketplace (20260408.01, 20260410.01), connect flow
  (20260408.02), OAuth (20260410.03, 20260411.01), BYOA (20260413.01)
- Next: T02 (marketplace and connect guides + demos)

---

**Status**: Production Ready
**Timeline**: 1 session
