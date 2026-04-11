# Vendor OAuth Bootstrap Migration: Slack, Figma, Salesforce

**Date**: April 11, 2026

## Summary

Registered OAuth apps with Slack, Figma, and Salesforce (all free tier), created a Mongock migration to seed OAuthApp resources into MongoDB with encrypted credentials and FGA authorization tuples, and wired the credentials through planton service-hub secrets/variables groups into the Spring Boot service via Kustomize. Updated seedpack YAMLs to reference these vendor OAuth apps via `oauth_app_ref`.

## Problem Statement

The MCP OAuth Connect flow (T01-T04) supports two authentication modes: DCR+PKCE for MCP-spec-compliant servers and vendor OAuth for servers that require pre-registered app credentials. While the backend infrastructure was complete, the vendor OAuth path had no actual OAuth app registrations or bootstrap data — Slack, Figma, and Salesforce MCP servers were configured for manual credential entry only.

### Pain Points

- Users had to manually obtain and enter OAuth tokens for Slack, Figma, and Salesforce
- No OAuthApp resources existed in the stigmer org for vendor OAuth servers
- No mechanism to inject vendor OAuth credentials into the cloud deployment
- Seedpack YAMLs lacked `auth` blocks with `oauth_app_ref` for vendor OAuth servers

## Solution

End-to-end vendor OAuth bootstrap: register apps with vendors, store credentials in planton service-hub, inject via Kustomize env vars, seed OAuthApp resources via Mongock migration with FGA tuples, and update seedpack YAMLs.

## Implementation Details

### Vendor Registration (all free)

| Vendor | Auth URL | Token URL | Scopes | PKCE |
|--------|----------|-----------|--------|------|
| Slack | `slack.com/oauth/v2/authorize` | `slack.com/api/oauth.v2.access` | channels:read, chat:write, users:read, search:read | Yes |
| Figma | `figma.com/oauth` | `figma.com/api/oauth/token` | file_content:read, file_metadata:read, file_comments:read | No |
| Salesforce | `login.salesforce.com/services/oauth2/authorize` | `login.salesforce.com/services/oauth2/token` | api, refresh_token, offline_access | Yes |

Stripe excluded — uses API keys, not OAuth.

### Credential Pipeline (stigmer-cloud)

- **SecretsGroup**: `vendor-oauth-credentials.yaml` (3 client secrets)
- **VariablesGroup**: `vendor-oauth-config.yaml` (3 client IDs)
- **Kustomize**: 6 env var mappings in `service.yaml` (3 variables + 3 secrets)
- **Spring**: `stigmer.vendor-oauth.*` properties in `application.yaml`
- **Config class**: `VendorOAuthBootstrapConfig.java` with `isConfigured()` per vendor

### Migration: U20260411_SeedVendorOAuthApps (stigmer-cloud)

- Mongock `@ChangeUnit(order = "013")`, runs after bootstrap accounts (order 002)
- For each vendor with configured credentials:
  - Encrypts client_secret via `SecretEncryptionService`
  - Inserts `OAuthApp` document into `oauth_app` collection
  - Creates two FGA tuples: org link + owner (matching `createSteps.createAuthorizationTuples`)
  - Inserts corresponding `IamPolicy` MongoDB documents
- Gracefully skips vendors without credentials
- Idempotent — skips existing OAuthApps by org+slug
- Full rollback support

### Seedpack YAML Updates (stigmer)

- `mcp-server-slack.yaml`: Added `auth` block with `oauth_app_ref: slack-oauth`
- `mcp-server-figma.yaml`: Added `auth` block with `oauth_app_ref: figma-oauth`
- `mcp-server-salesforce.yaml`: Added `env_spec` + `auth` block with `oauth_app_ref: salesforce-oauth`

## Benefits

- One-click OAuth Connect for Slack, Figma, and Salesforce MCP servers
- Credentials managed through existing planton infrastructure (same pattern as Auth0, GitHub)
- Migration runs automatically on deployment — no manual OAuthApp creation needed
- Incremental rollout: vendors with empty credentials are silently skipped

## Impact

- **Users**: Can connect Slack, Figma, Salesforce MCP servers via OAuth instead of manual token entry
- **Operators**: Vendor credentials managed through planton service-hub (familiar workflow)
- **Platform**: Completes the vendor OAuth path of the MCP OAuth Connect feature (T01-T04)

## Related Work

- T01-T04: MCP OAuth Connect project (`_projects/2026-04/20260410.03.mcp-oauth-connect/`)
- OAuthApp proto definitions and handlers (T01-T02)
- Backend OAuth infrastructure and Connect flow (T03)
- React SDK OAuth Connect UI (T04)

---

**Status**: Production Ready
**Timeline**: 1 session
