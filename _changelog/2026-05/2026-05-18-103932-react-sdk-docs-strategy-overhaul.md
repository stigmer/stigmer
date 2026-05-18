# React SDK Documentation Strategy Overhaul

**Date**: May 18, 2026

## Summary

Overhauled the React SDK documentation generator to produce curated, workflow-ordered reference pages instead of a flat alphabetical dump of every export. Reduced the docs surface from 42 undifferentiated pages to 36 intentionally ordered pages, each with proper titles and descriptions — aligning with patterns used by Clerk, Stripe, and Auth0.

## Problem Statement

The React SDK docs generator auto-documented every export from `@stigmer/react` with no curation, producing noise that diluted the developer experience.

### Pain Points

- **Internal UI primitives leaked into public docs**: `action-menu`, `tabs`, `inline-edit`, `empty-state`, and `feedback` are implementation details, not SDK surface for consumers.
- **Test fixtures in consumer docs**: The `./test` subpath export surfaced sample data factories (`samples`) on a page titled "test" with no description.
- **Alphabetical ordering**: Pages were sorted A-Z, so `action-menu` appeared first and `core` (the setup page) was buried at position 9.
- **Missing metadata**: 19 of 42 pages lacked frontmatter titles and descriptions, rendering as raw slugs like "version-history" in the sidebar.
- **TypeDoc Module wrapping**: A TypeDoc update started wrapping exports in Module containers (kind 2), which the parser didn't handle — causing the generator to produce empty stub pages.

## Solution

A multi-layered approach: fix the parser to handle TypeDoc's new output format, exclude noise domains, introduce intentional ordering, and fill missing metadata — all within the existing auto-generation pipeline so the improvements are sustainable.

## Implementation Details

### Files Modified

- **`site/scripts/generate-react-sdk-docs/parser.ts`**
  - Added `EXCLUDED_DOMAINS` set to filter out 6 noise domains before MDX generation
  - Added `DOMAIN_META` entries for all 19 previously missing domains with proper titles and descriptions
  - Added `flattenModules()` helper to unwrap TypeDoc Module containers (kind 2)

- **`site/scripts/generate-react-sdk-docs/renderer.ts`**
  - Replaced `domains.map(d => d.slug).sort()` with a hand-maintained `DOMAIN_ORDER` array
  - Ordering follows adoption journey: Foundation → Sessions → Agents → Tools → Identity → Platform → Integrations → Usage → UI
  - New domains not in the order list are appended alphabetically as a safety net

- **`site/scripts/generate-react-sdk-docs/typedoc-types.ts`**
  - Added `Module: 2` to `ReflectionKind` constants

- **`sdk/react/typedoc.json`**
  - Added explicit `entryPoints: ["./src/index.ts"]` to exclude the `./test` subpath export from TypeDoc output

### Domains Excluded

| Domain | Reason |
|--------|--------|
| `test` | Sample data factories for unit tests, not consumer API |
| `action-menu` | Internal compound dropdown menu primitive |
| `tabs` | Generic tabbed layout primitive |
| `feedback` | Toast notification mounting helper |
| `empty-state` | Internal empty-state pattern component |
| `inline-edit` | Internal inline editing primitive |

### Page Ordering Strategy

Pages are grouped by adoption journey rather than sorted alphabetically:

1. **Foundation**: `core`
2. **Sessions & Execution**: `session`, `execution`, `composer`
3. **Agents & Workflows**: `agent`, `agent-instance`, `workflow`, `runner`
4. **Tools & Knowledge**: `mcp-server`, `skill`, `library`
5. **Environment & Config**: `environment`, `workspace`, `models`
6. **Identity & Access**: `organization`, `iam-policy`, `identity-provider`, `identity-account`, `invitation`, `oauth-app`, `api-key`
7. **Platform Building Blocks**: `resource-workbench`, `resource-creation`, `resource-detail`, `settings`, `version-history`, `dependency-graph`, `dashboard`
8. **Integrations**: `github`, `attachment`
9. **Monetization & Usage**: `billing`, `usage`
10. **UI Components**: `error`, `platform-client`, `user`, `activity`

## Benefits

- **Reduced noise**: 6 internal/test pages removed from consumer-facing docs
- **Better discoverability**: Core setup page is now first in the sidebar instead of buried at position 9
- **Professional presentation**: All 36 remaining pages have proper titles (e.g., "Version History" instead of "version-history") and descriptions
- **Workflow guidance**: Ordering guides developers through the natural adoption path
- **Sustainable**: Exclusions and ordering are maintained alongside the generator, so `make gen-react-sdk-docs` always produces the curated output
- **Safety net**: New domains are auto-appended alphabetically so nothing is silently lost

## Impact

- **SDK consumers**: Cleaner, more navigable reference documentation
- **Docs site**: Sidebar reflects intentional product architecture instead of filesystem structure
- **SDK team**: Clear pattern for adding new domains — add to `DOMAIN_META` and insert into `DOMAIN_ORDER` at the right position

## Related Work

- Future consideration: Fumadocs supports nested `meta.json` for sidebar subgroups. When the page count exceeds ~30 visible pages, grouping into collapsible sections (e.g., "Core", "Agents", "Identity") would further improve navigation.
- Benchmarked against Clerk, Stripe, and Auth0 React SDK documentation patterns.

---

**Status**: ✅ Production Ready
