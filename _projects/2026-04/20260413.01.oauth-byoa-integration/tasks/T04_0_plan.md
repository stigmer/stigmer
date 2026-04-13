# Task T04: Backend — BYOA Infrastructure (Resolution Service + Repo + Enricher)

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer-cloud
**Estimated scope**: ~8-10 new files
**Depends on**: T01 (proto stubs)

## Objective

Build the core BYOA data layer: the `OAuthAppOverride` MongoDB repository, the `OAuthAppResolutionService` that implements the resolution chain, and the query-time enricher that populates effective OAuth source on MCP server responses.

## Context

This task creates the infrastructure that T05 (handlers) will consume. It introduces no new RPCs — it's purely the data layer and resolution logic.

### Resolution Chain (implemented in `OAuthAppResolutionService`)

```
resolveEffectiveOAuthApp(resourceId, resourceKind, orgId, mcpServerAuth):
  1. Check OAuthAppOverrideRepo.find(resourceId, resourceKind, orgId)
     → Found? Load OAuthApp by oauth_app_id → return (oauthApp, ORG_OVERRIDE)
  2. Check mcpServerAuth.oauth_app_ref
     → Set + OAuthApp found? → return (oauthApp, PLATFORM)
  3. Return (null, NONE)
```

## Deliverables

### 1. `OAuthAppOverrideDocument`

New document class at `domain/agentic/mcpserver/oauth/OAuthAppOverrideDocument.java`:

```java
@Data
@Document(collection = "oauth_app_override")
public class OAuthAppOverrideDocument {
    @Id
    private String id;
    private String resourceId;
    private String resourceKind;
    private String orgId;
    private String oauthAppId;
}
```

### 2. `OAuthAppOverrideRepo`

New repository at `domain/agentic/mcpserver/oauth/OAuthAppOverrideRepo.java`:

Methods:
- `Optional<OAuthAppOverrideDocument> find(String resourceId, String resourceKind, String orgId)`
- `void upsert(OAuthAppOverrideDocument doc)` — upsert by composite key
- `void delete(String resourceId, String resourceKind, String orgId)`

Composite unique index on `(resourceId, resourceKind, orgId)`.

### 3. `OAuthAppResolutionService`

New service at `domain/agentic/mcpserver/oauth/OAuthAppResolutionService.java`:

```java
@Service
public class OAuthAppResolutionService {
    record ResolvedOAuthApp(OAuthApp oauthApp, OAuthAppSource source) {}

    /**
     * Resolves the effective OAuthApp for a resource + org using the chain:
     * 1. Org-specific override (OAuthAppOverrideRepo)
     * 2. Platform default (McpServerAuth.oauth_app_ref)
     * 3. None
     */
    public ResolvedOAuthApp resolve(
            String resourceId, String resourceKind, String orgId,
            McpServerAuth auth) { ... }

    /**
     * Convenience: resolve using an MCP server directly.
     */
    public ResolvedOAuthApp resolveForMcpServer(
            McpServer mcpServer, String orgId) { ... }
}
```

Uses `OAuthAppOverrideRepo` and `OAuthAppRepo` (direct access, same pattern as existing `OAuthTokenRefreshService` boundary crossing).

### 4. `McpServerOAuthAppOverrideEnricher`

New enricher at `domain/agentic/mcpserver/query/McpServerOAuthAppOverrideEnricher.java`:

Query-time enrichment (same pattern as existing `McpServerVendorApprovalEnricher`). Populates `effective_oauth_source` and `effective_oauth_app_id` on `McpServerAuth`.

Requires the caller's org context — enricher will need org passed from the handler (or derived from request context).

### 5. Wire enricher into query handlers

Add `McpServerOAuthAppOverrideEnricher` to the pipeline of:
- `McpServerGetHandler`
- `McpServerGetByReferenceHandler`

Must run AFTER `McpServerVendorApprovalEnricher` (vendor approval is resolved from the *effective* OAuthApp, not always the platform one).

### 6. Migration

`U2026XXXX_CreateOAuthAppOverrideCollection.java`:
- Create `oauth_app_override` collection
- Create unique compound index on `(resourceId, resourceKind, orgId)`

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `OAuthAppOverrideDocument.java` | Create | MongoDB document class |
| `OAuthAppOverrideRepo.java` | Create | Repository with find/upsert/delete |
| `OAuthAppResolutionService.java` | Create | Resolution chain logic |
| `McpServerOAuthAppOverrideEnricher.java` | Create | Query-time enrichment |
| `McpServerGetHandler.java` | Modify | Add enricher to pipeline |
| `McpServerGetByReferenceHandler.java` | Modify | Add enricher to pipeline |
| `McpServerVendorApprovalEnricher.java` | Modify | Resolve vendor approval from *effective* OAuthApp |
| Migration file | Create | Collection + index creation |

## Key Design Decisions

1. **`OAuthAppOverrideRepo` uses direct MongoDB access** (not gRPC pipeline), same pattern as `OAuthGrantRepo`. It's an internal document, not a full API resource.
2. **`OAuthAppResolutionService` accesses `OAuthAppRepo` directly** for the same reason as `OAuthTokenRefreshService` — needs unredacted `client_secret`.
3. **Enricher ordering matters**: override enricher must run before vendor approval enricher in query pipelines, so vendor approval is resolved from the effective OAuthApp (org override skips platform approval gating).

## Acceptance Criteria

- [ ] `OAuthAppOverrideRepo.find` returns override for exact `(resourceId, resourceKind, orgId)` match
- [ ] `OAuthAppResolutionService` correctly follows the chain: override → platform → none
- [ ] When no override exists, behavior is identical to current system (backward compatible)
- [ ] Query-time enrichment populates `effective_oauth_source` and `effective_oauth_app_id`
- [ ] Vendor approval enrichment uses the effective OAuthApp (not always platform)
- [ ] Migration creates collection with unique compound index

## Predecessor Tasks

T01 (proto + stubs)

## Successor Tasks

T05 (BYOA handlers that consume this infrastructure)
