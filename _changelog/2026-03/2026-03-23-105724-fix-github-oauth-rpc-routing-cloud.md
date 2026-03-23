# Fix GitHub OAuth RPC Routing on Cloud

**Date**: March 23, 2026

## Summary

Fixed the "Connect GitHub" button not working on the Stigmer Cloud web app. The root cause was a method name casing mismatch between the proto-defined RPC names (PascalCase) and the Java gRPC routing framework's handler registration (camelCase). Also normalized the GitHub proto RPC names to camelCase for consistency with all other protos in the codebase.

## Problem Statement

Clicking "Connect GitHub" in the Cloud web app produced no visible response. The backend logs showed repeated errors:

```
request mapping not found for ai.stigmer.platform.github.v1.GitHubService/GetOAuthAuthorizeUrl
```

### Pain Points

- Users could not connect their GitHub accounts on the Cloud version
- The error was silently swallowed by the frontend — no feedback to the user
- The GitHub proto was the only service using PascalCase RPC names, diverging from the codebase convention

## Solution

Two-part fix:

1. **Proto normalization**: Changed the GitHub service RPC names from PascalCase to camelCase (`GetOAuthAuthorizeUrl` → `getOAuthAuthorizeUrl`, `ExchangeOAuthCode` → `exchangeOAuthCode`) to match the convention used by all other protos (session, organization, search, etc.).

2. **Framework hardening** (in stigmer-cloud): Updated `FullMethodNameGetter` to resolve the actual proto method name from gRPC `MethodDescriptor` objects at startup, so the routing framework works correctly regardless of proto method name casing.

## Implementation Details

### Proto change (`apis/ai/stigmer/platform/github/v1/service.proto`)

```protobuf
// Before
rpc GetOAuthAuthorizeUrl(...) returns (...);
rpc ExchangeOAuthCode(...) returns (...);

// After
rpc getOAuthAuthorizeUrl(...) returns (...);
rpc exchangeOAuthCode(...) returns (...);
```

Message type names (`GetOAuthAuthorizeUrlRequest`, `ExchangeOAuthCodeResponse`, etc.) are unchanged.

### Python SDK update (`sdk/python/src/stigmer/_github.py`)

Updated stub method calls to match new proto names. Python gRPC stubs use the proto method name directly, unlike Go (exports/capitalizes), Java (lowercases first letter), and TypeScript/Connect (camelCases) which all produce the same method name regardless of proto casing.

### Why other SDKs didn't need changes

| Language | Codegen behavior | Proto `getOAuthAuthorizeUrl` | Proto `GetOAuthAuthorizeUrl` |
|----------|-----------------|------------------------------|------------------------------|
| Go | Capitalizes for export | `GetOAuthAuthorizeUrl` | `GetOAuthAuthorizeUrl` |
| Java | Lowercases first letter | `getOAuthAuthorizeUrl` | `getOAuthAuthorizeUrl` |
| TypeScript | camelCase | `getOAuthAuthorizeUrl` | `getOAuthAuthorizeUrl` |
| Python | Uses proto name as-is | `getOAuthAuthorizeUrl` | `GetOAuthAuthorizeUrl` |

## Benefits

- GitHub OAuth flow now works on Cloud
- Proto RPC naming is consistent across all services
- The `FullMethodNameGetter` fix in stigmer-cloud prevents this class of bug for any future proto that might use PascalCase

## Impact

- **Cloud users**: Can now connect GitHub accounts and select repos for workspaces
- **All SDK consumers**: Regenerated stubs reflect the camelCase RPC names (wire-compatible for Go/Java/TS, breaking for Python stub callers who must update method names)

## Related Work

- `2026-03-17-141340-github-oauth-workspace-integration.md` — original GitHub OAuth integration
- `2026-03-20-145642-workspace-github-popup-oauth-flow.md` — popup OAuth flow

---

**Status**: ✅ Production Ready
