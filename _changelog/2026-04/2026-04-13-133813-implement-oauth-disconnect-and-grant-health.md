# Implement OAuth Disconnect Flow and Grant Health Evaluation

**Date**: April 13, 2026

## Summary

Implemented the disconnect OAuth handler (GAP 2) and grant health evaluation (GAP 3) across both stigmer and stigmer-cloud repos. Users can now tear down stale OAuth connections, and the "Connected" status is backed by actual token expiry checks instead of mere grant existence.

## Problem Statement

Two critical gaps in the MCP server OAuth integration left users without visibility or control over their OAuth connections:

### Pain Points

- **No disconnect flow (GAP 2)**: `OAuthGrantRepo.delete()` existed but was never called. Once connected, a user could never disconnect — leading to stale grants (e.g., the Figma "Connected" mystery where a test grant could never be removed).
- **Misleading "Connected" status (GAP 3)**: `getOAuthGrantStatus` returned `connected: true` if a grant document existed, regardless of whether the access token was expired. The green "Connected" pill gave users false confidence.

## Solution

### Disconnect Handler (GAP 2)

New `McpServerDisconnectOAuthHandler` with idempotent desired-state semantics:
- Grant exists: delete managed environment (secrets first), then delete grant record, return `disconnected: true`
- No grant: return `disconnected: false` without error — the desired state ("no connection") is already achieved
- Authorization: `can_connect` on the MCP server resource (same permission as connect/initiateOAuthConnect)

### Grant Health Evaluation (GAP 3)

Enhanced `LookupGrant` step in `McpServerGetOAuthGrantStatusHandler` to evaluate `OAuthConnectionHealth`:
- `NO_GRANT`: no grant exists
- `HEALTHY`: token not expired (or has no expiry metadata)
- `TOKEN_EXPIRED_REFRESHABLE`: token expired but refresh token is available
- `TOKEN_EXPIRED`: token expired, no refresh token, user must re-authenticate

Uses the same 60-second buffer as `OAuthTokenRefreshService` so the UX signal matches execution behavior.

## Implementation Details

### Proto Changes (stigmer)

Updated doc comments on `DisconnectOAuthInput`, `DisconnectOAuthOutput`, and the `disconnectOAuth` RPC to reflect idempotent semantics. Removed NOT_FOUND error documentation. No structural changes.

### Backend Changes (stigmer-cloud)

**Infrastructure layer** (downstream gRPC):
- `EnvironmentCommandGrpcRepo`: Added `deleteOnBehalfOf` interface method
- `EnvironmentCommandGrpcRepoImpl`: Implemented delete using impersonated channel + `ApiResourceDeleteInput`, following the `ExecutionContextGrpcRepoImpl` pattern

**OAuth domain layer**:
- `ManagedEnvironmentService`: Added `deleteManagedEnvironment` — delegates to gRPC repo, environment handler pipeline handles FGA cleanup and audit
- `McpServerDisconnectOAuthHandler`: New handler with `ExecuteDisconnect` pipeline step
- `McpServerGetOAuthGrantStatusHandler`: Enhanced `LookupGrant` with `evaluateHealth` method

### Design Decision: Idempotent Disconnect

The original proto specified NOT_FOUND for missing grants. During planning, this was reconsidered: Stigmer is a declarative platform where operations express desired state. Disconnect means "ensure no connection" — if already disconnected, that's success, not an error. This handles race conditions, retries, and partial failures gracefully.

## Benefits

- **Users can disconnect**: Stale OAuth connections (like the Figma mystery) can finally be cleaned up
- **Trustworthy status**: "Connected" now means "connected and healthy" — the frontend can show actionable health states
- **Retry-safe**: Idempotent disconnect handles double-clicks, concurrent tabs, and partial failures
- **Clean layering**: Environment deletion goes through the full gRPC pipeline (FGA cleanup, audit, encryption)

## Impact

- **Frontend (T06)**: Unblocked — can now build disconnect UI and health status display
- **End users**: Will see accurate OAuth connection health instead of stale "Connected" pills
- **Backend**: `OAuthGrantRepo.delete` is finally reachable via a handler pipeline

## Files Changed

### stigmer (proto + codegen)
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — comment update
- `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` — comment update
- 18 regenerated stub files across Go, Java, Python, TypeScript, Dart

### stigmer-cloud (backend + codegen)
- `EnvironmentCommandGrpcRepo.java` — +17 lines (interface method)
- `EnvironmentCommandGrpcRepoImpl.java` — +19 lines (implementation)
- `ManagedEnvironmentService.java` — +20 lines (delete method)
- `McpServerDisconnectOAuthHandler.java` — +113 lines (new handler)
- `McpServerGetOAuthGrantStatusHandler.java` — +35 lines (health evaluation)
- 11 regenerated stub files

## Related Work

- T01: Proto layer defining `disconnectOAuth` RPC, `OAuthConnectionHealth` enum, I/O messages
- T03: Hardened refresh (GAP 4), vendor gate (GAP 8), error UX (GAP 9) — committed `22cc3ca5`
- T06 (next): Frontend disconnect + health display — now unblocked by T02 + T03

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
