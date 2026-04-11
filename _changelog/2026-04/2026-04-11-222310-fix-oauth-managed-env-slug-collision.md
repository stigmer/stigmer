# Fix OAuth Managed Environment Slug Collision

**Date**: April 11, 2026

## Summary

Fixed a multi-tenant slug collision in the OAuth managed environment creation flow. The managed environment slug was derived solely from the MCP server name, causing `ALREADY_EXISTS` failures when multiple users in the same org connected to the same MCP server, or when a partial failure left an orphaned environment with no OAuthGrant pointing to it.

## Problem Statement

Clicking "Sign in to connect" on an OAuth-enabled MCP server (e.g., Slack) failed with `ALREADY_EXISTS: environment with org 'suresh' and slug 'oauth-mcp-server-slack' already exists`. The error surfaced because `ManagedEnvironmentService.createManagedEnvironment` built an Environment with name `"OAuth: mcp-server-slack"` and no explicit slug. The create pipeline auto-generated slug `oauth-mcp-server-slack`, which collides across users and across retries.

### Pain Points

- **Cross-user collision**: The slug `oauth-{mcpServerName}` is identical for every user in the same org connecting to the same MCP server. The second user always fails.
- **Orphaned environment on partial failure**: If `ExchangeAndStore` creates the environment but fails before `grantRepo.upsert`, the environment exists without a grant. The next attempt finds no grant, tries to create a new env, and hits the duplicate check.
- **No idempotent recovery**: The create path had no find-before-create logic, so any ALREADY_EXISTS was a hard failure propagated to the UI.

## Solution

Two complementary changes in `stigmer-cloud`:

1. **User-scoped deterministic slug** — Encode identity into the managed environment slug: `oauth-{mcpServerSlug}-{identitySuffix}`, where `identitySuffix` is the last 8 characters of the ULID portion of the `identityAccountId`. This gives each (user, mcp_server, org) tuple a unique slug.

2. **Idempotent find-or-create** — New `ManagedEnvironmentService.findOrCreateManagedEnvironment` method that: (a) looks up by (org, slug) first, verifying the `stigmer.ai/managed=true` label; (b) creates via the full gRPC pipeline with an explicit slug on metadata; (c) catches `ALREADY_EXISTS` from a concurrent race and retries the lookup.

## Implementation Details

### ManagedEnvironmentService.java

- Added `EnvironmentRepo` dependency for direct slug-based lookup (documented boundary crossing, following the same pattern as `McpServerConnectHandler` in this domain)
- New `findOrCreateManagedEnvironment(name, slug, org, identityAccountId)` method with three-phase resolution: find → create → retry-on-race
- Existing `createManagedEnvironment` preserved for backward compatibility

### McpServerCompleteOAuthConnectHandler.java — ExchangeAndStore

- `resolveOrCreateManagedEnvironment` now loads the MCP server's slug (not just name) and computes the user-scoped slug
- New `identitySuffix` helper extracts the last 8 chars of the ULID portion of the identity account ID (Crockford base32, always slug-safe)
- Calls `findOrCreateManagedEnvironment` instead of `createManagedEnvironment`

### Data Cleanup

- Deleted 1 orphaned managed environment from production MongoDB (`env_01knyhbg6j3y3cyscdp7bbwyj6`, slug `oauth-mcp-server-slack`, org `suresh`)
- The `oauth_grant` collection was already empty (grants cleaned up during earlier testing)

## Benefits

- Multiple users in the same org can now independently connect to the same OAuth MCP server
- Partial failures and orphaned environments are recovered gracefully on retry
- Race conditions between concurrent connects are handled without errors

## Impact

- **OAuth Connect**: All 13 OAuth-capable MCP servers are unblocked for multi-user orgs
- **Resilience**: The find-or-create pattern eliminates a class of partial-failure bugs in the OAuth flow

## Related Work

- `20260411.19.managed-environment-service-oauth-token-storage` — Introduced `ManagedEnvironmentService` and the managed env concept
- `20260411.21.fix-mcp-connect-401-and-delete-handler-pipeline` — Fixed the 401 from missing OAuth token in connect flow

---

**Status**: ✅ Production Ready
**Repositories**: stigmer-cloud (2 files), production MongoDB (1 document deleted)
