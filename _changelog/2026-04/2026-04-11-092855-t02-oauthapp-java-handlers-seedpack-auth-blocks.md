# T02: OAuthApp Java Handlers + Seedpack Auth Blocks

**Date**: April 11, 2026

## Summary

Implemented full OAuthApp CRUD handler stack in stigmer-cloud (Java), extracted a shared encryption library, created the FGA authorization model, switched 4 MCP servers from stdio to HTTP transport, and added OAuth auth blocks to 9 DCR+PKCE servers. This establishes the server-side foundation for vendor OAuth credential management and automated token acquisition.

## Problem Statement

T01 created the OAuthApp proto definitions and McpServerAuth on McpServerSpec, but no backend handlers existed to actually create, read, update, or delete OAuthApp resources. The seedpack MCP server YAMLs also lacked auth configuration, meaning the Connect flow had no way to know which servers support OAuth.

### Pain Points

- No handler code to serve OAuthApp gRPC RPCs (create, update, delete, get, getByReference, listByOrg, apply)
- `client_secret` encryption was locked inside the Environment domain — OAuthApp couldn't reuse it
- `EncryptionConfig` and `EnvironmentSecretService` had no shared library boundary — cross-domain use meant an architectural violation
- 5 MCP servers (Sentry, Neon, Tavily, Supabase, Cloudflare) still used stdio despite having hosted HTTP endpoints
- No seedpack auth blocks declared which servers support DCR+PKCE OAuth

## Solution

Three-part implementation spanning two repos:

1. **Shared encryption library** — extracted AES-256-GCM encryption to `backend/libs/java/infra/encryption/`
2. **OAuthApp domain handlers** — full CRUD stack in `domain/iam/oauthapp/` following the IdentityProvider pattern
3. **Seedpack YAML updates** — transport switch + auth block declarations for 9 DCR+PKCE servers

## Implementation Details

### Shared Encryption Library (stigmer-cloud)

- Created `SecretEncryptionService` in `backend/libs/java/infra/encryption/` with `encrypt()`, `decrypt()`, `isEncrypted()`, `isEncryptionEnabled()`, plus `REDACTED_MARKER` and `isRedacted()` utilities
- Moved `EncryptionConfig` from `ai.stigmer.config.encryption` to the library
- Refactored `EnvironmentSecretService` to a thin delegate — all existing callers (Environment steps, tests) compile unchanged
- New Bazel target `//backend/libs/java/infra/encryption` with public visibility

### FGA Model

- Created `iam/oauth_app.fga` following the RESTRICTED access pattern (identical to identity_provider): organization parent, owner, viewer (owner + org admin), can_view/can_edit/can_delete/can_grant_access/can_view_access

### OAuthApp Handlers (11 Java files)

| File | Role |
|------|------|
| `OAuthAppRepo` | MongoDB repository, `@ApiResourceRepo(kind = oauth_app)` |
| `OAuthAppGrpcAutoController` | `@AutoGrpcRouterController` for compile-time gRPC routing |
| `EncryptClientSecret` | Pipeline step: AES-256-GCM encrypt `client_secret` before persist; preserves existing on `***REDACTED***` update |
| `RedactClientSecret` | Pipeline step: replaces `client_secret` with `***REDACTED***` in all API responses |
| `OAuthAppCreateHandler` | Create pipeline with encrypt + FGA tuple creation + redact |
| `OAuthAppUpdateHandler` | Update pipeline with encrypt (preserves secret if redacted) + redact |
| `OAuthAppDeleteHandler` | Delete pipeline with `CheckNoReferencingMcpServers` referential integrity guard |
| `OAuthAppApplyHandler` | Standard apply (delegates to create or update) |
| `OAuthAppGetHandler` | Get by ID with redaction |
| `OAuthAppGetByReferenceHandler` | Get by org+slug with post-load FGA auth and redaction |
| `OAuthAppListByOrgHandler` | List by org with per-entry redaction |

### Delete Referential Integrity

`CheckNoReferencingMcpServers` queries the `mcp_server` MongoDB collection for any document where `spec.auth.oauthAppRef` references the OAuthApp being deleted. Returns `FAILED_PRECONDITION` if references exist. This uses the flattened `McpServerAuth` structure (no oneof wrapper).

### Seedpack YAML Changes (stigmer)

- **Transport switch**: Sentry, Neon, Tavily, Supabase switched from stdio to HTTP with hosted endpoints
- **Cloudflare**: kept as stdio (no hosted HTTP endpoint found for `@cloudflare/mcp-server-cloudflare`)
- **Auth blocks**: all 9 DCR+PKCE servers now declare `auth:` with `target_env_var` and optional `token_lifetime_hint`/`scope_hints`
- Uses flat `McpServerAuth` structure — absence of `oauth_app_ref` indicates DCR mode

## Benefits

- OAuthApp resources can now be created, managed, and deleted via gRPC
- `client_secret` is encrypted at rest (AES-256-GCM) and never exposed in API responses
- Encryption is a shared platform capability, not locked to a single domain
- Seedpack servers declare OAuth support, enabling the Connect flow in T03
- Delete safety: cannot orphan MCP servers that reference an OAuthApp

## Impact

- **stigmer-cloud**: 15 new Java files, 5 modified files, 1 deleted file
- **stigmer**: 9 modified seedpack YAMLs
- **FGA model**: 1 new type definition, model bundle updated
- No breaking changes — all new additive surface

## Related Work

- [T01: OAuthApp Proto Definitions](2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md)
- [McpServerAuth Flattening](2026-04-11-091131-flatten-mcp-server-auth-remove-oneof-wrapper.md)
- T03 (next): Backend OAuth Client + Connect Flow + Token Refresh

---

**Status**: Production Ready
**Timeline**: Single session, building on T01 proto foundation
