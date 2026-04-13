# Self-Host Brand Icons for MCP Servers and Agents

**Date**: April 13, 2026

## Summary

Downloaded and self-hosted 58 SVG brand icons for all seedpack MCP servers and agents, replacing unreliable external CDN references with stable `raw.githubusercontent.com` URLs served directly from the repository. Agents now have distinctive per-role icons instead of the generic Stigmer favicon.

## Problem Statement

MCP server and agent cards in the Library were rendering without icons for many popular services, degrading the perceived quality of the product.

### Pain Points

- `cdn.simpleicons.org` URLs required JavaScript/Cloudflare challenge, making them unreliable as `<img>` sources
- Several services (Neon, Exa, Tavily) returned HTTP 404 from Simple Icons — they were never in that icon set
- Newer brands (Twilio, Slack, Canva, Playwright) were only available in unreleased Simple Icons versions
- All 10 agents shared the same generic Stigmer favicon, offering no visual differentiation

## Solution

Vendor every icon as an SVG file inside `seedpack/icons/` and point each YAML `icon_url` at its `raw.githubusercontent.com` counterpart. This eliminates third-party CDN dependencies and ensures icons are always available once the commit reaches `main`.

## Implementation Details

### Icon Sources

| Source | Count | Brands |
|--------|-------|--------|
| Simple Icons GitHub (develop branch) | 33 | Redis, MongoDB, MySQL, Kubernetes, PostgreSQL, Stripe, Cloudflare, etc. |
| jsDelivr npm CDN (latest release) | 4 | Twilio, Slack, Canva, Playwright |
| LobeHub icon CDN | 2 | Exa, Tavily |
| Official brand assets / logotyp.us | 3 | Neon, Attio, Monday.com |
| Lucide icons (MIT) | 10 | Agent role icons |

### Color Handling

- Simple Icons SVGs ship with no fill (default black, invisible on dark backgrounds) — brand hex colors were applied from the Simple Icons data file
- Brands with near-black brand colors (GitHub, Notion, Prisma, Resend, Square) were set to `#FFFFFF` for dark-background visibility
- Neon's official SVG includes CSS `prefers-color-scheme` media queries — kept as-is
- Lucide agent icons use `stroke` — set to `#E0E0E0` for universal readability

### Agent Icon Mapping

| Agent | Lucide Icon | Rationale |
|-------|------------|-----------|
| assistant | bot-message-square | Chat / AI assistant |
| agent-creator | wand-sparkles | Creation / magic |
| code-review-agent | scan-search | Code inspection |
| data-analyst-agent | chart-column-big | Data visualization |
| docs-agent | book-open-text | Documentation |
| mcp-server-creator | server-cog | Server configuration |
| research-agent | telescope | Discovery / research |
| skill-creator | sparkles | Capabilities |
| slack-agent | Slack brand mark | Platform identity |
| support-agent | headset | Customer support |

### Files

- **58 new SVGs** in `seedpack/icons/mcp-servers/` (48) and `seedpack/icons/agents/` (10)
- **48 MCP server YAMLs** updated (`icon_url` changed)
- **10 agent YAMLs** updated (`icon_url` changed)
- **3 MCP servers unchanged** — Stigmer, Sequential Thinking (own favicon), AWS trio (Wikimedia SVG)

## Benefits

- **100% icon availability** — no runtime dependency on third-party CDNs
- **Instant loads** — GitHub raw content is served via Fastly CDN with aggressive caching
- **Visual identity for agents** — each agent role is now immediately recognizable
- **Maintainability** — adding a new icon is just dropping an SVG and updating one YAML line

## Impact

Every user browsing the MCP Server Library or Agent Library will now see branded, colorful icons for all 48+ services and 10 agents, significantly improving the first impression and perceived polish of the platform.

## Related Work

- Library card grid layout improvements (2026-04-13)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
