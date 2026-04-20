# T01 Audit: `protos.ai.stigmer.*` imports across `backend/libs/java/`

**Date**: 2026-04-20
**Status**: COMPLETE
**Method**: `rg "^import protos\.ai\.stigmer\." backend/libs/java/`

## Headline finding

The original T01 plan claimed "all Stigmer-specific coupling flows through two root types: `ApiResourceKind` enum + `ApiResourceMetadata` concrete type". **This is incorrect.** The actual coupling surface is much larger.

- **~85 files** under `backend/libs/java/` import from `protos.ai.stigmer.*`.
- **~28 distinct proto types** are imported.
- All six lib modules (`api-shape`, `api-state`, `api-authentication`, `api-authorization`, `grpc-request`, `infra/redis-starter`) are coupled.

The good news: most of the coupling falls into a small number of **conceptual buckets** that map cleanly to the neutral interfaces we plan to introduce. So the interface design is still valid; the per-file work is just larger than originally scoped.

## File counts per module

- `api-shape`: 25 files
- `api-state`: 6 files
- `api-authentication`: 7 files
- `api-authorization`: 10 files
- `grpc-request`: 36 files (incl. tests)
- `infra/redis-starter`: 1 file

## Imported proto types grouped by conceptual bucket

### Bucket A: Resource kind / kind metadata (replaced by `ResourceKind` + `KindRegistry`)
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind` (enum, used as map key everywhere)
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKindProto` (file descriptor for kind enum)
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKindMeta` (per-kind metadata: id prefix, plural name, etc.)
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceGroupMeta`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceGroupProto`

**Files affected (sample)**: `ApiResourceKindExtractor`, `ApiResourceKindsGetter`, `ApiResourceKindMetaResolver`, `ApiResourceGroupMetaResolver`, `KindNameResolver`, `ApiResourceRepositoryRegistry`, `ApiResourceProtoClassRegistry`, every `*ContextV2` in `grpc-request/context/`.

### Bucket B: Resource metadata (replaced by `ResourceMetadata` interface + reflection adapter)
- `protos.ai.stigmer.commons.apiresource.ApiResourceMetadata`
- `protos.ai.stigmer.commons.apiresource.ApiResourceVisibility` (enum: PUBLIC/PRIVATE)

**Files affected**: `ApiResourceMetadataRetriever`, `ApiResourceMetadataSetter`, `ApiResourceMetadataAnnotationsManager`, `ValidateVisibilityStep`, `UpdateVisibilityTuplesStep`, `CreateAuthorizationTuplesStepV2`, `UpdateOperationPreserveResourceIdentifiersStepV2`.

### Bucket C: Audit trail (replaced by `AuditEvent` + `AuditActor` interfaces)
- `protos.ai.stigmer.commons.apiresource.ApiResourceAudit`
- `protos.ai.stigmer.commons.apiresource.ApiResourceAuditActor`
- `protos.ai.stigmer.commons.apiresource.ApiResourceAuditInfo`
- `protos.ai.stigmer.commons.apiresource.ApiResourceEventType` (enum)

**Files affected**: `ApiResourceStatusAuditBuilder`, `ApiResourceStatusAuditInfoSetter`, `ApiResourceStatusAuditSetter`, `ApiResourceStatusAuditGetter`, `EventTypeIsPersistRequiredVerifier`, `CreateOperationSetAuditStepV2`, `UpdateOperationSetAuditStepV2`, `DeleteOperationUpdateAuditStep`, `AuditActorBuilder`, `ApiResourceAuditActorCacheProxy`, `ApiResourceResponseTransformer`.

> **Audit was not in the original plan.** Treat as Bucket C addition; it should map to a `ResourceAudit` interface analogous to `ResourceMetadata`.

### Bucket D: gRPC request envelope (replaced by `FindRequest` interface or accessor)
- `protos.ai.stigmer.commons.apiresource.FindApiResourcesRequest`

**Files affected**: `FindOperationContextV2`, `InterceptorAwareFindOperationContextFactory`, `FindOperationHandlerV2`.

> **Not in original plan.** This is the standard "list with pagination/filter" request type the lib's Find pipeline expects. Either: (a) extract it as a real interface, or (b) accept `Message` + reflection on standard field names (`page_size`, `page_token`, `parent`).

### Bucket E: RPC method authorization (replaced by `MethodAuthorizationConfig` interface — already in plan)
- `protos.ai.stigmer.commons.rpc.RpcAuthorizationConfig`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.AuthorizationConfig`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.AuthorizationScopeType`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.OwnerAttributionType`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.ParentRelationConfig`
- `protos.ai.stigmer.commons.apiresource.apiresourcekind.VisibilityConfig`

**Files affected**: `AuthorizationConfigResolver`, `VisibilityConfigResolver`, `RequestAuthorizationService`, `AuthorizeRequestStepV2`, `IamPolicyCreationService`, `CreateAuthorizationTuplesStepV2`.

> **Bigger than the single `RpcAuthorizationConfig` mentioned in the plan.** Five sub-types form the authorization config family. All need neutral analogues.

### Bucket F: IAM types (need neutral `AuthorizationPolicy` + `Permission` + `Role` interfaces)
- `protos.ai.stigmer.iam.v1.IamPermission`
- `protos.ai.stigmer.iam.v1.IamRole`
- `protos.ai.stigmer.iam.iampolicy.v1.IamPolicySpec`
- `protos.ai.stigmer.iam.iampolicy.v1.RoleInfo`
- `protos.ai.stigmer.iam.iampolicy.v1.ApiResourceRef`

**Files affected**: `IamPolicyCreationService`, `IamPolicyGrpcRepo`, `IamPolicyCreationException`, `RequestAuthorizationService`, `OnBehalfOfAuthorizationGuard`, `IamRoleMetadata`, `DeleteOperationCleanupIamPoliciesStep`, `PlatformConstants`.

> **Bigger than expected.** Authorization is deeply IAM-coupled. Either keep IAM types in the platform layer (publish `iam` proto stubs as a separate platform artifact), or extract `AuthorizationPolicy` interface family.

### Bucket G: Identity / API key types (need neutral `AuthenticatedIdentity` + `ApiKeyDescriptor`)
- `protos.ai.stigmer.iam.identityaccount.v1.IdentityAccount`
- `protos.ai.stigmer.iam.apikey.v1.ApiKey`

**Files affected**: `IdentityAccountGrpcRepo`, `IdentityAccountMongoRepo`, `IdentityAccountRedisCacheRepo`, `ApiKeyGrpcRepo`, `ApiKeyRedisCacheRepo`, `ApiKeyHashToApiKeyCacheProxy`, `ApiKeyOwnerIdentityAccountIdExtractor`, `GrpcSecurityConfigBase`.

> **Matches T05 in the original plan**, but the surface is wider (Mongo + Redis repos, security config).

### Bucket H: Field-level proto extensions (need to migrate to neutral commons proto)
- `protos.ai.stigmer.commons.apiresource.FieldOptionsProto`

**Files affected**: `ApiResourceComputedFieldsClearer`.

> **Subtle.** Custom proto field options (e.g., `[(api_resource.computed) = true]`) live in this descriptor. If we drop the commons proto module, each product must define its own `FieldOptionsProto` with the same option names. Same convention-over-configuration approach as metadata fields.

### Bucket I: Concrete agentic types in tests (cleanup, not refactor)
- `protos.ai.stigmer.agentic.agentexecution.v1.*`
- `protos.ai.stigmer.agentic.agentinstance.v1.*`
- `protos.ai.stigmer.agentic.workflowinstance.v1.*`

**Files affected**: `ParentIdExtractorRegistryTest`.

> **Test-only.** These tests use real Stigmer proto types as fixtures. After T05, replace with synthetic test fixtures defined in the lib's test sources, or move these tests to stigmer-service.

## Surprise files outside the original scope

1. **`infra/redis-starter/src/main/java/.../RedisConfiguration.java`** imports proto types — Redis serializer is registered for specific proto types. Needs config-driven registration instead.
2. **`api-state/src/main/java/.../ApiResourceProtoClassesDiscoverer.java`** uses the `ApiResourceKind` proto descriptor file to discover proto classes. Needs to switch to scanning a configured base package or accept a `Set<Class<? extends Message>>`.
3. **`grpc-request/method/RequestMethodMetadata.java` and `RequestMethodMetadataRegistry.java`** — the request-method registry holds `RpcAuthorizationConfig` directly; needs to hold `MethodAuthorizationConfig` interface.

## Implications for the plan

1. **Add Bucket C (audit) as a first-class neutral interface family**: `AuditEvent`, `AuditActor`, `AuditInfo`. Today these are concrete proto types used pervasively in audit pipeline steps.
2. **Add Bucket D (FindRequest) handling** — either reflection-based or interface-based. Pick reflection (consistent with metadata approach).
3. **Add Bucket F (IAM)** decision: separate platform IAM artifact OR neutral `AuthorizationPolicy` interfaces. Recommend the latter to keep the libs proto-type-free.
4. **Add Bucket H (FieldOptionsProto)** to the metadata-contract spec: each product defines its own field options proto with the same option names.
5. **`infra/redis-starter`** needs config-driven proto type registration (not hard-coded imports).
6. **`api-state` proto-class discoverer** needs a Spring-config-driven base-package scan instead of enum-based discovery.

## Per-module file lists (full)

### api-shape (25 files)
- `apishape/apiversion/ApiGroupVersionResolver.java`
- `apishape/authorization/AuthorizationConfigResolver.java`
- `apishape/authorization/IamRoleMetadata.java`
- `apishape/authorization/VisibilityConfigResolver.java`
- `apishape/kind/ApiResourceKindExtractor.java`
- `apishape/kind/ApiResourceKindsGetter.java`
- `apishape/kind/kindname/KindNameResolver.java`
- `apishape/kind/meta/ApiResourceGroupMetaResolver.java`
- `apishape/kind/meta/ApiResourceKindMetaResolver.java`
- `apishape/metadata/ApiResourceMetadataRetriever.java`
- `apishape/metadata/ApiResourceMetadataSetter.java`
- `apishape/metadata/annotations/ApiResourceMetadataAnnotationsManager.java`
- `apishape/metadata/id/ApiResourceDefaultIdBuilder.java`
- `apishape/metadata/id/ApiResourceIdBuilderMarker.java`
- `apishape/metadata/id/ApiResourceIdBuilderRegistry.java`
- `apishape/metadata/id/ApiResourceIdPrefixExtractor.java`
- `apishape/metadata/slug/SlugResolver.java`
- `apishape/metadata/version/ApiResourceIsVersionedVerifier.java`
- `apishape/metadata/version/ApiResourceVersionIdGenerator.java`
- `apishape/status/audit/ApiResourceStatusAuditBuilder.java`
- `apishape/status/audit/ApiResourceStatusAuditGetter.java`
- `apishape/status/audit/ApiResourceStatusAuditInfoSetter.java`
- `apishape/status/audit/ApiResourceStatusAuditSetter.java`
- `apishape/status/audit/eventtype/EventTypeIsPersistRequiredVerifier.java`
- `apishape/authorization/VisibilityConfigResolverTest.java` (test)

### api-state (6 files)
- `apistate/annotation/ApiResourceRepo.java`
- `apistate/mapper/annotation/ApiResourceEntityAndProtoMapperMarker.java`
- `apistate/mapper/registry/ApiResourceEntityAndProtoMapperRegistry.java`
- `apistate/protoclass/ApiResourceProtoClassRegistry.java`
- `apistate/protoclass/library/ApiResourceProtoClassesDiscoverer.java`
- `apistate/repo/AbstractMongoApiResourceRepository.java`
- `apistate/repo/ApiResourceRepository.java`
- `apistate/repo/registry/ApiResourceRepositoryRegistry.java`

### api-authentication (7 files)
- `apiauthentication/apikey/library/ApiKeyHashToApiKeyCacheProxy.java`
- `apiauthentication/apikey/library/ApiKeyOwnerIdentityAccountIdExtractor.java`
- `apiauthentication/apikey/repo/ApiKeyGrpcRepo.java`
- `apiauthentication/apikey/repo/ApiKeyRedisCacheRepo.java`
- `apiauthentication/grpc/GrpcSecurityConfigBase.java`
- `apiauthentication/identityaccount/IdentityAccountGrpcRepo.java`
- `apiauthentication/identityaccount/IdentityAccountMongoRepo.java`
- `apiauthentication/identityaccount/repo/IdentityAccountRedisCacheRepo.java`

### api-authorization (10 files)
- `apiauthorization/PlatformConstants.java`
- `apiauthorization/exception/IamPolicyCreationException.java`
- `apiauthorization/extractor/ParentIdExtractorRegistry.java`
- `apiauthorization/guard/OnBehalfOfAuthorizationGuard.java`
- `apiauthorization/library/ApiRequestAuthorizationResourceIdExtractor.java`
- `apiauthorization/repo/IamPolicyGrpcRepo.java`
- `apiauthorization/service/IamPolicyCreationService.java`
- `apiauthorization/service/RequestAuthorizationService.java`
- `apiauthorization/service/TupleCreationRequest.java`
- Plus 4 tests: `IamPolicyCreationServiceTest`, `ParentIdExtractorRegistryTest`, `RequestAuthorizationConfigRegistryTest`, `RequestAuthorizationConfigRegistryDemo`

### grpc-request (36 files including tests)
Too many to list inline; see `rg` output above. Categories:
- All `context/*ContextV2.java` (Create, Update, Get, Delete, Apply, Find, Custom) — each binds `ApiResourceKind`.
- All `pipeline/operation/*/step/**StepV2.java` for Create, Update, Delete, Find — bind metadata, audit, visibility, authorization config.
- All `pipeline/step/common/*.java` — bind authorization config and visibility.
- `loader/*` — bind kind for state lookup.
- `method/RequestMethodMetadata*.java` — bind RpcAuthorizationConfig.
- `state/ApiResourceStateRepoReadAdapter.java`, `WriteAdapter.java` — bind kind.
- `validator/*` — bind FieldOptionsProto.
- `response/mapper/*` — bind audit actor.
- `util/AuditActorBuilder.java` — bind audit actor.

### infra/redis-starter (1 file)
- `infra/redisstarter/config/RedisConfiguration.java` — Redis template registration uses Stigmer proto types directly.

## Next steps

1. Update `tasks/T01_0_plan.md` to reflect the expanded scope (new buckets C, D, F, H + surprise files).
2. Sketch the neutral interfaces in `tasks/T01_2_interfaces.md` covering all buckets.
3. Capture decisions in `design-decisions/001-neutral-interfaces-and-reflection-contract.md`.
4. Get developer approval before starting T02.
