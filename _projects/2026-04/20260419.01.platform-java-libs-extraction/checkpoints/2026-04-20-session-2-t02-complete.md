# Checkpoint: T02 Complete — api-shape proto-agnostic foundation

**Date**: 2026-04-20
**Session**: 2 (T02 planning + implementation)
**Scope**: `stigmer-cloud/backend/libs/java/api/api-shape/`

## What shipped

T02 introduced the proto-agnostic foundation as an **additive layer** in `.neutral` sub-packages alongside the existing proto-coupled static utilities. No existing code was modified beyond deprecation annotations and a stale javadoc cleanup.

### New types (T02.1)

Under `ai.stigmer.apishape.{kind,metadata,audit,role}.neutral`:

- **Kind**: `ResourceKind` record, `KindMetadata`/`KindAuthorizationConfig`/`KindVisibilityConfig`/`ParentRelation` interfaces, `AuthorizationScope`/`OwnerAttribution` enums, `KindRegistry`/`InMemoryKindRegistry`
- **Metadata**: `ResourceMetadata` interface, `Visibility` enum, `ImmutableResourceMetadata` record
- **Audit**: `ResourceAudit`/`AuditInfo`/`AuditActor` interfaces, `ImmutableResourceAudit`/`ImmutableAuditInfo`/`ImmutableAuditActor` records
- **Role**: `Role`/`Permission` interfaces, `RoleCatalog`/`InMemoryRoleCatalog`

### Reflection adapters (T02.2)

- `ProtoReflectionMetadataAdapter` (read) + `ProtoReflectionMetadataWriter` (write)
- `ProtoReflectionAuditAdapter` (read) + `ProtoReflectionAuditWriter` (write)
- Round-trip property tests using Stigmer's `Agent` proto as a fixture

### Contract validators (T02.3)

- `MetadataContractValidator`, `AuditContractValidator`, `ContractViolation`
- `MetadataContractStartupCheck` Spring component (fails boot on violations)

### Beans (T02.4 + T02.5)

Read-side: `KindExtractor`, `KindLister`, `KindMetadataResolver`, `KindGroupResolver`, `KindNameResolverBean`, `KindIsVersionedVerifier`, `KindIdPrefixExtractor`, `MetadataReader`, `MetadataYamlReader`, `AuthorizationConfigResolverBean`, `VisibilityConfigResolverBean`, `StatusAuditReader`

Write-side: `MetadataWriter`, `ResourceIdBuilder`, `VersionIdGenerator`, `StatusAuditBuilder`, `StatusAuditWriter`, `StatusAuditInfoWriter`

### Deprecation staging (T02.6)

- `IamRoleMetadata` marked `@Deprecated(since = "T02", forRemoval = true)` with relocation javadoc
- `ApiResourceKindExtractor` marked `@Deprecated(since = "T02", forRemoval = true)`

### Hygiene (T02.7)

- Removed stale `CloudResourceKindExtractor` javadoc reference
- Added `package-info.java` to all four `.neutral` sub-packages

## By the numbers

- **52 new production files** in `api-shape`
- **8 new test files**, **9 Bazel test targets**, all passing
- **2 existing files** modified with deprecation annotations
- **0 files** modified in any other module (api-state, api-authorization, grpc-request, stigmer-service)
- **`bazel build //backend/libs/java/api/api-shape/...`**: passes
- **`bazel test //backend/libs/java/api/api-shape/...`**: 9/9 pass

## Decisions locked during T02 planning (DD-001 Decisions 5-9)

5. Full bean conversion for api-shape helpers
6. Write-side reflection adapters
7. `IamRoleMetadata` staged deprecation (relocated in T05)
8. Authorization config embedded inside `KindMetadata`
9. Audit shape: two-bucket (match existing proto)

## What's next

T03: Refactor `api-state` (Repository Layer) — migrate `api-state` consumers to use the neutral types introduced in T02.
