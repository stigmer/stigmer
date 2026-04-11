# Next Task: 20260410.03.mcp-oauth-connect

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.03.mcp-oauth-connect

**Description**: Implement OAuth-based MCP server authentication across Stigmer, supporting MCP OAuth spec (DCR+PKCE) for 9 servers and vendor OAuth for 4 servers, with automatic token refresh.
**Goal**: Enable one-click OAuth Connect for 13 MCP servers, store tokens in personal environment, refresh tokens automatically before execution.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), Python/LangGraph (agent-runner), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-10
**Status**: T05 COMPLETE + Cross-Domain Repo Remediation
**Active Task**: Manual end-to-end testing (user-driven)
**Last Session**: 2026-04-11

## Session Progress (2026-04-11, Session 2 -- Cross-Domain Repo Audit)

### Cross-Domain Repository Remediation (stigmer-cloud)
- **Audit**: Identified 4 `EnvironmentRepo` violations (2 reads + 2 writes across `OAuthTokenRefreshService` and `McpServerCompleteOAuthConnectHandler`) and 2 `OAuthAppRepo` violations (reads in `OAuthTokenRefreshService` and `McpServerInitiateOAuthConnectHandler`)
- **Created** `EnvironmentCommandGrpcRepo` interface + impl in `downstream/agentic/environment/` -- wraps `updateVariables` RPC with OBO channel
- **Refactored** `OAuthTokenRefreshService` -- replaced `EnvironmentRepo` with `EnvironmentQueryGrpcRepo` (list) + `EnvironmentCommandGrpcRepo` (updateVariables), replaced `EnvironmentSecretService` with gRPC getSecretValue (returns decrypted), removed all pre-encryption
- **Refactored** `McpServerCompleteOAuthConnectHandler` -- same pattern: downstream gRPC for env reads/writes, plaintext tokens with `isSecret=true`
- **Documented** `OAuthAppRepo` boundary exception -- gRPC `getByReference` redacts client_secret, but OAuth flows need unredacted secrets for external provider calls. Kept direct repo access with class-level and field-level documentation.
- **Key benefit**: Environment mutations now go through FGA authorization, handler-level encryption, and audit trail (`updatedBy` is set correctly)

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

### T03: Backend OAuth Client + Connect Flow + Token Refresh -- COMPLETE

#### Proto Additions (stigmer)
- Added `InitiateOAuthConnectInput/Output`, `CompleteOAuthConnectInput/Output` to `io.proto`
- Added `initiateOAuthConnect`, `completeOAuthConnect` RPCs to `command.proto` (both `can_connect` auth)
- Ran `make codegen` (stigmer) + `make protos` (stigmer-cloud) -- stubs in Go, Java, Python, TypeScript, Dart

#### OAuth Infrastructure Package (Go + Java)
- **Go** (`pkg/domain/mcpserver/oauth/`): `pkce.go`, `discovery.go`, `dcr.go`, `token.go`, `refresh.go`
  - RFC 8414 `.well-known` discovery with S256 PKCE validation
  - RFC 7591 DCR for public clients (token_endpoint_auth_method: "none")
  - PKCE S256 generation, authorization code exchange, refresh token exchange
  - Reusable `RefreshTokenIfExpired` utility with 60s expiry buffer
- **Java** (`ai.stigmer.domain.agentic.mcpserver.oauth`): 5 Spring `@Service` classes
  - `PkceGenerator`, `McpOAuthDiscoveryService`, `McpDcrService`, `OAuthTokenService`, `McpOAuthException`
  - Same HTTP contracts as Go, using `java.net.http.HttpClient` + Jackson `ObjectMapper`

#### OAuthGrant + PendingOAuthState Storage
- **Go**: SQLite tables (`oauth_grant`, `pending_oauth_state`) with UPSERT, atomic GetAndDelete, TTL enforcement
- **Java**: MongoDB repos (`OAuthGrantRepo`, `PendingOAuthStateRepo`) with TTL index on `createdAt`
- OAuthGrant keyed by (identity_account_id, mcp_server_id), PendingOAuthState keyed by `state` param

#### InitiateOAuthConnect Handler (Go + Java)
- DCR path: discover auth server → DCR register → generate PKCE → build auth URL → store pending state
- Vendor OAuth path: load OAuthApp → decrypt client_secret → generate PKCE → build auth URL → store pending state
- Validates DCR requires HTTP transport (not stdio)
- Added `STIGMER_OAUTH_REDIRECT_URI` deployment config, `SetOAuthDependencies` on McpServerController

#### CompleteOAuthConnect Handler (Go + Java)
- Validates state param, atomically consumes PendingOAuthState
- Exchanges authorization code for tokens via PKCE code_verifier
- Stores access_token + refresh_token in personal environment (new `UpdateVariables` on Go env client)
- Creates OAuthGrant record with expiry, client_id, token_endpoint
- Java encrypts tokens via `SecretEncryptionService` before storing

#### Pre-flight Token Refresh
- **Go**: `refreshOAuthTokenIfNeeded` in `connect.go` runs before env resolution when `runtime_env` is empty
- **Java**: `OAuthTokenRefreshService` + `RefreshOAuthToken` pipeline step in `McpServerConnectHandler`
- Checks OAuthGrant expiry, reads refresh_token from personal env, calls token endpoint, updates env + grant
- 60-second buffer before expiry to refresh proactively

### Design Decisions Made During T03
- **Frontend-mediated (SPA) pattern** -- two RPCs matching GitHub OAuth pattern, no HTTP callback endpoint
- **Per-user DCR** -- client_id in OAuthGrant, no shared org-level DCR state
- **PKCE for both auth modes** -- DCR (public client) and vendor OAuth (defense-in-depth)
- **Separate RPCs** -- initiateOAuthConnect stores tokens; connect discovers tools (single responsibility)
- **Deployment-level redirect URI** -- `STIGMER_OAUTH_REDIRECT_URI` env var, not per-OAuthApp or per-McpServer
- **PendingOAuthState is not a proto** -- backend-internal storage with 10-minute TTL, similar to session state

### T04: React SDK OAuth Connect UI -- COMPLETE

#### New Files (SDK)
- **`useMcpServerOAuthConnect.ts`** -- Core OAuth popup flow hook. Opens popup synchronously (avoids blockers), calls `initiateOAuthConnect` → navigates popup → listens for `postMessage` → `completeOAuthConnect` → chains `connect`. Phase state machine: `idle → initiating → awaiting-callback → completing → connecting → done`. 120s timeout, popup-closed detection.
- **`OAuthCallbackHandler.tsx`** -- Callback page component. Extracts `code`+`state` from URL, posts to `window.opener` via `postMessage` (origin-validated), closes popup. Handles no-opener fallback.

#### New File (Console)
- **`client-apps/web/src/app/auth/oauth/callback/page.tsx`** -- Console callback route rendering `<OAuthCallbackHandler />`.

#### Updated Hooks
- **`useMcpServerCredentials`** -- Now returns `authMode` (`"manual" | "oauth"`), `oauthTargetEnvVar`, `isOAuthConnected`, `tokenLifetimeHint`. Excludes OAuth-managed var from `missingVariables`. `isReady` checks ALL vars (both OAuth + manual).

#### Updated Components
- **`McpServerDetailView`** -- New `OAuthSection` with sign-in button + green/gray connection status badge. `ConnectBar` shows phase-aware labels. Mixed mode: OAuth section + env var form for non-OAuth vars. `EnvSpecSection` marks OAuth-managed var with "oauth" badge.
- **`McpServerConfigPanel`** -- New `oauthSignIn` prop with `McpServerOAuthSignInProps`. Compact inline OAuth sign-in button. Disables form + tool selector during OAuth.
- **`McpServerPicker`** -- Uses `useMcpServerOAuthConnect` internally. Detects `spec.auth`, filters `target_env_var` from credential form, wires OAuth button. Re-adds server after OAuth for setup re-evaluation.

#### Barrel Exports
- `mcp-server/index.ts` and `sdk/react/src/index.ts` updated with 3 new exports + expanded types.

### Design Decisions Made During T04
- **Popup-based OAuth (not redirect)** -- critical for SDK-first embeddable components; platform builders can't have users navigated away
- **Synchronous popup open before async RPC** -- `window.open("about:blank")` first to avoid popup blockers, then set `location` after `initiateOAuthConnect` resolves
- **Connection status is env-var-presence-based** -- frontend can't know token expiry (OAuthGrant is backend-internal). Green/gray based on `target_env_var` in personal env. Amber "re-auth needed" only on connect failure.
- **Mixed-mode credential flow** -- OAuth and manual vars are parallel paths into the same personal env. Both sections render independently. `isReady` gates on all vars present.
- **Session setup OAuth is lightweight** -- inline per-server action in config panel, not a page-level flow. Picker re-adds server after OAuth to trigger re-evaluation.
- **No redirect fallback in T04** -- popup covers all standard browser environments. `OAuthCallbackHandler` detects no-opener for future redirect support.
- **`useMcpServerSetup` unchanged** -- OAuth awareness handled at the UI layer (Picker filters vars, shows button). After OAuth, Picker calls `onServerAdded(ref)` to re-evaluate.

### T05: Vendor OAuth Bootstrap Migration -- COMPLETE

#### Vendor OAuth App Registration
- Registered OAuth apps with Slack (free), Figma (free, pending review), Salesforce (free Developer Edition)
- Configured redirect URL `https://app.stigmer.ai/auth/oauth/callback` on all three
- Slack: PKCE enabled, user token scopes (channels:read, chat:write, users:read, search:read)
- Figma: Public distribution, scopes (file_content:read, file_metadata:read, file_comments:read)
- Salesforce: External Client App, Authorization Code flow, PKCE enabled, scopes (api, refresh_token, offline_access)
- Stripe excluded -- uses API keys, not OAuth

#### Credential Pipeline (stigmer-cloud, 4 new files + 2 modified)
- **SecretsGroup**: `vendor-oauth-credentials.yaml` (3 client secrets via planton)
- **VariablesGroup**: `vendor-oauth-config.yaml` (3 client IDs via planton)
- **Kustomize**: 6 env var mappings in `service.yaml` (3 variables + 3 secrets)
- **Spring**: `stigmer.vendor-oauth.*` in `application.yaml` + `VendorOAuthBootstrapConfig.java`

#### Mongock Migration (stigmer-cloud, 1 new file)
- `U20260411_SeedVendorOAuthApps.java` -- `@ChangeUnit(order = "013")`
- Creates 3 OAuthApp documents with encrypted client_secret
- Writes FGA tuples (org link + owner) matching `createSteps.createAuthorizationTuples`
- Idempotent, graceful skip for unconfigured vendors, full rollback support
- Owner: `operator@stigmer.ai`, org: `stigmer`

#### Seedpack YAML Updates (stigmer, 3 modified files)
- `mcp-server-slack.yaml`: Added `auth.oauth_app_ref: slack-oauth`
- `mcp-server-figma.yaml`: Added `auth.oauth_app_ref: figma-oauth`
- `mcp-server-salesforce.yaml`: Added `env_spec` + `auth.oauth_app_ref: salesforce-oauth`

## Next Steps

1. **Manual end-to-end testing** (user-driven)
   - Real OAuth flow against a DCR server (GitLab or Linear)
   - Vendor OAuth with OAuthApp (Slack, Figma, Salesforce)
   - Token refresh cycle verification
   - Pre-flight expiry check
   - Validate all 37 seedpack YAMLs
   - Test popup flow in Console
   - Test mixed-mode (OAuth + manual vars) scenario

## Uncommitted Work

### stigmer repo (T01-T05, all sessions combined)
- T01-T03: Protos, backend Go code, stubs, seedpack auth blocks
- T04: React SDK OAuth Connect UI, Console callback page
- T05: Seedpack YAML vendor OAuth `auth` blocks (Slack, Figma, Salesforce)
- Changelogs for all tasks

### stigmer-cloud repo (T01-T05 + repo remediation, all sessions combined)
- T01: Proto stubs across Go, Java, Python, TypeScript (regenerated)
- T02: Encryption library, OAuthApp handlers, FGA model, test updates
- T03: Java OAuth infrastructure, handlers, repos, pre-flight refresh step
- T05: Vendor OAuth bootstrap migration, planton groups, Kustomize, Spring config
- Cross-domain fix: `EnvironmentCommandGrpcRepo` (new), refactored OAuth handlers to use downstream gRPC repos

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
| OAuth infra Go (NEW, T03) | `backend/services/stigmer-server/pkg/domain/mcpserver/oauth/` (stigmer) |
| OAuth infra Java (NEW, T03) | `backend/services/stigmer-service/.../domain/agentic/mcpserver/oauth/` (stigmer-cloud) |
| FGA model (NEW) | `backend/services/stigmer-service/.../fga/model/iam/oauth_app.fga` (stigmer-cloud) |
| Connect handler (Go) | `backend/services/stigmer-server/pkg/domain/mcpserver/controller/connect.go` |
| React Connect UI | `sdk/react/src/mcp-server/McpServerDetailView.tsx` |
| OAuth Connect hook (NEW, T04) | `sdk/react/src/mcp-server/useMcpServerOAuthConnect.ts` |
| OAuth Callback component (NEW, T04) | `sdk/react/src/mcp-server/OAuthCallbackHandler.tsx` |
| Console OAuth callback (NEW, T04) | `client-apps/web/src/app/auth/oauth/callback/page.tsx` |
| Seedpack servers | `seedpack/mcp-servers/` |

## Key References

- **MCP Auth Spec**: OAuth 2.1 + PKCE + DCR (2025-03-26 revision)
- **Previous project (curated marketplace)**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/`
- **Personal env design**: `_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/001-personal-environment-pattern.md`
- **McpServerAuth flattening**: `_changelog/2026-04/2026-04-11-091131-flatten-mcp-server-auth-remove-oneof-wrapper.md`

---

*Drop this file into a new conversation to resume work on this project.*
