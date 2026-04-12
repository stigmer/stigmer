# T06+T03: DCR Verification and Marketplace Expansion to 53 Servers

**Date**: April 12, 2026

## Summary

Verified DCR (Dynamic Client Registration) support across 13 MCP server endpoints, added 5 new DCR-confirmed servers to the marketplace, confirmed 2 existing servers (Atlassian, GitLab) were correctly configured, and conducted a full trust audit that identified 3 servers to remove and 9 missing repository URLs to fix. The marketplace now stands at 53 servers, all verified as first-party vendor-operated with either public repos or official documentation.

## Problem Statement

The marketplace had grown from 36 to 48 servers across previous sessions, but two issues needed addressing:

### Pain Points

- Atlassian and GitLab were configured with DCR-implied auth blocks, but external sources (awesome-remote-mcp-servers) listed Atlassian as "no DCR" — potentially silently broken for users
- 11 new server candidates from T03 had unverified DCR status from initial research
- No systematic quality audit had been performed on the servers added during the expansion project

## Solution

Combined T06 (audit) and T03 (verify + add) into a single batch verification pass: curl all 13 OAuth discovery endpoints, test DCR registration, triage results, then act. Followed up with a comprehensive trust audit of all servers in the marketplace.

## Implementation Details

### Phase 1: Batch DCR Verification

Fetched `/.well-known/oauth-authorization-server` for all 13 servers and tested DCR POST registration for each that returned a `registration_endpoint`.

**T06 Audit Results:**
- Atlassian: DCR confirmed (`client_id: VPpg6WfDS0y7YJwt`). Discovery at root path, not `/v1/`. The awesome-remote-mcp-servers "no DCR" listing is incorrect.
- GitLab: DCR confirmed (`client_id: 0f0beab...`). Supports MCP-specific scopes (`mcp`, `mcp_orbit`).

**T03 Verification Results (8 confirmed, 3 deferred):**
- DCR confirmed: Wix, Canva, Netlify, Ramp, Prisma, Cloudinary, Egnyte, Port IO
- Dropbox: has OAuth metadata but blocks DCR ("only pre-registered partners") — moved to T04
- Stack Overflow: 404 on well-known — no OAuth support
- Grafbase: Vercel deployment removed — service is down

### Phase 2: Quality Audit

Post-verification audit revealed significant gaps:

**3 servers removed:**
- Port IO: GitHub repo (`port-labs/port-mcp-server`) archived Feb 2026. Remote server is the recommended replacement but has no public source.
- Egnyte: Repo (`egnyte/egnyte-mcp-server`) last pushed June 2025 (10 months stale). Uncertain relationship between repo and remote server.
- Ramp: No npm package; Python/uv-only; remote endpoint at `ramp-mcp-remote.ramp.com` not officially documented. PulseMCP classifies as "community."

**9 missing repository URLs fixed:**
- Cloudinary: `cloudinary/mcp-servers` (8 stars) + endpoint corrected from `/sse` to `/mcp`
- Wix: `wix/wix-mcp` (10 stars) + endpoint corrected from `/sse` to `/mcp`
- PayPal: `paypal/paypal-mcp-server` (9 stars)
- Square: `square/square-mcp-server` (95 stars)
- Intercom: `intercom/intercom-mcp-server` (5 stars)
- monday.com: `mondaycom/mcp` (387 stars)
- Buildkite: `buildkite/buildkite-mcp-server` (49 stars)
- Webflow: `webflow/mcp-server` (113 stars)
- PagerDuty: `PagerDuty/pagerduty-mcp-server` (58 stars)

### Key Discovery: Dropbox Protected Resource Metadata

Dropbox implements the RFC 8707 Protected Resource Metadata pattern. The MCP endpoint returns `WWW-Authenticate` with a `resource_metadata` URL pointing to `www.dropbox.com` as the authorization server. Direct `/.well-known/oauth-authorization-server` at `mcp.dropbox.com` returns 429.

## Benefits

- All 53 marketplace servers now verified as first-party vendor-operated
- 43 servers have public repos linked; 10 have official vendor docs confirming legitimacy
- No archived, deprecated, or community-maintained remote servers in the marketplace
- Atlassian/GitLab DCR uncertainty resolved — both work correctly

## Impact

- **Marketplace count**: 48 → 53 servers (net +5 after 8 added and 3 removed)
- **Trust posture**: Zero high-risk servers; every server is vendor-first-party
- **Data quality**: `repository_url` populated for all servers that have public repos

## Related Work

- Previous session: T05 Marketplace Expansion (`2026-04-12-183709`)
- Previous session: Stripe/Cloudflare OAuth upgrade (`2026-04-12-173835`)
- Next: T04 vendor OAuth registration (manual OAuthApp setup)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (verification + audit + fixes)
