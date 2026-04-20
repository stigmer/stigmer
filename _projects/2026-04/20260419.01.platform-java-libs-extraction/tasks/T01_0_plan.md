# Task T01: Make Java Libs Proto-Agnostic

**Created**: 2026-04-19
**Last updated**: 2026-04-20
**Status**: COMPLETE — T02 approved and in progress
**Type**: Refactoring

## Locked decisions (from [DD-001](../design-decisions/001-neutral-interfaces-and-reflection-contract.md))

These decisions were authorized by the developer on 2026-04-20 and are now binding for T01-T07. See the design decision doc for full rationale.

1. **Abstraction shape**: `ResourceKind` (typed wrapper around String) + `ResourceMetadata` Java interface + `ProtoReflectionMetadataAdapter`. Same shape extended to audit, authorization config, IAM, and identity buckets.
2. **Java package rename**: `ai.stigmer.<module>.*` → `ai.stigmer.platform.<module>.*` for every extracted lib. Done as a single mechanical commit at the **start of T07**, immediately before Maven publishing. Reversed from earlier upfront-timing decision (see [DD-001 Decision 2](../design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-2--java-package-rename-to-aistigmerplatform) for reasoning).
3. **Maven group ID**: `ai.stigmer.platform`. No commons proto module published.
4. **No commons proto module**: each product duplicates the small handful of contract messages (ApiResourceMetadata, audit, visibility, field options) in its own apis repo. The libs read fields BY NAME via reflection, with a `MetadataContractValidator` that fails fast at startup if a registered proto type doesn't satisfy the field-name contract.

## Objective

Refactor the shared Java libs so they work with ANY product's proto types, not just Stigmer's. This unblocks Maven publishing and Scenar Cloud reuse.

## What the audit revealed (changes the original plan)

The original plan assumed coupling flowed through "two root types" (`ApiResourceKind` enum, `ApiResourceMetadata`). The [audit](T01_1_audit.md) found ~85 files across all six lib modules importing ~28 distinct proto types in NINE conceptual buckets. The interface design still holds, but the per-file work is larger than originally scoped, and several buckets (audit, find request, IAM, field options, redis-starter, proto-class discoverer) were not in the original plan.

## Task breakdown

### T01: Audit, interface design (this task) — COMPLETE

- [x] Grep all `protos.ai.stigmer.*` imports under `backend/libs/java/` — see [T01_1_audit.md](T01_1_audit.md)
- [x] Design `ResourceKind` value-object (NOT bare String — typed wrapper for safety)
- [x] Design `ResourceMetadata` interface with reflection adapter
- [x] Design `ResourceAudit` / `AuditInfo` / `AuditActor` / `AuditEventType` (Bucket C — audit didn't appear in original plan)
- [x] Design `FindRequest` interface + adapter (Bucket D — also new)
- [x] Design `MethodAuthorizationConfig` + `KindAuthorizationConfig` + `ParentRelation` family (Bucket E)
- [x] Design `AuthorizationPolicy` / `Role` / `Permission` / `ResourceRef` (Bucket F — replaces IAM proto types)
- [x] Design `AuthenticatedIdentity` and `ApiKeyDescriptor` (Bucket G)
- [x] Design `KindRegistry` interface
- [x] Design `MetadataContractValidator` + `MetadataContractStartupCheck` for fail-fast on bad config
- [x] Document the field-name contract (the spec the validator enforces)
- [x] Capture the four locked decisions in [DD-001](../design-decisions/001-neutral-interfaces-and-reflection-contract.md)
- [x] Get developer approval before proceeding to T02

> **Note on mechanical rename**: originally planned as the last step of T01 but moved to the first step of T07 (Maven publishing). See [DD-001 Decision 2](../design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-2--java-package-rename-to-aistigmerplatform) for reasoning. This means T02-T06 work in the existing `ai.stigmer.<lib>.*` namespace.

### T02: Refactor api-shape (Kind, Metadata, Audit) — COMPLETE

The foundation — all other modules depend on this.

> **Plan revision (2026-04-20, T02 planning session)**: T02 is now **purely additive**. New proto-agnostic beans and interfaces are introduced in `.neutral` sub-packages alongside the existing proto-coupled static utilities. Old static classes stay completely untouched so stigmer-service keeps compiling. Consumer migration is owned by T03/T04/T05. T07 deletes the legacy classes once nothing imports them. See [DD-001 Decisions 5-9](../design-decisions/001-neutral-interfaces-and-reflection-contract.md) for the five new sub-decisions locked in this session.

- [x] T02.0: Update planning docs with five new sub-decisions (DD-001 Decisions 5-9)
- [x] T02.1: Foundation interfaces/records/enums — 22 production files in `.neutral` sub-packages
- [x] T02.2: Reflection adapters (read + write) + round-trip property tests — 4 production files, 2 test files
- [x] T02.3: Contract validators + startup check — 4 production files, 1 test file
- [x] T02.4: Read-side beans — 12 bean files with unit tests
- [x] T02.5: Write-side beans — 6 bean files with unit tests
- [x] T02.6: `IamRoleMetadata` + `ApiResourceKindExtractor` marked `@Deprecated(forRemoval=true)`
- [x] T02.7: Stale javadoc removed; 4 `package-info.java` files created
- [x] T02.8: Checkpoint created; plan + next-task updated

### T03: Refactor api-state (Repository Layer)

- [ ] Replace `ApiResourceKind kind()` with `ResourceKind kind()` in `ApiResourceRepository` interface
- [ ] Update `AbstractMongoApiResourceRepository` to use `ResourceMetadata` interface (the Mongo field paths `metadata.id`/`metadata.org`/`metadata.slug` already work with reflection-based metadata since they're document field paths, not Java type references)
- [ ] Replace `ApiResourceProtoClassesDiscoverer` enum-based discovery with config-driven base-package scan (audit Bucket A surprise)
- [ ] Update `ApiResourceProtoClassRegistry` to be keyed by `ResourceKind`
- [ ] Update `ApiResourceRepositoryRegistry` to use `ResourceKind`-keyed lookup
- [ ] Update `ApiResourceRepo` and `ApiResourceEntityAndProtoMapperMarker` annotations to take `String` kind value
- [ ] Update `ApiResourceEntityAndProtoMapperRegistry` to use `ResourceKind` keys
- [ ] All api-state tests pass

### T04: Refactor grpc-request (Pipeline Layer)

- [ ] Replace `ApiResourceKind` field in `ContextBase` and all subclasses (`CreateContextV2`, `UpdateContextV2`, `GetContextV2`, `DeleteContextV2`, `ApplyContextV2`, `FindOperationContextV2`, `CustomOperationContextV2`) with `ResourceKind`
- [ ] Replace `RpcAuthorizationConfig` field in `RequestMethodMetadata` and `RequestMethodMetadataRegistry` with `MethodAuthorizationConfig` interface
- [ ] Update `ResolveSlugStepV2` to use `ResourceMetadata`
- [ ] Update `AuthorizeRequestStepV2` to use `MethodAuthorizationConfig`
- [ ] Update `ValidateVisibilityStep` and `UpdateVisibilityTuplesStep` to use `ResourceMetadata.visibility()`
- [ ] Update `CreateAuthorizationTuplesStepV2`, `UpdateOperationPreserveResourceIdentifiersStepV2` to use `ResourceMetadata`
- [ ] Update `CreateOperationSetAuditStepV2`, `UpdateOperationSetAuditStepV2`, `DeleteOperationUpdateAuditStep` to use `ResourceAudit` family
- [ ] Update `CreateOperationSetVersionStepV2` to use `ResourceMetadata.versionId()`
- [ ] Update `ApiResourceComputedFieldsClearer` and `ComputedFieldsValidator` to read field options by NAME (not by `FieldOptionsProto` Java type)
- [ ] Replace `FindApiResourcesRequest` field in `FindOperationContextV2` and `InterceptorAwareFindOperationContextFactory` with `FindRequest` adapter
- [ ] Update `ApiResourceResponseTransformer` and `ApiResourceAuditActorCacheProxy` to use `AuditActor` interface
- [ ] Update `AuditActorBuilder`, `ResourceLoaderService`, `ResourceLoaderV2`, `DefaultResourceLoaderV2` to use `ResourceKind`
- [ ] Update `ApiResourceStateRepoReadAdapter` and `ApiResourceStateRepoWriteAdapter` to use `ResourceKind`
- [ ] Operation pipelines (`FindOperationPipeline`, etc.) — minimal changes since they compose steps
- [ ] All grpc-request tests pass

### T05: Refactor api-authentication, api-authorization, infra/redis-starter

- [ ] api-authentication: Replace `IdentityAccount` proto with `AuthenticatedIdentity` interface in `IdentityAccountGrpcRepo`, `IdentityAccountMongoRepo`, `IdentityAccountRedisCacheRepo`
- [ ] api-authentication: Replace `ApiKey` proto with `ApiKeyDescriptor` interface in `ApiKeyGrpcRepo`, `ApiKeyRedisCacheRepo`, `ApiKeyHashToApiKeyCacheProxy`, `ApiKeyOwnerIdentityAccountIdExtractor`
- [ ] api-authentication: Replace `ApiResourceAuditActor` import in `IdentityAccountGrpcRepo` with `AuditActor` interface
- [ ] api-authentication: Make `GrpcSecurityConfigBase` configuration-driven (remove proto-type imports)
- [ ] api-authentication: Make `StigmerJwtIssuer`/`StigmerJwtVerifier` product-neutral (rename to `PlatformJwtIssuer`/`PlatformJwtVerifier`, config-driven issuer name)
- [ ] api-authentication: Extract Redis template beans for Stigmer-specific types out of the core lib into stigmer-service config
- [ ] api-authorization: Replace `IamPolicySpec` / `IamPermission` / `IamRole` / `RoleInfo` / `ApiResourceRef` with `AuthorizationPolicy` / `Role` / `Permission` / `ResourceRef` interfaces in `IamPolicyCreationService`, `IamPolicyGrpcRepo`, `IamPolicyCreationException`, `RequestAuthorizationService`, `OnBehalfOfAuthorizationGuard`
- [ ] api-authorization: Replace `PlatformConstants.PLATFORM_RESOURCE_ID = "stigmer"` with configurable value
- [ ] api-authorization: Replace `ApiResourceKind` with `ResourceKind` in `TupleCreationRequest`, `ApiRequestAuthorizationResourceIdExtractor`, `ParentIdExtractorRegistry`, `RequestAuthorizationConfigRegistryTest`
- [ ] api-authorization: Replace `RpcAuthorizationConfig`, `AuthorizationConfig`, `AuthorizationScopeType`, `OwnerAttributionType`, `ParentRelationConfig` with the Bucket E interface family
- [ ] api-authorization: Tests in `ParentIdExtractorRegistryTest` use concrete agentic proto types as fixtures — replace with synthetic test fixtures defined in lib test sources, OR move test to stigmer-service
- [ ] infra/redis-starter: Make `RedisConfiguration` register Redis templates via configuration (not hard-coded proto-type imports) — audit surprise
- [ ] All auth + redis-starter tests pass

### T06: Migrate stigmer-service to consume refactored libs

- [ ] Register Stigmer's resource kinds (one entry per concrete `ApiResourceKind` enum value) in the `KindRegistry` at startup, providing `KindMetadata` for each
- [ ] Provide `StigmerResourceMetadataAdapter` only if reflection adapter is insufficient (likely not needed)
- [ ] Provide Stigmer-specific `MethodAuthorizationConfig` mappings (a small adapter from `RpcAuthorizationConfig` proto to the interface)
- [ ] Provide Stigmer-specific `KindAuthorizationConfig` registrations
- [ ] Provide Stigmer-specific `AuthorizationPolicy` / `Role` adapters from existing IAM proto types
- [ ] Provide Stigmer-specific Redis template beans (moved out of `infra/redis-starter` in T05)
- [ ] Provide Stigmer-specific identity / api-key adapters from existing proto types
- [ ] All stigmer-service integration tests pass
- [ ] No behavioral changes to any existing API
- [ ] Run `MetadataContractValidator` at startup — must pass without violations

### T07: Maven Publishing Setup

- [ ] **Mechanical package rename (FIRST sub-task of T07)** — single dedicated commit moving `ai.stigmer.<lib>.*` → `ai.stigmer.platform.<lib>.*` for every lib root package (apishape, apistate, apiauthentication, apiauthorization, grpc, grpcrequest, infra, utils). Updates: Java sources (~200+ files), `BUILD.bazel` `test_class` strings + `srcs` paths, stigmer-service imports. Pure rename, zero behavior change. Verified by full `bazel build //...` + `bazel test //...`. Confirm no collision with existing `ai.stigmer.platform.github` (4 files in stigmer-service).
- [ ] (Optional, separate commit) Move `ai.stigmer.platform.github` out of `ai.stigmer.platform.*` (e.g., to `ai.stigmer.downstream.github`) so the platform namespace stays pure for cross-product infra.
- [ ] Add Maven publishing configuration (Bazel `maven_export` rules — already used elsewhere in repo, check existing patterns)
- [ ] Define artifact coordinates under group `ai.stigmer.platform`:
  - `ai.stigmer.platform:grpc-request`
  - `ai.stigmer.platform:api-state`
  - `ai.stigmer.platform:api-shape`
  - `ai.stigmer.platform:api-authentication`
  - `ai.stigmer.platform:api-authorization`
  - `ai.stigmer.platform:redis-starter`
  - `ai.stigmer.platform:grpc-router-codegen`
- [ ] Test: a fresh Java project can depend on the Maven artifacts and build a pipeline with custom proto types satisfying the field-name contract
- [ ] CI: publish snapshots on main, releases on tags
- [ ] Document the metadata field-name contract publicly (README + JavaDoc on `ResourceMetadata`)

> **Removed from T07**: "Publish commons proto stubs as a separate artifact." Per [DD-001 Decision 4](../design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-4--no-commons-proto-module-field-name-contract--startup-validator), there is no commons proto module. Each product duplicates the contract messages in its own apis repo.

## Dependencies

- This project modifies `stigmer-cloud/backend/libs/java/` — must not break `stigmer-service`.
- No proto-side work required (no commons proto module to publish).

## Execution order

T01 → T02 → T03 → T04 → T05 → T06 → T07 (sequential — each builds on the previous)

T02 and T03 could potentially be parallelized since they touch different modules, but T02 (api-shape) should go first as api-state depends on it.

## Notes

- All knowledge folders required developer permission. The `design-decisions/001-...md` doc was authorized by the developer on 2026-04-20 when they asked to track the four decisions in the plan.
- Task logs (T##_1_*.md, T##_2_*.md) can be updated freely.
- Update [DD-001](../design-decisions/001-neutral-interfaces-and-reflection-contract.md) if any of the four decisions change after approval to start T02.

## Review process

The four core decisions are LOCKED. T01 deliverables (audit, interface sketches, design decision doc, this plan) are complete. Remaining gate:

1. **Approval to start T02** (api-shape refactor — replace `ApiResourceMetadata` cast and `ApiResourceKind` enum usage with the neutral interfaces).

The mechanical package rename is now scheduled for the start of T07, not T01. There are no open questions for the developer at this stage.
