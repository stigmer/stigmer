# T02b: OAuthApp Go Handlers for stigmer-server (OSS)

**Date**: April 11, 2026

## Summary

Implemented full OAuthApp CRUD controller stack in stigmer-server (Go, OSS), mirroring the Java handlers built in stigmer-cloud during T02. The controller uses the established pipeline pattern with AES-256-GCM encryption of client_secret, redaction in all API responses, and referential integrity enforcement on delete. This completes OAuthApp handler coverage across both the Cloud and OSS backends.

## Problem Statement

T02 implemented OAuthApp handlers in Java (stigmer-cloud) but the Go OSS server (`stigmer-server`) had no equivalent. Without Go handlers, the OSS single-user local server cannot create, manage, or delete OAuthApp resources, blocking the Connect flow (T03) from working in local/OSS mode.

### Pain Points

- No OAuthApp CRUD operations available in `stigmer-server`
- CLI `stigmer apply` for OAuthApp resources would fail in local mode
- Connect flow (T03) needs OAuthApp handlers in both Cloud and OSS backends
- OSS users cannot test vendor OAuth integrations locally

## Solution

Created a new domain package at `pkg/domain/oauthapp/controller/` following the exact patterns established by Organization, Environment, and McpServer controllers. Three custom pipeline steps handle OAuthApp-specific concerns (encryption, redaction, referential integrity).

## Implementation Details

### Controller (8 Go files)

| File | Operation | Pipeline |
|------|-----------|----------|
| `oauthapp_controller.go` | Struct + constructor | Embeds Command+Query servers, holds `store.Store` + `*encryption.SecretService` |
| `create.go` | Create | ResolveSlug -> Validate -> CheckDuplicate -> EncryptClientSecret -> BuildNewState -> Persist |
| `update.go` | Update | Validate -> ResolveSlug -> LoadExisting -> BuildUpdateState -> EncryptClientSecret -> Persist |
| `delete.go` | Delete | Validate -> LoadExistingForDelete -> CheckNoReferencingMcpServers -> DeleteResource |
| `apply.go` | Apply | Validate -> ResolveSlug -> LoadForApply -> delegates to Create or Update |
| `get.go` | Get | Validate -> LoadTarget -> redact on return |
| `get_by_reference.go` | GetByReference | Validate -> LoadByReference -> redact on return |
| `list_by_org.go` | ListByOrg | Validate -> custom ListByOrg step (filter + per-entry redact) |

### Custom Pipeline Steps (3 Go files in `steps/`)

| File | Role |
|------|------|
| `encrypt_client_secret.go` | AES-256-GCM encrypt `client_secret` before persist; on update, preserves existing encrypted value when client sends `***REDACTED***`; rejects redaction marker on create |
| `redact_client_secret.go` | Exported `RedactOAuthApp()` function replaces `client_secret` with `***REDACTED***` in all API responses |
| `check_no_referencing_mcp_servers.go` | Scans McpServer resources for `spec.auth.oauth_app_ref` matching the OAuthApp being deleted; returns `FAILED_PRECONDITION` if any found |

### Design Decisions

- **Encrypt step timing differs by operation**: On create, runs before `BuildNewState` (which modifies NewState in place). On update, runs after `BuildUpdateState` (which replaces NewState from Input).
- **Redaction is a function, not a pipeline step**: The target location varies by operation (NewState for create/update, TargetResourceKey for get, inline for list), making a single pipeline step impractical.
- **No search indexing**: OAuthApp is a configuration resource, not user-searchable. Can be added later.
- **Reuses existing `encryption.SecretService`**: Same AES-256-GCM implementation and `enc:v1:` format used by Environment secrets. No new encryption code.
- **Referential integrity via full scan**: SQLite store has no field-level query for nested proto references, so the delete check lists all McpServer resources and filters in Go (same pattern as Environment `list.go`).

## Benefits

- OAuthApp resources can now be managed via gRPC in the OSS server
- CLI `stigmer apply` works for OAuthApp in local mode
- `client_secret` encrypted at rest and redacted in all responses (same security as Cloud)
- Delete safety: cannot orphan MCP servers referencing an OAuthApp
- Zero new dependencies: reuses existing encryption service and pipeline framework

## Impact

- **stigmer**: 13 new files (11 Go + 2 BUILD.bazel), 2 modified files (server.go + BUILD.bazel)
- **No breaking changes**: purely additive surface
- **Parity with Cloud**: all 7 OAuthApp RPCs (apply, create, update, delete, get, getByReference, listByOrg) now work in both backends

## Related Work

- [T01: OAuthApp Proto Definitions](2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md)
- [McpServerAuth Flattening](2026-04-11-091131-flatten-mcp-server-auth-remove-oneof-wrapper.md)
- [T02: Java Handlers + Seedpack](2026-04-11-092855-t02-oauthapp-java-handlers-seedpack-auth-blocks.md)
- T03 (next): Backend OAuth Client + Connect Flow + Token Refresh

---

**Status**: Production Ready
**Timeline**: Single session, building on T01 proto foundation and T02 Java handler patterns
