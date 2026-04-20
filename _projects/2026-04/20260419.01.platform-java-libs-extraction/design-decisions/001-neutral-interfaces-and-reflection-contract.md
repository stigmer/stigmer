# DD-001: Neutral interfaces, package rename, no commons proto module

**Date**: 2026-04-20
**Status**: ACCEPTED
**Authorized by**: Developer (in T01 review session, 2026-04-20)

## Context

The Stigmer Cloud Java libs (`grpc-request`, `api-state`, `api-shape`, `api-authentication`, `api-authorization`) currently import directly from `protos.ai.stigmer.*`, making them unusable in other products (Scenar Cloud, future platforms) without forking. The audit ([T01_1_audit.md](../tasks/T01_1_audit.md)) confirmed ~85 files across all six lib modules touch these proto types, grouped into ~9 conceptual buckets.

This document captures the four foundational decisions that shape the entire refactor (T02-T07).

## Decision 1 — Abstraction shape: `String`-keyed kind + `ResourceMetadata` interface + reflection adapter

**Decision**

Replace concrete proto types with three neutral Java types:

1. **`ResourceKind`** — a value-object record `record ResourceKind(String value)` (typed wrapper around String, NOT bare String — the wrapper prevents accidental string-arg confusion at call sites).
2. **`ResourceMetadata`** — a Java interface exposing `id()`, `slug()`, `org()`, `name()`, `visibility()`, `version()`. The libs depend ONLY on this interface.
3. **`ProtoReflectionMetadataAdapter`** — adapter that wraps any `com.google.protobuf.Message` and pulls metadata sub-fields by NAME via reflection (`findFieldByName("metadata")` then `findFieldByName("slug")` etc.). No cast to a specific proto type.

The same shape applies to other buckets surfaced by the audit:

- **Audit (Bucket C)**: `ResourceAudit`, `ResourceAuditActor`, `AuditEvent` interfaces + reflection adapters.
- **Authorization config (Bucket E)**: `MethodAuthorizationConfig`, `KindAuthorizationConfig`, `ParentRelationConfig` interfaces.
- **IAM (Bucket F)**: `AuthorizationPolicy`, `Permission`, `Role` interfaces (replacing `IamPolicySpec`/`IamPermission`/`IamRole`).
- **Identity (Bucket G)**: `AuthenticatedIdentity`, `ApiKeyDescriptor` interfaces.

**Rationale**

- The existing `ApiResourceMetadataRetriever` already does field-name lookup (`findFieldByName("metadata")`); the only hard coupling is the cast on line 22. Replacing that cast with an interface is a localized change.
- Reflection lets each product define its own proto types with the same field names; no shared proto type required.
- Interfaces give type safety in the lib while leaving the concrete proto type pluggable per product.
- A typed `ResourceKind` wrapper prevents the "stringly-typed" smell while keeping the runtime representation a String.

**Consequences**

- The libs depend on the interfaces, not on any proto type.
- Each product implements the interfaces (or relies on the reflection adapters).
- The libs need a startup-time validator (see Decision 4) to fail fast if a registered proto type doesn't satisfy the field-name contract.

## Decision 2 — Java package rename to `ai.stigmer.platform.*`

**Decision**

Rename all extracted lib packages from `ai.stigmer.<module>.*` to `ai.stigmer.platform.<module>.*`:

- `ai.stigmer.apishape.*` → `ai.stigmer.platform.apishape.*`
- `ai.stigmer.requestpipeline.*` → `ai.stigmer.platform.requestpipeline.*` (and other lib roots)
- `ai.stigmer.apistate.*` → `ai.stigmer.platform.apistate.*`
- `ai.stigmer.apiauthentication.*` → `ai.stigmer.platform.apiauthentication.*`
- `ai.stigmer.apiauthorization.*` → `ai.stigmer.platform.apiauthorization.*`
- `ai.stigmer.grpcrequest.*` → `ai.stigmer.platform.grpcrequest.*`
- `ai.stigmer.infra.*` → `ai.stigmer.platform.infra.*`

**Rationale**

- Mirrors the Maven group `ai.stigmer.platform` (Decision 3).
- Reads correctly when consumed from Scenar Cloud (e.g., `import ai.stigmer.platform.requestpipeline.PipelineStep`).
- Signals "platform infra owned by stigmer org" vs. "stigmer-the-product".
- Stays under `ai.stigmer.*` org root — no debate about a more-neutral root like `ai.platform.*`.

**Timing** (decided in plan, no developer input requested)

Done as the **first step of T07** in a single dedicated mechanical commit, immediately before Maven publishing setup. NOT upfront at the end of T01.

This was reversed from an earlier upfront-timing decision after pre-flight discovery surfaced:

- `ai.stigmer.platform.github` already exists in stigmer-service (4 product files for GitHub OAuth). Doing the lib rename upfront muddies the namespace until the github subpackage is also moved out, and that cleanup is unrelated to the libs extraction.
- The "dual-import mess during T02-T06" argument originally cited for upfront timing is incorrect — stigmer-service consistently imports `ai.stigmer.<lib>.*` through all of T02-T06 in either timing scenario. There is no mid-task dual-import condition.
- The rename has zero functional value before Maven publishing. Doing it upfront produces a large mechanical PR with no reviewer-facing motivation other than "preparing for something later". Doing it as the first step of T07 makes the motivation immediate ("we are about to publish Maven artifacts under `ai.stigmer.platform`").
- The full scope (12 lib modules, 8 root packages, ~200+ Java files to move, plus `BUILD.bazel` test-class string updates and Spring `@ComponentScan` review) is large enough that bundling it with the actual refactor work would dominate review attention.

T07 will execute the rename in this order:
1. Single dedicated commit titled "Move shared libs under ai.stigmer.platform.* namespace". IDE refactor-rename across libs + stigmer-service in one pass. Verified by full `bazel build //...` + `bazel test //...`. Pure rename, zero behavior change.
2. (Optional, separate follow-up) Move `ai.stigmer.platform.github` out of `ai.stigmer.platform.*` to keep that namespace pure for platform infra.
3. Maven publishing setup follows.

## Decision 3 — Maven group ID `ai.stigmer.platform`

**Decision**

Publish lib artifacts under group `ai.stigmer.platform`:

- `ai.stigmer.platform:grpc-request`
- `ai.stigmer.platform:api-state`
- `ai.stigmer.platform:api-shape`
- `ai.stigmer.platform:api-authentication`
- `ai.stigmer.platform:api-authorization`
- `ai.stigmer.platform:redis-starter`
- `ai.stigmer.platform:grpc-router-codegen`

**Rationale**

- Mirrors the Java package naming (Decision 2).
- Leaves `ai.stigmer.<product>:*` free for product-specific artifacts.
- Distinguishes "platform infra (consumable by anyone)" from "stigmer product code".

## Decision 4 — No commons proto module; field-name contract + startup validator

**Decision**

**Do NOT publish a separate "commons proto" Maven artifact.** Each product duplicates the small handful of contract messages in its own apis repo:

- `ApiResourceMetadata` (~10-line message)
- `ApiResourceVisibility` (enum)
- `ApiResourceAudit` / `ApiResourceAuditActor` / `ApiResourceAuditInfo` / `ApiResourceEventType`
- `FieldOptionsProto` (custom proto field options)

Each product keeps these in its own apis repo (e.g., `stigmer/apis/ai/stigmer/commons/apiresource/*` and `stigmer/scenar/apis/ai/scenar/commons/apiresource/*`).

The contract is a documented field-name spec, not a proto type. The libs' reflection adapters look up fields by NAME, so any proto with the right field names works.

A `MetadataContractValidator` runs at application startup, scans every proto descriptor registered in the `KindRegistry`, and FAILS FAST if any of:
- `metadata` sub-field is missing or not a message
- `metadata.id`, `metadata.slug`, `metadata.org`, `metadata.name`, `metadata.visibility` are missing or wrong types
- `audit` sub-field on the status message doesn't match the audit contract
- `[(api_resource.computed) = true]` field options don't match the documented option name

**Rationale**

- **Contract locality** (developer's stated goal): readers of `scenar/apis/*` see all of Scenar's contracts in one place without jumping repos.
- **Independent evolution**: Scenar can add a `description` field to its metadata without coordinating PRs to a shared proto repo.
- **Architecturally sound**: the libs are already reflection-based, so they don't need a shared proto type to function.
- **Cost of duplication is near-zero** (~50 lines of proto per product, total).
- **Risk mitigated by validator**: misnamed fields fail at boot, not at first request.

**Trade-off**

- "Convention-over-configuration" coupling: if Scenar misnames `slug` to `handle`, the lib silently breaks. Mitigated by the validator.
- Contract drift risk: if the libs add a new required field (e.g., `metadata.tenant`), every product must update. Mitigated by versioning the contract spec and gating it via the validator.

## Cross-cutting consequences for the plan

- **T07 simplification**: drops the "publish commons proto stubs as separate artifact" sub-task. T07 publishes ONLY the Java libs.
- **T02 addition**: must include `MetadataContractValidator` as a deliverable.
- **Audit (Bucket C) elevation**: audit interfaces are now part of T02, not an afterthought.
- **IAM (Bucket F) decision**: keep IAM types out of the libs; introduce neutral `AuthorizationPolicy` interface family in T05.
- **Mechanical rename**: First step of T07 (immediately before Maven publishing). NOT in T01.
- **`infra/redis-starter` config refactor**: Redis template registration must become config-driven (T05 scope addition).
- **`api-state` proto-class discoverer** must switch from enum-based to base-package scan (T03 scope addition).

## References

- [T01_1_audit.md](../tasks/T01_1_audit.md) — full audit findings
- [T01_2_interfaces.md](../tasks/T01_2_interfaces.md) — neutral interface sketches
- [T01_0_plan.md](../tasks/T01_0_plan.md) — execution plan
