# Add GitHubClient to Python, Go, and Java SDKs

**Date**: March 17, 2026

## Summary

Added handwritten `GitHubClient` to the Python, Go, and Java SDKs, completing parity with the TypeScript SDK. These clients wrap the `GitHubService` proto (OAuth authorize URL and code exchange) using each SDK's established patterns. This is part of the broader GitHub OAuth workspace integration.

## Problem Statement

The TypeScript SDK had a handwritten `GitHubClient` for GitHub OAuth integration, but the Python, Go, and Java SDKs were missing this client. This meant SDK consumers outside the web frontend (CLI tools, backend integrations, automation scripts) could not use the GitHub OAuth flow through the SDK.

### Pain Points

- Python, Go, and Java SDK consumers had no typed client for GitHub OAuth
- The `GitHubService` proto existed and stubs were generated for all languages, but no SDK-level wrapper exposed them
- Inconsistency across SDKs: TypeScript had the client, others did not

## Solution

Implemented `GitHubClient` as a handwritten utility client in each SDK, following the same approach used for the existing `SearchClient` (another non-CRUD utility service that was already handwritten across all SDKs).

The GitHub and Search services are structurally different from CRUD resource services (no spec, no ID type, no command/query split), so they cannot use the existing Go-based codegen pipeline. The decision was made to maintain them as handwritten code until the number of such utility services justifies extending the codegen.

## Implementation Details

### Python SDK (`sdk/python/src/stigmer/_github.py`)

- Follows `_search.py` patterns: dataclasses for params/responses, `grpc.Channel` constructor, `wrap_error` for gRPC errors
- Two methods: `get_oauth_authorize_url()`, `exchange_oauth_code()`
- Wired into `StigmerClient` via `_client.py`, exported from `__init__.py`

### Go SDK (`sdk/go/github.go`)

- Follows `search.go` patterns: struct params/responses, `context.Context` first arg, `gen.WrapErr` for errors
- Two methods: `GetOAuthAuthorizeUrl()`, `ExchangeOAuthCode()`
- Wired into `Client` struct in `client.go` as `GitHub *GitHubClient`

### Java SDK (`sdk/java/.../GitHubClient.java`)

- Follows `SearchClient.java` patterns: inner classes with builder pattern, `StigmerException.wrap` for errors
- Two methods: `getOAuthAuthorizeUrl()`, `exchangeOAuthCode()`
- Wired into `StigmerClient` with `github()` accessor

### Authorization Note

The `GitHubService` proto marks both RPCs with `is_skip_authorization = true`. This skips FGA-based fine-grained authorization but does NOT skip authentication. In the cloud backend, callers still need a valid JWT or API key. The SDK does not need to handle this distinction -- it uses the same transport/channel as all other clients.

## Benefits

- Full SDK parity across TypeScript, Python, Go, and Java for GitHub OAuth
- SDK consumers in any language can now initiate OAuth flows and exchange codes
- Consistent patterns: each SDK's GitHubClient follows the same conventions as its SearchClient

## Impact

- **Python SDK**: New `GitHubClient` class and 5 exported types
- **Go SDK**: New `GitHubClient` struct and 4 param/response types
- **Java SDK**: New `GitHubClient` class with inner builder types
- **All SDKs**: Main client class updated to expose `github` sub-client

## Related Work

- [GitHub OAuth Credential Embedding](_changelog/2026-03/2026-03-17-143646-github-oauth-credential-embedding.md) -- backend OAuth config
- TypeScript `sdk/typescript/src/github.ts` -- the reference implementation these clients mirror
- `sdk/*/search.*` -- the existing handwritten utility client pattern followed

---

**Status**: Production Ready
