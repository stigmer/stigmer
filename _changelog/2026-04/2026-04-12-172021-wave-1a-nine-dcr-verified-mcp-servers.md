# Wave 1a: Nine DCR-Verified MCP Servers Added to Marketplace

**Date**: April 12, 2026

## Summary

Added 9 new remote MCP server definitions with verified OAuth DCR support to the Stigmer marketplace, expanding the catalog from 36 to 45 servers. All new entries use the auto-discovery auth pattern (no pre-registered OAuthApp required), enabling one-click OAuth connect for end users.

## Problem Statement

The Stigmer MCP marketplace had 36 curated servers but was underrepresented in key categories — payments had only Stripe, monitoring had only Sentry, and CRM/support had only Atlassian. Users integrating with widely-used platforms like PayPal, Datadog, monday.com, or Intercom had no marketplace entry and had to configure MCP connections manually.

### Pain Points

- Payments category limited to a single vendor (Stripe, stdio-only)
- No monitoring alternative beyond Sentry
- CRM/support category had only Atlassian — missing popular platforms like Intercom and emerging ones like Attio
- Productivity category had only Notion — missing monday.com
- Developer tools and design categories missing CI/CD (Buildkite), headless CMS (Contentful), and website builders (Webflow)

## Solution

Created 9 new `McpServer` YAML definitions following the established DCR auth pattern (`auth.target_env_var` only, no `oauth_app_ref`), matching the Linear/Notion template exactly. Each server was verified to have a `registration_endpoint` in its OAuth authorization server metadata, meaning Stigmer auto-discovers and registers via DCR at connect time.

## Implementation Details

All 9 servers follow the identical structure — `HttpServerConfig` with `Authorization: Bearer` header, a single secret env var, and `auth.target_env_var` with `token_lifetime_hint: "1h"`.

### New servers by category

**Payments** (2):
- `mcp-server-paypal` — PayPal payment processing, invoicing, transactions (`mcp.paypal.com/sse`)
- `mcp-server-square` — Square POS, payments, inventory, orders (`mcp.squareup.com/sse`)

**CRM & Support** (2):
- `mcp-server-intercom` — Intercom customer messaging, support tickets, help center (`mcp.intercom.com/sse`)
- `mcp-server-attio` — Attio CRM, contacts, deals, sales pipeline (`mcp.attio.com/mcp`)

**Productivity** (1):
- `mcp-server-monday` — monday.com boards, items, workflow automation (`mcp.monday.com/sse`)

**Developer Tools** (2):
- `mcp-server-contentful` — Contentful headless CMS, entries, assets, content models (`mcp.contentful.com/mcp`)
- `mcp-server-buildkite` — Buildkite CI/CD pipelines, builds, agents (`mcp.buildkite.com/mcp`)

**Design** (1):
- `mcp-server-webflow` — Webflow site management, CMS, design, publishing (`mcp.webflow.com/sse`)

**Monitoring** (1):
- `mcp-server-datadog` — Datadog infrastructure monitoring, logs, APM, dashboards (`mcp.datadoghq.com`)

### Design decisions

- **Buildkite scope_hints omitted**: The task spec suggested `["read", "write"]` but these are too generic to be informative. Omitted to stay consistent with other DCR servers (Linear, Notion, etc.) which have no scope_hints.
- **Webflow categorized as `design`**: Webflow straddles developer-tools and design; `design` was chosen to group it with Figma as a visual builder rather than with Git/GitHub.
- **Datadog URL kept as-is**: The endpoint path includes `/api/unstable/` which is Datadog's API versioning convention, not a stability concern. Datadog is a trusted vendor with a production MCP offering.
- **Datadog `toolsets=core` baked into URL**: The proto supports a `query_params` field, but no existing server uses it. Kept in URL for consistency; can migrate to `query_params` later if the pattern is adopted.

## Benefits

- Marketplace grows from 36 to 45 servers (25% increase)
- Five categories gain new entries, improving breadth across the platform
- All 9 servers support one-click OAuth connect via DCR — no manual credential setup required
- Zero new patterns introduced — pure additive change following established conventions

## Impact

- **End users**: Can now connect PayPal, Square, Intercom, Attio, monday.com, Contentful, Buildkite, Webflow, and Datadog with a single OAuth click
- **Marketplace**: Broader category coverage makes the platform more compelling for new users evaluating Stigmer
- **Maintainers**: No new patterns or infrastructure — all 9 files are structurally identical to existing DCR entries

## Related Work

- Part of project `20260412.02.mcp-marketplace-oauth-expansion` (Wave 1a of 6 waves)
- Follows the curated marketplace established in `2026-04-10-164734-curated-mcp-marketplace-36-servers.md`
- Builds on the OAuth auth infrastructure from `2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md`
- Next waves: T02 (Stripe/Cloudflare upgrade), T03 (unverified DCR), T04 (vendor OAuth), T05 (API-key-only), T06 (audit)

---

**Status**: Production Ready
**Timeline**: ~1 hour
