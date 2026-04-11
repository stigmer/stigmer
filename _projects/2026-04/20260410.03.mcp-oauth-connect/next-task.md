# Next Task: 20260410.03.mcp-oauth-connect

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.03.mcp-oauth-connect

**Description**: Implement OAuth-based MCP server authentication across Stigmer, supporting MCP OAuth spec (DCR+PKCE) for 9 servers and vendor OAuth for 4 servers, with automatic token refresh.
**Goal**: Enable one-click OAuth Connect for 13 MCP servers, store tokens in personal environment, refresh tokens automatically before execution.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), Python/LangGraph (agent-runner), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-10
**Status**: T01 COMPLETE -- Proto definitions implemented
**Active Task**: T02 -- OAuthApp Handlers + Seedpack YAMLs
**Last Session**: 2026-04-11

## Session Progress (2026-04-11)

### T01: Proto Definitions -- COMPLETE
- Registered `oauth_app` (enum value 22) in `ApiResourceKind` with full kind metadata
- Added `can_create_oauth_app` (enum value 23) to `IamPermission`
- Created 5 OAuthApp resource protos in `apis/ai/stigmer/iam/oauthapp/v1/` (spec, api, io, command, query) following the IdentityProvider pattern exactly
- Added `McpServerAuth`, `McpOAuth`, `McpServerVendorOAuth` messages to `McpServerSpec` with `auth = 14` field
- Created `OAuthGrant` infrastructure proto in `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto`
- `buf lint` and `buf build` pass clean
- All stubs regenerated (Go, Java, Python, TypeScript) via `make build`

### Design Decisions Made During Implementation
- **`redirect_uri` dropped** from `OAuthAppSpec` -- the platform derives its OAuth callback URL from server config, not per-app settings
- **OAuthApp is always org-private** -- no `supports_public`, no `updateVisibility` RPC (matches IdentityProvider pattern)
- **`userinfo_url` added** to `OAuthAppSpec` (field 7) -- optional OIDC userinfo endpoint for fetching display name/avatar after token acquisition

## Next Steps

1. **T02: OAuthApp Handlers + Seedpack YAMLs** (3-4 days)
   - OAuthApp Go handlers (CRUD, FGA model, repository, validation)
   - Switch 5 servers stdio -> HTTP
   - Add auth blocks to 13 servers
   - Improve descriptions for manual servers
2. **T03**: Backend OAuth Client + Connect Flow + Token Refresh
3. **T04**: UI Updates + Token Lifecycle
4. **T05**: End-to-End Testing

## Key Design Decisions

### Domain Model
- **OAuthApp**: First-class resource in `iam` bounded context (like IdentityProvider). Holds vendor OAuth client credentials (client_id, client_secret, URLs, scopes). Org-scoped.
- **McpServerAuth**: `oneof` with `mcp_oauth` (DCR, inline, no OAuthApp) and `vendor_oauth` (reference to OAuthApp).
- **OAuthGrant**: Infrastructure-only (not a public resource). Per (user, mcp_server). Stores non-secret metadata: expiry, client_id, token_endpoint, env var names.
- **DCR stays inline on McpServer**: DCR is a capability, not pre-existing config. OAuthApp with empty credentials would be anemic.

### Token Storage
- **Access token**: Environment resource as `target_env_var` (e.g., `SLACK_ACCESS_TOKEN`). Secret, encrypted.
- **Refresh token**: Same Environment as `{target_env_var}_REFRESH_TOKEN` (convention). Secret, encrypted.
- **Default**: personal environment (stigmer.ai/personal=true). But OAuthGrant tracks which Environment was used via `environment_id`, allowing future flexibility for team/project environments.
- **Non-secret metadata**: OAuthGrant DB record (expiry, client_id, token_endpoint, environment_id).
- All secrets in the Environment resource with consistent encryption and access control.

### Token Lifecycle (Refresh Token as Primary Mechanism)
- **Pre-flight check**: Before execution, check OAuthGrant expiry. If expired, use refresh token to get new access token. Update personal env. Execution starts with fresh token.
- **Clean failure**: If refresh token itself is expired, execution fails with clear error. User re-authenticates from Connect page. No mid-execution interrupt.
- **No EXECUTION_WAITING_FOR_REAUTH**: Dropped the interrupt-based re-auth. Refresh tokens handle 95% of cases. Can be added later if needed.

### Server Classification
- 9 DCR + PKCE: GitLab, Linear, Atlassian, Notion, Sentry, Neon, Tavily, Supabase, Cloudflare
- 4 vendor OAuth: Slack, Stripe, Figma (restricted), Salesforce
- 5 servers need transport switch from stdio to HTTP
- 16 manual only, 7 no auth

### Flat Environment Limitation
- Personal env is a flat key-value map (one value per key)
- Two MCP servers with the same env var name share the same token
- Acceptable: different vendors naturally use different names; platform builders control their own names
- Not solving per-server isolation -- simple naming convention handles it

## Task Breakdown (5 tasks)

### T01: Proto Definitions -- COMPLETE
**Repo**: stigmer
**Scope**: OAuthApp resource (iam context: api, spec, io, command, query protos), McpServerAuth on McpServerSpec (McpOAuth, McpServerVendorOAuth), OAuthGrant infrastructure proto, stub regeneration
**Effort**: 1.5-2 days

### T02: OAuthApp Handlers + Seedpack YAMLs
**Repos**: stigmer
**Scope**: OAuthApp Go handlers (CRUD, FGA model, repository, validation). Switch 5 servers stdio->HTTP. Add auth blocks to 13 servers. Improve descriptions for manual servers.
**Effort**: 3-4 days

### T03: Backend OAuth Client + Connect Flow + Token Refresh
**Repos**: stigmer
**Scope**: MCP OAuth discovery (.well-known), DCR, PKCE auth code flow, callback endpoint, token storage (personal env + OAuthGrant), OAuth-aware Connect handler, pre-flight token expiry check, refresh logic.
**Effort**: 4-5 days

### T04: UI Updates + Token Lifecycle
**Repos**: stigmer (SDK/React)
**Scope**: Connect flow: "Sign in with {vendor}" for OAuth servers, handle OAuth redirect/popup. Connection status indicators (connected/expired/not connected). Lazy refresh in Connect flow. OAuthApp management UI (if needed).
**Effort**: 3-4 days

### T05: End-to-End Testing
**Repos**: stigmer + stigmer-cloud
**Scope**: Real OAuth flow against a DCR server (GitLab or Linear). Vendor OAuth with OAuthApp. Token refresh cycle. Pre-flight expiry check. Validate all 37 seedpack YAMLs.
**Effort**: 2-3 days

## Key Files

| Area | Path |
|------|------|
| OAuthApp protos (NEW) | `apis/ai/stigmer/iam/oauthapp/v1/` |
| OAuthGrant proto (NEW) | `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` |
| McpServer spec proto (MODIFIED) | `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` |
| ApiResourceKind enum (MODIFIED) | `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` |
| IamPermission enum (MODIFIED) | `apis/ai/stigmer/iam/v1/enum.proto` |
| Environment spec proto | `apis/ai/stigmer/agentic/environment/v1/spec.proto` |
| IdentityProvider (reference pattern) | `apis/ai/stigmer/iam/identityprovider/v1/` |
| Connect handler (Go) | `backend/services/stigmer-server/pkg/domain/mcpserver/controller/connect.go` |
| Personal env resolution | `backend/services/stigmer-server/pkg/domain/mcpserver/controller/connect.go` (`resolveFromPersonalEnvironment`) |
| Execution context creation | `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create_execution_context_step.go` |
| React Connect UI | `sdk/react/src/mcp-server/McpServerDetailView.tsx` |
| Personal env hook | `sdk/react/src/environment/usePersonalEnvironment.ts` |
| Seedpack servers | `seedpack/mcp-servers/` |

## Key References

- **MCP Auth Spec**: OAuth 2.1 + PKCE + DCR (2025-03-26 revision)
- **Previous project (curated marketplace)**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/`
- **Personal env design**: `_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/001-personal-environment-pattern.md`

---

*Drop this file into a new conversation to resume work on this project.*
