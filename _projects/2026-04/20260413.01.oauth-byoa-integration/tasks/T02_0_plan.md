# Task T02: Backend — Disconnect OAuth + Grant Health Evaluation

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer-cloud
**Estimated scope**: ~6-8 files
**Depends on**: T01 (proto stubs must be regenerated)

## Objective

Implement the disconnect OAuth flow (GAP 2) and enrich grant status with connection health evaluation (GAP 3). These are the two most critical gap fixes — disconnect unblocks stale grant cleanup, and health evaluation makes the "Connected" status trustworthy.

## Context

### GAP 2: No Disconnect / Revoke Flow
`OAuthGrantRepo.delete(identityAccountId, resourceId, orgId)` exists in Java but is never called. Once connected, a user cannot disconnect. This is likely why Figma shows "Connected" when the user doesn't remember connecting — a stale grant from testing that can never be removed.

### GAP 3: Grant Status != Token Validity
`McpServerGetOAuthGrantStatusHandler.LookupGrant` returns `connected: true` if a grant document exists. It does NOT evaluate `accessTokenExpiresAt` against current time. The green "Connected" pill is potentially misleading.

## Deliverables

### 1. `McpServerDisconnectOAuthHandler`

New handler at `domain/agentic/mcpserver/request/handler/McpServerDisconnectOAuthHandler.java`.

Pipeline:
1. `ValidateFieldConstraints`
2. `Authorize` — FGA `can_connect` on `mcp_server:{mcp_server_id}`
3. `ExecuteDisconnect` — delete OAuthGrant, delete managed environment, return confirmation

Steps in `ExecuteDisconnect`:
- Resolve caller's `identityAccountId`
- Look up grant via `OAuthGrantRepo.find(identityAccountId, mcpServerId, org)`
- If grant exists and has `environmentId`: delete the managed environment via `ManagedEnvironmentService` (or `EnvironmentCommandGrpcRepo`)
- Delete the grant via `OAuthGrantRepo.delete`
- Return `DisconnectOAuthOutput { disconnected: true }`
- If no grant: return `DisconnectOAuthOutput { disconnected: false }` (idempotent, no error)

### 2. `ManagedEnvironmentService.deleteEnvironment`

New method on the existing `ManagedEnvironmentService`:
```java
public void deleteEnvironment(String environmentId, String identityAccountId) {
    environmentCommandRepo.deleteOnBehalfOf(environmentId, identityAccountId);
}
```

### 3. Enhance `LookupGrant` in `McpServerGetOAuthGrantStatusHandler`

Modify the existing `LookupGrant` step to evaluate token health:

```java
OAuthConnectionHealth health;
if (grantOpt.isEmpty()) {
    health = OAUTH_CONNECTION_HEALTH_NO_GRANT;
} else {
    long expiresAt = grant.getAccessTokenExpiresAt();
    if (expiresAt == 0) {
        // No expiry metadata — assume healthy (vendor may not provide expires_in)
        health = OAUTH_CONNECTION_HEALTH_HEALTHY;
    } else if (Instant.now().getEpochSecond() < expiresAt - 60) {
        health = OAUTH_CONNECTION_HEALTH_HEALTHY;
    } else if (grant.getRefreshTokenEnvVar() != null && !grant.getRefreshTokenEnvVar().isBlank()) {
        health = OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE;
    } else {
        health = OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
    }
}
```

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `McpServerDisconnectOAuthHandler.java` | Create | New handler with pipeline |
| `McpServerCommandController.java` (method enum) | Modify | Add `disconnectOAuth` method |
| `McpServerGetOAuthGrantStatusHandler.java` | Modify | Add health evaluation in `LookupGrant` |
| `ManagedEnvironmentService.java` | Modify | Add `deleteEnvironment` method |
| `McpServerGrpcAutoController.java` | Modify | Wire new RPC to handler |

## Acceptance Criteria

- [ ] `disconnectOAuth` RPC deletes grant + managed environment
- [ ] Idempotent: calling disconnect when no grant returns `disconnected: false`, no error
- [ ] `getOAuthGrantStatus` returns accurate `connection_health` based on token expiry evaluation
- [ ] Existing `connected` boolean behavior unchanged (backward compatible)
- [ ] No changes to `OAuthGrant` composite key or document schema

## Predecessor Tasks

T01 (proto + stubs)

## Successor Tasks

T06 (frontend disconnect + health display)
