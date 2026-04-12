# T05 Expanded: Marketplace Expansion, discovery_url Proto, GitHub & Google Calendar Vendor OAuth

**Date**: April 12, 2026

## Summary

Added 3 new API-key HTTP servers (HubSpot, Brevo, PagerDuty) to the marketplace, introduced the `discovery_url` proto field on `McpServerAuth` to enable DCR for stdio servers, and added vendor OAuth for GitHub and Google Calendar as the first stdio servers with `auth` blocks. Changes span both stigmer (OSS) and stigmer-cloud repos.

## Problem Statement

The marketplace needed more server integrations, and the auth model had an implicit limitation: DCR (Dynamic Client Registration) was only possible for HTTP servers because the OAuth discovery URL was derived from `http.url`. Stdio servers had no path to DCR. Additionally, stdio servers could not benefit from OAuth Connect at all — users had to manually create and paste credentials.

### Pain Points

- Marketplace coverage gaps in CRM, email marketing, and incident management
- Stdio servers forced users into manual credential management with no "Connect" button
- DCR architecturally blocked for stdio transport (no URL to discover from)
- GitHub MCP server required manual PAT creation despite having a registered OAuth app
- Google Calendar required downloading a JSON credentials file — poor UX

## Solution

Four-part expansion: (1) API-key HTTP servers for immediate marketplace growth, (2) `discovery_url` proto field for future stdio DCR, (3) GitHub vendor OAuth on stdio, (4) Google Calendar vendor OAuth on stdio.

## Implementation Details

### Part 1: Proto Enhancement — `discovery_url`

Added field 7 to `McpServerAuth` in `spec.proto`:

```protobuf
string discovery_url = 7;
```

Resolution priority: `discovery_url` > `http.url`. Ignored when `oauth_app_ref` is set. Updated both Go (`initiate_oauth_connect.go`) and Java (`McpServerInitiateOAuthConnectHandler.java`) DCR paths to use the new field.

### Part 2: API-Key HTTP Servers (3 new)

| Server | Endpoint | Category | Auth |
|--------|----------|----------|------|
| HubSpot | `app.hubspot.com/mcp/v1/http` | crm-support | Bearer token |
| Brevo | `mcp.brevo.com/v1/brevo/mcp` | communication | Bearer token |
| PagerDuty | `mcp.pagerduty.com/mcp` | monitoring | Token (PagerDuty convention) |

Endpoint verification revealed HubSpot and PagerDuty both support OAuth (without DCR). Added as API-key-only for now; flagged for vendor OAuth upgrade in T04.

### Part 3: GitHub Vendor OAuth (stdio)

- Reused existing GitHub OAuth App credentials (duplicated into vendor-oauth pipeline)
- New Mongock migration `U20260412c` (order 017) seeds OAuthApp resource
- Updated `mcp-server-github.yaml`: added `auth` block with `oauth_app_ref: github-oauth`, kept stdio transport
- Scopes: `repo`, `read:org`, `read:user`

### Part 4: Google Calendar Vendor OAuth (stdio)

- New Google Cloud OAuth client created with Calendar API scope
- Same migration seeds both GitHub and Google Calendar OAuthApps
- Updated `mcp-server-google-calendar.yaml`: added `auth` block with `oauth_app_ref: google-calendar-oauth`, kept stdio transport
- Scope: `https://www.googleapis.com/auth/calendar` (sensitive, pending Google verification)

### Cloud Infrastructure (stigmer-cloud)

- `vendor-oauth-config.yaml`: Added GitHub + Google Calendar client IDs
- `vendor-oauth-credentials.yaml`: Added GitHub + Google Calendar client secrets
- `service.yaml` (Kustomize): 4 new env var mappings
- `application.yaml`: 2 new vendor-oauth entries
- `VendorOAuthBootstrapConfig.java`: 2 new `VendorCredentials` fields

## Benefits

- Marketplace expanded from 45 to 48 servers (HubSpot, Brevo, PagerDuty)
- GitHub and Google Calendar users get OAuth "Connect" button instead of manual credential management
- First proof that vendor OAuth works on stdio servers — validates the architecture
- `discovery_url` future-proofs the platform for stdio DCR as vendors adopt the MCP Authorization spec
- HubSpot and PagerDuty OAuth discovery documented for future T04 upgrade

## Impact

- **Users**: 3 new MCP servers available; GitHub and Google Calendar now have one-click OAuth Connect
- **Architecture**: Stdio + OAuth proven viable; `discovery_url` removes the HTTP-only DCR limitation
- **Platform**: Marketplace count at 48 servers; 2 more stdio servers with OAuth Connect

## Related Work

- T01: Wave-1a DCR servers (PayPal, Square, Intercom, etc.)
- T02: Stripe + Cloudflare remote OAuth upgrade
- T04: Vendor OAuth servers (HubSpot and PagerDuty now candidates)
- U20260411_SeedVendorOAuthApps: Original vendor OAuth bootstrap (Slack, Figma, Salesforce)

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
