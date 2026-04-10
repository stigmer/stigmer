# Replace PT-Edge Quality Index with GitHub-based Quality Grading

**Date**: April 10, 2026

## Summary

Replaced the third-party PT-Edge MCP Quality Index dependency with a self-owned grading system that computes quality tiers directly from GitHub API signals. Removed the `subcategory` field from `McpServerSource` proto and reserved the field number for wire compatibility.

## Problem Statement

The MCP server sync workflow relied on the PT-Edge MCP Quality Index API (`mcp.phasetransitions.ai`) to score and filter servers. This introduced a dependency on a community project built by a single developer, with no SLA, no stability guarantees, and only two weeks of existence.

### Pain Points

- PT-Edge is a brand-new project (created March 2026) maintained by one person — high bus-factor risk
- No SLA or uptime guarantees — a free community API running on Render
- Scores based purely on GitHub metadata (stars, forks, commits) without actually probing MCP servers
- If the API went down, the fallback silently admitted all ~5,000 servers with no filtering
- The `subcategory` field was PT-Edge-specific with no value to the product

## Solution

Replace the external quality scoring API with a self-owned grading system that calls the GitHub REST API directly. GitHub's API is backed by Microsoft, has well-documented rate limits, and is the most stable developer API available.

The new approach:
- Fetches repository metadata directly from `GET /repos/{owner}/{repo}`
- Computes a composite score (0-100) from four signals: stars, push recency, license presence, and community (forks)
- Assigns two quality tiers: **verified** (A) and **established** (B) — no emerging or experimental tiers
- Filters per-page rather than pre-fetching a bulk quality map

## Implementation Details

### Proto changes

In `McpServerSource` message:
- Updated comments on `github_stars` (field 6), `quality_score` (field 7), and `quality_tier` (field 8) to reference GitHub API as the data source
- Removed `subcategory` (field 9) and reserved the field number and name for backward compatibility

### Grading formula

| Tier | Stars | Recency | License |
|------|-------|---------|---------|
| Verified (A) | >= 500 | Pushed within 90 days | Required |
| Established (B) | >= 50 | Pushed within 180 days | Not required |
| Excluded | < 50, archived, or stale > 365 days | — | — |

Composite score (0-100):
- Stars: 0-40 points (log-scaled, 10K stars ≈ 40 pts)
- Recency: 0-30 points (linear decay over 365 days)
- License: 0-15 points (present/absent)
- Community: 0-15 points (forks, log-scaled)

All thresholds are configurable via Spring Boot properties.

## Benefits

- **Zero external dependency** — no third-party API can take down the quality filter
- **Stable data source** — GitHub API backed by Microsoft with 5,000 req/hour authenticated rate limit
- **Transparent scoring** — the formula is in our code, not a black box
- **Safer failure mode** — if GitHub API fails for a repo, that repo is excluded (not admitted)
- **Simpler model** — two tiers instead of four, no PT-Edge-specific subcategory

## Impact

- **Proto**: `McpServerSource` field 9 (`subcategory`) removed; field numbers 6-8 retain same wire format
- **Stubs**: All language stubs (Java, Go, TypeScript, Python) regenerated
- **Backend**: Sync workflow now fetches GitHub metrics per-page instead of bulk-fetching a quality index
- **Ops**: New `TEMPORAL_MCP_SERVER_SYNC_GITHUB_TOKEN` environment variable required

## Related Work

- `2026-04-10-125723-fix-mcp-server-duplicate-creation-and-quality-filter.md` — the previous change that introduced PT-Edge (now replaced)
- `cd04f028` — original commit adding quality score fields to proto

---

**Status**: ✅ Production Ready
