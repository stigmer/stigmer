# Task T01: Make Java Libs Proto-Agnostic

**Created**: 2026-04-19
**Status**: PENDING REVIEW
**Type**: Refactoring

## Objective

Refactor the two coupling seams in the shared Java libs so they work with ANY product's proto types, not just Stigmer's. This unblocks Maven publishing and Scenar Cloud reuse.

## The Two Coupling Seams

Based on analysis of the codebase, all Stigmer-specific coupling flows through two root types:

1. **`ApiResourceKind` enum** -- Used as a registry key in `ContextBase`, `ApiResourceRepository`, pipeline steps, and `api-shape` utilities. Today it's a proto enum with ~50 Stigmer-specific entries.
2. **`ApiResourceMetadata` concrete type** -- `ApiResourceMetadataRetriever` uses reflection to find the `metadata` field but then casts to Stigmer's `ApiResourceMetadata`. Steps like `ResolveSlugStepV2` depend on this indirectly.

Everything else (pipeline core, validation, gRPC routing) is already proto-agnostic.

## Task Breakdown

### T01: Audit and Interface Design (this task)

Map every import of `protos.ai.stigmer.*` in the lib modules and design the neutral interfaces.

- [ ] Grep all `protos.ai.stigmer` imports in `libs/java/` -- produce a complete list per module
- [ ] Design `ResourceKind` as a String-based type (or a small value object wrapping String) to replace `ApiResourceKind` enum
- [ ] Design `ResourceMetadata` interface: `id()`, `slug()`, `org()`, `name()`, `visibility()` -- with a `ProtoReflectionMetadataAdapter` that extracts these from any proto `Message` with a `metadata` field
- [ ] Design `MethodAuthorizationConfig` interface to replace `RpcAuthorizationConfig` proto
- [ ] Design `KindRegistry` interface: `register(kind, metadata)`, `resolve(kind)` -- replaces enum-based kind lookup
- [ ] Document the new interfaces in a design decision doc
- [ ] Get developer approval before proceeding

### T02: Refactor api-shape (Kind and Metadata Layer)

The foundation -- all other modules depend on this.

- [ ] Replace `ApiResourceKind` with `String` kind in `ApiResourceKindExtractor`, `ApiResourceKindsGetter`, `ApiResourceKindMetaResolver`
- [ ] Replace `ApiResourceMetadata` cast in `ApiResourceMetadataRetriever` with `ResourceMetadata` interface + reflection adapter
- [ ] Update `ApiResourceDefaultIdBuilder`, `ApiResourceIdPrefixExtractor` to use neutral types
- [ ] Update `AuthorizationConfigResolver`, `VisibilityConfigResolver` to use neutral types
- [ ] Ensure all tests pass with the new interfaces
- [ ] Stigmer-service provides concrete implementations via DI/registration

### T03: Refactor api-state (Repository Layer)

- [ ] Replace `ApiResourceKind kind()` with `String kind()` in `ApiResourceRepository` interface
- [ ] Update `AbstractMongoApiResourceRepository` to use `ResourceMetadata` interface
- [ ] Update `ApiResourceRepositoryRegistry` to use String-based kind lookup
- [ ] Verify Mongo query paths (`metadata.id`, `metadata.org`, `metadata.slug`) work with the reflection-based metadata -- these are document field paths, not Java type references
- [ ] All existing repository tests pass

### T04: Refactor grpc-request (Pipeline Layer)

- [ ] Replace `ApiResourceKind` in `ContextBase` with `String` kind
- [ ] Replace `RpcAuthorizationConfig` in `RequestMethodMetadata` with `MethodAuthorizationConfig` interface
- [ ] Update `ResolveSlugStepV2` to use `ResourceMetadata` interface
- [ ] Update `AuthorizeRequestStepV2` to use `MethodAuthorizationConfig` interface
- [ ] Update operation pipelines (Create, Update, Get, Delete, Apply, Find) -- these should need minimal changes since they compose steps
- [ ] All pipeline tests pass

### T05: Refactor api-authentication and api-authorization

- [ ] `api-authentication`: Replace `IdentityAccount` and `ApiKey` proto imports with interfaces (`AuthenticatedIdentity`, `ApiKeyDescriptor`)
- [ ] `api-authentication`: Make `StigmerJwtIssuer`/`StigmerJwtVerifier` product-neutral (rename to `PlatformJwtIssuer`/`PlatformJwtVerifier`, config-driven issuer name)
- [ ] `api-authentication`: Extract Redis template beans for Stigmer-specific types out of the core lib into stigmer-service config
- [ ] `api-authorization`: Replace `PlatformConstants.PLATFORM_RESOURCE_ID = "stigmer"` with configurable value
- [ ] `api-authorization`: Replace IAM policy proto imports with neutral authorization interfaces
- [ ] All auth tests pass

### T06: Migrate stigmer-service to Consume Refactored Libs

- [ ] Register Stigmer's `ApiResourceKind` enum values in the `KindRegistry` at startup
- [ ] Provide `StigmerResourceMetadataAdapter` that wraps proto reflection for Stigmer's `ApiResourceMetadata`
- [ ] Provide Stigmer-specific auth config mappings
- [ ] All stigmer-service integration tests pass
- [ ] No behavioral changes to any existing API

### T07: Maven Publishing Setup

- [ ] Add Maven publishing configuration (Gradle or Bazel maven_export rules)
- [ ] Define artifact coordinates: `ai.stigmer.platform:grpc-request`, `ai.stigmer.platform:api-state`, etc.
- [ ] Publish commons proto stubs as a separate artifact: `ai.stigmer.platform:api-commons-proto`
- [ ] Test: a fresh Java project can depend on the Maven artifacts and build a pipeline with custom proto types
- [ ] CI: publish snapshots on main, releases on tags

## Dependencies

- This project modifies `stigmer-cloud/backend/libs/java/` -- must not break `stigmer-service`
- Proto commons types need a publishable form (either extract from stigmer/apis or create a neutral commons proto module)

## Execution Order

T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 (sequential -- each builds on the previous)

T02 and T03 could potentially be parallelized since they touch different modules, but T02 (api-shape) should go first as api-state depends on it.

## Notes

- **IMPORTANT**: Only document in knowledge folders after ASKING for permission
- Task logs (T##_1_feedback.md, T##_2_execution.md) can be updated freely

## Review Process

**Please review this plan and provide feedback.** I will not proceed until you approve.

Consider:
- Is the interface design approach (String kind + ResourceMetadata interface) the right abstraction level?
- Should we rename the Java package from `ai.stigmer.*` to something neutral like `ai.platform.*`?
- What Maven group ID do you prefer? (`ai.stigmer.platform`, `io.scenar.platform`, something else?)
- Should the neutral commons proto be a new Buf module or extracted from the existing one?
