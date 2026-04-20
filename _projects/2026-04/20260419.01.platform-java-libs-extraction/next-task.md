# Next Task: 20260419.01.platform-java-libs-extraction

## Quick Resume Instructions

Drag this file into your conversation to quickly resume work on this project.

## Project: 20260419.01.platform-java-libs-extraction

**Description**: Refactor Stigmer Cloud's shared Java backend libraries (grpc-request pipeline, api-state, api-authentication, api-authorization, api-shape) to be proto-agnostic and publish them as Maven artifacts. This enables reuse across multiple products (Scenar Cloud, future platforms) without forking.
**Goal**: Make the core Java backend infrastructure (request pipeline, repository layer, auth framework, authorization framework) independent of any specific product's protobuf types. Replace concrete `ApiResourceKind` enum with `ResourceKind` value object + `KindRegistry`. Replace concrete `ApiResourceMetadata` casts with `ResourceMetadata` interface + reflection adapter. Replace `RpcAuthorizationConfig` and the IAM proto types with neutral interface families. Publish resulting libraries to Maven for cross-product consumption.
**Tech Stack**: Java/Spring Boot, Protocol Buffers, Bazel 8 (MODULE.bazel), Maven publishing, OpenFGA
**Components**: stigmer-cloud/backend/libs/java/{api/api-shape, api/api-state, api/api-authentication, api/api-authorization, grpc/grpc-request, grpc/grpc-router-codegen, infra/redis-starter}

## Current State

- **Status**: T01 COMPLETE — ready to start T02
- **Last Session**: 2026-04-20 — locked four foundational design decisions, ran proto-import audit, drafted Java interface sketches, rewrote T01 plan to reflect audit-expanded scope, deferred mechanical package rename from end-of-T01 to start-of-T07
- **Active Task**: T02 (Refactor api-shape — Kind, Metadata, Audit) — pending developer approval to begin

## Session Progress (2026-04-20)

- Locked four design decisions in [`design-decisions/001-neutral-interfaces-and-reflection-contract.md`](design-decisions/001-neutral-interfaces-and-reflection-contract.md):
  1. `ResourceKind` value-object + `ResourceMetadata` interface + `ProtoReflectionMetadataAdapter` (reflection by field name)
  2. Java package rename `ai.stigmer.<lib>.*` → `ai.stigmer.platform.<lib>.*` (deferred to first sub-task of T07, NOT end-of-T01)
  3. Maven group `ai.stigmer.platform`
  4. No commons proto module — per-product duplication + documented field-name contract + startup `MetadataContractValidator`
- Wrote [`tasks/T01_1_audit.md`](tasks/T01_1_audit.md): proto-import audit across all 6 lib modules, ~85 files, ~28 distinct proto types, organized into 9 conceptual coupling buckets. Audit revealed the original "two coupling seams" assumption was wrong.
- Wrote [`tasks/T01_2_interfaces.md`](tasks/T01_2_interfaces.md): Java interface sketches for every bucket (kind, metadata, audit, find request, method auth, IAM, identity) + `MetadataContractValidator` + the documented field-name contract spec.
- Rewrote [`tasks/T01_0_plan.md`](tasks/T01_0_plan.md) to reflect audit-expanded scope: added new sub-tasks for Bucket C (audit), D (find request), F (IAM), H (field options), and surprise files.
- Created session checkpoint: [`checkpoints/2026-04-20-session-1-t01-complete.md`](checkpoints/2026-04-20-session-1-t01-complete.md).
- **No code in `stigmer-cloud` was modified** — all work was scoping, design, and planning in `stigmer/_projects/`.

## Next Steps

1. **Get approval to start T02** (api-shape refactor).
2. **T02 in `stigmer-cloud`**:
   a. Implement `ResourceKind` record, `ResourceMetadata` interface, `Visibility` enum, `ProtoReflectionMetadataAdapter` under `backend/libs/java/api/api-shape/src/main/java/ai/stigmer/apishape/` (current package — rename happens in T07).
   b. Replace the `(ApiResourceMetadata)` cast on line 22 of `ApiResourceMetadataRetriever.java` with the new interface.
   c. Implement `KindRegistry` interface + default in-memory implementation.
   d. Implement `MetadataContractValidator` + `MetadataContractStartupCheck` Spring component.
   e. Refactor the kind-touching files in api-shape (`ApiResourceKindExtractor`, `ApiResourceKindsGetter`, `ApiResourceKindMetaResolver`, `ApiResourceGroupMetaResolver`, `KindNameResolver`, etc.) to use `ResourceKind` instead of the proto enum.
   f. Provide minimal Stigmer-side adapter in stigmer-service to keep it compiling (small piece of T06 needed during T02).
3. T03-T06 follow per the plan; T07 starts with the mechanical rename then Maven publishing setup.

## Context for Resume

- The mechanical package rename (`ai.stigmer.<lib>.*` → `ai.stigmer.platform.<lib>.*`) was originally planned for end-of-T01 but **was reversed mid-session** to first-sub-task-of-T07. Reasoning is in [DD-001 Decision 2](design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-2--java-package-rename-to-aistigmerplatform). T02-T06 work in the existing `ai.stigmer.<lib>.*` namespace.
- The audit revealed that `ai.stigmer.platform.github` already exists in stigmer-service (4 product files). When T07 rename runs, an optional follow-up commit may move that subpackage out so `ai.stigmer.platform.*` stays pure for cross-product infra.
- The libs' existing `ApiResourceMetadataRetriever` already does field-name lookup — only the line-22 cast is the hard proto coupling. This makes the reflection-adapter approach cheap to apply.
- `RequestMethodMetadataRegistry.java` uses `Class.forName` over `protos.ai.stigmer.*` strings. These reference proto-generated classes (not lib classes) so they'll need a config-driven base-package replacement, not just an import update.
- Bazel 8.5.0 (MODULE.bazel based, no WORKSPACE). Most lib `BUILD.bazel` files use `glob(["src/main/java/**/*.java"])` so source moves auto-track. Two BUILD.bazel files (`api-authentication`, `grpc-router-codegen`) hard-code paths and `test_class` strings — will need updating during T07's rename.

## Blockers

None. T01 is complete and waiting on developer approval to start T02.

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-04/20260419.01.platform-java-libs-extraction/next-task.md`

## Knowledge folders

- [tasks/](tasks/) — T01_0_plan.md (master plan), T01_1_audit.md (audit findings), T01_2_interfaces.md (interface sketches)
- [design-decisions/](design-decisions/) — 001-neutral-interfaces-and-reflection-contract.md
- [checkpoints/](checkpoints/) — 2026-04-20-session-1-t01-complete.md
- [coding-guidelines/](coding-guidelines/) — empty (no guidelines yet)
- [wrong-assumptions/](wrong-assumptions/) — empty
- [dont-dos/](dont-dos/) — empty

## Quick Commands

After loading context:
- "Start T02" — begin api-shape refactor in stigmer-cloud
- "Show project status" — get overview of progress against T01-T07
- "Review T01 audit" — re-read audit findings
- "Re-open the rename-timing decision" — revisit DD-001 Decision 2

---

*This file provides direct paths to all project resources for quick context loading.*
