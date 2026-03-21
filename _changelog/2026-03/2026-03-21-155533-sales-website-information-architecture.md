# Sales Website Information Architecture

**Date**: March 21, 2026

## Summary

Created the information architecture document for the Stigmer sales website, defining the complete page map, navigation structure, URL scheme, internal linking rules, and page inventory. This is Phase 2 of the sales website foundation project, establishing the structural blueprint that all subsequent content creation will follow.

## Problem Statement

The Stigmer sales website is a single-page site with no defined structure for growth. Phase 1 established the quality standards (page types, section types, copy rules, design rules), but there was no document specifying which pages to build, how they connect through the conversion funnel, what URLs they live at, or how navigation should surface them.

### Pain Points

- No page map — decisions about what pages to create were ad hoc
- No URL scheme — new pages could end up at inconsistent paths
- No navigation plan — the current header has dead links (`/examples`, `/changelog`)
- No internal linking strategy — pages could become dead ends with no funnel progression
- No priority ordering — unclear which pages to build first in the content project

## Solution

Created `site/standards/information-architecture.md` with five sections that provide a complete structural blueprint for the multi-page sales website.

## Implementation Details

### Page Map (Section 1)

Defined 18 pages organized by funnel stage:

- **Awareness**: Homepage (exists)
- **Interest**: 3 use-case pages (solo developer, platform builder, engineering leader) + 6 feature pages (declarative YAML, durable execution, MCP tool protocol, human-in-the-loop, local-first, platform for platforms)
- **Evaluation**: 3 comparison pages (vs LangChain, vs CrewAI, vs custom solutions) + pricing
- **Action**: Community page
- **Cross-funnel**: Blog (index + posts), changelog

Each page includes type, persona target, visitor goal, and success metric.

### Navigation Structure (Section 2)

- **Header**: Use Cases, Features, Compare, Docs, Pricing, GitHub (6 items)
- **Footer**: Product / Developers / Resources / Open Source (4 groups)
- **Mobile**: Full-screen slide-out drawer with accessibility requirements
- **Breadcrumbs**: Positional context on all pages except homepage, with `aria-label` and `aria-current`

### URL Scheme (Section 3)

Predictable patterns for all 9 page types:
- `/use-cases/{persona-slug}`, `/features/{feature-slug}`, `/compare/{competitor-slug}`, `/blog/{post-slug}`, `/launch/{campaign-slug}`
- Singleton pages: `/pricing`, `/community`, `/changelog`
- Slug conventions, index pages, and full Next.js App Router directory-to-route mapping

### Internal Linking Rules (Section 4)

- Funnel flow diagram showing page connections (Awareness → Interest → Evaluation → Action)
- Linking requirements per page type with example anchor text
- Cross-site linking rules (sales → docs, sales → GitHub)
- Orphan page prevention: every page reachable via both navigation and content links

### Page Inventory (Section 5)

- **Current state**: 1 existing page + 5 dead links identified
- **P0**: Homepage update when new pages ship
- **P1** (first wave, 8 pages): 3 use-cases, 3 features, 2 comparisons
- **P2** (second wave, 7 pages): 3 features, 1 comparison, pricing, community, changelog
- **P3** (ongoing): Blog posts, landing pages, index pages
- Dead link resolution plan for all 5 broken links in current nav

## Benefits

- Content project has a clear blueprint — no ad hoc page decisions
- URLs are predictable and permanent — no restructuring needed later
- Navigation is designed for conversion funnel progression
- Priority tiers tell the content team what to build first
- Dead links are documented with resolution paths

## Impact

- **Content team**: Has a complete page-by-page building guide with priorities
- **Developers**: Know the exact App Router structure and URL patterns before writing code
- **Subsequent phases**: Phase 3 (JSON files), Phase 4 (templates), and Phase 5 (component standards) can now reference specific pages and URL patterns

## Related Work

- Phase 1: `site/standards/website-standards.md` — master standards (defines the 9 page types this IA instantiates)
- Parallel model: `docs/standards/information-architecture.md` — docs IA (same structural approach adapted for marketing)
- Roles 007/008/009 — persona definitions, funnel mapping, and navigation guidance synthesized into this document

---

**Status**: ✅ Production Ready
**Timeline**: Single session
