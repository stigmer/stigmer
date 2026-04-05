# IAM Access-List and Revocation Backend RPCs

**Date**: April 5, 2026

## Summary

Implemented four new IAM policy RPCs and the supporting backend infrastructure to enable access-list views, role queries, member counts, and organization-level access revocation. This work adapts Planton's Postgres-based IAM access patterns to Stigmer Cloud's MongoDB backend through three key architectural decisions: static role metadata, in-application display enrichment, and application-level hierarchy traversal.

## Problem Statement

The IAM grantable-roles client strategy (Track 1) builds SDK components for role selectors and access management UIs, but the backend had no RPCs to answer fundamental IAM questions:

- "Who has access to this organization and what roles do they have?"
- "What roles does a specific user have on a resource?"
- "How many members does this organization have?"
- "How do I remove all of a user's access to an organization?"

### Pain Points

- The existing `IamPolicy` service only supported create, delete, and authorization checks — no read/list operations for access management
- Planton's reference implementation used Postgres-specific features (recursive CTEs, `json_agg`, joins with `iam_role` and `api_resource_index` tables) that have no direct MongoDB equivalent
- No backend support for displaying role metadata (human-readable names, descriptions)
- No mechanism for inherited access resolution (parent resource roles cascading to children)
- Removing a user from an organization required individually identifying and deleting each policy

## Solution

Designed a MongoDB-native approach based on three confirmed architectural decisions:

1. **Role metadata as a Java utility class** (`IamRoleMetadata`): The four IAM roles are a fixed, small set. A static `Map<IamRole, RoleInfo>` is simpler, faster, and more type-safe than a database table, with zero deployment coupling.

2. **In-application display enrichment** (`PrincipalEnricher`): Batch-loads display information from `IdentityAccountRepo` for principals referenced in policies. Avoids the write-time synchronization complexity of maintaining a denormalized index collection. Acceptable because access-list views have bounded result sets.

3. **Application-level hierarchy traversal** (`ResourceHierarchyResolver`): Walks "scope tuples" (IAM policies with structural relations like "organization" or "platform") upward from a resource. Capped at 10 hops. Clearer and more maintainable than MongoDB `$graphLookup` given the shallow hierarchy depth (typically 2-3 levels).

## Implementation Details

### Proto Definitions (stigmer repo)

Added 4 new RPCs to the `IamPolicy` service:

| RPC | Controller | Input | Output | Permission |
|-----|-----------|-------|--------|------------|
| `listResourceAccessByPrincipal` | Query | `ListResourceAccessInput` | `ResourceAccessByPrincipalList` | `can_view_access` |
| `getPrincipalResourceRoles` | Query | `PrincipalResourceInput` | `PrincipalResourceRoles` | `can_view_access` |
| `getPrincipalsCount` | Query | `GetPrincipalsCountInput` | `PrincipalsCount` | `can_view_access` |
| `revokeOrgAccess` | Command | `RevokeOrgAccessInput` | `Empty` | `can_grant_access` |

All proto input/output messages were already defined in `io.proto` — the RPCs were the missing wiring.

### Utility Classes (stigmer-cloud repo)

**`IamRoleMetadata`** (api-shape library):
- Static `Map<IamRole, RoleInfo>` mapping each role to display metadata
- `fromRelationString(relation)` converts FGA relation names to `RoleInfo` protos
- `resolveRole(relation)` returns `Optional<IamRole>` for filtering structural vs. assignable relations
- `isAssignableRole(relation)` predicate for excluding structural tuples from access lists

**`ResourceHierarchyResolver`** (stigmer-service):
- `resolve(resourceKind, resourceId, includeInherited)` returns an ordered list of `ResourceRef` from child to root
- Uses `IamPolicyRepo.findScopeTuple()` to walk the ownership chain
- Capped iteration prevents infinite loops from data inconsistencies

**`PrincipalEnricher`** (stigmer-service):
- `enrich(Collection<IamPolicy>)` returns `Map<String, ApiResourceRefView>` keyed by `"kind:id"`
- Groups principals by kind, batch-loads from respective repositories
- Currently supports `identity_account` kind — extensible for service accounts, teams
- Builds `ApiResourceRefView` with name, email, and avatar URL

### Repository Methods (IamPolicyRepo)

Added 5 new query methods using `MongoTemplate` and `Criteria`:

- `findByResourceExcludingRelations` — policies on a resource, excluding structural relations
- `findByPrincipalAndResource` — direct lookup for a principal-resource pair
- `countDistinctPrincipalsByResource` — MongoDB aggregation (`$group` + `$count`) for member count badges
- `findScopeTuple` — finds the single scope/ownership tuple for a resource
- `findByIdentityAccountInOrg` — all policies where a user is principal within an org scope

### Handlers

All four handlers follow the established `CustomOperationHandlerV2` + `RequestPipelineV2` pattern:

**`IamPolicyListResourceAccessByPrincipalHandler`** (most complex):
1. Resolves resource hierarchy (if `include_inherited`)
2. Queries policies across all hierarchy levels
3. Batch-enriches principal display data
4. Groups policies by principal, maps roles to `RoleInfo` via `IamRoleMetadata`
5. Builds `PrincipalAccess` entries with `is_inherited` flag

**`IamPolicyGetPrincipalResourceRolesHandler`**:
1. Queries policies for specific principal-resource pair
2. Filters to assignable roles only
3. Maps to `RoleInfo` list

**`IamPolicyRevokeOrgAccessHandler`**:
1. Finds all policies where user is principal within the org
2. Batch-deletes OpenFGA tuples
3. Removes MongoDB documents

**`IamPolicyGetPrincipalsCountHandler`**:
1. Runs MongoDB aggregation to count distinct principals
2. Excludes structural relations and system principals
3. Returns integer count for badge display

## Benefits

- **Access management UI unblocked**: Frontend can now render "Members" pages, role editors, and member count badges
- **One-operation user removal**: `revokeOrgAccess` replaces manual per-resource policy deletion
- **Inherited access visibility**: `include_inherited` flag enables showing both direct and inherited roles in access views
- **Clean Postgres-to-MongoDB adaptation**: No schema compromises — uses MongoDB's strengths (flexible queries, aggregation pipelines) instead of forcing relational patterns
- **Extensible enrichment**: `PrincipalEnricher` is designed for additional principal kinds without changing the handler code

## Impact

- **Backend**: 7 new Java files, 155 lines added to `IamPolicyRepo`, all 57 Bazel targets compile
- **APIs**: 4 new RPCs across 2 controllers, regenerated stubs in 5 languages (Go, Java, Python, TypeScript, Dart)
- **SDKs**: Generated SDK clients updated with new methods in all 4 SDKs (Go, Java, Python, TypeScript)
- **Cross-repo**: Changes span both `stigmer` (protos) and `stigmer-cloud` (implementation)

## Related Work

- **Prerequisite**: Session 1-2 (IamRole/IamPermission enum split, `grantable_roles` on `AuthorizationConfig`)
- **Prerequisite**: Session 4 (`ValidateGrantableRole` pipeline step)
- **Parallel**: Track 1 — SDK codegen and React components for IAM access management
- **Upstream**: Identity provider flow (Phases 1-5) — federated account creation provides the user data that `PrincipalEnricher` displays
- **Reference**: Planton `IamPolicyRepoCustomImpl` — Postgres-based implementation that informed the MongoDB adaptation

---

**Status**: Production Ready
**Timeline**: ~2 hours (analysis, architectural decisions, implementation, build verification)
