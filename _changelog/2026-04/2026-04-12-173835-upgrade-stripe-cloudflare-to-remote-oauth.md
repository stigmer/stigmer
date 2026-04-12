# Upgrade Stripe and Cloudflare MCP Servers to Remote HTTP with OAuth

**Date**: April 12, 2026

## Summary

Upgraded the Stripe and Cloudflare MCP server marketplace entries from local stdio (npx subprocess) to remote HTTP with DCR-verified OAuth. Both endpoints were live-verified before any YAML changes — OAuth metadata, Dynamic Client Registration, and MCP endpoint connectivity all confirmed working.

## Problem Statement

Stripe and Cloudflare MCP servers were configured as stdio-based subprocesses, requiring users to install Node.js packages locally (`npx @stripe/mcp@latest`, `npx @cloudflare/mcp-server-cloudflare`). Both vendors have since shipped first-party remote HTTP MCP endpoints with full OAuth 2.1 support, making the stdio approach unnecessary overhead.

### Pain Points

- Users needed Node.js and npx installed to use these servers
- Stripe required a manually-generated secret API key (`STRIPE_SECRET_KEY`)
- Cloudflare required both an API token and account ID (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
- No automated credential acquisition — users had to copy-paste keys from vendor dashboards

## Solution

Converted both servers from stdio to remote HTTP transport with DCR-enabled OAuth, matching the established pattern used by Linear, PayPal, Datadog, and the other T01 servers.

## Implementation Details

### Stripe (`mcp-server-stripe.yaml`)

- Transport: `stdio` (npx subprocess) → `http` (`https://mcp.stripe.com/`)
- Auth: Manual `STRIPE_SECRET_KEY` → OAuth `STRIPE_ACCESS_TOKEN` with DCR via `access.stripe.com/mcp`
- Transport detail: Stripe uses Streamable HTTP (POST-only), not SSE

### Cloudflare (`mcp-server-cloudflare.yaml`)

- Transport: `stdio` (npx subprocess) → `http` (`https://mcp.cloudflare.com/mcp`)
- Auth: Manual `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` → OAuth `CLOUDFLARE_ACCESS_TOKEN` with DCR via `mcp.cloudflare.com/register`
- Repo: Updated from `cloudflare/mcp-server-cloudflare` to `cloudflare/mcp` (new first-party repo)

### Verification Performed

Both servers were live-verified before writing YAML:

| Check | Stripe | Cloudflare |
|-------|--------|------------|
| OAuth metadata | Valid (issuer: `access.stripe.com/mcp`) | Valid (issuer: `mcp.cloudflare.com`) |
| DCR registration | `client_id: oacli_UK0mcPsNuZQ7Lo` | `client_id: FmGtiNml5MeBSPq3` |
| MCP endpoint | 401 Unauthorized (alive) | 401 with WWW-Authenticate (alive) |

### Design Decisions

- **Single env var pattern**: Replaced old env vars with `*_ACCESS_TOKEN` instead of keeping both old and new. Avoids dead declarations that would confuse users.
- **Dropped `CLOUDFLARE_ACCOUNT_ID`**: The new remote endpoint handles account context through the OAuth flow.

## Benefits

- Zero local dependencies — no Node.js or npx required
- Automated credential acquisition via OAuth (one-click Connect)
- Consistent pattern across all 11 DCR-verified servers in the marketplace
- Reduced env var complexity (Cloudflare: 2 vars → 1 var)

## Impact

- **Users**: Stripe and Cloudflare MCP servers now support one-click OAuth Connect, same as PayPal, Linear, and the other T01 servers
- **Marketplace**: All high-value payment and cloud infrastructure servers now use the modern remote OAuth pattern
- **Codebase**: Both YAMLs structurally identical to the DCR reference pattern — zero special cases

## Related Work

- [Wave 1a: Nine DCR-Verified MCP Servers](2026-04-12-172021-wave-1a-nine-dcr-verified-mcp-servers.md) — T01 that established the DCR pattern
- Part of project `20260412.02.mcp-marketplace-oauth-expansion` (T02 of 6)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
