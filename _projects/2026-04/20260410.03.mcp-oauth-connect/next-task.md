# Next Task: 20260410.03.mcp-oauth-connect

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.03.mcp-oauth-connect

**Description**: Implement OAuth-based MCP server authentication across Stigmer, supporting MCP OAuth spec (DCR+PKCE) for 9 servers and vendor OAuth for 4 servers, with automatic token refresh.
**Goal**: Enable one-click OAuth Connect for 13 MCP servers, store tokens in personal environment, refresh tokens automatically before execution.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), Python/LangGraph (agent-runner), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-10
**Status**: T02 COMPLETE -- OAuthApp handlers in both Java (Cloud) and Go (OSS)
**Active Task**: T03 -- Backend OAuth Client + Connect Flow + Token Refresh
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
- **Post-T01 refactor**: Flattened `McpServerAuth` -- removed oneof wrapper, `oauth_app_ref` presence/absence is the discriminator

### T02: Java Handlers + Seedpack YAMLs -- COMPLETE

#### Shared Encryption Library (stigmer-cloud)
- Extracted `SecretEncryptionService` + `EncryptionConfig` to `backend/libs/java/infra/encryption/`
- Refactored `EnvironmentSecretService` to thin delegate over shared service
- Deleted old `EncryptionConfig` from `ai.stigmer.config.encryption`
- Updated `stigmer-service` BUILD.bazel with `//backend/libs/java/infra/encryption` dep

#### FGA Model
- Created `iam/oauth_app.fga` (RESTRICTED access model, mirrors identity_provider)
- Registered in `fga.mod`

#### OAuthApp Handlers (stigmer-cloud, 11 new Java files)
- `OAuthAppRepo` -- MongoDB repository with `@ApiResourceRepo(kind = oauth_app)`
- `OAuthAppGrpcAutoController` -- compile-time gRPC routing
- `EncryptClientSecret` -- pipeline step: AES-256-GCM encrypt before persist, preserve on redacted update
- `RedactClientSecret` -- pipeline step: replace `client_secret` with `***REDACTED***` in responses
- `OAuthAppCreateHandler` -- full create pipeline with encrypt + FGA + redact
- `OAuthAppUpdateHandler` -- full update pipeline with encrypt + redact
- `OAuthAppDeleteHandler` -- delete with `CheckNoReferencingMcpServers` (queries `spec.auth.oauthAppRef`)
- `OAuthAppApplyHandler` -- standard apply delegation
- `OAuthAppGetHandler` -- get by ID with redaction
- `OAuthAppGetByReferenceHandler` -- get by org+slug with post-load FGA and redaction
- `OAuthAppListByOrgHandler` -- list by org with per-entry redaction

#### Seedpack YAMLs (stigmer)
- Switched 4 servers stdio -> HTTP: Sentry, Neon, Tavily, Supabase (verified hosted endpoints)
- Cloudflare kept as stdio (no hosted HTTP endpoint for `@cloudflare/mcp-server-cloudflare`)
- Added flat `auth:` blocks to all 9 DCR+PKCE servers (target_env_var + token_lifetime_hint + scope_hints)

### T02b: Go Handlers (stigmer-server, OSS) -- COMPLETE

#### OAuthApp Controller (stigmer, 11 new Go files + 2 BUILD.bazel)
- `OAuthAppController` struct -- embeds Command+Query unimplemented servers, holds `store.Store` + `*encryption.SecretService`
- `create.go` -- ResolveSlug -> Validate -> CheckDuplicate -> EncryptClientSecret -> BuildNewState -> Persist
- `update.go` -- Validate -> ResolveSlug -> LoadExisting -> BuildUpdateState -> EncryptClientSecret -> Persist
- `delete.go` -- Validate -> LoadExistingForDelete -> CheckNoReferencingMcpServers -> DeleteResource
- `apply.go` -- Validate -> ResolveSlug -> LoadForApply -> delegates to Create or Update
- `get.go` / `get_by_reference.go` -- Load + redact on return
- `list_by_org.go` -- custom ListByOrg step with per-entry redaction
- **Pipeline steps**: `EncryptClientSecret` (encrypt/preserve), `RedactOAuthApp` (function), `CheckNoReferencingMcpServers` (referential integrity)
- Registered in `server.go` -- reuses same `secretService` as Environment controller
- `go build`, `go vet` clean

### Design Decisions Made During T02
- **Encryption as shared library** -- `SecretEncryptionService` in `backend/libs/java/infra/encryption/`, not locked to the Environment domain
- **Flat McpServerAuth in seedpack** -- absence of `oauth_app_ref` indicates DCR mode, no wrapper nesting
- **Delete referential integrity** -- OAuthApp deletion blocked if any MCP server references it via `spec.auth.oauthAppRef`
- **Cloudflare stays stdio** -- no hosted HTTP endpoint found; auth block still added for future DCR support
- **Vendor OAuth seedpack deferred** -- Slack, Stripe, Figma, Salesforce auth blocks require org-specific OAuthApp refs, deferred to T03/T04
- **Go encrypt step timing** -- runs before `BuildNewState` on create (in-place mutation), after `BuildUpdateState` on update (replaces NewState from Input)
- **Go redaction as function, not step** -- target location varies by operation; exported `RedactOAuthApp()` is simpler and more explicit
- **No search indexing for OAuthApp** -- configuration resource, not user-searchable in OSS

## Next Steps

1. **T03: Backend OAuth Client + Connect Flow + Token Refresh** (4-5 days)
   - MCP OAuth discovery (.well-known/oauth-authorization-server)
   - Dynamic Client Registration (DCR)
   - PKCE authorization code flow
   - OAuth callback endpoint
   - Token storage (access token -> personal env, refresh token -> convention)
   - OAuthGrant DB record creation
   - OAuth-aware Connect handler
   - Pre-flight token expiry check + refresh logic
2. **T04**: UI Updates + Token Lifecycle
3. **T05**: End-to-End Testing

## Uncommitted Work

### stigmer repo (this session)
- T02b: OAuthApp Go handlers (13 new files, 2 modified)
- Changelog entry for T02b
- Project session notes update
- (Previous session also has uncommitted: 9 seedpack YAMLs, prior changelogs)

### stigmer-cloud repo (T01 + T02 combined)
- T01: Proto stubs across Go, Java, Python, TypeScript (regenerated)
- T02: Encryption library, OAuthApp handlers, FGA model, test updates
- **Needs separate commit** in stigmer-cloud repo

## Key Design Decisions

### Domain Model
- **OAuthApp**: First-class resource in `iam` bounded context (like IdentityProvider). Holds vendor OAuth client credentials (client_id, client_secret, URLs, scopes). Org-scoped.
- **McpServerAuth**: Flat message -- `oauth_app_ref` presence/absence determines auth mode (vendor OAuth vs DCR+PKCE). No oneof.
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
- 4 servers switched to HTTP (Sentry, Neon, Tavily, Supabase); Cloudflare stays stdio
- 16 manual only, 7 no auth

### Flat Environment Limitation
- Personal env is a flat key-value map (one value per key)
- Two MCP servers with the same env var name share the same token
- Acceptable: different vendors naturally use different names; platform builders control their own names
- Not solving per-server isolation -- simple naming convention handles it

## Task Breakdown (5 tasks)

### T01: Proto Definitions -- COMPLETE
**Repo**: stigmer
**Scope**: OAuthApp resource (iam context: api, spec, io, command, query protos), McpServerAuth on McpServerSpec, OAuthGrant infrastructure proto, stub regeneration
**Effort**: 1.5-2 days

### T02: OAuthApp Handlers + Seedpack YAMLs -- COMPLETE
**Repos**: stigmer + stigmer-cloud
**Scope**: Java OAuthApp handlers (CRUD, FGA model, repository, validation, encryption), shared encryption library extraction, seedpack transport switch + auth blocks
**Effort**: 1 session (accelerated from 3-4 day estimate)

### T03: Backend OAuth Client + Connect Flow + Token Refresh
**Repos**: stigmer + stigmer-cloud
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
| OAuthApp protos | `apis/ai/stigmer/iam/oauthapp/v1/` |
| OAuthGrant proto | `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` |
| McpServer spec proto | `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` |
| Shared encryption library (NEW) | `backend/libs/java/infra/encryption/` (stigmer-cloud) |
| OAuthApp Java handlers (NEW) | `backend/services/stigmer-service/.../domain/iam/oauthapp/` (stigmer-cloud) |
| OAuthApp Go handlers (NEW) | `backend/services/stigmer-server/pkg/domain/oauthapp/controller/` (stigmer) |
| FGA model (NEW) | `backend/services/stigmer-service/.../fga/model/iam/oauth_app.fga` (stigmer-cloud) |
| Connect handler (Go) | `backend/services/stigmer-server/pkg/domain/mcpserver/controller/connect.go` |
| React Connect UI | `sdk/react/src/mcp-server/McpServerDetailView.tsx` |
| Seedpack servers | `seedpack/mcp-servers/` |

## Key References

- **MCP Auth Spec**: OAuth 2.1 + PKCE + DCR (2025-03-26 revision)
- **Previous project (curated marketplace)**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/`
- **Personal env design**: `_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/001-personal-environment-pattern.md`
- **McpServerAuth flattening**: `_changelog/2026-04/2026-04-11-091131-flatten-mcp-server-auth-remove-oneof-wrapper.md`

---

*Drop this file into a new conversation to resume work on this project.*
