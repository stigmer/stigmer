# Fix Figma OAuth Token Endpoint URL

**Date**: April 12, 2026

## Summary

Fixed Figma OAuth sign-in failure caused by an outdated token exchange endpoint. The seeded OAuthApp used `https://www.figma.com/api/oauth/token`, which Figma deprecated in favor of `https://api.figma.com/v1/oauth/token`. The old endpoint returns HTTP 404, blocking all Figma OAuth connections.

## Problem Statement

Users attempting to connect the Figma MCP server via OAuth were encountering an immediate failure during the token exchange step:

```
Token exchange failed: Token endpoint https://www.figma.com/api/oauth/token returned HTTP 404: Not Found
```

### Pain Points

- Figma OAuth sign-in was completely broken — no user could connect
- The error occurred after the user completed the Figma authorization prompt, so it appeared the integration was "almost working"
- A second cascading error ("No pending OAuth state found") appeared because the state was consumed by the first (failed) attempt

## Solution

Created a new Mongock migration (`U20260412_PatchFigmaOAuthAppTokenUrl`, order 015) that patches the existing Figma OAuthApp document in MongoDB to use the correct token endpoint. Also updated the seed migration so fresh deployments get the correct URL from the start.

## Implementation Details

### New Migration: `U20260412_PatchFigmaOAuthAppTokenUrl`

- **Location**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/`
- **Pattern**: Single-field patch on existing document (same pattern as `U20260411b_PatchSlackOAuthAppScopeParam`)
- **Change**: `spec.tokenUrl` from `https://www.figma.com/api/oauth/token` → `https://api.figma.com/v1/oauth/token`
- **Idempotent**: Skips if document doesn't exist or already has the correct URL
- **Rollback**: Restores the old URL

### Seed Migration Update

- Updated `U20260411_SeedVendorOAuthApps.java` line 131 to use the new endpoint, ensuring fresh deployments are correct without needing the patch migration

### Figma API Context

Figma migrated their OAuth token exchange endpoint from the `www.figma.com` domain to `api.figma.com` (announced October 2024 in their [changelog](https://developers.figma.com/docs/rest-api/changelog/)). The old endpoint now returns 404.

| Endpoint | Old (broken) | New (correct) |
|---|---|---|
| Token exchange | `https://www.figma.com/api/oauth/token` | `https://api.figma.com/v1/oauth/token` |
| Token refresh | N/A | `https://api.figma.com/v1/oauth/refresh` |

## Benefits

- Figma OAuth sign-in is unblocked for all users
- Fresh deployments will have the correct URL without needing the patch migration

## Impact

- **Users**: All users attempting to connect Figma MCP servers via OAuth
- **Services**: `stigmer-service` (migration runs on startup)
- **Risk**: Low — targeted single-field update on one document

## Related Work

- `U20260411_SeedVendorOAuthApps` — original seed migration that introduced the incorrect URL
- `U20260411b_PatchSlackOAuthAppScopeParam` — precedent for single-field OAuthApp patch migrations

---

**Status**: ✅ Production Ready
