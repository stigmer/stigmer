# T04: BYOA Infrastructure — Override Repo, Resolution Service, Migration

**Date**: April 13, 2026

## Summary

Built the core data layer and resolution logic for Bring Your Own App (BYOA) OAuth support. Organizations can now maintain independent OAuth app overrides for shared MCP servers, with a resolution chain that selects org override over platform default. Also corrected two misplaced query RPCs from the command controller to the query controller.

## Problem Statement

The platform's OAuth integration was hardcoded to the platform-default OAuthApp for every organization. There was no mechanism for an org admin to register their own OAuth app credentials for a shared MCP server (e.g., the platform's Figma or Slack integration).

### Pain Points

- Organizations blocked by vendor approval on the platform's OAuth app had no alternative
- Token refresh service used a hardcoded `findBySlug` with no override path
- No data model existed for per-org OAuth app bindings
- Two query RPCs (`getOAuthGrantStatus`, `getOrgOAuthApp`) were incorrectly placed on the command controller

## Solution

Implemented the BYOA infrastructure layer (T04 of the OAuth BYOA integration project):

1. **OAuthAppOverride persistence** — MongoDB document and repository for the `(resourceId, resourceKind, orgId)` → `oauthAppId` binding
2. **OAuthAppResolutionService** — Two-step resolution chain: org override → platform default → none
3. **Mongock migration** — Collection creation with unique compound index
4. **Proto correction** — Moved `getOAuthGrantStatus` and `getOrgOAuthApp` to `McpServerQueryController`

## Implementation Details

### New Files (stigmer-cloud)

- **`OAuthAppOverrideDocument.java`**: Plain `@Data` POJO following `OAuthGrantDocument` pattern — no Spring Data annotations, composite key managed by the repository.
- **`OAuthAppOverrideRepo.java`**: `MongoTemplate`-based with `find`, `upsert` (with `setOnInsert` for `createdAt`), and `delete` by composite key. Manual `Document` → POJO mapping with BSON `Instant`/`Date` variance handling.
- **`OAuthAppResolutionService.java`**: Stateless `@Service` implementing the resolution chain. Returns `ResolvedOAuthApp` record with `OAuthApp` + `OAuthAppSource` enum. Includes `resolveForMcpServer` convenience and `resolveClientSecret` for token refresh integration. Documents the cross-domain `OAuthAppRepo` access (same pattern as `OAuthTokenRefreshService`).
- **`U20260413_CreateOAuthAppOverrideCollection.java`**: Mongock `@ChangeUnit` (order 018) creating `oauth_app_override` collection with unique compound index on `(resourceId, resourceKind, orgId)`.

### Proto Correction (stigmer)

Moved two read-only RPCs from `McpServerCommandController` to `McpServerQueryController`:
- `getOAuthGrantStatus` — returns grant metadata, `can_view` authorization
- `getOrgOAuthApp` — returns override metadata, `can_view` authorization

Regenerated stubs across all four SDKs (Go, Java, TypeScript, Python) and updated the backend handler's `@RequestRoute` annotation.

### Architecture Decision: No Enricher

During planning, discovered that query-time enrichment of BYOA status on the get pipeline is not feasible — the BYOA override is keyed by the caller's active org, but the get-by-ID pipeline has no org context. Resolution: the existing `getOrgOAuthApp` RPC (defined in T01, explicit org parameter) already provides what the frontend needs. The frontend composes effective source from three calls: get (vendor approval) + getOrgOAuthApp (override check) + getOAuthGrantStatus (connection health).

## Benefits

- Organizations can bypass vendor approval delays by providing their own OAuth credentials
- Resolution chain is backward-compatible — no override means behavior is identical to before
- Defensive fallthrough: if an override's OAuthApp is deleted, the chain falls back to platform default
- The `resolveClientSecret` method provides a clean integration point for T05 handlers and token refresh

## Impact

- **T05 (BYOA handlers)**: Unblocked — `setOrgOAuthApp`, `getOrgOAuthApp`, `deleteOrgOAuthApp` handlers can now consume the repo and resolution service
- **T05 (token refresh integration)**: `OAuthAppResolutionService.resolveClientSecret` replaces the hardcoded `findBySlug` in `OAuthTokenRefreshService`
- **T07 (frontend BYOA)**: Unblocked via T05 → the frontend BYOA experience has its data layer ready
- **All SDK consumers**: `getOAuthGrantStatus` and `getOrgOAuthApp` now correctly route through the query client

## Related Work

- [T01: Proto layer](2026-04-13-130208-oauth-byoa-proto-layer.md) — defined OAuthAppOverride, OAuthAppSource, new RPCs
- [T02: Disconnect + grant health](2026-04-13-133813-implement-oauth-disconnect-and-grant-health.md) — disconnect handler, health evaluation
- [T03: Refresh + vendor gate + error UX](2026-04-13-131630-harden-oauth-refresh-vendor-gate-error-ux.md) — execution-path hardening

---

**Status**: Production Ready
**Commits**: stigmer `7894f2130`, stigmer-cloud `0dea473a`
