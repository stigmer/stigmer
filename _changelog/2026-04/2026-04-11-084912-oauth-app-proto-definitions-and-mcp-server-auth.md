# OAuthApp Proto Definitions & MCP Server Auth Configuration

**Date**: April 11, 2026

## Summary

Defined all proto types for the OAuth-based MCP server authentication feature: the OAuthApp first-class resource in the IAM bounded context, the McpServerAuth configuration block on McpServerSpec, and the OAuthGrant infrastructure proto. Regenerated stubs across Go, Java, Python, and TypeScript.

## Problem Statement

Stigmer's curated MCP marketplace includes 13 servers (GitLab, Linear, Slack, Salesforce, Figma, etc.) that support OAuth-based credential acquisition. Currently, users must manually obtain and paste API tokens. There was no proto-level foundation to model OAuth app registrations, declare OAuth capabilities on MCP servers, or track OAuth grant metadata for token refresh.

### Pain Points

- No way to represent a vendor OAuth app registration (client_id, client_secret, endpoints) as a managed resource
- McpServerSpec had no mechanism to declare that a server supports automated credential acquisition via OAuth
- No infrastructure schema for tracking OAuth grant metadata (expiry, refresh endpoints) needed by the pre-flight token refresh mechanism

## Solution

Introduced three proto-level concepts following existing platform patterns:

1. **OAuthApp** -- a new first-class resource in the `iam` bounded context (analogous to IdentityProvider for inbound auth). Represents Stigmer's outbound OAuth registration with an external vendor.
2. **McpServerAuth** -- a new configuration block on McpServerSpec with a `oneof` between `mcp_oauth` (DCR + PKCE, auto-discovered) and `vendor_oauth` (references an OAuthApp).
3. **OAuthGrant** -- an infrastructure-only proto (not a public resource) tracking non-secret OAuth metadata per (user, mcp_server) for pre-flight expiry checks and token refresh.

## Implementation Details

### New Resource: OAuthApp (`apis/ai/stigmer/iam/oauthapp/v1/`)

Five proto files following the IdentityProvider pattern exactly:

- **spec.proto**: `OAuthAppSpec` with provider, client_id, client_secret, authorization_url, token_url, scopes, userinfo_url. `redirect_uri` intentionally omitted -- the platform derives its callback URL from server config.
- **api.proto**: Standard resource envelope (`apiVersion: iam.stigmer.ai/v1`, `kind: OAuthApp`).
- **io.proto**: `OAuthAppId`, `OAuthApps` list wrapper, `ListOAuthAppsByOrgInput`.
- **command.proto**: `OAuthAppCommandController` with apply, create, update, delete RPCs. No `updateVisibility` -- OAuthApp is always org-private since it holds secrets.
- **query.proto**: `OAuthAppQueryController` with get, getByReference, listByOrg RPCs.

### Type System Registration

- `ApiResourceKind` enum: `oauth_app = 22` with kind metadata (group: iam, id_prefix: "oapp", cloud_only, org-scoped, grantable_roles: [owner, viewer])
- `IamPermission` enum: `can_create_oauth_app = 23`

### McpServerSpec Extension (`apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`)

Three new messages added to the existing file:

- `McpServerAuth`: oneof `method` (required) with `mcp_oauth` or `vendor_oauth`, plus `target_env_var` and `token_lifetime_hint`
- `McpOAuth`: For MCP Authorization spec servers (DCR + PKCE). Contains optional `scope_hints`.
- `McpServerVendorOAuth`: References an `ApiResourceReference` to an OAuthApp resource.

New field `auth = 14` on `McpServerSpec` (optional).

### OAuthGrant Infrastructure Proto (`apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto`)

Infrastructure-only message (no kind, no apiVersion, no CRUD RPCs) with fields for identity_account_id, mcp_server_id, access_token_expires_at, client_id, auth_method, token_endpoint, env var names, and environment_id.

## Benefits

- **Foundation for 13 OAuth-enabled MCP servers**: Proto types are ready for handler implementation, seedpack YAML auth blocks, and the Connect flow
- **Clean domain boundaries**: OAuthApp in IAM (outbound auth), McpServerAuth on the blueprint (capabilities), OAuthGrant as infrastructure (runtime metadata)
- **No breaking changes**: All additions are backward-compatible -- existing McpServer resources continue to work without an auth block
- **Full stub coverage**: Generated code available in Go, Java, Python, and TypeScript for immediate use by all service layers

## Impact

- **apis/**: 7 new proto files, 2 modified protos, regenerated stubs across 4 languages
- **sdk/**: Go, Java, Python, TypeScript SDKs updated with OAuthApp client code and McpServer auth types
- **mcp-server/**: Generated Go proto stubs and MCP server codegen updated
- **docs/**: SDK resource docs updated with OAuthApp and McpServer auth sections
- **tools/codegen/**: JSON schemas updated for OAuthApp resource and McpServer auth types

## Related Work

- **T01 plan**: `_projects/2026-04/20260410.03.mcp-oauth-connect/tasks/T01_0_plan.md`
- **Curated marketplace project**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/` (established the 37-server seedpack)
- **Personal environment design**: `_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/001-personal-environment-pattern.md`

---

**Status**: Production Ready
**Timeline**: T01 of 5-task feature (MCP OAuth Connect)
