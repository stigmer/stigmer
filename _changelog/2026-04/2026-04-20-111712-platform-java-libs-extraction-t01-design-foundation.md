# Platform Java Libs Extraction — T01 Design Foundation Complete

**Date**: April 20, 2026

## Summary

Locked the four foundational design decisions for refactoring stigmer-cloud's shared Java backend libraries to be proto-agnostic and publishable as Maven artifacts. Ran a full proto-import audit that revealed the original "two coupling seams" assumption was wrong — actual coupling spans ~85 files across 6 lib modules and 9 conceptual buckets. Drafted Java interface sketches for every bucket, captured decisions in a design-decisions doc, and rewrote the T01 plan to reflect audit-expanded scope. No source code modified — entirely a scoping and design session.

## Problem Statement

stigmer-cloud's shared Java libs (`grpc-request`, `api-state`, `api-shape`, `api-authentication`, `api-authorization`, `redis-starter`, etc.) are tightly coupled to Stigmer-specific proto types (`protos.ai.stigmer.*`). This makes them unusable from other products (Scenar Cloud, future platforms) without forking. The goal is to make these libs proto-agnostic and publish them under a neutral Maven group so multiple products can reuse the same request pipeline, repository layer, auth framework, and authorization framework infrastructure.

### Pain Points

- `ApiResourceKind` proto enum is used as a registry key in `ContextBase`, `ApiResourceRepository`, pipeline steps, and `api-shape` utilities — all keyed off Stigmer-specific enum values.
- `ApiResourceMetadataRetriever` casts to Stigmer's concrete `ApiResourceMetadata` proto type, blocking other products from using the metadata-extraction logic with their own metadata messages.
- `RpcAuthorizationConfig` and the IAM proto types (`IamPolicySpec`, `IamPermission`, `IamRole`) are deeply embedded in the request authorization pipeline.
- The original T01 plan claimed coupling flowed through "two root types" — the audit proved this was a dramatic underestimate.
- Without resolving these couplings, every product needs its own fork of the libs, defeating the purpose of having shared infrastructure.

## Solution

A four-decision design foundation:

1. **String-keyed `ResourceKind` value object + `ResourceMetadata` Java interface + `ProtoReflectionMetadataAdapter`** that reads sub-fields by NAME via proto reflection. The libs depend on the interface, not on any concrete proto type. The same shape extends to audit, authorization config, IAM policy, and identity buckets.

2. **Java package rename `ai.stigmer.<lib>.*` → `ai.stigmer.platform.<lib>.*`** for every extracted lib. Originally planned for end-of-T01 but **reversed mid-session** to first sub-task of T07 (Maven publishing) after pre-flight discovery surfaced that an upfront mechanical PR has zero functional value before publishing.

3. **Maven group ID `ai.stigmer.platform`**. Artifacts: `ai.stigmer.platform:{api-shape, api-state, api-authentication, api-authorization, grpc-request, redis-starter, grpc-router-codegen}`. Mirrors the Java package naming. Leaves `ai.stigmer.<product>:*` free for product-specific artifacts.

4. **No commons proto module published.** Each product duplicates the small handful of contract messages (`ApiResourceMetadata`, audit, visibility, field options) in its own apis repo. The libs read fields BY NAME via reflection, with a `MetadataContractValidator` Spring component that runs at application startup and FAILS FAST if any registered proto type doesn't satisfy the documented field-name contract.

The reflection-adapter pattern works because the existing `ApiResourceMetadataRetriever` already does `findFieldByName("metadata")` — only the cast on line 22 is the hard proto coupling.

## Implementation Details

### Audit findings

Ran `rg "^import protos\.ai\.stigmer\." backend/libs/java/` and grouped by module + conceptual bucket:

- **~85 files** across all 6 lib modules import from `protos.ai.stigmer.*`
- **~28 distinct proto types** imported
- **9 conceptual coupling buckets** (4 of which were entirely missing from the original plan):
  - Bucket A: Resource kind / kind metadata
  - Bucket B: Resource metadata + visibility
  - **Bucket C: Audit trail (NEW)** — `ApiResourceAudit`, `AuditActor`, `AuditInfo`, `EventType` are pervasive in pipeline steps
  - **Bucket D: gRPC find request envelope (NEW)** — `FindApiResourcesRequest` is a typed parameter of the find pipeline
  - Bucket E: Method authorization config
  - **Bucket F: IAM types (NEW)** — `IamPolicySpec`, `IamPermission`, `IamRole`, `RoleInfo`, `ApiResourceRef` are deeply embedded
  - Bucket G: Identity / API key types
  - **Bucket H: Field-level proto extensions (NEW)** — `FieldOptionsProto` for marker options like `[(api_resource.computed) = true]`
  - Bucket I: Concrete agentic types in tests (cleanup, not refactor)
- Three **surprise files outside the original module list**:
  - `infra/redis-starter/RedisConfiguration.java` — Redis serializer registration uses Stigmer proto types directly
  - `api-state/ApiResourceProtoClassesDiscoverer.java` — uses kind enum descriptor for proto-class discovery
  - `grpc-request/method/RequestMethodMetadata*.java` — holds `RpcAuthorizationConfig` directly

### Interface sketches

Written as Java signatures (no implementations) in `tasks/T01_2_interfaces.md`:

- `ResourceKind` (record value-object), `KindRegistry`, `KindMetadata`
- `ResourceMetadata`, `Visibility` enum, `ProtoReflectionMetadataAdapter`
- `ResourceAudit`, `AuditInfo`, `AuditActor`, `AuditEventType`, `ProtoReflectionAuditAdapter`
- `FindRequest`, `ProtoReflectionFindRequestAdapter`
- `MethodAuthorizationConfig`, `KindAuthorizationConfig`, `OwnerAttribution`, `ParentRelation`, `AuthorizationScope`
- `AuthorizationPolicy`, `RoleBinding`, `Role`, `Permission`, `ResourceRef`
- `AuthenticatedIdentity`, `ApiKeyDescriptor`
- `MetadataContractValidator`, `ContractViolation`, `MetadataContractStartupCheck`

### The metadata field-name contract

Documented in `tasks/T01_2_interfaces.md`. The libs require the following field-name conventions on any registered proto type:

| Path | Type | Required | Notes |
|------|------|----------|-------|
| `resource.metadata` | message | yes | sub-message containing the fields below |
| `metadata.id` / `slug` / `org` / `name` | string | yes | core identifying fields |
| `metadata.visibility` | enum | yes | values 0=UNSPECIFIED, 1=PUBLIC, 2=PRIVATE |
| `metadata.version` / `labels` / `annotations` / `tags` | various | no | optional |
| `resource.status.audit` (for audited kinds) | message | yes | with sub-fields per audit contract |
| `request.page_size` / `page_token` / `parent` / `filters` (for find) | various | mostly yes | |

Each product MUST define its own messages with these field NAMES. Field NUMBERS may differ since the libs key off names via descriptor introspection.

### Mid-session decision reversal

The mechanical package rename was originally scheduled as the last step of T01. Pre-flight discovery surfaced three reasons to defer it to T07:

1. `ai.stigmer.platform.github` already exists in stigmer-service (4 files for GitHub OAuth) — the rename works functionally but conceptually muddies the namespace until that subpackage is also moved out.
2. The "dual-import mess during T02-T06" argument used to justify upfront timing was incorrect. Stigmer-service consistently imports `ai.stigmer.<lib>.*` through all of T02-T06 in either timing scenario.
3. The rename has zero functional value until Maven publishing (T07). Doing it upfront produces a ~200-file mechanical PR with no reviewer-facing motivation.

The reversal is documented in [DD-001 Decision 2](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-2--java-package-rename-to-aistigmerplatform). T02-T06 will work in the existing `ai.stigmer.<lib>.*` namespace; T07 starts with the rename then proceeds to Maven publishing setup.

## Benefits

- **Unblocks Scenar Cloud reuse.** Once T02-T07 land, Scenar Cloud can depend on `ai.stigmer.platform:*` artifacts and reuse the entire request pipeline + repository layer + auth framework with its own proto types.
- **Eliminates the need for a commons proto repo.** Per-product duplication of ~50 lines of proto avoids cross-repo coordination overhead and keeps each product's contracts in one place (the project owner's stated preference).
- **Fail-fast contract validation.** `MetadataContractValidator` runs at application startup and refuses to boot if a proto type misses a required field name — bad config caught at deploy time, not at first request.
- **Smaller, single-purpose PRs in T02-T07.** Deferring the rename keeps each refactor PR focused on one bucket of coupling at a time. The eventual rename PR is one-shot, well-motivated ("preparing to publish Maven artifacts under `ai.stigmer.platform`").
- **Audit-driven scope.** The audit caught four entire coupling buckets that the original plan missed. Without the audit, T02-T07 would have hit those buckets as surprises during execution.

## Impact

- **Stigmer Cloud backend team**: T02-T06 will refactor the libs in-place over the next ~3 weeks. Stigmer-service compiles continuously; no big-bang change.
- **Scenar Cloud backend team**: After T07 publishes Maven artifacts, Scenar Cloud can depend on the platform libs and remove its forked copies. Each product needs to define ~50 lines of proto satisfying the field-name contract.
- **Future products**: Onboarding cost drops to "define your protos with the field-name contract + register your kinds with the KindRegistry."
- **Stigmer-service codebase**: Will receive small adapter classes (in T06) bridging Stigmer's existing `ApiResourceKind` enum into the new `KindRegistry`, plus authorization/identity adapters.

## Related Work

- **Project**: [_projects/2026-04/20260419.01.platform-java-libs-extraction/](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/)
- **Design decision**: [DD-001 Neutral interfaces and reflection contract](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/design-decisions/001-neutral-interfaces-and-reflection-contract.md)
- **Audit findings**: [T01_1_audit.md](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/tasks/T01_1_audit.md)
- **Interface sketches**: [T01_2_interfaces.md](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/tasks/T01_2_interfaces.md)
- **Master plan**: [T01_0_plan.md](../../_projects/2026-04/20260419.01.platform-java-libs-extraction/tasks/T01_0_plan.md)
- **Sister project (downstream consumer)**: [_projects/2026-04/20260419.02.scenar-proto-foundation/](../../../scenar/_projects/2026-04/20260419.02.scenar-proto-foundation/) — Scenar Cloud's proto foundation that will consume these libs.
- **Previous changelog (project scaffolding)**: [`bc6c1e030 docs(projects): finalize secrets-vault-migration design plan`](../2026-04-18-173249-fix-scenar-tailwind-class-detection.md) era — this is the first design-foundation changelog for the libs-extraction project.

---

**Status**: ✅ T01 Complete — Ready for T02
**Timeline**: 1 session (~3 hours of design + audit + planning)
